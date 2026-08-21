// runner.js — Code execution sandboxes.
// - JavaScript: sandboxed iframe (srcdoc) with structured console capture.
// - Python: lazy-loaded Pyodide, run in same iframe.
// - HTML: rendered in a sandboxed iframe.

(function () {
  const PYODIDE_VERSION = "0.26.4";
  const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

  let pyodidePromise = null;
  function loadPyodide() {
    if (pyodidePromise) return pyodidePromise;
    pyodidePromise = new Promise((resolve, reject) => {
      if (window.loadPyodide) return resolve(window.loadPyodide({ indexURL: PYODIDE_INDEX }));
      const s = document.createElement("script");
      s.src = PYODIDE_INDEX + "pyodide.js";
      s.onload = () => {
        window.loadPyodide({ indexURL: PYODIDE_INDEX }).then(resolve, reject);
      };
      s.onerror = () => reject(new Error("Pyodide failed to load"));
      document.head.appendChild(s);
    });
    return pyodidePromise;
  }

  function makeRunnerIframe() {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    document.body.appendChild(iframe);
    return iframe;
  }

  // Build a sandboxed runner page with a console bridge.
  function sandboxHTML(userCode, kind) {
    const safe = (s) => String(s).replace(/<\/script>/gi, "<\\/script>");
    return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function(){
  var logs = [];
  function send(level, args){
    try {
      var parts = args.map(function(a){
        if (a instanceof Error) return a.stack || (a.name + ": " + a.message);
        if (typeof a === "object") {
          try { return JSON.stringify(a); } catch(e){ return String(a); }
        }
        return String(a);
      });
      parent.postMessage({ __codexRunner: true, level: level, parts: parts }, "*");
    } catch(e) {}
  }
  var origLog = console.log, origErr = console.error, origWarn = console.warn, origInfo = console.info;
  console.log  = function(){ send("log", Array.prototype.slice.call(arguments)); origLog.apply(console, arguments); };
  console.info = function(){ send("info", Array.prototype.slice.call(arguments)); origInfo.apply(console, arguments); };
  console.warn = function(){ send("warn", Array.prototype.slice.call(arguments)); origWarn.apply(console, arguments); };
  console.error= function(){ send("error",Array.prototype.slice.call(arguments)); origErr.apply(console, arguments); };
  window.addEventListener("error", function(ev){
    send("error", [ev.message + " (line " + ev.lineno + ":" + ev.colno + ")"]);
  });
  window.addEventListener("unhandledrejection", function(ev){
    send("error", ["Unhandled rejection: " + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason)]);
  });
  send("meta", ["sandbox ready"]);
  try {
    ${kind === "module"
      ? "var __m = document.createElement('script'); __m.type='module'; __m.textContent = " + JSON.stringify(userCode) + "; document.body.appendChild(__m);"
      : safe(userCode)
    }
  } catch(e) { send("error", [e.stack || (e.name + ": " + e.message)]); }
  send("meta", ["done"]);
})();
</script></body></html>`;
  }

  async function runJavaScript(code, onOut) {
    const iframe = makeRunnerIframe();
    const cleanup = () => { try { iframe.remove(); } catch(e){} };
    return new Promise((resolve) => {
      const handler = (ev) => {
        const d = ev.data;
        if (!d || !d.__codexRunner) return;
        if (d.level === "meta" && d.parts[0] === "done") {
          window.removeEventListener("message", handler);
          cleanup();
          resolve();
        } else {
          onOut(d.level, d.parts.join(" "));
        }
      };
      window.addEventListener("message", handler);
      iframe.srcdoc = sandboxHTML(code, "classic");
    });
  }

  async function runPython(code, onOut) {
    onOut("meta", ["loading Python runtime…"]);
    const py = await loadPyodide();
    onOut("meta", ["Python ready"]);
    py.setStdout({ batched: (s) => onOut("log", [s]) });
    py.setStderr({ batched: (s) => onOut("error", [s]) });
    try {
      await py.runPythonAsync(code);
      onOut("meta", ["exit 0"]);
    } catch (e) {
      onOut("error", [e.message || String(e)]);
    }
  }

  function previewHTML(code, mount) {
    mount.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.className = "preview";
    iframe.srcdoc = code;
    mount.appendChild(iframe);
  }

  window.CodexRunner = { runJavaScript, runPython, previewHTML, loadPyodide };
})();
