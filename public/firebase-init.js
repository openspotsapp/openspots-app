// ============================
// Firebase Initialization (GLOBAL)
// ============================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
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
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  console.log("Firebase already initialized.");
}

export const auth = getAuth();
export const db = getFirestore();
