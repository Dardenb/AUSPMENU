// The Firebase v8 compat SDK is still loaded from the CDN in index.html, so
// `firebase` is a global here. Swapping to `import firebase from 'firebase/compat/app'`
// is a safe follow-up once this refactor is confirmed working in production.
const firebaseConfig = {
  apiKey: "AIzaSyDe7cQPav_8tHeHBFQ2atxmtANf9zxvN2M",
  authDomain: "weekly-menu-5bc28.firebaseapp.com",
  databaseURL: "https://weekly-menu-5bc28-default-rtdb.firebaseio.com",
  projectId: "weekly-menu-5bc28",
  storageBucket: "weekly-menu-5bc28.firebasestorage.app",
  messagingSenderId: "936530103301",
  appId: "1:936530103301:web:a74d1fda34ea57ae37a06c"
};

firebase.initializeApp(firebaseConfig);

export const db = firebase.database();
