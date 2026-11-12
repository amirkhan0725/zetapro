// Account-based sync through Firebase (sign in with Google; the Windows app
// finishes Google's sign-in in the user's browser, see src/desktop-signin.js).
// Email and password stay only so older accounts can sign in and link Google.
//
// Layout in Firestore, per user:
//   users/{uid}/meta/state         settings, epoch, resetAt, deleted (tombstones)
//   users/{uid}/sessions/{key}     one document per game, with a server updatedAt
//
// Games are pushed once and pulled incrementally (only what changed since the
// last pull). Deletions, resets and restores travel in the meta document and
// follow the same DataModel.merge rules as every other copy, so nothing is
// lost when two devices sync at once.
//
// The Firebase SDK (about 720 KB of script) isn't on the page: it loads just
// after the first screen is up. app.js only checks that window.firebase exists
// before calling createCloud, so a stand-in fills that slot until then.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./datamodel.js'));
  else {
    root.Cloud = factory(root.DataModel);
    if (!root.firebase && root.document) root.firebase = root.Cloud.lazySdk(root.document, root);
  }
})(typeof self !== 'undefined' ? self : this, function (DM) {
  'use strict';

  // In load order; tools/build-web.mjs ships and caches the same files.
  const SDK_FILES = ['vendor/firebase-app-compat.js', 'vendor/firebase-auth-compat.js', 'vendor/firebase-firestore-compat.js'];

  /** Stand-in for window.firebase whose load() adds the SDK's scripts and resolves to it. */
  function lazySdk(doc, win) {
    let loading = null;
    const stub = {
      lazy: true,
      load() {
        if (!loading) {
          // The SDK warns if it finds window.firebase already defined (this
          // stand-in, or half an SDK from a failed try), and nothing else holds it.
          win.firebase = undefined;
          loading = Promise.all(SDK_FILES.map((src) => new Promise((resolve, reject) => {
            const el = doc.createElement('script');
            el.src = src;
            el.async = false; // fetched together, run in order
            el.onload = resolve;
            el.onerror = () => reject(new Error(`Couldn't load ${src}`));
            doc.head.appendChild(el);
          }))).then(() => {
            const fb = win.firebase;
            if (!fb || !fb.initializeApp || !fb.auth || !fb.firestore) throw new Error('The Firebase SDK didn’t start.');
            return fb;
          }).catch((e) => {
            loading = null; // tried again the next time it's needed
            throw e;
          });
        }
        return loading;
      },
    };
    return stub;
  }

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
    // What this device wrote, so the listeners can tell their own echo from
    // another device's change: games it uploaded or removed, and the shared
    // rules as it last read or wrote them.
    const mine = new Set();
    let lastMeta = null;
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
        lastMeta = snap.exists ? snap.data() : null;
        return lastMeta;
      },
      /** fn(current meta or null) → meta to store; retried by Firestore on contention. */
      async updateMeta(fn) {
        lastMeta = await db.runTransaction(async (tx) => {
          const snap = await tx.get(metaRef);
          const next = fn(snap.exists ? snap.data() : null);
          tx.set(metaRef, plain(next));
          return next;
        });
        return lastMeta;
      },
      async pushSessions(list) {
        for (let i = 0; i < list.length; i += 400) {
          const batch = db.batch();
          for (const s of list.slice(i, i + 400)) {
            mine.add(DM.sessionKey(s));
            batch.set(sessions.doc(DM.sessionKey(s)), { s: plain(s), at: s.at, updatedAt: ts() });
          }
          await batch.commit();
        }
      },
      async deleteSessions(keys) {
        for (let i = 0; i < keys.length; i += 400) {
          const batch = db.batch();
          for (const k of keys.slice(i, i + 400)) {
            mine.add(k);
            batch.delete(sessions.doc(k));
          }
          await batch.commit();
        }
      },
      /**
       * Calls back whenever another device changes this user's data. Each
       * listener's first snapshot is the current state, not a change, and this
       * device's own writes are ignored: without that, every sync that wrote
       * something started a second one 800 ms later.
       */
      listen(onChange) {
        const watch = (isOwn) => {
          let first = true;
          return (snap) => {
            if (first) { first = false; return; }
            if (!isOwn(snap)) onChange();
          };
        };
        const a = metaRef.onSnapshot(watch((snap) => sameMeta(snap.exists ? snap.data() : null, lastMeta)), () => {});
        const b = sessions.where('updatedAt', '>', firebase.firestore.Timestamp.now())
          .onSnapshot(watch((snap) => snap.docChanges().every((c) => mine.has(c.doc.id))), () => {});
        return () => { a(); b(); };
      },
    };
  }

  /**
   * One sync pass for one user. `store` is window.zm; `book` remembers, per
   * device and user, which games were already pushed and when we last pulled.
   */
  async function syncOnce(store, remote, book) {
    // A full download lists exactly what the account holds, so the bookkeeping
    // is rebuilt from it: entries for games the account no longer has can't
    // send every later sync back here, and a game this device has but the
    // account lost is uploaded again in step 3.
    const listAll = (list) => { book.pushed = new Map(list.map((s) => [DM.sessionKey(s), s.at])); };

    // 1. Pull what changed elsewhere, and the shared rules (deletions, resets).
    let firstTime = !book.pulledAt;
    let { sessions: incoming, maxUpdated } = await remote.pullSince(book.pulledAt ? book.pulledAt - 2000 : 0);
    if (firstTime) listAll(incoming);
    else for (const s of incoming) book.pushed.set(DM.sessionKey(s), s.at); // already in the account
    const meta = await remote.readMeta();
    let merged = await store.mergeRemote(meta || incoming.length ? { ...(meta || {}), sessions: incoming } : null);

    // A game we know is in the account, missing here and not deleted, means this
    // device lost data (storage cleared, file removed). Re-download everything
    // rather than treat the gap as a deletion.
    const isGone = (key, at) => merged.deleted.includes(key) || (!!merged.resetAt && !!at && at <= merged.resetAt);
    const have = new Set(merged.sessions.map(DM.sessionKey));
    if ([...book.pushed].some(([k, at]) => !have.has(k) && !isGone(k, at))) {
      firstTime = true;
      ({ sessions: incoming, maxUpdated } = await remote.pullSince(0));
      listAll(incoming);
      merged = await store.mergeRemote({ ...(meta || {}), sessions: incoming });
    }

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
    for (const s of fresh) book.pushed.set(DM.sessionKey(s), s.at);

    // 4. Remove deleted games from the account. Only games that are actually
    //    deleted (a tombstone, or older than a reset) ever leave it.
    const live = new Set(merged.sessions.map(DM.sessionKey));
    const gone = [...book.pushed].filter(([k, at]) => !live.has(k) && isGone(k, at)).map(([k]) => k);
    if (gone.length) await remote.deleteSessions(gone);
    for (const k of gone) book.pushed.delete(k);

    book.pulledAt = Math.max(book.pulledAt || 0, maxUpdated || 0, firstTime ? 1 : 0);
    return { merged, pushed: fresh.length, pulled: incoming.length, removed: gone.length };
  }

  // ---- per-device bookkeeping -------------------------------------------------

  function loadBook(uid) {
    try {
      const raw = JSON.parse(localStorage.getItem(`zetapro-cloud-${uid}`) || '{}');
      // pushed: key → game start time. (1.2.0 stored a plain list of keys.)
      const pushed = Array.isArray(raw.pushed) ? new Map(raw.pushed.map((k) => [k, 0])) : new Map(Object.entries(raw.pushed || {}));
      return { pulledAt: raw.pulledAt || 0, pushed };
    } catch {
      return { pulledAt: 0, pushed: new Map() };
    }
  }

  function saveBook(uid, book) {
    try {
      localStorage.setItem(`zetapro-cloud-${uid}`, JSON.stringify({ pulledAt: book.pulledAt, pushed: Object.fromEntries(book.pushed) }));
    } catch { /* storage blocked: next sync re-checks everything */ }
  }

  // ---- account + sync controller ---------------------------------------------------

  const AUTH_MESSAGES = {
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Enter a password.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with that email. Use Continue with Google.',
    'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
    'auth/network-request-failed': 'Couldn’t reach the sign-in service. Check your connection.',
    'auth/popup-closed-by-user': 'Sign-in window was closed before finishing.',
    'auth/popup-blocked': 'The browser blocked the Google window. Allow pop-ups for this site and try again.',
    'auth/account-exists-with-different-credential': 'You already have an account with this email. Open “Used an email and password before?”, sign in, then link Google.',
    'auth/credential-already-in-use': 'That Google account already has its own Zetapro account.',
    'auth/provider-already-linked': 'Google is already linked to this account.',
    'auth/requires-recent-login': 'For security, sign out and back in, then try again.',
    'auth/unauthorized-domain': 'This site isn’t on the Firebase project’s authorized domains list yet.',
  };
  const friendly = (e) => AUTH_MESSAGES[e && e.code] || (e && e.message) || 'Something went wrong.';
  const NOT_LOADED = 'Couldn’t load the sign-in service. Check your connection and try again.';

  /**
   * `firebase` is the SDK, or lazySdk's stand-in: then the SDK loads once the
   * first screen has been drawn, or sooner if something needs it (a sign-in,
   * the leaderboards reading `db`). A signed-in user's session is restored and
   * synced as soon as it's loaded, as before.
   */
  function createCloud({ firebase, config, store, onStatus = () => {}, onData = () => {}, onUser = () => {} }) {
    let sdk = null;
    let auth = null;
    let db = null;
    let loading = null;
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
        // Signing out (and maybe clearing this device) can happen mid-sync. From
        // then on this pass must not merge games back in, record bookkeeping
        // that forgetDevice just removed, or report a result.
        const current = () => !!user && user.uid === uid;
        const guarded = {
          mergeRemote: (r) => (current() ? store.mergeRemote(r) : Promise.reject(new Error('Signed out during sync.'))),
        };
        try {
          const r = await syncOnce(guarded, remote, book);
          if (!current()) return null;
          saveBook(uid, book);
          onData(r.merged, r);
          emit({ status: 'ok', lastSyncAt: Date.now() });
          return r;
        } catch (e) {
          if (current()) emit({ status: 'error', error: e.code === 'permission-denied' ? 'The database refused access. Check the Firestore rules.' : friendly(e) });
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

    function start(fb) {
      const app = fb.initializeApp(config);
      auth = app.auth();
      db = app.firestore();
      sdk = fb;
      auth.onAuthStateChanged((u) => {
        if (stopListen) stopListen();
        stopListen = null;
        user = u;
        remote = u ? firestoreRemote(sdk, db, u.uid) : null;
        onUser(u);
        if (!u) {
          emit({ status: 'off', error: '' });
          return;
        }
        emit({ status: 'idle', error: '' });
        now();
        stopListen = remote.listen(() => soon(800));
      });
    }

    /** Resolves once the SDK is loaded and started. */
    function ready() {
      if (sdk) return Promise.resolve();
      if (!loading) {
        loading = Promise.resolve().then(() => firebase.load()).then(start).catch((e) => {
          loading = null;
          throw e;
        });
      }
      return loading;
    }
    const kick = () => { ready().catch((e) => console.warn(`Account sync isn't available: ${e.message}`)); };
    /** For the sign-in calls: the SDK, loading it first if need be. */
    const loaded = async () => {
      if (sdk) return;
      try { await ready(); } catch { throw new Error(NOT_LOADED); }
    };

    if (!firebase.lazy) start(firebase);
    else {
      // After the frame that shows the first screen. A page opened in the
      // background draws no frames, so a timer makes sure it happens anyway.
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(kick, 0));
      setTimeout(kick, 2000);
    }

    return {
      now,
      soon,
      /** The leaderboards (leaderboard.js) share this connection; null until the SDK is loaded. */
      get db() {
        if (!db) kick();
        return db;
      },
      signedIn: () => !!user,
      uid: () => (user ? user.uid : null),
      state: () => ({ ...state, user: user && { email: user.email, providers: user.providerData.map((p) => p.providerId) } }),
      async signInGoogle() {
        // Windows app: Google refuses its sign-in inside app windows, so it
        // happens in the user's browser, which hands back a Google ID token.
        if (store.signInWithBrowser) {
          await loaded();
          const idToken = await store.signInWithBrowser();
          try { await auth.signInWithCredential(sdk.auth.GoogleAuthProvider.credential(idToken)); } catch (e) { throw new Error(friendly(e)); }
          return;
        }
        // Once loaded, the popup must open in the same turn as the click, or
        // browsers block it, so there's no await before it then.
        if (!sdk) await loaded();
        const provider = new sdk.auth.GoogleAuthProvider();
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
      /** Older accounts only: they sign in this way once, then link Google. */
      async signInEmail(email, password) {
        await loaded();
        try { await auth.signInWithEmailAndPassword(email.trim(), password); } catch (e) { throw new Error(friendly(e)); }
      },
      async resetPassword(email) {
        await loaded();
        try { await auth.sendPasswordResetEmail(email.trim()); } catch (e) { throw new Error(friendly(e)); }
      },
      /** Moves the signed-in email-and-password account to Google: links it, then retires the password. */
      async linkGoogle() {
        if (!user) throw new Error('Sign in first.');
        const u = user;
        try {
          if (store.signInWithBrowser) {
            const idToken = await store.signInWithBrowser();
            await u.linkWithCredential(sdk.auth.GoogleAuthProvider.credential(idToken));
          } else {
            // Straight from the click, like signInGoogle, or the popup is blocked.
            await u.linkWithPopup(new sdk.auth.GoogleAuthProvider());
          }
          if (u.providerData.some((p) => p.providerId === 'password')) await u.unlink('password');
          await u.reload();
        } catch (e) { throw new Error(friendly(e)); }
        if (user && user.uid === u.uid) user = auth.currentUser || u;
        emit({});
      },
      async signOut() {
        const uid = user && user.uid;
        if (!auth) return uid; // nothing loaded, so nobody is signed in
        await auth.signOut();
        return uid;
      },
      forgetDevice(uid) {
        try { localStorage.removeItem(`zetapro-cloud-${uid}`); } catch { /* ignore */ }
      },
    };
  }

  return { createCloud, syncOnce, firestoreRemote, metaOf, friendly, lazySdk, SDK_FILES };
});
