// Account-based sync through Firebase (sign in with Google or email).
//
// Layout in Firestore, per user:
//   users/{uid}/meta/state         settings, epoch, resetAt, deleted (tombstones)
//   users/{uid}/sessions/{key}     one document per game, with a server updatedAt
//
// Games are pushed once and pulled incrementally (only what changed since the
// last pull). Deletions, resets and restores travel in the meta document and
// follow the same DataModel.merge rules as every other copy, so nothing is
// lost when two devices sync at once.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./datamodel.js'));
  else root.Cloud = factory(root.DataModel);
})(typeof self !== 'undefined' ? self : this, function (DM) {
  'use strict';

  const META_KEYS = ['settings', 'epoch', 'resetAt', 'deleted'];
  const plain = (x) => JSON.parse(JSON.stringify(x)); // Firestore rejects undefined
  const metaOf = (d) => {
    const up = DM.forUpload(d);
    return { settings: up.settings, epoch: up.epoch || 0, resetAt: up.resetAt || 0, deleted: up.deleted || [] };
  };
  // Firestore may hand maps back with keys in a different order, so compare canonically.
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const sameMeta = (a, b) => !!a && !!b && JSON.stringify(canon(META_KEYS.map((k) => a[k]))) === JSON.stringify(canon(META_KEYS.map((k) => b[k])));

  /**
   * Storage for one signed-in user. Everything the sync needs from Firestore
   * goes through these six calls, which keeps the algorithm testable.
   */
  function firestoreRemote(firebase, db, uid) {
    const userDoc = db.collection('users').doc(uid);
    const sessions = userDoc.collection('sessions');
    const metaRef = userDoc.collection('meta').doc('state');
    const ts = firebase.firestore.FieldValue.serverTimestamp;
    const millis = (t) => (t && t.toMillis ? t.toMillis() : 0);
    return {
      async pullSince(ms) {
        const q = ms ? sessions.where('updatedAt', '>', firebase.firestore.Timestamp.fromMillis(ms)) : sessions;
        const snap = await q.get();
        let maxUpdated = ms;
        const list = [];
        snap.forEach((doc) => {
          const d = doc.data();
          if (d.s) list.push(d.s);
          maxUpdated = Math.max(maxUpdated, millis(d.updatedAt));
        });
        return { sessions: list, maxUpdated };
      },
      async readMeta() {
        const snap = await metaRef.get();
        return snap.exists ? snap.data() : null;
      },
      /** fn(current meta or null) → meta to store; retried by Firestore on contention. */
      async updateMeta(fn) {
        return db.runTransaction(async (tx) => {
          const snap = await tx.get(metaRef);
          const next = fn(snap.exists ? snap.data() : null);
          tx.set(metaRef, plain(next));
          return next;
        });
      },
      async pushSessions(list) {
        for (let i = 0; i < list.length; i += 400) {
          const batch = db.batch();
          for (const s of list.slice(i, i + 400)) batch.set(sessions.doc(DM.sessionKey(s)), { s: plain(s), at: s.at, updatedAt: ts() });
          await batch.commit();
        }
      },
      async deleteSessions(keys) {
        for (let i = 0; i < keys.length; i += 400) {
          const batch = db.batch();
          for (const k of keys.slice(i, i + 400)) batch.delete(sessions.doc(k));
          await batch.commit();
        }
      },
      /** Calls back whenever another device changes this user's data. */
      listen(onChange) {
        let first = 0;
        const skipFirst = () => { if (first++ >= 2) onChange(); };
        const a = metaRef.onSnapshot(skipFirst, () => {});
        const b = sessions.where('updatedAt', '>', firebase.firestore.Timestamp.now()).onSnapshot(skipFirst, () => {});
        return () => { a(); b(); };
      },
    };
  }

  /**
   * One sync pass for one user. `store` is window.zm; `book` remembers, per
   * device and user, which games were already pushed and when we last pulled.
   */
  async function syncOnce(store, remote, book) {
    // 1. Pull what changed elsewhere, and the shared rules (deletions, resets).
    const firstTime = !book.pulledAt;
    const { sessions: incoming, maxUpdated } = await remote.pullSince(book.pulledAt ? book.pulledAt - 2000 : 0);
    for (const s of incoming) book.pushed.add(DM.sessionKey(s)); // already in the account
    const meta = await remote.readMeta();
    let merged = await store.mergeRemote(meta || incoming.length ? { ...(meta || {}), sessions: incoming } : null);

    // 2. Agree on the shared rules. The transaction merges with whatever another
    //    device wrote in the meantime, then this device adopts the result.
    const mine = metaOf(merged);
    if (!sameMeta(mine, meta)) {
      const agreed = await remote.updateMeta((current) => metaOf(DM.merge({ ...mine, sessions: [] }, current ? { ...current, sessions: [] } : null)));
      merged = await store.mergeRemote({ ...agreed, sessions: [] });
    }

    // 3. Push games the account doesn't have yet.
    const fresh = merged.sessions.filter((s) => !book.pushed.has(DM.sessionKey(s)));
    if (fresh.length) await remote.pushSessions(fresh);
    for (const s of fresh) book.pushed.add(DM.sessionKey(s));

    // 4. Remove deleted games from the account (the tombstones keep them gone).
    const live = new Set(merged.sessions.map(DM.sessionKey));
    const gone = [...book.pushed].filter((k) => !live.has(k));
    if (gone.length) await remote.deleteSessions(gone);
    for (const k of gone) book.pushed.delete(k);

    book.pulledAt = Math.max(book.pulledAt || 0, maxUpdated || 0, firstTime ? 1 : 0);
    return { merged, pushed: fresh.length, pulled: incoming.length, removed: gone.length };
  }

  // ---- per-device bookkeeping -------------------------------------------------

  function loadBook(uid) {
    try {
      const raw = JSON.parse(localStorage.getItem(`zetapro-cloud-${uid}`) || '{}');
      return { pulledAt: raw.pulledAt || 0, pushed: new Set(raw.pushed || []) };
    } catch {
      return { pulledAt: 0, pushed: new Set() };
    }
  }

  function saveBook(uid, book) {
    try {
      localStorage.setItem(`zetapro-cloud-${uid}`, JSON.stringify({ pulledAt: book.pulledAt, pushed: [...book.pushed] }));
    } catch { /* storage blocked: next sync re-checks everything */ }
  }

  // ---- account + sync controller ---------------------------------------------------

  const AUTH_MESSAGES = {
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Enter a password.',
    'auth/weak-password': 'Use at least 6 characters for the password.',
    'auth/email-already-in-use': 'There’s already an account with that email. Sign in instead.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with that email. Create one instead.',
    'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
    'auth/network-request-failed': 'Couldn’t reach the sign-in service. Check your connection.',
    'auth/popup-closed-by-user': 'Sign-in window was closed before finishing.',
    'auth/credential-already-in-use': 'Another account already uses that email and password.',
    'auth/provider-already-linked': 'This account already has a password.',
    'auth/requires-recent-login': 'For security, sign out and back in, then try again.',
    'auth/unauthorized-domain': 'This site isn’t on the Firebase project’s authorized domains list yet.',
  };
  const friendly = (e) => AUTH_MESSAGES[e && e.code] || (e && e.message) || 'Something went wrong.';

  function createCloud({ firebase, config, store, onStatus = () => {}, onData = () => {}, onUser = () => {} }) {
    const app = firebase.initializeApp(config);
    const auth = app.auth();
    const db = app.firestore();
    let user = null;
    let remote = null;
    let stopListen = null;
    let running = null;
    let queued = false;
    let timer = 0;
    const state = { status: 'off', error: '', lastSyncAt: 0 };
    const emit = (patch) => {
      Object.assign(state, patch);
      onStatus({ ...state, user: user && { email: user.email, providers: user.providerData.map((p) => p.providerId) } });
    };

    function now() {
      if (!user) return Promise.resolve(null);
      if (running) {
        queued = true;
        return running;
      }
      running = (async () => {
        emit({ status: 'syncing', error: '' });
        const uid = user.uid;
        const book = loadBook(uid);
        try {
          const r = await syncOnce(store, remote, book);
          saveBook(uid, book);
          onData(r.merged, r);
          emit({ status: 'ok', lastSyncAt: Date.now() });
          return r;
        } catch (e) {
          emit({ status: 'error', error: e.code === 'permission-denied' ? 'The database refused access. Check the Firestore rules.' : friendly(e) });
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

    function soon(ms = 1500) {
      if (!user) return;
      clearTimeout(timer);
      timer = setTimeout(now, ms);
    }

    auth.onAuthStateChanged((u) => {
      if (stopListen) stopListen();
      stopListen = null;
      user = u;
      remote = u ? firestoreRemote(firebase, db, u.uid) : null;
      onUser(u);
      if (!u) {
        emit({ status: 'off', error: '' });
        return;
      }
      emit({ status: 'idle', error: '' });
      now();
      stopListen = remote.listen(() => soon(800));
    });

    return {
      now,
      soon,
      signedIn: () => !!user,
      state: () => ({ ...state, user: user && { email: user.email, providers: user.providerData.map((p) => p.providerId) } }),
      async signInGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
          await auth.signInWithPopup(provider);
        } catch (e) {
          if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
            await auth.signInWithRedirect(provider);
            return;
          }
          throw new Error(friendly(e));
        }
      },
      async signInEmail(email, password) {
        try { await auth.signInWithEmailAndPassword(email.trim(), password); } catch (e) { throw new Error(friendly(e)); }
      },
      async createAccount(email, password) {
        try { await auth.createUserWithEmailAndPassword(email.trim(), password); } catch (e) { throw new Error(friendly(e)); }
      },
      async resetPassword(email) {
        try { await auth.sendPasswordResetEmail(email.trim()); } catch (e) { throw new Error(friendly(e)); }
      },
      /** Lets a Google account also sign in with email + password (the Windows app). */
      async addPassword(password) {
        try {
          await user.linkWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
          await user.reload();
          user = auth.currentUser;
          emit({});
        } catch (e) { throw new Error(friendly(e)); }
      },
      async signOut() {
        await auth.signOut();
      },
    };
  }

  return { createCloud, syncOnce, firestoreRemote, metaOf, friendly };
});
