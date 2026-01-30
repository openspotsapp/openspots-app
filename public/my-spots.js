import { db, auth } from "./firebase-init.js";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const spotsListEl = document.getElementById("spotsList");
const authErrorEl = document.getElementById("authError");
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");
const activePanelEl = document.getElementById("tab-active");
const pastPanelEl = document.getElementById("tab-past");

const venueCache = new Map();
let activeSessionTimerId = null;

function activateTab(tabName) {
  if (!tabs.length || !panels.length) return;

  const supportedTabs = new Set(Array.from(tabs).map((tab) => tab.dataset.tab));
  const safeTab = supportedTabs.has(tabName) ? tabName : "active";

  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === safeTab);
  });

  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${safeTab}`);
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const tabName = tab.dataset.tab;
    activateTab(tabName);
    history.replaceState(null, "", `?tab=${tabName}`);
  });
});

const params = new URLSearchParams(window.location.search);
activateTab(params.get("tab") || "active");

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

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "--:--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return "Total TBD";
  return `$${value.toFixed(2)}`;
}

function formatRatePerMinute(session) {
  const perMinute =
    session.rate_per_minute ??
    session.rate_per_min ??
    session.price_per_minute ??
    null;
  if (Number.isFinite(perMinute)) {
    return `$${perMinute.toFixed(2)}/min`;
  }

  const perHour =
    session.rate_per_hour ??
    session.rate ??
    session.price_per_hour ??
    null;
  if (Number.isFinite(perHour)) {
    return `$${(perHour / 60).toFixed(2)}/min`;
  }

  return "Rate TBD";
}

function resolveParkingTotal(session, startedAt, endedAt) {
  const directTotal =
    session.total ??
    session.total_amount ??
    session.amount_total ??
    session.total_cost ??
    session.price_paid ??
    session.price ??
    null;

  if (Number.isFinite(directTotal)) {
    return formatCurrency(directTotal);
  }

  if (!startedAt || !endedAt) return "Total TBD";

  const durationMinutes = Math.max(
    0,
    (endedAt.getTime() - startedAt.getTime()) / 60000
  );

  const perMinute =
    session.rate_per_minute ??
    session.rate_per_min ??
    session.price_per_minute ??
    null;

  if (Number.isFinite(perMinute)) {
    return formatCurrency(perMinute * durationMinutes);
  }

  const perHour =
    session.rate_per_hour ??
    session.rate ??
    session.price_per_hour ??
    null;

  if (Number.isFinite(perHour)) {
    return formatCurrency((perHour / 60) * durationMinutes);
  }

  return "Total TBD";
}

function resolveReservationTotal(reservation) {
  const total =
    reservation.price_paid ??
    reservation.price ??
    reservation.amount_total ??
    null;
  return Number.isFinite(total) ? formatCurrency(total) : "Total TBD";
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

async function getLocationName(zoneRef) {
  if (!zoneRef) return "Metered Parking";
  try {
    const snap = await getDoc(zoneRef);
    if (!snap.exists()) return "Metered Parking";
    return snap.data().location_name || "Metered Parking";
  } catch {
    return "Metered Parking";
  }
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

function renderActiveSession(session) {
  if (!activePanelEl) return;

  if (!session) {
    activePanelEl.innerHTML = `<p>No active parking session</p>`;
    if (activeSessionTimerId) {
      clearInterval(activeSessionTimerId);
      activeSessionTimerId = null;
    }
    return;
  }

  const startedAt = normalizeDate(session.started_at);
  const startedAtFallback = normalizeDate(
    session.startedAt || session.arrival_time || session.start_time
  );
  const startedAtSafe = startedAt || startedAtFallback;
  const ratePerMinute = formatRatePerMinute(session);
  const statusText = (session.status || "ACTIVE").toString().toUpperCase();
  const spotLabel = session.sensor_id || "—";
  const locationName = session.location_name || "Metered Parking";

  activePanelEl.innerHTML = `
    <div class="spot-card spot-card-parking active" data-spot="${spotLabel}">
      <div>
        <div class="spot-meta">
          <strong>${locationName}</strong>
          <div>Rate: ${ratePerMinute}</div>
          <div>Started: ${formatDateTime(startedAtSafe)}</div>
          <div>Timer: <span id="activeSessionTimer">--:--:--</span></div>
        </div>
      </div>
      <div class="status-text">${statusText}</div>
    </div>
  `;

  const timerEl = document.getElementById("activeSessionTimer");
  if (activeSessionTimerId) clearInterval(activeSessionTimerId);

  if (timerEl && startedAtSafe) {
    const updateTimer = () => {
      const elapsed = Date.now() - startedAtSafe.getTime();
      timerEl.textContent = formatDuration(elapsed);
    };
    updateTimer();
    activeSessionTimerId = setInterval(updateTimer, 1000);
  }
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
    card.className = `spot-card spot-card-active ${isActive ? "active" : "past"}`;
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

function renderPastParkingSessionCard(session) {
  const card = document.createElement("div");
  card.className = "spot-card spot-card-parking-past";
  card.setAttribute("data-spot", session.spot_label || "—");

  const left = document.createElement("div");
  const metaEl = document.createElement("div");
  metaEl.className = "spot-meta";
  metaEl.innerHTML = `
    <strong>${session.location_name || "Metered Parking"}</strong>
    <div>Rate: ${formatRatePerMinute(session)}</div>
    <div>Started: ${formatDateTime(session.started_at)}</div>
    <div>Total: ${session.total_display || "Total TBD"}</div>
  `;
  left.appendChild(metaEl);

  const statusEl = document.createElement("div");
  statusEl.className = "status-text";
  statusEl.textContent = (session.status || "DONE").toString().toUpperCase();

  card.appendChild(left);
  card.appendChild(statusEl);

  return card;
}

function renderPastReservationCard(reservation) {
  const card = document.createElement("div");
  card.className = "spot-card spot-card-reservation-past";
  card.setAttribute("data-spot", reservation.spot_label || "—");

  const left = document.createElement("div");

  const spotIdEl = document.createElement("div");
  spotIdEl.className = "spot-id";
  spotIdEl.textContent = reservation.spot_label || "—";

  const metaEl = document.createElement("div");
  metaEl.className = "spot-meta";
  metaEl.innerHTML = `
    <strong>${reservation.venue_name || "Venue"}</strong>
    <div>${reservation.event_name || ""}</div>
    <div>${formatDateTime(reservation.start_time)}</div>
    <div>Total: ${reservation.total_display || "Total TBD"}</div>
  `;

  left.appendChild(spotIdEl);
  left.appendChild(metaEl);

  const statusEl = document.createElement("div");
  statusEl.className = "status-text";
  statusEl.textContent = (reservation.status || "DONE").toString().toUpperCase();

  card.appendChild(left);
  card.appendChild(statusEl);

  return card;
}

function renderPastContent(pastItems) {
  if (!pastPanelEl) return;
  pastPanelEl.innerHTML = "";

  if (!pastItems.length) {
    pastPanelEl.innerHTML = `<p>No past parking sessions</p>`;
    return;
  }

  const listEl = document.createElement("div");
  listEl.className = "spots-list";
  pastItems.forEach((item) => {
    listEl.appendChild(item);
  });

  pastPanelEl.appendChild(listEl);
}

async function loadReservations(user) {
  const userRef = doc(db, "users", user.uid);
  const reservationsQuery = query(
    collection(db, "reservations"),
    where("user_id", "==", userRef)
  );

  const snapshot = await getDocs(reservationsQuery);

  const pastStatuses = new Set(["COMPLETED", "EXPIRED", "CANCELLED"]);
  const reservations = [];
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const rawStatus = (data.status || "").toString().toUpperCase();
    if (pastStatuses.has(rawStatus)) {
      continue;
    }

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

async function loadActiveSession(user) {
  const userRef = doc(db, "users", user.uid);
  const sessionsQuery = query(
    collection(db, "parking_sessions"),
    where("user_id", "==", userRef),
    where("status", "==", "ACTIVE"),
    limit(1)
  );

  const snapshot = await getDocs(sessionsQuery);

  if (snapshot.empty) {
    renderActiveSession(null);
    return;
  }

  const docSnap = snapshot.docs[0];
  const data = docSnap.data();

  const venueName = data.venue_name
    ? data.venue_name
    : data.venue_id
    ? await getVenueName(data.venue_id)
    : data.venue_ref
    ? await getVenueName(data.venue_ref)
    : "Venue";

  const locationName = data.location_name
    ? data.location_name
    : data.zone_id
    ? await getLocationName(data.zone_id)
    : "Metered Parking";

  const spotLabel =
    data.spot_label ||
    data.spot_number ||
    (data.spot_ref ? await getSpotLabel(data.spot_ref) : "SPOT");

  renderActiveSession({
    id: docSnap.id,
    ...data,
    location_name: locationName,
    venue_name: venueName,
    spot_label: spotLabel,
  });
}

async function loadPastItems(user) {
  if (!pastPanelEl) return;
  const userRef = doc(db, "users", user.uid);
  const pastStatuses = ["COMPLETED", "EXPIRED", "CANCELLED"];

  const parkingQuery = query(
    collection(db, "parking_sessions"),
    where("user_id", "==", userRef),
    where("status", "in", pastStatuses)
  );

  const reservationQuery = query(
    collection(db, "reservations"),
    where("user_id", "==", userRef),
    where("status", "in", pastStatuses)
  );

  const [parkingSnap, reservationSnap] = await Promise.all([
    getDocs(parkingQuery),
    getDocs(reservationQuery),
  ]);

  const pastCards = [];

  for (const docSnap of parkingSnap.docs) {
    const data = docSnap.data();
    const startedAt = normalizeDate(
      data.started_at || data.startedAt || data.arrival_time || data.start_time
    );
    const endedAt = normalizeDate(
      data.departure_time || data.ended_at || data.end_time || data.completed_at
    );
    const locationName = data.location_name
      ? data.location_name
      : data.zone_id
      ? await getLocationName(data.zone_id)
      : "Metered Parking";

    const spotLabel = data.sensor_id || "—";

    pastCards.push(
      renderPastParkingSessionCard({
        id: docSnap.id,
        ...data,
        location_name: locationName,
        spot_label: spotLabel,
        started_at: startedAt,
        total_display: resolveParkingTotal(data, startedAt, endedAt),
      })
    );
  }

  for (const docSnap of reservationSnap.docs) {
    const data = docSnap.data();
    const venueName = data.venue_name
      ? data.venue_name
      : data.venue_id
      ? await getVenueName(data.venue_id)
      : "Venue";

    pastCards.push(
      renderPastReservationCard({
        id: docSnap.id,
        ...data,
        venue_name: venueName,
        spot_label: data.spot_label || data.spot_number || "—",
        total_display: resolveReservationTotal(data),
      })
    );
  }

  renderPastContent(pastCards);
}

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    showAuthError();
    return;
  }

  hideAuthError();
  try {
    await loadActiveSession(user);
    await loadReservations(user);
    await loadPastItems(user);
  } catch (err) {
    console.error("Error loading reservations:", err);
  }
});
