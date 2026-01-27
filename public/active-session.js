import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const spotEl = document.getElementById("spotId");
const startEl = document.getElementById("startTime");
const elapsedEl = document.getElementById("elapsedTime");

let startTimestamp = null;

async function findActiveSession(userId) {
  const byUserId = query(
    collection(db, "parking_sessions"),
    where("userId", "==", userId),
    where("status", "==", "active")
  );

  const byLegacyUserId = query(
    collection(db, "parking_sessions"),
    where("user_id", "==", userId),
    where("status", "==", "active")
  );

  const snap = await getDocs(byUserId);
  if (!snap.empty) return snap.docs[0].data();

  const legacySnap = await getDocs(byLegacyUserId);
  if (!legacySnap.empty) return legacySnap.docs[0].data();

  return null;
}

function updateElapsed() {
  if (!startTimestamp) return;

  const diffMs = Date.now() - startTimestamp.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);

  elapsedEl.textContent = `${minutes}m ${seconds}s`;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  const session = await findActiveSession(user.uid);

  if (!session) {
    window.location.href = "./nearby.html";
    return;
  }

  const spotId = session.spotId || session.spot_id;
  const startedAt = session.startedAt || session.arrival_time;

  spotEl.textContent = spotId || "—";

  if (startedAt?.toDate) {
    startTimestamp = startedAt.toDate();
    startEl.textContent = startTimestamp.toLocaleTimeString();
  } else {
    startEl.textContent = "—";
  }

  updateElapsed();
  setInterval(updateElapsed, 1000);
});
