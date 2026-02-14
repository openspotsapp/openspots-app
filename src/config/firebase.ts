import { initializeApp } from "firebase/app";
import { initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// @ts-ignore
import { getReactNativePersistence } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyDy3VL4_2rXT5QNwlDMQc_GBrOSx_OalFY",
  authDomain: "open-spots-yt903b.firebaseapp.com",
  projectId: "open-spots-yt903b",
  storageBucket: "open-spots-yt903b.firebasestorage.app",
  messagingSenderId: "298540480317",
  appId: "1:298540480317:web:e3fdb63b777ebb165ff754",
  measurementId: "G-4D0EYL43HL"
};


const app = initializeApp(firebaseConfig);

const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

const db = getFirestore(app);

export { app, auth, db };
