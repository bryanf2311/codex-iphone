// compiler.js — transpile/bundle source files.
// Uses Sucrase for TS/JSX (fast, runs in browser via esm.sh) and esbuild-wasm
// for proper ES-module bundling. Loaded lazily; users without these needs
// never pay the cost.

(function () {
  const SUCraseUrl = "https://esm.sh/sucrase@3.35.0";
  const ESBUILDUrl = "https://esm.sh/esbuild-wasm@0.24.0/esm/browser.min.js";

  let sucraseMod = null;
  let esbuildMod = null;
  let loading = null;

  function ensureSucrase() {
    if (sucraseMod) return Promise.resolve(sucraseMod);
    return import(SUCraseUrl).then((m) => { sucraseMod = m; return m; });
  }

  function ensureEsbuild() {
    if (esbuildMod) return Promise.resolve(esbuildMod);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ESBUILDUrl;
      s.async = true;
      s.onload = () => {
        if (!window.esbuild) return reject(new Error("esbuild-wasm failed to load"));
        esbuildMod = window.esbuild;
        esbuildMod.init({}).then(() => resolve(esbuildMod), reject);
      };
      s.onerror = () => reject(new Error("esbuild-wasm script error"));
      document.head.appendChild(s);
    });
    return loading;
  }

  // Transpile a single source string. Returns { code, map? }.
  // language: "typescript" | "tsx" | "jsx" | "javascript"
  async function transpile(code, language) {
    const lang = language || "typescript";
    if (lang === "javascript" || lang === "plaintext") return { code, language: "javascript" };
    const transforms = [];
    if (lang === "typescript" || lang === "tsx") transforms.push("typescript");
    if (lang === "tsx" || lang === "jsx") transforms.push("jsx");
    if (lang === "typescript") transforms.push("imports");
    if (transforms.length === 0) return { code, language: "javascript" };
    const mod = await ensureSucrase();
    const out = mod.transform(code, { transforms, disableESTransforms: true });
    return { code: out.code, language: "javascript" };
  }

  // Bundle an entry file plus its imports. Returns { code, warnings }.
  async function bundle(entryName, files, opts = {}) {
    const eb = await ensureEsbuild();
    const stdin = {};
    const virtualPlugin = {
      name: "codex-virtual",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in stdin) return { path: args.path, namespace: "codex" };
          // Resolve relative imports against the file doing the importing
          if (args.path.startsWith(".") && args.importer) {
            const dir = args.importer.includes("/") ? args.importer.split("/").slice(0, -1).join("/") + "/" : "";
            const joined = (dir + args.path).replace(/\/\.\//g, "/").replace(/\/[^/]+\/\.\.\//g, "/");
            if (joined in stdin) return { path: joined, namespace: "codex" };
          }
          return { path: args.path, namespace: "codex" };
        });
        build.onLoad({ filter: /.*/, namespace: "codex" }, (args) => {
          const f = stdin[args.path];
          if (f == null) return { contents: "", loader: "js", warnings: [{ text: "missing: " + args.path }] };
          return { contents: f, loader: f.endsWith(".ts") || f.endsWith(".tsx") ? "tsx"
                  : f.endsWith(".json") ? "json"
                  : f.endsWith(".css") ? "css"
                  : "js" };
        });
      },
    };
    for (const f of files) stdin[f.name] = f.content;
    const result = await eb.build({
      entryPoints: [entryName],
      bundle: true,
      write: false,
      format: opts.format || "iife",
      target: "es2019",
      plugins: [virtualPlugin],
      sourcemap: "inline",
    });
    const out = result.outputFiles[0];
    return { code: out.text, warnings: result.warnings.map((w) => w.text) };
  }

  async function format(code, language) {
    // Cheap prettier-free formatter: normalize indentation, trim trailing ws.
    if (language !== "javascript" && language !== "typescript") return code;
    return code.split("\n").map((l) => l.replace(/[\t ]+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n");
  }

  window.CodexCompiler = { transpile, bundle, format };
})();
