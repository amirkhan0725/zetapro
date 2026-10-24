// Cross-device sync through one gzipped JSON file in a private GitHub repo.
// Each device reads the shared copy, merges it into its own (DataModel.merge
// only ever adds games), and writes the result back. GitHub's per-file `sha`
// catches two devices writing at once; the loser re-reads and merges again.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./datamodel.js'));
  else root.Sync = factory(root.DataModel);
})(typeof self !== 'undefined' ? self : this, function (DM) {
  'use strict';

  const API = 'https://api.github.com';
  const FILE = 'zetapro-data.json.gz';
  const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

  class SyncError extends Error {
    constructor(message, kind) {
      super(message);
      this.kind = kind; // 'auth' | 'repo' | 'conflict' | 'network' | 'other'
    }
  }

  async function gzip(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function fromBase64(b64) {
    const s = atob(b64.replace(/\s/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  class GitHubRemote {
    constructor({ repo, token, fetchImpl }) {
      this.repo = repo;
      this.token = token;
      this.fetch = fetchImpl || ((...a) => fetch(...a));
    }

    async call(path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
      let res;
      try {
        res = await this.fetch(`${API}${path}`, {
          method,
          cache: 'no-store',
          headers: {
            Accept: accept,
            Authorization: `Bearer ${this.token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new SyncError('Offline, or GitHub could not be reached.', 'network');
      }
      if (res.status === 401) throw new SyncError('GitHub rejected the token. It may have expired; paste a new one.', 'auth');
      return res;
    }

    /** Confirms the repo exists and this token can see it. */
    async check() {
      const res = await this.call(`/repos/${this.repo}`);
      if (res.status === 404) throw new SyncError(`Can't see ${this.repo}. Check the name, and that the token has access to it.`, 'repo');
      if (!res.ok) throw new SyncError(`GitHub said ${res.status} when opening ${this.repo}.`, 'other');
      return res.json();
    }

    /** { data, sha } of the shared copy; data is null if nothing's been synced yet. */
    async read() {
      const path = `/repos/${this.repo}/contents/${FILE}`;
      const res = await this.call(path);
      if (res.status === 404) {
        await this.check(); // tells "no file yet" apart from "no repo / no access"
        return { data: null, sha: null };
      }
      if (res.status === 403) throw new SyncError('The token is not allowed to read this repo (it needs Contents: read and write).', 'auth');
      if (!res.ok) throw new SyncError(`GitHub said ${res.status} while reading.`, 'other');
      const meta = await res.json();
      let bytes;
      if (meta.encoding === 'base64' && meta.content) {
        bytes = fromBase64(meta.content);
      } else {
        // Over 1 MB GitHub leaves `content` empty; fetch the raw bytes instead.
        const raw = await this.call(path, { accept: 'application/vnd.github.raw' });
        if (!raw.ok) throw new SyncError(`GitHub said ${raw.status} while reading.`, 'other');
        bytes = new Uint8Array(await raw.arrayBuffer());
      }
      return { data: JSON.parse(await gunzip(bytes)), sha: meta.sha };
    }

    async write(data, sha, device) {
      const body = {
        message: `Sync from ${device} (${data.sessions.length} games)`,
        content: toBase64(await gzip(JSON.stringify(data))),
      };
      if (sha) body.sha = sha;
      const res = await this.call(`/repos/${this.repo}/contents/${FILE}`, { method: 'PUT', body });
      // 409: someone else wrote first. 422: we sent no sha but a file now exists.
      if (res.status === 409 || res.status === 422) throw new SyncError('Another device saved at the same moment.', 'conflict');
      if (!res.ok) {
        // Pass GitHub's own reason through; "missing permission" is only a guess.
        let detail = '';
        try { detail = (await res.json()).message || ''; } catch { /* no body */ }
        const needs = res.headers.get('x-accepted-github-permissions');
        const hint = res.status === 403 || res.status === 404 ? ' Check the token has Contents: Read and write on this repo, then press Sync now.' : '';
        throw new SyncError(`GitHub refused the save (${res.status}${detail ? `: ${detail}` : ''}${needs ? `; needs ${needs}` : ''}).${hint}`, res.status === 403 || res.status === 404 ? 'auth' : 'other');
      }
      return (await res.json()).content.sha;
    }
  }

  /**
   * One sync pass: read shared copy → merge into this device (via store.mergeRemote,
   * which is atomic on its side) → upload if the shared copy is missing anything.
   * Returns the merged data.
   */
  async function syncOnce(store, remote, device) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: shared, sha } = await remote.read();
      const merged = await store.mergeRemote(shared);
      if (shared && DM.signature(DM.forUpload(merged)) === DM.signature(shared)) return merged;
      try {
        await remote.write(DM.forUpload(merged), sha, device);
        return merged;
      } catch (e) {
        if (e.kind !== 'conflict') throw e;
      }
    }
    throw new SyncError('Kept colliding with another device; will try again shortly.', 'conflict');
  }

  /**
   * Keeps one device in sync: serialises passes, coalesces requests made while
   * a pass is running, and reports status. `store` is window.zm.
   */
  function createSyncer({ store, device, onStatus = () => {}, onData = () => {}, fetchImpl }) {
    let cfg = { repo: '', token: '' };
    let running = null;
    let queued = false;
    let timer = 0;
    const state = { status: 'off', lastSyncAt: 0, error: '' };
    const emit = (patch) => {
      Object.assign(state, patch);
      onStatus({ ...state, repo: cfg.repo });
    };

    const enabled = () => !!(cfg.repo && cfg.token);

    async function load() {
      cfg = await store.getSyncConfig();
      if (cfg.repo && !cfg.token) {
        // A repo is set but the token is missing or can't be unlocked on this device.
        emit({ status: 'error', error: "This device's saved token can't be read. Open Sync and paste your token again." });
      } else {
        emit({ status: enabled() ? 'idle' : 'off' });
      }
      return cfg;
    }

    function now() {
      if (!enabled()) return Promise.resolve(null);
      if (running) {
        queued = true;
        return running;
      }
      running = (async () => {
        emit({ status: 'syncing', error: '' });
        try {
          const merged = await syncOnce(store, new GitHubRemote({ ...cfg, fetchImpl }), device);
          onData(merged);
          emit({ status: 'ok', lastSyncAt: Date.now() });
          return merged;
        } catch (e) {
          emit({ status: 'error', error: e.message });
          return null;
        } finally {
          running = null;
          if (queued) {
            queued = false;
            now();
          }
        }
      })();
      return running;
    }

    /** Debounced sync, for after games and setting changes. */
    function soon(ms = 1500) {
      if (!enabled()) return;
      clearTimeout(timer);
      timer = setTimeout(now, ms);
    }

    /** Validates and saves new credentials, then syncs. Throws SyncError on a bad repo/token. */
    async function connect(repo, token) {
      repo = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
      token = token.trim();
      if (!REPO_RE.test(repo)) throw new SyncError('Repository should look like owner/name.', 'repo');
      if (!token) throw new SyncError('Paste an access token.', 'auth');
      const info = await new GitHubRemote({ repo, token, fetchImpl }).check();
      cfg = await store.setSyncConfig({ repo, token });
      emit({ status: 'idle', error: '' });
      const merged = await now();
      return { private: !!info.private, merged, repo };
    }

    async function disconnect() {
      cfg = await store.setSyncConfig({ repo: '', token: '' });
      emit({ status: 'off', error: '', lastSyncAt: 0 });
    }

    return { load, now, soon, connect, disconnect, enabled, state: () => ({ ...state, repo: cfg.repo }) };
  }

  return { FILE, SyncError, GitHubRemote, syncOnce, createSyncer, gzip, gunzip, toBase64, fromBase64 };
});
