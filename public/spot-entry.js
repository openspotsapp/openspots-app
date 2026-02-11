import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const zoneNumber = params.get("spot");

if (!zoneNumber) {
  document.getElementById("status-text").innerText =
    "Invalid parking spot. Please scan the QR code again.";
  throw new Error("Missing spot ID");
}

async function resolveZone() {
  const q = query(
    collection(db, "private_metered_parking"),
    where("zone_number", "==", zoneNumber),
    where("active", "==", true)
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    document.getElementById("status-text").innerText =
      "Invalid or inactive parking spot. Please scan the QR code again.";
    throw new Error("Zone not found");
  }

  if (!snap.docs[0]) {
    throw new Error("Zone not found");
  }
}

// OPTIONAL: add venue later
// sessionStorage.setItem("venueId", "river-oaks");

function withSpotParam(path) {
  return `${path}?spot=${encodeURIComponent(zoneNumber)}`;
}

setTimeout(() => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = withSpotParam("./signup.html");
      return;
    }

    await resolveZone();

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : {};

      if (data.setupComplete !== true) {
        window.location.href = withSpotParam("./accSetup.html");
        return;
      }

      if (data.hasPaymentMethod === true) {
        window.location.href = withSpotParam("./confirm-spot.html");
        return;
      }
    } catch (err) {
      console.error("Failed to check user status:", err);
    }

    window.location.href = withSpotParam("./add-payment.html");
  });
}, 1200);
