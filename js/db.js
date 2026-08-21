// db.js — IndexedDB-backed file store + small KV for settings/keys
// All persistence is local. API keys never leave the device except
// when explicitly sent to the user-configured API endpoint.

(function () {
  const DB_NAME = "codex-mobile";
  const DB_VERSION = 1;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("files")) {
          const s = db.createObjectStore("files", { keyPath: "name" });
          s.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(stores, mode = "readonly") {
    const db = await open();
    return db.transaction(stores, mode);
  }

  const Files = {
    async list() {
      return new Promise(async (resolve, reject) => {
        const t = await tx(["files"]);
        const req = t.objectStore("files").getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.name.localeCompare(b.name)));
        req.onerror = () => reject(req.error);
      });
    },
    async get(name) {
      return new Promise(async (resolve, reject) => {
        const t = await tx(["files"]);
        const req = t.objectStore("files").get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },
    async put(file) {
      return new Promise(async (resolve, reject) => {
        const t = await tx(["files"], "readwrite");
        const rec = { ...file, updatedAt: Date.now() };
        const req = t.objectStore("files").put(rec);
        req.onsuccess = () => resolve(rec);
        req.onerror = () => reject(req.error);
      });
    },
    async delete(name) {
      return new Promise(async (resolve, reject) => {
        const t = await tx(["files"], "readwrite");
        const req = t.objectStore("files").delete(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async clear() {
      return new Promise(async (resolve, reject) => {
        const t = await tx(["files"], "readwrite");
        const req = t.objectStore("files").clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
  };

  const KV = {
    async get(key) {
      return new Promise(async (resolve, reject) => {
        const t = await tx(["kv"]);
        const req = t.objectStore("kv").get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value) {
      return new Promise(async (resolve, reject) => {
        const t = await tx(["kv"], "readwrite");
        const req = t.objectStore("kv").put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async delete(key) {
      return new Promise(async (resolve, reject) => {
        const t = await tx(["kv"], "readwrite");
        const req = t.objectStore("kv").delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
  };

  window.CodexDB = { Files, KV };
})();
