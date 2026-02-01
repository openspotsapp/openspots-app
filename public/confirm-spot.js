import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
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
  try {
    // 🔁 Fallback: resolve venue via spotId
    if (!pendingParkingDocId && spotId) {
      const q = query(
        collection(db, "private_metered_parking"),
        where("zone_number", "==", spotId)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const data = snap.docs[0].data();
        if (venueLabelEl) {
          venueLabelEl.innerText =
            data.location_name || data.venue_name || "Parking Location";
        }
      }
      return;
    }

    if (!pendingParkingDocId) return;

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
        data.location_name || data.venue_name || venueLabelEl.innerText;
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

function showLoading(isLoading) {
  if (!confirmBtn || !loadingEl) return;
  confirmBtn.disabled = isLoading;
  loadingEl.classList.toggle("hidden", !isLoading);
}

if (!confirmBtn) {
  throw new Error("Confirm button not found");
}

onAuthStateChanged(auth, async (user) => {
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

  if (!user) {
    if (loadingEl) {
      loadingEl.classList.remove("hidden");
      loadingEl.textContent = "Sign-in required.";
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
    }
    return;
  }

  const canProceed = await enforcePaymentMethod(user);
  if (!canProceed) return;

  confirmBtn.addEventListener("click", async () => {
    showLoading(true);

    try {
      const q = query(
        collection(db, "private_metered_parking"),
        where("zone_number", "==", spotId)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        showLoading(false);
        alert("Parking zone not found. Please rescan the QR code.");
        return;
      }

      const zoneDoc = snap.docs[0];
      const zone = zoneDoc.data();
      const ratePerHour = Number(zone.rate_per_hour) || 0;

      const docRef = await addDoc(collection(db, "parking_sessions"), {
        user_id: doc(db, "users", user.uid),
        sensor_id: spotId,
        arrival_time: serverTimestamp(),
        created_at: serverTimestamp(),
        status: "ACTIVE",
        regulation_type: zone.regulation_type || "METERED",
        rate_per_minute: ratePerHour / 60,
        price_charged: 0,
        total_minutes: 0,
        payment_method: "MOBILE",
        after_hours_fee: 0,
        zone_id: doc(db, "private_metered_parking", zoneDoc.id)
      });

      await fetch("/api/lock-metered-spot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          zoneDocId: zoneDoc.id
        })
      });

      console.log("Parking session created:", docRef.id);
      window.location.href = "./my-spots.html?tab=active";
    } catch (err) {
      console.error("Parking session failed:", err);
      showLoading(false);
      alert("Could not start parking session.");
    }
  });
});
