import { auth, db } from "./firebase-init.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const spotFromUrl = params.get("spot");

if (spotFromUrl) {
  sessionStorage.setItem("pending_spot_id", spotFromUrl);
}

let spotId =
  spotFromUrl ||
  sessionStorage.getItem("pending_spot_id") ||
  sessionStorage.getItem("pending_zone_number");
const pendingParkingDocId = sessionStorage.getItem("pending_parking_doc_id");

const spotLabelEl = document.getElementById("spotLabel");
const venueLabelEl = document.getElementById("venueLabel");
const confirmBtn = document.getElementById("confirmBtn");
const loadingEl = document.getElementById("loading");

if (spotLabelEl && spotId) {
  spotLabelEl.innerText = `You are parking in Spot ${spotId}`;
}

async function loadSpotMeta() {
  if (!pendingParkingDocId) return;

  try {
    const snap = await getDoc(
      doc(db, "private_metered_parking", pendingParkingDocId)
    );
    if (!snap.exists()) return;

    const data = snap.data();

    if (!spotId && data.zone_number) {
      spotId = data.zone_number;
      sessionStorage.setItem("pending_spot_id", spotId);
    }

    if (venueLabelEl) {
      venueLabelEl.innerText =
        data.location_name ||
        data.venue_name ||
        data.venue ||
        venueLabelEl.innerText;
    }

    if (spotLabelEl && spotId) {
      spotLabelEl.innerText = `You are parking in Spot ${spotId}`;
    }
  } catch (err) {
    console.error("Failed to load spot metadata:", err);
  }
}

async function enforcePaymentMethod(user) {
  if (!user) {
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

async function startParkingSession(user, spotId) {
  return await addDoc(collection(db, "parking_sessions"), {
    user_id: user.uid,
    spot_id: spotId,
    status: "ACTIVE",
    started_at: serverTimestamp(),
    source: "qr"
  });
}

function showLoading(isLoading) {
  if (!confirmBtn || !loadingEl) return;
  confirmBtn.disabled = isLoading;
  loadingEl.classList.toggle("hidden", !isLoading);
}

if (!confirmBtn) {
  throw new Error("Confirm button not found");
}

const currentUser = auth.currentUser;

(async () => {
  await loadSpotMeta();

  if (!spotId) {
    if (loadingEl) {
      loadingEl.classList.remove("hidden");
      loadingEl.textContent = "Missing spot ID. Please rescan the QR code.";
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
    }
    return;
  }

  if (!currentUser) {
    if (loadingEl) {
      loadingEl.classList.remove("hidden");
      loadingEl.textContent = "Sign-in required.";
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
    }
    return;
  }

  const canProceed = await enforcePaymentMethod(currentUser);
  if (!canProceed) return;

  confirmBtn.addEventListener("click", async () => {
    showLoading(true);

    try {
      const docRef = await startParkingSession(currentUser, spotId);
      console.log("Parking session created:", docRef.id);
      window.location.href = "./my-spots.html?tab=active";
    } catch (err) {
      console.error("Parking session failed:", err);
      showLoading(false);
      alert("Could not start parking session.");
    }
  });
})();
