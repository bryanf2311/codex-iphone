// localModel.js — On-device model loader using @huggingface/transformers (v3).
// - Runs in browser and on iPhone Safari without WebGPU (ONNX Runtime Web / WASM).
// - Caches weights in the browser Cache Storage so re-loads are instant.
// - Three ways to bring a model in:
//     1. Pick a curated repo (auto-download from HuggingFace CDN)
//     2. Download from any non-gated HF repo by id
//     3. Sideload local files from the iPhone Files app
// - Reports cache usage; can clear cache on demand.
// - HF token supported as an opt-in for gated repos (Gemma 3, etc.).

(function () {
  const HF_VERSION = "3.0.2";
  const TRANSFORMERS_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${HF_VERSION}/dist/transformers.min.js`;
  const HF_CDN = "https://huggingface.co";

  // Curated, iPhone-feasible, code-friendly instruction models.
  const MODELS = [
    { id: "HuggingFaceTB/SmolLM2-360M-Instruct",        label: "SmolLM2 360M — tiny, very fast",         size: "~250 MB", task: "text-generation", gated: false, family: "smollm2" },
    { id: "onnx-community/Qwen2.5-Coder-1.5B-Instruct", label: "Qwen2.5 Coder 1.5B — coding, balanced", size: "~1.0 GB", task: "text-generation", gated: false, family: "qwen" },
    { id: "Xenova/Phi-3.5-mini-instruct",              label: "Phi-3.5 mini — high quality, slow",     size: "~2.3 GB", task: "text-generation", gated: false, family: "phi3" },
    { id: "HuggingFaceTB/SmolLM2-1.7B-Instruct",        label: "SmolLM2 1.7B — chat, medium",            size: "~1.1 GB", task: "text-generation", gated: false, family: "smollm2" },
    { id: "onnx-community/gemma-3-1b-it",               label: "Gemma 3 1B IT — Google, gated (token)", size: "~0.8 GB", task: "text-generation", gated: true,  family: "gemma3" },
  ];

  let transformers = null;
  let pipeline = null;
  let loadingPromise = null;
  let lastProgress = { text: "", pct: 0 };
  let currentModelId = null;
  let currentModelSource = "remote"; // "remote" | "local-files"
  let supportsWebGPU = false;
  let hfToken = "";
  let familyGuess = "auto";

  function detectWebGPU() {
    try { supportsWebGPU = !!(navigator.gpu && typeof navigator.gpu.requestAdapter === "function"); }
    catch (e) { supportsWebGPU = false; }
    return supportsWebGPU;
  }

  function loadTransformers() {
    if (transformers) return Promise.resolve(transformers);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TRANSFORMERS_URL;
      s.async = true;
      s.onload = () => {
        if (!window.transformers) return reject(new Error("transformers.js failed to load"));
        transformers = window.transformers;
        resolve(transformers);
      };
      s.onerror = () => reject(new Error("transformers.js script error"));
      document.head.appendChild(s);
    });
  }

  function applyToken() {
    if (!transformers || !hfToken) return;
    try {
      transformers.env.token = hfToken;
      if (transformers.envHF) transformers.envHF.token = hfToken;
    } catch (e) { /* ignore */ }
  }

  async function ensure(progressCallback) {
    if (!transformers) await loadTransformers();
    detectWebGPU();
    applyToken();
    const opts = {
      device: supportsWebGPU ? "webgpu" : "wasm",
      dtype: supportsWebGPU ? "fp16" : "q4",
      progress_callback: (data) => {
        let pct = 0;
        if (data && typeof data.progress === "number") pct = data.progress;
        else if (data && data.status === "ready") pct = 100;
        lastProgress = {
          text: (data && (data.file || data.name)) ? `${data.status || "loading"} ${data.file || data.name}` : (data && data.status) || "loading",
          pct,
        };
        if (progressCallback) progressCallback(lastProgress);
      },
    };
    if (!supportsWebGPU) {
      try {
        transformers.env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
        transformers.env.backends.onnx.wasm.simd = true;
      } catch (e) { /* ignore */ }
    }
    return { transformers, opts };
  }

  function resolveModel(modelId) {
    return MODELS.find((m) => m.id === modelId) || { id: modelId, label: modelId, size: "?", task: "text-generation", gated: true, family: familyGuess };
  }

  function guessFamily(modelId, explicit) {
    if (explicit && explicit !== "auto") return explicit;
    const id = (modelId || "").toLowerCase();
    if (id.includes("gemma-3")) return "gemma3";
    if (id.includes("gemma"))   return "gemma";
    if (id.includes("phi-3") || id.includes("phi3")) return "phi3";
    if (id.includes("llama-3")) return "llama3";
    if (id.includes("qwen"))    return "qwen";
    if (id.includes("smollm"))  return "smollm2";
    if (id.includes("mistral") || id.includes("mixtral")) return "mistral";
    return "auto";
  }

  function buildPrompt(family, messages) {
    const sys = messages.find((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system");
    switch (family) {
      case "gemma3":
      case "gemma":
        return (sys ? `<start_of_turn>system\n${sys.content}<end_of_turn>\n` : "") +
          rest.map((m) => `<start_of_turn>${m.role === "assistant" ? "model" : m.role}\n${m.content}<end_of_turn>\n`).join("") +
          `<start_of_turn>model\n`;
      case "llama3":
        return `<|begin_of_text|>` +
          (sys ? `<|start_header_id|>system<|end_header_id|>\n\n${sys.content}<|eot_id|>` : "") +
          rest.map((m) => `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`).join("") +
          `<|start_header_id|>assistant<|end_header_id|>\n\n`;
      case "phi3":
        return rest.map((m) => `<|${m.role}|>\n${m.content}\n<|end|>\n`).join("") +
          (sys ? `<|system|>\n${sys.content}\n<|end|>\n` : "") +
          `<|assistant|>\n`;
      case "qwen":
        return (sys ? `<|im_start|>system\n${sys.content}<|im_end|>\n` : "") +
          rest.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join("") +
          `<|im_start|>assistant\n`;
      case "smollm2":
        return rest.map((m) => `<|${m.role}|>\n${m.content}\n`).join("") +
          (sys ? `<|system|>\n${sys.content}\n` : "") +
          `<|assistant|>\n`;
      case "mistral":
        return rest.map((m) => `<|${m.role}|>${m.content}</s>`).join("") + "<|assistant|>";
      default:
        return messages.map((m) => `<|${m.role}|>\n${m.content}\n`).join("") + "<|assistant|>\n";
    }
  }

  // ── Cache helpers ─────────────────────────────────────────────
  function cacheNameFor(repoId) { return "codex-model::" + repoId; }
  function urlForFile(repoId, relPath) {
    return `${HF_CDN}/${repoId}/resolve/main/${relPath}`;
  }

  async function seedCacheWithFiles(repoId, files, progressCallback) {
    const cache = await caches.open(cacheNameFor(repoId));
    let i = 0;
    for (const file of files) {
      // file.webkitRelativePath looks like "ModelName/onnx/model_q4.onnx" when
      // uploaded as a directory; fall back to file.name for flat uploads.
      let rel = file.webkitRelativePath || file.name;
      // Strip the top-level folder name (whatever the user named the dir)
      const parts = rel.split("/");
      if (parts.length > 1) rel = parts.slice(1).join("/");
      const url = urlForFile(repoId, rel);
      const buf = await file.arrayBuffer();
      const resp = new Response(buf, {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(buf.byteLength) },
      });
      await cache.put(new Request(url, { method: "GET" }), resp);
      i++;
      if (progressCallback) progressCallback({ text: `imported ${rel}`, pct: Math.round((i / files.length) * 100) });
    }
  }

  async function seedCacheFromHF(repoId, relPaths, progressCallback) {
    const cache = await caches.open(cacheNameFor(repoId));
    let i = 0;
    for (const rel of relPaths) {
      const url = urlForFile(repoId, rel);
      const headers = {};
      if (hfToken) headers["Authorization"] = "Bearer " + hfToken;
      const resp = await fetch(url, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${rel}`);
      const buf = await resp.arrayBuffer();
      const stored = new Response(buf, {
        headers: { "Content-Type": resp.headers.get("Content-Type") || "application/octet-stream" },
      });
      await cache.put(new Request(url, { method: "GET" }), stored);
      i++;
      if (progressCallback) progressCallback({ text: `downloaded ${rel}`, pct: Math.round((i / relPaths.length) * 100) });
    }
  }

  async function listRepoFiles(repoId) {
    // Probe the HF API for repo tree (works for any public, non-gated repo)
    const url = `https://huggingface.co/api/models/${repoId}/tree/main`;
    const headers = hfToken ? { "Authorization": "Bearer " + hfToken } : {};
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Repo ${repoId} not accessible (HTTP ${resp.status}). ${resp.status === 401 ? "Add an HF token for gated repos." : ""}`);
    const tree = await resp.json();
    return tree.filter((f) => !f.type || f.type === "file").map((f) => f.path);
  }

  async function load(modelId, progressCallback) {
    if (currentModelId === modelId && pipeline) return pipeline;
    if (loadingPromise) return loadingPromise;
    if (pipeline && currentModelId !== modelId) {
      try { if (pipeline.dispose) await pipeline.dispose(); } catch (e) {}
      pipeline = null; currentModelId = null;
    }

    loadingPromise = (async () => {
      const { transformers: t, opts } = await ensure(progressCallback);
      const model = resolveModel(modelId);
      pipeline = await t.pipeline(model.task, model.id, opts);
      currentModelId = model.id;
      currentModelSource = "remote";
      familyGuess = model.family || "auto";
      loadingPromise = null;
      return pipeline;
    })();

    try { return await loadingPromise; }
    catch (e) { loadingPromise = null; throw e; }
  }

  // Sideload: import local files. The repoId is a synthetic name you give
  // the model; transformers.js will look up files at HF URLs in the
  // matching cache bucket, find them, and skip the network.
  async function importLocalFiles({ repoId, files, family = "auto" }, progressCallback) {
    if (!repoId) throw new Error("Give the model a name (repo id).");
    if (!files || !files.length) throw new Error("No files selected.");
    familyGuess = family;
    if (currentModelId === repoId && pipeline) return pipeline;
    if (pipeline) { try { await pipeline.dispose(); } catch (e) {} pipeline = null; currentModelId = null; }

    loadingPromise = (async () => {
      await seedCacheWithFiles(repoId, files, progressCallback);
      const { transformers: t, opts } = await ensure(progressCallback);
      const model = { id: repoId, task: "text-generation", family };
      pipeline = await t.pipeline(model.task, model.id, opts);
      currentModelId = repoId;
      currentModelSource = "local-files";
      loadingPromise = null;
      return pipeline;
    })();

    try { return await loadingPromise; }
    catch (e) { loadingPromise = null; throw e; }
  }

  // Download from a (non-gated) HF repo into the cache, then load.
  async function downloadFromHub({ repoId, family = "auto" }, progressCallback) {
    if (!repoId) throw new Error("Enter a repo id.");
    if (pipeline && currentModelId !== repoId) {
      try { await pipeline.dispose(); } catch (e) {} pipeline = null; currentModelId = null;
    }
    loadingPromise = (async () => {
      const files = await listRepoFiles(repoId);
      // Pull the model + tokenizer + config + tokenizer.json
      const wanted = files.filter((p) =>
        /\.(onnx|bin|gguf|safetensors)$/i.test(p) ||
        /tokenizer\.json$|tokenizer_config\.json$|special_tokens_map\.json$|generation_config\.json$|config\.json$/i.test(p)
      );
      if (!wanted.length) throw new Error("No model/tokenizer files found in repo.");
      await seedCacheFromHF(repoId, wanted, progressCallback);
      familyGuess = family;
      const { transformers: t, opts } = await ensure(progressCallback);
      const model = { id: repoId, task: "text-generation", family };
      pipeline = await t.pipeline(model.task, model.id, opts);
      currentModelId = repoId;
      currentModelSource = "remote";
      loadingPromise = null;
      return pipeline;
    })();
    try { return await loadingPromise; }
    catch (e) { loadingPromise = null; throw e; }
  }

  async function unload() {
    try { if (pipeline && pipeline.dispose) await pipeline.dispose(); } catch (e) {}
    pipeline = null; currentModelId = null;
  }

  function loadedModelId() { return currentModelId; }
  function loadedSource() { return currentModelSource; }
  function listModels() { return MODELS.slice(); }
  function progress() { return lastProgress; }
  function device() { return supportsWebGPU ? "webgpu" : "wasm"; }
  function setToken(t) { hfToken = (t || "").trim(); applyToken(); }
  function getToken() { return hfToken; }

  async function* chat(messages, opts = {}) {
    if (!pipeline) throw new Error("No local model loaded");
    const maxNew = opts.max_new_tokens || 256;
    const model = resolveModel(currentModelId);
    const family = model.family || familyGuess || "auto";
    const prompt = buildPrompt(family, messages);
    const out = await pipeline(prompt, {
      max_new_tokens: maxNew,
      do_sample: typeof opts.temperature === "number" ? opts.temperature > 0 : false,
      temperature: opts.temperature ?? 0.2,
      top_p: opts.top_p ?? 0.95,
      repetition_penalty: opts.repetition_penalty ?? 1.05,
      return_full_text: false,
    });
    const text = (out && (Array.isArray(out) ? out[0]?.generated_text : out.generated_text)) || "";
    const tokens = text.split(/(\s+)/);
    let acc = "";
    for (const tok of tokens) {
      acc += tok;
      yield acc;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  // ── Cache introspection & clearing ────────────────────────────
  function listCacheNames() {
    if (!window.caches || !window.caches.keys) return Promise.resolve([]);
    return caches.keys();
  }
  async function cacheBytes(cacheName) {
    if (!window.caches || !window.caches.open) return 0;
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      let total = 0;
      for (const k of keys) {
        const r = await cache.match(k);
        if (!r) continue;
        const buf = await r.clone().arrayBuffer().catch(() => null);
        if (buf) total += buf.byteLength;
        else {
          const len = r.headers.get("content-length");
          if (len) total += parseInt(len, 10) || 0;
        }
      }
      return total;
    } catch (e) { return 0; }
  }
  async function reportCache() {
    const names = await listCacheNames();
    const rows = [];
    for (const n of names) {
      const bytes = await cacheBytes(n);
      rows.push({ name: n, bytes });
    }
    return rows;
  }
  async function clearCache() {
    const names = await listCacheNames();
    await Promise.all(names.map((n) => caches.delete(n)));
  }
  async function clearModel(repoId) {
    return caches.delete(cacheNameFor(repoId));
  }

  function bytesPretty(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  window.CodexLocalModel = {
    MODELS, load, unload, chat, listModels, progress, loadedModelId, loadedSource,
    device, supportsWebGPU: () => supportsWebGPU,
    setToken, getToken, resolveModel,
    importLocalFiles, downloadFromHub, listRepoFiles,
    reportCache, clearCache, clearModel, bytesPretty,
    cacheNameFor,
  };
})();
