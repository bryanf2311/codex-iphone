// agent.js — agentic loop. The model gets a list of tools; when it returns
// tool_calls, we run them and feed the results back. Loops until the model
// either returns plain text (final answer) or hits the step limit.

(function () {
  const TOOLS = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the contents of a file from the local project. Path is relative to the project root.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "Path to the file, e.g. 'src/main.ts'" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Create or overwrite a file. Use this to save code the agent has written.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to write to" },
            content: { type: "string", description: "Full file content" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List every file currently in the local project, with size.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "run_code",
        description: "Execute JavaScript or Python in the sandbox and return stdout/stderr. Language is 'javascript' or 'python'.",
        parameters: {
          type: "object",
          properties: {
            language: { type: "string", enum: ["javascript", "python"] },
            code: { type: "string" },
          },
          required: ["language", "code"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description: "Delete a file from the local project.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish",
        description: "Call this when the task is complete. Pass a short summary of what was done.",
        parameters: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
        },
      },
    },
  ];

  // Execute a tool by name. Returns { ok, result } | { ok: false, error }.
  async function runTool(name, args, ctx) {
    try {
      switch (name) {
        case "list_files": {
          const files = await ctx.DB.Files.list();
          return { ok: true, result: files.map((f) => ({ path: f.name, bytes: f.content.length })) };
        }
        case "read_file": {
          const f = await ctx.DB.Files.get(args.path);
          if (!f) return { ok: false, error: "no such file: " + args.path };
          return { ok: true, result: { path: f.name, content: f.content } };
        }
        case "write_file": {
          if (!args.path || typeof args.content !== "string") return { ok: false, error: "write_file requires path and content" };
          await ctx.DB.Files.put({ name: args.path, content: args.content, language: window.CodexEditor.detectLanguage(args.path) });
          if (ctx.onChange) ctx.onChange();
          return { ok: true, result: "wrote " + args.path + " (" + args.content.length + " bytes)" };
        }
        case "delete_file": {
          await ctx.DB.Files.delete(args.path);
          if (ctx.onChange) ctx.onChange();
          return { ok: true, result: "deleted " + args.path };
        }
        case "run_code": {
          const lang = (args.language || "javascript").toLowerCase();
          let out = "";
          if (lang === "javascript") {
            await ctx.Runner.runJavaScript(args.code, (level, text) => { out += "[" + level + "] " + text + "\n"; });
          } else if (lang === "python") {
            await ctx.Runner.runPython(args.code, (level, text) => { out += "[" + level + "] " + text + "\n"; });
          } else {
            return { ok: false, error: "unsupported language: " + lang };
          }
          return { ok: true, result: out.trim() || "(no output)" };
        }
        case "finish": {
          return { ok: true, result: args.summary || "done", finished: true };
        }
        default:
          return { ok: false, error: "unknown tool: " + name };
      }
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // Build the JSON tool-call wire format we send to remote APIs.
  // Returns messages array updated for one step.
  async function stepRemote({ apiBase, apiKey, model, messages, onChunk, onToolCall }) {
    const url = (apiBase || "https://api.deepseek.com").replace(/\/+$/, "") + "/v1/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (apiKey || "") },
      body: JSON.stringify({ model: model || "deepseek-chat", messages, tools: TOOLS, tool_choice: "auto", stream: true }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", acc = "", toolCalls = {};
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const choice = json.choices?.[0];
          const delta = choice?.delta || {};
          if (delta.content) { acc += delta.content; onChunk && onChunk(acc); }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0;
              toolCalls[i] = toolCalls[i] || { id: "", type: "function", function: { name: "", arguments: "" } };
              if (tc.id) toolCalls[i].id = tc.id;
              if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
            }
          }
        } catch (e) {}
      }
    }
    const tcs = Object.values(toolCalls);
    if (tcs.length) onToolCall && onToolCall(tcs);
    return { content: acc, toolCalls: tcs };
  }

  // Run a multi-step agentic loop. Streams progress via onEvent.
  // onEvent({ kind: "text"|"tool_call"|"tool_result"|"done", ... })
  async function run({ provider, ctx, goal, maxSteps = 8, onEvent, abortSignal }) {
    const systemPrompt = (ctx.systemPrompt || "") +
      "\n\nYou are an autonomous coding agent. Use the provided tools to read, write, and run code. " +
      "When the task is complete, call the finish tool with a short summary.";
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: goal },
    ];

    for (let step = 0; step < maxSteps; step++) {
      if (abortSignal && abortSignal.aborted) { onEvent && onEvent({ kind: "done", reason: "aborted" }); return; }
      onEvent && onEvent({ kind: "step", index: step });

      let result;
      if (provider === "local") {
        const lm = window.CodexLocalModel;
        if (!lm.loadedModelId()) throw new Error("No local model loaded. Open Setup → Local Model.");
        // Local models in transformers.js v3 don't have a built-in tool-use
        // protocol. We emulate one with a structured prompt: ask the model to
        // emit a JSON list of tool calls, or a final answer.
        const acc = { content: "" };
        const toolPrompt = buildLocalToolPrompt(messages, TOOLS);
        for await (const partial of lm.chat([{ role: "system", content: toolPrompt.system }, ...toolPrompt.history], { temperature: 0.2, max_new_tokens: 512 })) {
          acc.content = partial;
        }
        const parsed = parseLocalToolOutput(acc.content);
        result = { content: parsed.text || "", toolCalls: parsed.toolCalls };
      } else {
        result = await stepRemote({
          apiBase: ctx.apiBase, apiKey: ctx.apiKey, model: ctx.model, messages,
          onChunk: (partial) => onEvent && onEvent({ kind: "text", text: partial }),
        });
      }

      if (result.content) {
        messages.push({ role: "assistant", content: result.content });
      }

      if (!result.toolCalls || !result.toolCalls.length) {
        onEvent && onEvent({ kind: "done", reason: "no_tool_calls" });
        return { messages, final: result.content };
      }

      // Execute each tool call.
      let finished = false;
      for (const tc of result.toolCalls) {
        let name, args = {};
        try {
          if (provider === "local") {
            name = tc.name; args = tc.args || {};
          } else {
            name = tc.function?.name;
            args = JSON.parse(tc.function?.arguments || "{}");
          }
        } catch (e) { args = {}; }
        onEvent && onEvent({ kind: "tool_call", name, args });
        const out = await runTool(name, args, ctx);
        onEvent && onEvent({ kind: "tool_result", name, ok: out.ok, result: out.result, error: out.error });
        if (provider === "remote") {
          messages.push({ role: "tool", tool_call_id: tc.id, content: out.ok ? JSON.stringify(out.result) : "ERROR: " + out.error });
        } else {
          messages.push({ role: "user", content: `[tool result: ${name}]\n` + (out.ok ? JSON.stringify(out.result) : "ERROR: " + out.error) });
        }
        if (out.finished) finished = true;
      }
      if (finished) { onEvent && onEvent({ kind: "done", reason: "finished" }); return { messages, final: result.content }; }
    }
    onEvent && onEvent({ kind: "done", reason: "max_steps" });
    return { messages, final: messages[messages.length - 1]?.content || "" };
  }

  // Build a prompt for local models that tells them to emit a JSON list
  // of tool calls, or a final answer.
  function buildLocalToolPrompt(messages, tools) {
    const toolList = tools.map((t) => `- ${t.function.name}(${Object.keys(t.function.parameters.properties || {}).join(", ")}) — ${t.function.description}`).join("\n");
    const system = `You are a coding agent. To use a tool, reply with ONLY a JSON object on a single line of the form {"tool_calls":[{"name":"...","args":{...}}]}. To give a final answer, reply with JSON: {"answer":"..."}.\n\nAvailable tools:\n${toolList}\n\nDo not wrap in markdown. Do not include any other text.`;
    const history = messages.map((m) => `<|${m.role}|>\n${m.content}\n`).join("");
    return { system, history: [{ role: "user", content: history + "<|assistant|>\n" }] };
  }

  function parseLocalToolOutput(text) {
    const out = { text: "", toolCalls: [] };
    if (!text) return out;
    // Try to extract JSON
    const trimmed = text.trim();
    const tryParse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
    let obj = tryParse(trimmed);
    if (!obj) {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) obj = tryParse(trimmed.slice(start, end + 1));
    }
    if (obj) {
      if (Array.isArray(obj.tool_calls)) {
        obj.tool_calls.forEach((tc, i) => out.toolCalls.push({ id: "local_" + i, name: tc.name, args: tc.args || {} }));
      } else if (typeof obj.answer === "string") {
        out.text = obj.answer;
      } else {
        out.text = trimmed;
      }
    } else {
      out.text = trimmed;
    }
    return out;
  }

  window.CodexAgent = { run, TOOLS };
})();
