import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const ids = {
  reservation: "toggleReservationUpdates",
  email: "toggleEmailUpdates",
  sms: "toggleSmsUpdates",
  promos: "togglePromos",
};

const saveStatus = document.getElementById("saveStatus");

function setStatus(msg = "", isError = false) {
  saveStatus.textContent = msg;
  saveStatus.style.color = isError ? "#b00020" : "";
  if (msg) {
    setTimeout(() => {
      // Only clear if it hasn't changed
      if (saveStatus.textContent === msg) saveStatus.textContent = "";
    }, 1500);
  }
}

function getToggleValues() {
  return {
    reservation_updates: document.getElementById(ids.reservation).checked,
    email_updates: document.getElementById(ids.email).checked,
    sms_updates: document.getElementById(ids.sms).checked,
    promos: document.getElementById(ids.promos).checked,
  };
}

// Tiny debounce so rapid toggles don't spam writes
let saveTimer = null;
function scheduleSave(userRef) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await updateDoc(userRef, {
        notification_settings: getToggleValues(),
      });
      setStatus("Saved ✅");
    } catch (e) {
      console.error("Failed to save notifications:", e);
      setStatus("Save failed. Try again.", true);
    }
  }, 250);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const userRef = doc(db, "users", user.uid);

  try {
    const snap = await getDoc(userRef);
    const data = snap.exists() ? snap.data() : {};

    const settings = data.notification_settings || {};

    document.getElementById(ids.reservation).checked = settings.reservation_updates ?? true;
    document.getElementById(ids.email).checked = settings.email_updates ?? true;
    document.getElementById(ids.sms).checked = settings.sms_updates ?? false;
    document.getElementById(ids.promos).checked = settings.promos ?? false;

  } catch (e) {
    console.error("Failed to load notifications:", e);
    setStatus("Couldn’t load settings.", true);
  }

  // Wire listeners after load
  Object.values(ids).forEach((id) => {
    document.getElementById(id).addEventListener("change", () => scheduleSave(userRef));
  });
});
