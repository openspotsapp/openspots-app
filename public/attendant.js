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

function renderReservations(snapshot) {
  reservationsList.innerHTML = "";

  if (snapshot.empty) {
    reservationsList.innerHTML = `<p class="empty">No active reservations</p>`;
    return;
  }

  snapshot.forEach((docSnap) => {
    const r = docSnap.data();
    if (!r.start_time || !r.end_time) return;

    const start = r.start_time.toDate ? r.start_time.toDate() : new Date(r.start_time);
    const end   = r.end_time.toDate   ? r.end_time.toDate()   : new Date(r.end_time);

    const status = deriveStatus(start, end);

    const card = document.createElement("div");
    card.className = `reservation-card ${status}`;

    card.innerHTML = `
      <div class="info">
        <h3>Spot ${r.spot_number}</h3>
        <p>${formatTime(r.start_time)} – ${formatTime(r.end_time)}</p>
      </div>
      <div class="status">
        <span class="badge ${status}">${status.toUpperCase()}</span>
      </div>
    `;

    reservationsList.appendChild(card);
  });
}

function deriveStatus(start, end) {
  const now = new Date();
  if (now < start) return "confirmed";
  if (now >= start && now <= end) return "arrived";
  return "expired";
}

function formatTime(ts) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString();
}
