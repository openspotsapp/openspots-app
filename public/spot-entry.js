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

  const docSnap = snap.docs[0];

  // Store BOTH
  sessionStorage.setItem("pending_zone_number", zoneNumber);
  sessionStorage.setItem("pending_parking_doc_id", docSnap.id);
}

// OPTIONAL: add venue later
// sessionStorage.setItem("venueId", "river-oaks");

async function routeNext(user) {
  if (!user) {
    window.location.href = "./signup.html";
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    if (data.hasPaymentMethod === true) {
      window.location.href = "./confirm-spot.html";
      return;
    }
  } catch (err) {
    console.error("Failed to check payment status:", err);
  }

  window.location.href = "./add-payment.html";
}

setTimeout(() => {
  onAuthStateChanged(auth, async (user) => {
    await resolveZone();
    routeNext(user);
  });
}, 1200);
