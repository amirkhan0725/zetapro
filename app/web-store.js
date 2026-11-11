// window.zm, the page's storage API. On desktop it wraps the preload's bridge
// (window.zmDesktop), which passes the whole data file as JSON text to parse
// here: much faster than Electron copying it as objects. In a browser it is
// the same API backed by IndexedDB, using the same DataModel rules.
(function () {
  'use strict';
  if (window.zm) return;

  const desktop = window.zmDesktop;
  if (desktop) {
    const parse = (text) => JSON.parse(text);
    window.zm = {
      ...desktop, // platform and the calls that pass little data, as they are
      load: async () => parse(await desktop.load()),
      deleteSessions: async (keys) => parse(await desktop.deleteSessions(keys)),
      restoreSessions: async (sessions) => parse(await desktop.restoreSessions(JSON.stringify(sessions))),
      clearDevice: async () => parse(await desktop.clearDevice()),
      mergeRemote: async (remote) => parse(await desktop.mergeRemote(JSON.stringify(remote === undefined ? null : remote))),
    };
    return;
  }

  const DM = window.DataModel;
  const DB_NAME = 'zetapro';
  const STORE = 'kv';
  const SYNC_KEY = 'zetapro-sync';

  let dbp = null;
  let conn = null;
  const forget = (d) => {
    if (conn !== d) return;
    conn = null;
    dbp = null;
  };
  function db() {
    if (!dbp) {
      const p = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => {
          const d = req.result;
          // The browser can drop the connection (site data cleared, or iOS after
          // the app sat in the background); the next call then opens a new one.
          d.onclose = () => forget(d);
          d.onversionchange = () => { d.close(); forget(d); };
          conn = d;
          resolve(d);
        };
        req.onerror = () => reject(req.error);
      });
      dbp = p;
      p.catch(() => { if (dbp === p) dbp = null; }); // a failed open is tried again next time
    }
    return dbp;
  }

  // What a closed or lost connection looks like: "The database connection is
  // closing" (Chrome), "Connection to Indexed Database server lost" (Safari).
  const lostConnection = (e) => !!e && (e.name === 'InvalidStateError' || e.name === 'UnknownError');

  async function idb(mode, fn, retried = false) {
    const d = await db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        // Running out of space aborts a transaction with no error event; without
        // this the save would never finish.
        tx.onabort = () => reject(tx.error || new Error('Saving was interrupted.'));
      });
    } catch (e) {
      if (retried || !lostConnection(e)) throw e;
      // Every call reads or writes the whole record, so one retry on a fresh
      // connection is safe.
      try { d.close(); } catch { /* already closed */ }
      forget(d);
      return idb(mode, fn, true);
    }
  }

  let data = null;
  async function current() {
    if (!data) {
      data = DM.normalize(await idb('readonly', (s) => s.get('data')));
      // Ask the browser not to evict saved games under storage pressure.
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }
    return data;
  }
  // Set while the stored copy may be behind memory (a save failed), so the next
  // merge saves even if it changed nothing. Saves finish in the order they start.
  let dirty = false;
  const save = () => {
    dirty = true;
    return idb('readwrite', (s) => s.put(data, 'data')).then(() => { dirty = false; }, (e) => { dirty = true; throw e; });
  };
  const copy = (x) => JSON.parse(JSON.stringify(x));

  window.zm = {
    platform: 'web',
    async load() {
      return copy(await current());
    },
    async addSession(s) {
      DM.addSession(await current(), s);
      await save();
      return s;
    },
    async updateSettings(patch) {
      const d = await current();
      d.settings = DM.applySettings(d.settings, patch);
      await save();
      applyTheme(d.settings.theme);
      return copy(d.settings);
    },
    async deleteSessions(keys) {
      DM.deleteSessions(await current(), keys);
      await save();
      return copy(data);
    },
    async restoreSessions(sessions) {
      DM.restoreSessions(await current(), sessions);
      await save();
      return copy(data);
    },
    async clearDevice() {
      DM.clearDevice(await current());
      await save();
      return copy(data);
    },
    async mergeRemote(remote) {
      // Most syncs bring nothing new; then the stored copy isn't rewritten.
      const before = await current();
      data = DM.merge(before, remote);
      if (DM.changedBy(before, data) || dirty) await save();
      return copy(data);
    },
    async reset() {
      if (!window.confirm('Delete every saved game and all problem history? Settings are kept. If sync is on, this deletes them on your other devices too.')) return false;
      DM.reset(await current());
      await save();
      return true;
    },
    async exportCsv() {
      const name = `zetapro-problems-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(new Blob([DM.toCsv(await current())], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return name;
    },
    async openDataFolder() {},
    async getSyncConfig() {
      try {
        const c = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
        return { repo: c.repo || '', token: c.token || '' };
      } catch {
        return { repo: '', token: '' };
      }
    },
    async setSyncConfig({ repo = '', token = '' }) {
      localStorage.setItem(SYNC_KEY, JSON.stringify({ repo, token }));
      return { repo, token };
    },
  };

  // The desktop app themes via the OS; in a browser the page sets it itself.
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    window.dispatchEvent(new Event('zm-theme'));
  }
  current().then((d) => applyTheme(d.settings.theme)).catch(() => {});
})();
