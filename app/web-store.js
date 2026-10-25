// Phone / browser stand-in for the desktop app's storage. The desktop preload
// defines window.zm first, so on desktop this file does nothing. In a browser it
// provides the same API backed by IndexedDB, using the same DataModel rules.
(function () {
  'use strict';
  if (window.zm) return;

  const DM = window.DataModel;
  const DB_NAME = 'zetapro';
  const STORE = 'kv';
  const SYNC_KEY = 'zetapro-sync';

  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }

  async function idb(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
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
  const save = () => idb('readwrite', (s) => s.put(data, 'data'));
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
      data = DM.merge(await current(), remote);
      await save();
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
