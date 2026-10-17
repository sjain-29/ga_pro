/**
 * Database / Auth / Storage facade.
 * Two interchangeable backends with the same API:
 *   - FirebaseBackend: Realtime Database + Authentication + Storage (production)
 *   - DemoBackend:     in-browser sample data with a rule simulator (demo/testing)
 *
 * The rest of the app only talks to `backend`.
 */
import { firebaseConfig, FIREBASE_SDK_VERSION, isConfigured, FUNCTIONS_REGION, CLOUD_FUNCTIONS_DEPLOYED } from './firebase-config.js';

export let backend = null;

export async function initBackend() {
  if (isConfigured() && !new URLSearchParams(location.search).has('demo')) {
    backend = await createFirebaseBackend();
  } else {
    const { createDemoBackend } = await import('./demo-db.js');
    backend = createDemoBackend();
  }
  return backend;
}

async function createFirebaseBackend() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
  const [appM, dbM, authM] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-database.js`),
    import(`${base}/firebase-auth.js`),
  ]);
  const app = appM.initializeApp(firebaseConfig);
  const db = dbM.getDatabase(app);
  const auth = authM.getAuth(app);
  await authM.setPersistence(auth, authM.browserLocalPersistence).catch(() => {});

  const buildQuery = (path, q) => {
    let r = dbM.ref(db, path);
    if (!q) return r;
    const parts = [];
    if (q.orderBy) parts.push(dbM.orderByChild(q.orderBy));
    if (q.equalTo !== undefined) parts.push(dbM.equalTo(q.equalTo));
    if (q.limitToLast) parts.push(dbM.limitToLast(q.limitToLast));
    return parts.length ? dbM.query(r, ...parts) : r;
  };

  let storageMod = null;
  const storage = async () => {
    if (!storageMod) {
      const sm = await import(`${base}/firebase-storage.js`);
      storageMod = { sm, st: sm.getStorage(app) };
    }
    return storageMod;
  };

  return {
    mode: 'firebase',
    serverTime: () => dbM.serverTimestamp(),
    pushKey: (path) => dbM.push(dbM.ref(db, path)).key,
    onValue(path, cb, err, q) {
      return dbM.onValue(buildQuery(path, q), (snap) => cb(snap.val()), (e) => err && err(e));
    },
    async get(path) { const s = await dbM.get(dbM.ref(db, path)); return s.val(); },
    update: (updates) => dbM.update(dbM.ref(db), updates),
    set: (path, v) => dbM.set(dbM.ref(db, path), v),
    onConnection(cb) { return dbM.onValue(dbM.ref(db, '.info/connected'), (s) => cb(s.val() === true)); },

    /* ---- auth ---- */
    onAuth: (cb) => authM.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null)),
    signIn: (email, pw) => authM.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => authM.signOut(auth),
    async changePassword(currentPw, newPw) {
      const u = auth.currentUser;
      const cred = authM.EmailAuthProvider.credential(u.email, currentPw);
      await authM.reauthenticateWithCredential(u, cred);
      await authM.updatePassword(u, newPw);
    },
    sendReset: (email) => authM.sendPasswordResetEmail(auth, email),
    currentUid: () => auth.currentUser?.uid || null,
    /**
     * Create an Auth account without signing the admin out: uses a short-lived
     * secondary Firebase app instance. Returns the new uid.
     */
    async createAccount(email, password) {
      const sec = appM.initializeApp(firebaseConfig, 'provision-' + Date.now());
      try {
        const secAuth = authM.getAuth(sec);
        const cred = await authM.createUserWithEmailAndPassword(secAuth, email, password);
        await authM.signOut(secAuth);
        return cred.user.uid;
      } finally { await appM.deleteApp(sec).catch(() => {}); }
    },
    async callFunction(name, data) {
      const fm = await import(`${base}/firebase-functions.js`);
      const fn = fm.httpsCallable(fm.getFunctions(app, FUNCTIONS_REGION), name);
      return (await fn(data)).data;
    },

    /* ---- storage ---- */
    async upload(path, file, onProgress) {
      const { sm, st } = await storage();
      const r = sm.ref(st, path);
      const task = sm.uploadBytesResumable(r, file, { contentType: file.type });
      await new Promise((res, rej) => task.on('state_changed', (s) => onProgress && onProgress(s.bytesTransferred / s.totalBytes), rej, res));
      return path;
    },
    async downloadUrl(path) { const { sm, st } = await storage(); return sm.getDownloadURL(sm.ref(st, path)); },
    async removeFile(path) { const { sm, st } = await storage(); return sm.deleteObject(sm.ref(st, path)); },
    // Storage rules rely on custom claims set by the Cloud Functions.
    storageAvailable: CLOUD_FUNCTIONS_DEPLOYED,
  };
}
