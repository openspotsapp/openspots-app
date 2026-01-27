import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const spotId = sessionStorage.getItem("pending_spot_id");

if (!spotId) {
  window.location.href = "./nearby.html";
  throw new Error("Missing pending spot ID");
}

const spotLabelEl = document.getElementById("spotLabel");
const confirmBtn = document.getElementById("confirmBtn");
const loadingEl = document.getElementById("loading");

if (spotLabelEl) {
  spotLabelEl.innerText = `You are parking in Spot ${spotId}`;
}

async function enforcePaymentMethod(user) {
  if (!user) {
    window.location.href = "./signup.html";
    return false;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    if (data.hasPaymentMethod === true) {
      return true;
    }
  } catch (err) {
    console.error("Failed to check payment status:", err);
  }

  window.location.href = "./add-payment.html";
  return false;
}

function showLoading(isLoading) {
  if (!confirmBtn || !loadingEl) return;
  confirmBtn.disabled = isLoading;
  loadingEl.classList.toggle("hidden", !isLoading);
}

if (!confirmBtn) {
  throw new Error("Confirm button not found");
}

onAuthStateChanged(auth, async (user) => {
  const canProceed = await enforcePaymentMethod(user);
  if (!canProceed) return;

  confirmBtn.addEventListener("click", async () => {
    showLoading(true);

    try {
      const venueId = sessionStorage.getItem("venueId") || "unknown";

      await addDoc(collection(db, "parking_sessions"), {
        userId: user.uid,
        spotId: spotId,
        venueId: venueId,
        status: "active",
        startedAt: serverTimestamp(),
        source: "qr"
      });

      sessionStorage.removeItem("pending_spot_id");

      window.location.href = "./active-session.html";
    } catch (err) {
      console.error("Failed to start session:", err);
      showLoading(false);
      alert("Unable to start your parking session. Please try again.");
    }
  });
});
