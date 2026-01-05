import { auth, db } from "./firebase-init.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

const venueSelect = document.getElementById("venueSelect");
const reservationsList = document.getElementById("reservationsList");

let unsubscribeReservations = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/login.html";
    return;
  }

  const q = query(
    collection(db, "operators"),
    where("is_active", "==", true)
  );

  const snap = await getDocs(q);

  const operatorDoc = snap.docs.find(d => {
    const data = d.data();
    return (
      data.user_id?.id === user.uid ||   // DocumentReference
      data.user_id === user.uid           // string UID fallback
    );
  });

  if (!operatorDoc) {
    alert("You are not registered as an attendant yet.");
    window.location.href = "/nearby.html";
    return;
  }

  const operatorData = operatorDoc.data();
  loadVenues(operatorData.assigned_venues || []);
});

async function loadVenues(venueRefs) {
  venueSelect.innerHTML = `<option value="">Select Venue</option>`;

  for (const ref of venueRefs) {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const opt = document.createElement("option");
      opt.value = snap.id;
      opt.textContent = snap.data().name;
      venueSelect.appendChild(opt);
    }
  }
}

venueSelect.addEventListener("change", () => {
  if (unsubscribeReservations) unsubscribeReservations();
  const venueId = venueSelect.value;
  if (!venueId) return;

  const q = query(
    collection(db, "reservations"),
    where("venue_id", "==", doc(db, "venues", venueId))
  );

  unsubscribeReservations = onSnapshot(q, renderReservations);
});

async function renderReservations(snapshot) {
  reservationsList.innerHTML = "";

  if (snapshot.empty) {
    reservationsList.innerHTML = `<p class="empty">No active reservations</p>`;
    return;
  }

  for (const docSnap of snapshot.docs) {
    const r = docSnap.data();
    if (!r.start_time || !r.end_time) continue;

    const spotSnap = await getDocs(
      query(
        collection(db, "spots"),
        where("spot_id", "==", r.spot_number),
        where("venue_ref", "==", r.venue_id)
      )
    );

    const spotDoc = spotSnap.docs[0];
    const locationLink = spotDoc?.exists()
      ? `https://www.google.com/maps?q=${spotDoc.data().location.latitude},${spotDoc.data().location.longitude}`
      : null;

    const status = deriveStatus(r);

    const card = document.createElement("div");
    card.className = `reservation-card ${status}`;

    card.innerHTML = `
      <div class="info">
        <h3>Spot ${r.spot_number}</h3>
        <p>${formatTime(r.start_time)} – ${formatTime(r.end_time)}</p>
        ${locationLink ? `<a href="${locationLink}" target="_blank">📍 View Spot</a>` : ""}
      </div>
      <div class="status">
        <span class="badge ${status}">${status.toUpperCase()}</span>
      </div>
    `;

    reservationsList.appendChild(card);
  }
}

function deriveStatus(reservation) {
  const now = new Date();

  const start = reservation.start_time.toDate();
  const end = reservation.end_time.toDate();

  // DB-backed status wins
  if (reservation.status === "invalid") return "invalid";
  if (now < start && reservation.status === "arrived") {
    return "invalid";
  }
  if (reservation.status === "arrived") return "arrived";
  if (reservation.status === "confirmed") {
    if (now > end) return "expired";
    return "confirmed";
  }

  // Fallback safety
  if (now > end) return "expired";

  return "confirmed";
}

function formatTime(ts) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString();
}

document.addEventListener("DOMContentLoaded", () => {
  const exitBtn = document.getElementById("exitAttendant");

  exitBtn?.addEventListener("click", () => {
    window.location.href = "nearby.html";
  });
});
