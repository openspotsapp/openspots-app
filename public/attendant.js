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
  const selectedVenueId = venueSelect.value;
  if (!selectedVenueId) return;

  const venueRef = doc(db, "venues", selectedVenueId);

  const q = query(
    collection(db, "reservations"),
    where("venue_id", "==", venueRef)
  );

  unsubscribeReservations = onSnapshot(q, renderReservations);
});

async function renderReservations(snapshot) {
  reservationsList.innerHTML = "";

  console.log("Reservations found:", snapshot.size);

  if (snapshot.empty) {
    reservationsList.innerHTML = `<p class="empty">No active reservations</p>`;
    return;
  }

  for (const docSnap of snapshot.docs) {
    const r = docSnap.data();
    if (!r.start_time) continue;

    // derive end time safely if missing
    const endTime =
      r.end_time ??
      new Date(r.start_time.toDate().getTime() + 60 * 60 * 1000); // +1 hour fallback

    let spotDoc = null;

    const spotRef =
      r.spot_id ||        // NEW schema
      r.spot_ref ||       // OLD data
      null;

    if (spotRef) {
      const snap = await getDoc(spotRef);
      if (snap.exists()) spotDoc = snap;
    }
    const location = spotDoc?.data()?.location;

    const locationLink = location
      ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
      : null;

    const status = deriveStatus(r, endTime);

    const card = document.createElement("div");
    card.className = `reservation-card ${status}`;

    card.innerHTML = `
      <div class="info">
        <h3>Spot ${r.spot_label ?? spotDoc?.data()?.spot_id ?? "Unknown"}</h3>
        <p>${formatTime(r.start_time)} – ${formatTime(endTime)}</p>
        ${locationLink ? `<a href="${locationLink}" target="_blank">📍 View Spot</a>` : ""}
      </div>
      <div class="status">
        <span class="badge ${status}">${status.toUpperCase()}</span>
      </div>
    `;

    reservationsList.appendChild(card);
  }
}

function deriveStatus(reservation, endTimeOverride) {
  const now = new Date();

  const start = reservation.start_time.toDate
    ? reservation.start_time.toDate()
    : new Date(reservation.start_time);
  const endSource = endTimeOverride ?? reservation.end_time;
  const end = endSource?.toDate ? endSource.toDate() : new Date(endSource);

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
