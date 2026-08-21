// chat.js — Chat UI + provider abstraction.
// Two providers:
//   "remote" — OpenAI-compatible HTTP API (DeepSeek, OpenAI, OpenRouter, Groq).
//   "local"  — On-device model via transformers.js (loaded in localModel.js).

(function () {
  const CodexChat = {
    history: [],
    streaming: false,
    onUpdate: null,

    pushMessage(role, content) {
      this.history.push({ role, content });
      if (this.onUpdate) this.onUpdate();
    },
    clear() {
      this.history = [];
      if (this.onUpdate) this.onUpdate();
    },
    setOnUpdate(cb) { this.onUpdate = cb; },

    async send({ provider, apiBase, apiKey, model, systemPrompt, temperature }, onChunk, onDone, onError) {
      if (this.streaming) return;
      this.streaming = true;
      const sys = systemPrompt || "You are a concise coding assistant. Reply in code blocks when helpful.";
      const msgs = [{ role: "system", content: sys }, ...this.history];
      try {
        if (provider === "local") {
          const lm = window.CodexLocalModel;
          if (!lm.loadedModelId()) throw new Error("No local model loaded. Open Setup → Local Model.");
          const acc = { content: "" };
          for await (const partial of lm.chat(msgs, { temperature })) {
            acc.content = partial;
            onChunk(partial);
          }
          this.history.push({ role: "assistant", content: acc.content });
          onDone(acc.content);
        } else {
          const url = (apiBase || "https://api.deepseek.com").replace(/\/+$/, "") + "/v1/chat/completions";
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + (apiKey || ""),
            },
            body: JSON.stringify({
              model: model || "deepseek-chat",
              messages: msgs,
              stream: true,
              temperature: temperature ?? 0.7,
            }),
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => "");
            throw new Error("HTTP " + res.status + ": " + txt.slice(0, 200));
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let acc = "";
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
                const delta = json.choices?.[0]?.delta?.content || "";
                if (delta) { acc += delta; onChunk(acc); }
              } catch (e) { /* ignore */ }
            }
          }
          this.history.push({ role: "assistant", content: acc });
          onDone(acc);
        }
      } catch (e) {
        onError(e);
      } finally {
        this.streaming = false;
      }
    },
  };

  window.CodexChat = CodexChat;
})();
