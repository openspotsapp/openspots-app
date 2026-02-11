// ============================
// Firebase Initialization (GLOBAL)
// ============================

import {
  getApp,
  getApps,
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDy3VL4_2rXT5QNwlDMQc_GBrOSx_OalFY",
  authDomain: "open-spots-yt903b.firebaseapp.com",
  projectId: "open-spots-yt903b",
  storageBucket: "open-spots-yt903b.firebasestorage.app",
  messagingSenderId: "298540480317",
  appId: "1:298540480317:web:e3fdb63b777ebb165ff754",
  measurementId: "G-4D0EYL43HL"
};

// Prevent duplicate initialization
export const app =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
