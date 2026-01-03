import { db, auth } from "./firebase-init.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const spotsListEl = document.getElementById("spotsList");
const authErrorEl = document.getElementById("authError");

const venueCache = new Map();

function showAuthError() {
  authErrorEl?.classList.remove("hidden");
}

function hideAuthError() {
  authErrorEl?.classList.add("hidden");
}

function normalizeDate(rawDate) {
  if (!rawDate) return null;
  if (rawDate.seconds) {
    return new Date(rawDate.seconds * 1000);
  }
  const parsed = new Date(rawDate);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(rawDate) {
  const date = normalizeDate(rawDate);
  if (!date) return "Date & time TBD";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function getVenueName(venueRefOrId) {
  if (!venueRefOrId) return "Venue";
  let venueRef;

  if (typeof venueRefOrId === "string") {
    venueRef = doc(db, "venues", venueRefOrId);
  } else {
    venueRef = venueRefOrId;
  }

  const cacheKey = venueRef.id;
  if (venueCache.has(cacheKey)) return venueCache.get(cacheKey);

  try {
    const snap = await getDoc(venueRef);
    const name = snap.exists() ? snap.data().name || "Venue" : "Venue";
    venueCache.set(cacheKey, name);
    return name;
  } catch {
    return "Venue";
  }
}

async function getSpotLabel(spotRef) {
  if (!spotRef) return "SPOT";

  const snap = await getDoc(spotRef);
  if (!snap.exists()) return "SPOT";

  return snap.data().spot_label || snap.data().label || "SPOT";
}

async function getEventName(eventRef) {
  if (!eventRef) return "";

  const snap = await getDoc(eventRef);
  if (!snap.exists()) return "";

  return snap.data().name || "";
}

function renderEmptyState() {
  if (!spotsListEl) return;
  spotsListEl.innerHTML = `<p>No reservations yet.</p>`;
}

function renderReservations(reservations) {
  if (!spotsListEl) return;

  spotsListEl.innerHTML = "";

  if (!reservations.length) {
    renderEmptyState();
    return;
  }

  reservations.forEach((reservation) => {
    const spotLabel =
      reservation.spot_label || reservation.spot_number || "SPOT";
    const venueName = reservation.venue_name || "Venue";
    const eventName = reservation.event_name || "";
    const isActive = reservation.status === "confirmed";
    const statusText = isActive ? "ACTIVE" : "DONE";

    const card = document.createElement("div");
    card.className = `spot-card ${isActive ? "active" : "past"}`;
    card.setAttribute("data-spot", spotLabel);

    const left = document.createElement("div");

    const spotIdEl = document.createElement("div");
    spotIdEl.className = "spot-id";
    spotIdEl.textContent = spotLabel;

    const metaEl = document.createElement("div");
    metaEl.className = "spot-meta";
    metaEl.innerHTML = `
      <strong>${venueName}</strong>
      <div>${eventName}</div>
      <div>${formatDateTime(reservation.start_time)}</div>
    `;

    left.appendChild(spotIdEl);
    left.appendChild(metaEl);

    const statusEl = document.createElement("div");
    statusEl.className = "status-text";
    statusEl.textContent = statusText;

    if (isActive) {
      card.addEventListener("click", () => {
        window.location.href = `my-spot-details.html?reservationId=${reservation.id}`;
      });
    }

    card.appendChild(left);
    card.appendChild(statusEl);

    spotsListEl.appendChild(card);
  });
}

async function loadReservations(user) {
  const userRef = doc(db, "users", user.uid);
  const reservationsQuery = query(
    collection(db, "reservations"),
    where("user_id", "==", userRef)
  );

  const snapshot = await getDocs(reservationsQuery);

  const reservations = [];
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();

    const venueName = data.venue_name
      ? data.venue_name
      : data.venue_id
      ? await getVenueName(data.venue_id)
      : "Venue";

    reservations.push({
      id: docSnap.id,
      ...data,

      // ✅ prefer cached fields, fallback if needed
      spot_label: data.spot_label || data.spot_number || "SPOT",
      event_name: data.event_name || "Date & time TBD",
      venue_name: venueName,
    });
  }

  reservations.sort((a, b) => {
    const aDate = normalizeDate(a.start_time);
    const bDate = normalizeDate(b.start_time);
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return bDate - aDate; // newest first
  });

  renderReservations(reservations);
}

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    showAuthError();
    return;
  }

  hideAuthError();
  try {
    await loadReservations(user);
  } catch (err) {
    console.error("Error loading reservations:", err);
  }
});
