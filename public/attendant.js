import { auth, db } from "./firebase-init.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

const venueSelect = document.getElementById("venueSelect");
const reservationsList = document.getElementById("reservationsList");

let unsubscribeReservations = null;
let currentMode = "gate";
document.body.classList.add("gate-mode");

function loadMap(mapContainer) {
  if (!mapContainer || mapContainer.dataset.loaded) return;

  const lat = mapContainer.dataset.lat;
  const lng = mapContainer.dataset.lng;
  if (!lat || !lng) return;

  const iframe = document.createElement("iframe");
  iframe.src = `https://www.google.com/maps?q=${lat},${lng}&z=20&t=k&output=embed`;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "no-referrer-when-downgrade";

  mapContainer.appendChild(iframe);
  mapContainer.dataset.loaded = "true";
}

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

    const spotLabel = r.spot_label ?? spotDoc?.data()?.spot_id ?? "Unknown";
    const venueName = r.venue_name ?? "Venue";
    const eventName = r.event_name ?? "Reservation";
    const timeRange = `${formatTime(r.start_time)} – ${formatTime(endTime)}`;
    const statusClass = status;
    const lat = location?.latitude ?? null;
    const lng = location?.longitude ?? null;

    card.innerHTML = `
      <div class="card-top">
        <div class="card-left">
          <div class="spot-label">${spotLabel}</div>
          <div class="venue-name">${venueName}</div>
          <div class="event-name">${eventName}</div>
          <div class="time-range">${timeRange}</div>
        </div>

        <div class="card-right">
          <span class="status-pill ${statusClass}">
            ${status.toUpperCase()}
          </span>
        </div>
      </div>

      <div class="card-bottom">

        ${
          status === "confirmed"
            ? `
        <button class="checkin-toggle">Check-in</button>

        <div class="checkin-panel hidden">
          <button class="scan-btn" disabled>Scan QR (coming soon)</button>

          <input
            type="text"
            placeholder="Enter check-in code"
            data-res-id="${docSnap.id}"
          />

          <button class="confirm-btn" data-res-id="${docSnap.id}">
            Confirm Check-in
          </button>
        </div>
        `
            : ""
        }

        ${
          lat && lng
            ? `
        <div class="spot-location-label">
          📍 Spot Location
        </div>

        <div
          class="inline-map"
          data-lat="${lat}"
          data-lng="${lng}">
        </div>
        `
            : ""
        }
      </div>
    `;

    const mapContainer = card.querySelector(".inline-map");

    if (currentMode === "lot") {
      mapContainer?.classList.remove("hidden");
      loadMap(mapContainer);
    } else {
      mapContainer?.classList.add("hidden");
    }

    reservationsList.appendChild(card);
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;

  document.querySelectorAll(".mode-btn").forEach(b =>
    b.classList.remove("active")
  );

  btn.classList.add("active");

  currentMode = btn.dataset.mode;

  document.body.classList.remove("gate-mode", "lot-mode");
  document.body.classList.add(`${currentMode}-mode`);

  document.querySelectorAll(".inline-map").forEach(map => {
    if (currentMode === "lot") {
      map.classList.remove("hidden");
      loadMap(map);
    } else {
      map.classList.add("hidden");
    }
  });
});

document.addEventListener("click", (e) => {
  const toggle = e.target.closest(".checkin-toggle");
  if (!toggle) return;

  const panel = toggle.nextElementSibling;
  if (!panel) return;

  panel.classList.toggle("hidden");
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".confirm-btn");
  if (!btn) return;

  const resId = btn.dataset.resId;
  if (!resId) return;

  try {
    await updateDoc(doc(db, "reservations", resId), {
      arrival_time: serverTimestamp(),
      status: "arrived"
    });
  } catch (err) {
    console.error("Check-in failed:", err);
    alert("Failed to check in. Try again.");
  }
});

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
