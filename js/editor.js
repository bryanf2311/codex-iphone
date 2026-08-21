// editor.js — Monaco wrapper with a textarea fallback.
// On iPhone Safari Monaco is heavy; the textarea keeps typing instant
// and still gets the right language-aware behaviour via CSS.

(function () {
  const FALLBACK_LANGS = {
    javascript: "javascript",
    typescript: "typescript",
    python: "python",
    html: "html",
    css: "css",
    json: "json",
    markdown: "markdown",
    plaintext: "plaintext",
  };

  function detectLanguage(filename) {
    const ext = (filename.split(".").pop() || "").toLowerCase();
    return ({
      js: "javascript", mjs: "javascript", jsx: "javascript",
      ts: "typescript", tsx: "typescript",
      py: "python",
      html: "html", htm: "html",
      css: "css",
      json: "json",
      md: "markdown", markdown: "markdown",
      txt: "plaintext",
    })[ext] || "plaintext";
  }

  let monaco = null;
  let monacoEditor = null;
  let fallbackEl = null;
  let monacoEl = null;
  let onChangeCb = null;
  let currentLang = "plaintext";
  let monacoLoaded = false;
  let monacoLoading = null;
  const MONACO_VERSION = "0.52.0";
  const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

  function loadMonaco() {
    if (monacoLoading) return monacoLoading;
    monacoLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${MONACO_BASE}/loader.min.js`;
      s.onload = () => {
        if (!window.require) return reject(new Error("Monaco loader missing"));
        window.require.config({ paths: { vs: MONACO_BASE } });
        window.require(["vs/editor/editor.main"], () => resolve(window.monaco), 5);
      };
      s.onerror = () => reject(new Error("Monaco loader failed"));
      document.head.appendChild(s);
    }).then((m) => { monaco = m; monacoLoaded = true; return m; })
      .catch((e) => { console.warn("[editor] Monaco load failed, using fallback:", e); return null; });
    return monacoLoading;
  }

  function init(monacoMount, fallbackMount) {
    monacoEl = monacoMount;
    fallbackEl = fallbackMount;
    fallbackEl.value = "";
    fallbackEl.addEventListener("input", () => onChangeCb && onChangeCb(fallbackEl.value));
    fallbackEl.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = fallbackEl.selectionStart, en = fallbackEl.selectionEnd;
        fallbackEl.value = fallbackEl.value.slice(0, s) + "  " + fallbackEl.value.slice(en);
        fallbackEl.selectionStart = fallbackEl.selectionEnd = s + 2;
        onChangeCb && onChangeCb(fallbackEl.value);
      }
    });
    // Try Monaco. iPhone Safari may reject it; we always keep fallback usable.
    loadMonaco().then((m) => {
      if (!m) return;
      try {
        monacoEditor = m.editor.create(monacoEl, {
          value: "",
          language: "plaintext",
          theme: "vs-dark",
          automaticLayout: true,
          fontFamily: 'JetBrains Mono, "SF Mono", Menlo, monospace',
          fontSize: 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
          renderWhitespace: "none",
          padding: { top: 10 },
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          parameterHints: { enabled: false },
          snippetSuggestions: "none",
        });
        monacoEl.style.display = "block";
        fallbackEl.hidden = true;
        monacoEditor.onDidChangeModelContent(() => onChangeCb && onChangeCb(monacoEditor.getValue()));
      } catch (err) {
        console.warn("[editor] Monaco init failed, falling back:", err);
      }
    });
  }

  function setValue(text) {
    if (monacoEditor) monacoEditor.setValue(text);
    else fallbackEl.value = text;
  }
  function getValue() {
    return monacoEditor ? monacoEditor.getValue() : fallbackEl.value;
  }
  function setLanguage(lang) {
    currentLang = FALLBACK_LANGS[lang] || "plaintext";
    if (monacoEditor && monaco) {
      const model = monacoEditor.getModel();
      if (model) monaco.editor.setModelLanguage(model, currentLang);
    }
    if (fallbackEl) fallbackEl.setAttribute("data-lang", currentLang);
  }
  function onChange(cb) { onChangeCb = cb; }
  function focus() {
    if (monacoEditor) monacoEditor.focus();
    else fallbackEl.focus();
  }
  function dispose() {
    if (monacoEditor) { monacoEditor.dispose(); monacoEditor = null; }
  }
  function isMonaco() { return !!monacoEditor; }

  window.CodexEditor = {
    init, setValue, getValue, setLanguage, onChange, focus, dispose,
    detectLanguage, isMonaco,
  };
})();
