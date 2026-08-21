// app.js — UI orchestration. Wires tabs, editor, files, runner, chat, settings.

(function () {
  const $ = (id) => document.getElementById(id);
  const DB = window.CodexDB;
  const Editor = window.CodexEditor;
  const Runner = window.CodexRunner;
  const Chat = window.CodexChat;
  const LocalModel = window.CodexLocalModel;

  // ── State ────────────────────────────────────────────────────
  const state = {
    activeTab: "editor",
    activeFile: null,
    files: [],
    provider: "local",     // "local" | "remote"
    apiBase: "https://api.deepseek.com",
    apiKey: "",
    defaultModel: "deepseek-chat",
    systemPrompt: "You are Codex, a concise coding assistant running on an iPhone. Reply in fenced code blocks. Keep prose short.",
    hfToken: "",
    customModelId: "",
    ghToken: "",
    ghOwner: "",
    ghRepo: "",
    ghBranch: "main",
    saveTimer: null,
  };

  // ── DOM refs ─────────────────────────────────────────────────
  const els = {
    tabs: document.querySelectorAll(".tabbtn"),
    panes: document.querySelectorAll(".tab-pane"),
    fileSelect: $("fileSelect"),
    langSelect: $("languageSelect"),
    fileList: $("fileList"),
    fileItems: () => document.querySelectorAll("#fileList li"),
    renameBtn: $("renameBtn"),
    deleteBtn: $("deleteBtn"),
    newFileBtn: $("newFileBtn"),
    newFileBtn2: $("newFileBtn2"),
    chatLog: $("chatLog"),
    chatForm: $("chatForm"),
    chatInput: $("chatInput"),
    modelSelect: $("modelSelect"),
    clearChatBtn: $("clearChatBtn"),
    runLang: $("runLang"),
    runBtn: $("runBtn"),
    stopBtn: $("stopBtn"),
    terminal: $("terminal"),
    previewWrap: $("previewWrap"),
    settingsForm: $("settingsForm"),
    apiBase: $("apiBase"),
    apiKey: $("apiKey"),
    defaultModel: $("defaultModel"),
    systemPrompt: $("systemPrompt"),
    hfToken: $("hfToken"),
    saveHfTokenBtn: $("saveHfTokenBtn"),
    customModelId: $("customModelId"),
    loadCustomBtn: $("loadCustomBtn"),
    pickFolderBtn: $("pickFolderBtn"),
    pickFilesBtn: $("pickFilesBtn"),
    folderPicker: $("folderPicker"),
    filePicker: $("filePicker"),
    sideloadName: $("sideloadName"),
    sideloadFamily: $("sideloadFamily"),
    cacheList: $("cacheList"),
    clearCacheBtn: $("clearCacheBtn"),
    refreshCacheBtn: $("refreshCacheBtn"),
    exportBtn: $("exportBtn"),
    importBtn: $("importBtn"),
    importFile: $("importFile"),
    settingsStatus: $("settingsStatus"),
    statusStrip: $("statusStrip"),
    statusText: $("statusText"),
    statusMeter: $("statusMeter"),
    inlineForm: $("inlineForm"),
    inlineInput: $("inlineInput"),
    toast: $("toast"),
    buildLang: $("buildLang"),
    buildBtn: $("buildBtn"),
    buildEntry: $("buildEntry"),
    buildOutput: $("buildOutput"),
    saveBuildOutputBtn: $("saveBuildOutputBtn"),
    copyBuildOutputBtn: $("copyBuildOutputBtn"),
    agentProvider: $("agentProvider"),
    agentStartBtn: $("agentStartBtn"),
    agentStopBtn: $("agentStopBtn"),
    agentLog: $("agentLog"),
    agentForm: $("agentForm"),
    agentInput: $("agentInput"),
    ghForm: $("gitForm"),
    ghToken: $("ghToken"),
    ghLoginBtn: $("ghLoginBtn"),
    ghUser: $("ghUser"),
    ghOwner: $("ghOwner"),
    ghRepo: $("ghRepo"),
    ghBranch: $("ghBranch"),
    ghMessage: $("ghMessage"),
    ghPushBtn: $("ghPushBtn"),
    ghHistoryBtn: $("ghHistoryBtn"),
    ghStatus: $("ghStatus"),
    ghCommits: $("ghCommits"),
  };

  // ── UI helpers ───────────────────────────────────────────────
  function setStatus(state, text, pct) {
    els.statusStrip.dataset.state = state;
    els.statusText.textContent = text;
    if (typeof pct === "number") els.statusMeter.firstElementChild.style.width = Math.max(0, Math.min(100, pct)) + "%";
    else if (pct === null) els.statusMeter.firstElementChild.style.width = "0%";
  }
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
  }
  // Inline prompt: opens a small bar above the editor. No overlay, no modal.
  let inlineResolve = null;
  function inlinePrompt(placeholder, def = "") {
    return new Promise((resolve) => {
      inlineResolve = resolve;
      els.inlineInput.placeholder = placeholder || "";
      els.inlineInput.value = def || "";
      els.inlineForm.hidden = false;
      setTimeout(() => { els.inlineInput.focus(); els.inlineInput.select(); }, 40);
    });
  }
  function closeInline(value) {
    els.inlineForm.hidden = true;
    const r = inlineResolve; inlineResolve = null;
    if (r) r(value);
  }
  $("inlineOk").addEventListener("click", () => closeInline(els.inlineInput.value));
  $("inlineCancel").addEventListener("click", () => closeInline(null));
  els.inlineInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); closeInline(els.inlineInput.value); }
    else if (e.key === "Escape") { e.preventDefault(); closeInline(null); }
  });

  function extFromName(name) { return (name.split(".").pop() || "").toLowerCase(); }
  function langFromName(name) { return Editor.detectLanguage(name); }
  function iconForName(name) {
    const ext = extFromName(name);
    return ext ? ext.slice(0, 3).toUpperCase() : "FILE";
  }

  // ── Tabs ─────────────────────────────────────────────────────
  function setTab(name) {
    state.activeTab = name;
    els.tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    els.panes.forEach((p) => p.classList.toggle("active", p.dataset.tab === name));
    if (name === "editor") setTimeout(() => Editor.focus(), 50);
    if (name === "chat") renderChat();
  }
  els.tabs.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // ── Files ────────────────────────────────────────────────────
  async function loadFiles() {
    state.files = await DB.Files.list();
    renderFileSelect();
    renderFileList();
    rebuildBuildEntrySelect();
    if (!state.activeFile && state.files.length) selectFile(state.files[0].name);
  }
  function renderFileSelect() {
    els.fileSelect.innerHTML = "";
    state.files.forEach((f) => {
      const o = document.createElement("option");
      o.value = f.name; o.textContent = f.name;
      if (f.name === state.activeFile) o.selected = true;
      els.fileSelect.appendChild(o);
    });
  }
  function renderFileList() {
    els.fileList.innerHTML = "";
    state.files.forEach((f) => {
      const li = document.createElement("li");
      li.dataset.name = f.name;
      if (f.name === state.activeFile) li.classList.add("active");
      li.innerHTML = `
        <span class="file-icon">${iconForName(f.name)}</span>
        <span class="file-name">${escapeHTML(f.name)}</span>
        <span class="file-size">${(f.content.length / 1024).toFixed(1)}k</span>`;
      li.addEventListener("click", () => { selectFile(f.name); setTab("editor"); });
      els.fileList.appendChild(li);
    });
  }
  function escapeHTML(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c])); }

  async function selectFile(name) {
    if (state.activeFile === name) return;
    await flushActiveFile();
    state.activeFile = name;
    const rec = await DB.Files.get(name);
    if (!rec) return;
    Editor.setValue(rec.content || "");
    const lang = langFromName(name);
    els.langSelect.value = lang;
    Editor.setLanguage(lang);
    renderFileSelect();
    renderFileList();
  }
  async function flushActiveFile() {
    if (!state.activeFile) return;
    const content = Editor.getValue();
    await DB.Files.put({ name: state.activeFile, content, language: langFromName(state.activeFile) });
  }
  async function createFile(name) {
    if (!name) return;
    if (!/\.[a-z0-9]+$/i.test(name)) name = name + ".js";
    const exists = await DB.Files.get(name);
    if (exists) { toast("File exists"); return; }
    await DB.Files.put({ name, content: "", language: langFromName(name) });
    await loadFiles();
    selectFile(name);
    toast("Created " + name);
  }
  async function deleteFile(name) {
    await DB.Files.delete(name);
    if (state.activeFile === name) state.activeFile = null;
    await loadFiles();
    if (!state.files.length) {
      await createFile("main.js");
    } else if (!state.activeFile) {
      selectFile(state.files[0].name);
    }
    toast("Deleted " + name);
  }
  async function renameFile(from, to) {
    if (!to || to === from) return;
    const rec = await DB.Files.get(from);
    if (!rec) return;
    await DB.Files.put({ name: to, content: rec.content, language: langFromName(to) });
    await DB.Files.delete(from);
    if (state.activeFile === from) state.activeFile = to;
    await loadFiles();
    selectFile(to);
  }

  els.fileSelect.addEventListener("change", (e) => selectFile(e.target.value));
  els.langSelect.addEventListener("change", () => Editor.setLanguage(els.langSelect.value));
  els.newFileBtn.addEventListener("click", async () => {
    const name = await inlinePrompt("file name with extension, e.g. app.py", "untitled.js");
    if (name) createFile(name.trim());
  });
  els.newFileBtn2.addEventListener("click", () => els.newFileBtn.click());
  els.deleteBtn.addEventListener("click", async () => {
    if (!state.activeFile) return;
    if (!confirm("Delete " + state.activeFile + "?")) return;
    deleteFile(state.activeFile);
  });
  els.renameBtn.addEventListener("click", async () => {
    if (!state.activeFile) return;
    const to = await inlinePrompt("new file name", state.activeFile);
    if (to) renameFile(state.activeFile, to.trim());
  });

  Editor.onChange(() => {
    if (!state.activeFile) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => flushActiveFile().then(() => renderFileList()), 600);
  });

  // ── Run ──────────────────────────────────────────────────────
  els.runBtn.addEventListener("click", runActive);
  els.stopBtn.addEventListener("click", () => location.reload()); // crude stop for now

  async function runActive() {
    const lang = els.runLang.value;
    const code = Editor.getValue();
    els.terminal.innerHTML = "";
    els.previewWrap.hidden = true;
    setStatus("run", "RUNNING", null);
    const write = (level, text) => {
      const span = document.createElement("span");
      span.className = level === "error" ? "err" : level === "warn" ? "warn" : level === "meta" ? "meta" : "";
      span.textContent = text + "\n";
      els.terminal.appendChild(span);
      els.terminal.scrollTop = els.terminal.scrollHeight;
    };
    try {
      if (lang === "javascript") {
        await Runner.runJavaScript(code, write);
      } else if (lang === "python") {
        await Runner.runPython(code, write);
      } else if (lang === "html") {
        els.previewWrap.hidden = false;
        Runner.previewHTML(code, els.previewWrap);
        write("meta", "preview rendered");
      }
      setStatus("ready", "READY", null);
    } catch (e) {
      write("error", e.message || String(e));
      setStatus("error", "ERROR", null);
    }
  }

  // ── Chat ─────────────────────────────────────────────────────
  function renderChat() {
    els.chatLog.innerHTML = "";
    Chat.history.forEach((m) => appendMessageDOM(m.role, m.content, false));
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }
  function appendMessageDOM(role, content, animate) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.innerHTML = `<span class="role-tag">${role}</span><span class="body"></span>`;
    const body = div.querySelector(".body");
    if (animate && content) typewrite(body, content);
    else body.textContent = content || "";
    els.chatLog.appendChild(div);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
    return body;
  }
  function typewrite(el, text) {
    let i = 0;
    const step = () => {
      el.textContent = text.slice(0, i);
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
      if (i < text.length) { i += Math.max(1, Math.floor(text.length / 80)); requestAnimationFrame(step); }
    };
    step();
  }
  function rebuildModelSelect() {
    els.modelSelect.innerHTML = "";
    if (state.provider === "local") {
      const lm = LocalModel.loadedModelId();
      const o = document.createElement("option");
      o.value = lm || "(none)";
      o.textContent = lm ? `Local: ${lm}` : "No local model loaded";
      els.modelSelect.appendChild(o);
    } else {
      ["deepseek-chat", "deepseek-coder", "gpt-4o-mini", "gpt-4o", "llama-3.1-70b-versatile", "claude-3-5-sonnet"].forEach((m) => {
        const o = document.createElement("option");
        o.value = m; o.textContent = m;
        if (m === state.defaultModel) o.selected = true;
        els.modelSelect.appendChild(o);
      });
    }
  }
  els.modelSelect.addEventListener("change", () => {
    if (state.provider === "remote") state.defaultModel = els.modelSelect.value;
  });
  els.clearChatBtn.addEventListener("click", () => { Chat.clear(); renderChat(); });

  Chat.setOnUpdate(() => renderChat());

  els.chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    els.chatInput.value = "";
    Chat.pushMessage("user", text);
    appendMessageDOM("user", text, false);
    const body = appendMessageDOM("assistant", "", true);
    setStatus("ai", "THINKING", null);
    await Chat.send(
      {
        provider: state.provider,
        apiBase: state.apiBase,
        apiKey: state.apiKey,
        model: els.modelSelect.value,
        systemPrompt: state.systemPrompt,
        temperature: 0.3,
      },
      (partial) => { body.textContent = partial; els.chatLog.scrollTop = els.chatLog.scrollHeight; },
      (full) => { body.textContent = full; setStatus("ready", "READY", null); },
      (err) => {
        body.textContent = "Error: " + (err.message || err);
        setStatus("error", "ERROR", null);
      }
    );
  });

  els.chatInput.addEventListener("input", () => {
    els.chatInput.style.height = "auto";
    els.chatInput.style.height = Math.min(140, els.chatInput.scrollHeight) + "px";
  });

  // ── Settings ─────────────────────────────────────────────────
  function populateSettings() {
    els.apiBase.value = state.apiBase;
    els.apiKey.value = state.apiKey;
    els.defaultModel.value = state.defaultModel;
    els.systemPrompt.value = state.systemPrompt;
    if (els.hfToken) els.hfToken.value = state.hfToken ? "•".repeat(8) : "";
    if (els.customModelId) els.customModelId.value = state.customModelId || "";
    if (els.ghToken) els.ghToken.value = state.ghToken ? "•".repeat(8) : "";
    if (els.ghOwner) els.ghOwner.value = state.ghOwner || "";
    if (els.ghRepo) els.ghRepo.value = state.ghRepo || "";
    if (els.ghBranch) els.ghBranch.value = state.ghBranch || "main";
    document.querySelectorAll(".provider-pills button").forEach((b) => {
      b.classList.toggle("active", b.dataset.provider === state.provider);
    });
    LocalModel.setToken(state.hfToken || "");
    rebuildLocalModelUI();
    refreshCacheList();
    rebuildBuildEntrySelect();
  }
  function rebuildLocalModelUI() {
    const list = $("localModelList");
    if (!list) return;
    list.innerHTML = "";
    LocalModel.listModels().forEach((m) => {
      const btn = document.createElement("button");
      btn.textContent = m.label;
      btn.title = `${m.id} — ${m.size}`;
      btn.dataset.id = m.id;
      if (LocalModel.loadedModelId() === m.id) btn.classList.add("loaded");
      btn.addEventListener("click", () => loadLocalModel(m.id));
      list.appendChild(btn);
    });
    const dev = $("localDevice");
    if (dev) dev.textContent = "Device: " + LocalModel.device() + (LocalModel.supportsWebGPU() ? " (WebGPU available)" : "");
  }
  async function loadLocalModel(id, custom = false) {
    try {
      setStatus("ai", "LOADING MODEL", 0);
      const bar = $("localProgress");
      const text = $("localProgressText");
      await LocalModel.load(id, (p) => {
        const pct = Math.round(p.pct || 0);
        const label = custom ? id : (id.split("/")[1] || id);
        setStatus("ai", `LOADING ${label}`, pct);
        if (bar) bar.firstElementChild.style.width = pct + "%";
        if (text) text.textContent = p.text + (p.pct ? " — " + pct + "%" : "");
      });
      toast("Loaded " + id);
      setStatus("ready", "READY", null);
      rebuildLocalModelUI();
      rebuildModelSelect();
      if (bar) bar.firstElementChild.style.width = "100%";
      if (text) text.textContent = "ready — " + id;
      refreshCacheList();
    } catch (e) {
      console.error(e);
      toast("Load failed: " + (e.message || e));
      setStatus("error", "ERROR", null);
    }
  }

  els.settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.apiBase = els.apiBase.value.trim() || "https://api.deepseek.com";
    state.apiKey = els.apiKey.value.trim();
    state.defaultModel = els.defaultModel.value.trim() || "deepseek-chat";
    state.systemPrompt = els.systemPrompt.value;
    state.customModelId = (els.customModelId?.value || "").trim();
    // HF token is only re-saved when the user clicks "Save token"; keep it as-is here.
    await DB.KV.set("settings", { ...state });
    els.settingsStatus.textContent = "Saved on this device.";
    toast("Settings saved");
    rebuildModelSelect();
  });

  els.exportBtn.addEventListener("click", async () => {
    const files = await DB.Files.list();
    const settings = await DB.KV.get("settings") || {};
    const blob = new Blob([JSON.stringify({ files, settings }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "codex-project.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (Array.isArray(data.files)) {
        await DB.Files.clear();
        for (const r of data.files) await DB.Files.put(r);
      }
      if (data.settings) {
        await DB.KV.set("settings", data.settings);
        Object.assign(state, data.settings);
        populateSettings();
      }
      await loadFiles();
      toast("Imported");
    } catch (err) { toast("Import failed: " + err.message); }
  });

  document.querySelectorAll(".provider-pills button").forEach((b) => {
    b.addEventListener("click", () => {
      state.provider = b.dataset.provider;
      populateSettings();
      rebuildModelSelect();
    });
  });

  $("unloadLocalBtn").addEventListener("click", async () => {
    await LocalModel.unload();
    toast("Unloaded local model");
    rebuildLocalModelUI();
    rebuildModelSelect();
  });

  els.saveHfTokenBtn.addEventListener("click", async () => {
    const v = (els.hfToken.value || "").trim();
    const real = v.startsWith("•") ? state.hfToken : v;
    state.hfToken = real;
    LocalModel.setToken(real);
    await DB.KV.set("settings", { ...state });
    els.hfToken.value = real ? "•".repeat(8) : "";
    toast(real ? "HF token saved" : "HF token cleared");
  });

  // ③ Download from HuggingFace by repo id
  els.loadCustomBtn.addEventListener("click", async () => {
    const id = (els.customModelId.value || "").trim();
    if (!id) { toast("Enter a HuggingFace repo id"); return; }
    state.customModelId = id;
    await DB.KV.set("settings", { ...state });
    const bar = $("localProgress");
    const text = $("localProgressText");
    setStatus("ai", "FETCHING REPO", 0);
    try {
      await LocalModel.downloadFromHub({ repoId: id }, (p) => {
        const pct = Math.round(p.pct || 0);
        setStatus("ai", `FETCHING ${id.split("/")[1] || id}`, pct);
        if (bar) bar.firstElementChild.style.width = pct + "%";
        if (text) text.textContent = p.text + (p.pct ? " — " + pct + "%" : "");
      });
      toast("Loaded " + id);
      setStatus("ready", "READY", null);
      if (bar) bar.firstElementChild.style.width = "100%";
      if (text) text.textContent = "ready — " + id;
      rebuildLocalModelUI();
      rebuildModelSelect();
      refreshCacheList();
    } catch (e) {
      console.error(e);
      toast("Load failed: " + (e.message || e));
      setStatus("error", "ERROR", null);
    }
  });

  // ② Sideload local model files (folder or individual files)
  els.pickFolderBtn.addEventListener("click", () => els.folderPicker.click());
  els.pickFilesBtn.addEventListener("click", () => els.filePicker.click());

  async function sideloadFromFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => !f.name.startsWith("."));
    if (!files.length) { toast("No model files selected"); return; }
    const name = (els.sideloadName.value || "").trim()
      || (files[0].webkitRelativePath ? files[0].webkitRelativePath.split("/")[0] : "local-model")
      || "local-model";
    const family = els.sideloadFamily.value || "auto";
    const bar = $("localProgress");
    const text = $("localProgressText");
    setStatus("ai", "IMPORTING MODEL", 0);
    try {
      await LocalModel.importLocalFiles({ repoId: name, files, family }, (p) => {
        const pct = Math.round(p.pct || 0);
        setStatus("ai", "IMPORTING MODEL", pct);
        if (bar) bar.firstElementChild.style.width = pct + "%";
        if (text) text.textContent = p.text + (p.pct ? " — " + pct + "%" : "");
      });
      toast("Imported " + name);
      setStatus("ready", "READY", null);
      if (bar) bar.firstElementChild.style.width = "100%";
      if (text) text.textContent = "ready — " + name + " (" + files.length + " files)";
      rebuildLocalModelUI();
      rebuildModelSelect();
      refreshCacheList();
    } catch (e) {
      console.error(e);
      toast("Import failed: " + (e.message || e));
      setStatus("error", "ERROR", null);
    }
  }

  els.folderPicker.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length) {
      sideloadFromFiles(e.target.files);
      e.target.value = "";
    }
  });
  els.filePicker.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length) {
      sideloadFromFiles(e.target.files);
      e.target.value = "";
    }
  });

  async function refreshCacheList() {
    if (!els.cacheList) return;
    els.cacheList.innerHTML = "";
    const rows = await LocalModel.reportCache();
    if (!rows.length) {
      const li = document.createElement("li");
      li.style.cssText = "background:transparent;border:0;color:var(--ink-mute)";
      li.textContent = "Nothing cached yet.";
      els.cacheList.appendChild(li);
      return;
    }
    rows.sort((a, b) => b.bytes - a.bytes).forEach((r) => {
      const li = document.createElement("li");
      li.style.cssText = "background:#1d2026;border:1px solid var(--line-soft)";
      li.innerHTML = `<span class="file-name" style="flex:1">${r.name}</span><span class="file-size">${LocalModel.bytesPretty(r.bytes)}</span>`;
      els.cacheList.appendChild(li);
    });
  }
  els.refreshCacheBtn.addEventListener("click", refreshCacheList);
  els.clearCacheBtn.addEventListener("click", async () => {
    if (!confirm("Delete all cached model weights? You'll need to re-download to use the local provider.")) return;
    await LocalModel.unload();
    await LocalModel.clearCache();
    toast("Cache cleared");
    refreshCacheList();
    rebuildLocalModelUI();
    rebuildModelSelect();
  });

  // ── Build tab ────────────────────────────────────────────────
  function rebuildBuildEntrySelect() {
    if (!els.buildEntry) return;
    const prev = els.buildEntry.value;
    els.buildEntry.innerHTML = "";
    state.files.forEach((f) => {
      const o = document.createElement("option");
      o.value = f.name;
      o.textContent = f.name;
      els.buildEntry.appendChild(o);
    });
    if (prev && state.files.find((f) => f.name === prev)) els.buildEntry.value = prev;
    else if (state.activeFile) els.buildEntry.value = state.activeFile;
  }
  els.buildBtn.addEventListener("click", async () => {
    const target = els.buildLang.value;
    const entryName = els.buildEntry.value;
    if (!entryName) { toast("No entry file"); return; }
    const file = await DB.Files.get(entryName);
    if (!file) { toast("File missing"); return; }
    els.buildOutput.textContent = `[${target}] ${entryName} → …\n`;
    try {
      if (target === "transpile") {
        const lang = langFromName(entryName);
        const out = await window.CodexCompiler.transpile(file.content, lang);
        const baseName = entryName.replace(/\.(ts|tsx|jsx)$/i, "") + ".compiled.js";
        await DB.Files.put({ name: baseName, content: out.code, language: "javascript" });
        await loadFiles();
        els.buildOutput.textContent = `// transpiled to ${baseName} (${out.code.length} chars)\n${out.code}`;
        toast("Saved " + baseName);
      } else if (target === "bundle") {
        const out = await window.CodexCompiler.bundle(entryName, state.files.map((f) => ({ name: f.name, content: f.content })));
        const baseName = entryName.replace(/\.[^.]+$/, "") + ".bundle.js";
        await DB.Files.put({ name: baseName, content: out.code, language: "javascript" });
        await loadFiles();
        const warn = out.warnings.length ? `\n// warnings:\n// ${out.warnings.join("\n// ")}` : "";
        els.buildOutput.textContent = `// bundled to ${baseName} (${out.code.length} chars)${warn}\n${out.code}`;
        toast("Saved " + baseName);
      } else if (target === "format") {
        const out = await window.CodexCompiler.format(file.content, langFromName(entryName));
        await DB.Files.put({ name: entryName, content: out, language: langFromName(entryName) });
        await loadFiles();
        Editor.setValue(out);
        els.buildOutput.textContent = "// formatted " + entryName + "\n" + out;
        toast("Formatted " + entryName);
      }
    } catch (e) {
      console.error(e);
      els.buildOutput.textContent = "// error: " + (e.message || e);
      toast("Build failed: " + (e.message || e));
    }
  });
  els.copyBuildOutputBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(els.buildOutput.textContent || ""); toast("Copied"); }
    catch (e) { toast("Copy failed"); }
  });
  els.saveBuildOutputBtn.addEventListener("click", async () => {
    const name = await inlinePrompt("file name for the build output", "build-output.txt");
    if (!name) return;
    await DB.Files.put({ name, content: els.buildOutput.textContent || "", language: "plaintext" });
    await loadFiles();
    toast("Saved " + name);
  });

  // ── Agent tab ─────────────────────────────────────────────────
  let agentAbort = null;
  function appendAgent(kind, payload) {
    const div = document.createElement("div");
    div.className = "msg " + (kind === "user" ? "user" : "assistant");
    let inner = `<span class="role-tag">${kind}</span><span class="body"></span>`;
    div.innerHTML = inner;
    const body = div.querySelector(".body");
    if (kind === "tool_call") body.innerHTML = `→ <b>${payload.name}</b>(${JSON.stringify(payload.args)})`;
    else if (kind === "tool_result") body.innerHTML = (payload.ok ? "✓" : "✗") + " <b>" + payload.name + "</b>: " +
      (payload.ok ? "<pre>" + escapeHTML(JSON.stringify(payload.result, null, 2).slice(0, 400)) + "</pre>" : "<span style='color:var(--err)'>" + escapeHTML(payload.error) + "</span>");
    else if (kind === "text") body.textContent = payload.text || "";
    else if (kind === "step") body.innerHTML = `<span class="role-tag">step ${payload.index + 1}</span>`;
    else if (kind === "done") body.innerHTML = `<span class="role-tag">done · ${payload.reason}</span>`;
    els.agentLog.appendChild(div);
    els.agentLog.scrollTop = els.agentLog.scrollHeight;
  }
  els.agentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const goal = els.agentInput.value.trim();
    if (!goal) return;
    els.agentInput.value = "";
    appendAgent("user", { text: goal });
    appendAgent("step", { index: 0 });
    agentAbort = new AbortController();
    setStatus("ai", "AGENT RUNNING", null);
    try {
      await window.CodexAgent.run({
        provider: els.agentProvider.value,
        ctx: {
          DB, Runner, Chat,
          apiBase: state.apiBase,
          apiKey: state.apiKey,
          model: state.defaultModel,
          systemPrompt: state.systemPrompt,
          onChange: () => { loadFiles().then(() => rebuildBuildEntrySelect()); },
        },
        goal,
        maxSteps: 6,
        abortSignal: agentAbort.signal,
        onEvent: (ev) => {
          if (ev.kind === "text") {
            // Update last assistant bubble text
            const last = els.agentLog.querySelectorAll(".msg.assistant");
            const bubble = last[last.length - 1];
            if (bubble) bubble.querySelector(".body").textContent = ev.text;
          } else if (ev.kind === "tool_call") appendAgent("tool_call", ev);
          else if (ev.kind === "tool_result") appendAgent("tool_result", ev);
          else if (ev.kind === "step" && ev.index > 0) appendAgent("step", ev);
          else if (ev.kind === "done") { appendAgent("done", ev); setStatus("ready", "READY", null); }
        },
      });
    } catch (err) {
      appendAgent("text", { text: "Error: " + (err.message || err) });
      setStatus("error", "ERROR", null);
    } finally {
      agentAbort = null;
    }
  });
  els.agentStopBtn.addEventListener("click", () => { if (agentAbort) agentAbort.abort(); });
  els.agentInput.addEventListener("input", () => {
    els.agentInput.style.height = "auto";
    els.agentInput.style.height = Math.min(140, els.agentInput.scrollHeight) + "px";
  });

  // ── Git tab ───────────────────────────────────────────────────
  function ghRealToken() {
    const v = (els.ghToken.value || "").trim();
    return v.startsWith("•") ? state.ghToken : v;
  }
  els.ghLoginBtn.addEventListener("click", async () => {
    state.ghToken = ghRealToken();
    if (!state.ghToken) { toast("Enter a token"); return; }
    setStatus("ai", "GITHUB SIGN-IN", null);
    try {
      const user = await window.CodexGit.getUser(state.ghToken);
      els.ghUser.textContent = "Signed in as @" + user.login;
      toast("Hello @" + user.login);
      setStatus("ready", "READY", null);
    } catch (e) {
      els.ghUser.textContent = "Error: " + (e.message || e);
      toast("Sign-in failed");
      setStatus("error", "ERROR", null);
    }
  });
  els.ghForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.ghToken = ghRealToken();
    state.ghOwner = els.ghOwner.value.trim();
    state.ghRepo = els.ghRepo.value.trim();
    state.ghBranch = (els.ghBranch.value.trim() || "main");
    await DB.KV.set("settings", { ...state });
    if (els.ghToken) els.ghToken.value = state.ghToken ? "•".repeat(8) : "";
    setStatus("ai", "PUSHING", 0);
    els.ghStatus.textContent = "Reading project files…";
    try {
      const files = await DB.Files.list();
      const entries = files.map((f) => ({ path: f.name, content: f.content }));
      const message = (els.ghMessage.value.trim()) || "Update from Codex";
      const result = await window.CodexGit.push(state.ghToken, state.ghOwner, state.ghRepo, state.ghBranch, message, entries, (p) => {
        els.ghStatus.textContent = p;
      });
      els.ghStatus.textContent = `Pushed ${result.filesCommitted} files to ${result.branch}.\nCommit: ${result.sha.slice(0, 7)}\n${result.url}`;
      toast("Pushed");
      setStatus("ready", "READY", null);
    } catch (err) {
      els.ghStatus.textContent = "Error: " + (err.message || err);
      toast("Push failed");
      setStatus("error", "ERROR", null);
    }
  });
  els.ghHistoryBtn.addEventListener("click", async () => {
    state.ghToken = ghRealToken();
    state.ghOwner = els.ghOwner.value.trim();
    state.ghRepo = els.ghRepo.value.trim();
    if (!state.ghToken || !state.ghOwner || !state.ghRepo) { toast("Fill token + owner/repo first"); return; }
    els.ghCommits.innerHTML = "";
    try {
      const commits = await window.CodexGit.listCommits(state.ghToken, state.ghOwner, state.ghRepo, state.ghBranch, 8);
      commits.forEach((c) => {
        const li = document.createElement("li");
        li.style.cssText = "background:#1d2026;border:1px solid var(--line-soft)";
        li.innerHTML = `<span class="file-name" style="flex:1"><b>${c.sha.slice(0, 7)}</b> ${escapeHTML(c.commit.message.split("\n")[0])}</span>` +
          `<span class="file-size">${escapeHTML(c.commit.author.name)}</span>`;
        els.ghCommits.appendChild(li);
      });
    } catch (err) {
      toast("History failed: " + err.message);
    }
  });

  // ── Boot ─────────────────────────────────────────────────────
  async function boot() {
    const settings = await DB.KV.get("settings");
    if (settings) Object.assign(state, settings);
    populateSettings();

    Editor.init($("editor"), $("fallbackEditor"));
    Editor.setLanguage("javascript");
    Editor.setValue("// Welcome to Codex\n// Edit code on the left, hit Run, or open Pair to talk to a model.\n");
    Editor.onChange(() => {/* handled above after init */});

    // Wait until Editor.onChange is wired before saving — re-wire here:
    Editor.onChange(() => {
      if (!state.activeFile) return;
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(() => flushActiveFile().then(() => renderFileList()), 600);
    });

    const initial = await DB.Files.list();
    if (!initial.length) {
      await DB.Files.put({ name: "main.js", content: "// Welcome to Codex\nconsole.log('hello from iPhone');\n", language: "javascript" });
      await DB.Files.put({ name: "hello.py", content: "print('hello from python')\nfor i in range(3):\n    print(i)\n", language: "python" });
      await DB.Files.put({ name: "README.md", content: "# Codex\n\nA coding harness in your pocket. Edit code in the **Code** tab, hit **Run ▶** in the **Run** tab, and pair-program with a model in the **Pair** tab.\n", language: "markdown" });
    }
    await loadFiles();
    rebuildModelSelect();
    setTab("editor");
    setStatus("ready", "READY", null);
    console.log("[codex] boot complete — provider:", state.provider);
  }

  boot().catch((e) => {
    console.error("boot failed", e);
    document.body.insertAdjacentHTML("afterbegin",
      `<pre style="color:#ff5c5c;padding:12px;font:12px monospace;background:#1a1d21;border-bottom:1px solid #3a414b">Boot failed: ${escapeHTML(e.message || String(e))}</pre>`);
  });
})();
