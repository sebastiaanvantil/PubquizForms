// Firebase init. The web config is public by design; access is controlled by
// firestore.rules, not by hiding these values.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Re-exported so the SDK version lives in one place.
export * from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
export * from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Web config from the Firebase console (README, step 6).
const firebaseConfig = {
  apiKey: "AIzaSyBhrZ4iSJrwAPdkxUEMOssORqoexyOoE0E",
  authDomain: "pubquizforms.firebaseapp.com",
  projectId: "pubquizforms",
  storageBucket: "pubquizforms.firebasestorage.app",
  messagingSenderId: "120224312238",
  appId: "1:120224312238:web:e6583ea1841ed7d4f4363f"
};

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/**
 * Connect as 'player' or 'admin'. Each role is its own Firebase app, so the
 * anonymous player session and the admin login do not overwrite each other
 * when both pages are open in the same browser.
 */
export function connect(role = 'player') {
  const app = initializeApp(firebaseConfig, role);
  return { app, auth: getAuth(app), db: getFirestore(app) };
}
