// git.js — minimal GitHub client. Uses the Contents API for file CRUD and
// the Git Data API for atomic multi-file commits. The user supplies a
// personal access token (classic with `repo` scope, or fine-grained with
// Contents: Read & write). Stored locally only.

(function () {
  const API = "https://api.github.com";

  function headers(token) {
    return {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async function getUser(token) {
    const r = await fetch(`${API}/user`, { headers: headers(token) });
    if (!r.ok) throw new Error("auth failed: HTTP " + r.status);
    return r.json();
  }

  async function getRepo(token, owner, repo) {
    const r = await fetch(`${API}/repos/${owner}/${repo}`, { headers: headers(token) });
    if (!r.ok) throw new Error("repo not accessible: HTTP " + r.status);
    return r.json();
  }

  async function getDefaultBranchSha(token, owner, repo, branch) {
    const r = await fetch(`${API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers: headers(token) });
    if (!r.ok) throw new Error("ref fetch failed: HTTP " + r.status);
    const j = await r.json();
    return j.object.sha;
  }

  // Build a tree from a flat list of { path, content, mode? } entries.
  async function createTree(token, owner, repo, baseTreeSha, entries) {
    const tree = entries.map((e) => ({
      path: e.path,
      mode: e.mode || "100644",
      type: "blob",
      content: e.content,
    }));
    const r = await fetch(`${API}/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error("tree failed: HTTP " + r.status + " " + t.slice(0, 200));
    }
    const j = await r.json();
    return j.sha;
  }

  async function createCommit(token, owner, repo, message, treeSha, parentSha) {
    const r = await fetch(`${API}/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error("commit failed: HTTP " + r.status + " " + t.slice(0, 200));
    }
    return r.json();
  }

  async function updateRef(token, owner, repo, branch, sha) {
    const r = await fetch(`${API}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ sha, force: false }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error("ref update failed: HTTP " + r.status + " " + t.slice(0, 200));
    }
    return r.json();
  }

  // Push all local files as a single commit on the given branch.
  // Files: [{ path: "src/main.ts", content: "..." }, ...]
  async function push(token, owner, repo, branch, message, files, onProgress) {
    if (!token) throw new Error("Missing GitHub token");
    if (!owner || !repo) throw new Error("Missing owner/repo");
    if (!Array.isArray(files) || !files.length) throw new Error("No files to push");

    onProgress && onProgress("resolving repo");
    const repoInfo = await getRepo(token, owner, repo);
    const targetBranch = branch || repoInfo.default_branch;

    onProgress && onProgress("fetching base ref");
    const baseSha = await getDefaultBranchSha(token, owner, repo, targetBranch);

    onProgress && onProgress(`building tree (${files.length} files)`);
    const treeSha = await createTree(token, owner, repo, baseSha, files);

    onProgress && onProgress("creating commit");
    const commit = await createCommit(token, owner, repo, message, treeSha, baseSha);

    onProgress && onProgress("updating ref");
    await updateRef(token, owner, repo, targetBranch, commit.sha);

    return {
      sha: commit.sha,
      url: commit.html_url,
      branch: targetBranch,
      filesCommitted: files.length,
    };
  }

  async function listCommits(token, owner, repo, branch, perPage = 10) {
    const b = branch ? `&sha=${encodeURIComponent(branch)}` : "";
    const r = await fetch(`${API}/repos/${owner}/${repo}/commits?per_page=${perPage}${b}`, { headers: headers(token) });
    if (!r.ok) throw new Error("list failed: HTTP " + r.status);
    return r.json();
  }

  window.CodexGit = { push, getUser, getRepo, listCommits };
})();
