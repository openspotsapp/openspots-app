import {
  db,
  auth
} from "./firebase-init.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

/* ---------- Get venueId from URL ---------- */
const urlParams = new URLSearchParams(window.location.search);
const venueId = urlParams.get("venue");

if (!venueId) {
  alert("Invalid venue.");
  throw new Error("Missing venueId");
}

/* ---------- DOM Elements ---------- */
const venueNameEl = document.getElementById("venueName");
const venueImageEl = document.getElementById("venueImage");
const eventSelect = document.getElementById("eventSelect");
const spotTypeSelect = document.getElementById("spotTypeSelect");
const selectedSpotText = document.getElementById("selectedSpotText");
const continueBtn = document.getElementById("continueBtn");
const dateSection = document.getElementById("dateSection");
const calendarContainer = document.getElementById("calendarContainer");
const startDateInput = document.getElementById("startDate");
const endDateInput = document.getElementById("endDate");
const selectedDatesText = document.getElementById("selectedDatesText");

let map;
let markers = [];
let selectedSpot = null;
let selectedEventId = null;
let selectedMarker = null;
let isPrivateVenue = false;
let selectedStart = null;
let selectedEnd = null;
const MAX_DAYS = 7;
let currentCalendarMonth = null;
let currentCalendarYear = null;
let activeReservations = [];
let MAX_BOOKING_DAYS_AHEAD = 90; // fallback default

async function enforcePaymentMethod(user) {
  if (!user) return true;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    if (data.hasPaymentMethod === true) {
      return true;
    }
  } catch (err) {
    console.error("Failed to check payment status:", err);
  }

  window.location.href = "add-payment.html?flow=reservation";
  return false;
}

/* ---------- Map-only init ---------- */
function initVenueMap(lat, lng) {
  map = new google.maps.Map(
    document.getElementById("venue-det-map"),
    {
      center: { lat, lng },
      zoom: 18,
      mapTypeId: "satellite",
      tilt: 0,
      heading: 0,
      mapTypeControl: true,
      mapId: "8d193001f940fde3",
    }
  );

}

function normalizeDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const today = normalizeDate(new Date());
const MIN_MONTH = today.getMonth();
const MIN_YEAR = today.getFullYear();

function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isPastDate(date) {
  return date < today;
}

function isDateDisabled(date, reservations) {
  return reservations.some(r => {
    const start =
      typeof r.start_time?.toDate === "function"
        ? r.start_time.toDate()
        : new Date(r.start_time);
    const end =
      typeof r.end_time?.toDate === "function"
        ? r.end_time.toDate()
        : new Date(r.end_time ?? r.start_time);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;

    return date >= start &&
           date <= end &&
           r.status === "CONFIRMED";
  });
}

function validateRange(start, end) {
  const diff =
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1;
  return diff >= 1 && diff <= MAX_DAYS;
}

function updateSelectedDatesText(messageOverride) {
  if (!selectedDatesText) return;

  if (messageOverride) {
    selectedDatesText.textContent = messageOverride;
    return;
  }

  if (!selectedStart) {
    selectedDatesText.textContent = "No dates selected";
    return;
  }

  if (selectedStart && !selectedEnd) {
    selectedDatesText.textContent =
      `Selected start: ${formatDate(selectedStart)}`;
    return;
  }

  selectedDatesText.textContent =
    `${formatDate(selectedStart)} → ${formatDate(selectedEnd)}`;
}

function updateDateInputs() {
  if (startDateInput) {
    startDateInput.value = selectedStart ? formatDate(selectedStart) : "";
  }
  if (endDateInput) {
    endDateInput.value = selectedEnd ? formatDate(selectedEnd) : "";
  }
}

function updateContinueButton() {
  if (!continueBtn) return;

  if (!isPrivateVenue) {
    continueBtn.disabled = !selectedSpot;
    return;
  }

  if (!selectedSpot || !selectedStart || !selectedEnd) {
    continueBtn.disabled = true;
    return;
  }

  continueBtn.disabled = !validateRange(selectedStart, selectedEnd);
}

function resetDateSelection(message) {
  selectedStart = null;
  selectedEnd = null;
  updateDateInputs();
  updateSelectedDatesText(message);
}

function rangeHasDisabledDates(start, end, reservations) {
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    if (isDateDisabled(cursor, reservations)) return true;
    cursor.setDate(cursor.getDate() + 1);
  }
  return false;
}

function renderCalendar(reservations) {
  if (!calendarContainer) return;

  const today = new Date();
  if (currentCalendarMonth === null) currentCalendarMonth = today.getMonth();
  if (currentCalendarYear === null) currentCalendarYear = today.getFullYear();

  const daysGrid = document.getElementById("calendarDays");
  if (!daysGrid) return;
  daysGrid.innerHTML = "";

  const prevBtn = document.getElementById("prevMonth");
  const nextBtn = document.getElementById("nextMonth");
  const monthLabel = document.getElementById("calendarMonth");

  const labelDate = new Date(currentCalendarYear, currentCalendarMonth, 1);
  if (monthLabel) {
    monthLabel.textContent = labelDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    });
  }

  // Disable prev button if at minimum month
  if (prevBtn) {
    const atMinMonth =
      currentCalendarYear === MIN_YEAR &&
      currentCalendarMonth === MIN_MONTH;

    prevBtn.disabled = atMinMonth;
    prevBtn.classList.toggle("disabled", atMinMonth);
  }

  if (prevBtn) {
    prevBtn.onclick = () => {
      const newMonth = currentCalendarMonth - 1;
      const newYear =
        newMonth < 0 ? currentCalendarYear - 1 : currentCalendarYear;
      const finalMonth = newMonth < 0 ? 11 : newMonth;

      // 🚫 BLOCK past navigation
      if (
        newYear < MIN_YEAR ||
        (newYear === MIN_YEAR && finalMonth < MIN_MONTH)
      ) {
        return;
      }

      currentCalendarMonth = finalMonth;
      currentCalendarYear = newYear;
      renderCalendar(reservations);
    };
  }

  if (nextBtn) {
    nextBtn.onclick = () => {
      currentCalendarMonth += 1;
      if (currentCalendarMonth > 11) {
        currentCalendarMonth = 0;
        currentCalendarYear += 1;
      }
      renderCalendar(reservations);
    };
  }

  const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(
    currentCalendarYear,
    currentCalendarMonth + 1,
    0
  ).getDate();

  const maxAllowedDate = new Date(today);
  maxAllowedDate.setDate(maxAllowedDate.getDate() + MAX_BOOKING_DAYS_AHEAD);

  for (let i = 0; i < startWeekday; i += 1) {
    const empty = document.createElement("div");
    empty.className = "calendar-empty";
    daysGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = normalizeDate(new Date(currentCalendarYear, currentCalendarMonth, day));
    const dayBtn = document.createElement("button");
    dayBtn.type = "button";
    dayBtn.textContent = String(day);
    dayBtn.classList.add("calendar-day");

    const isPast = isPastDate(date);
    const isReserved = isDateDisabled(date, reservations);
    const isBeyondWindow = date > maxAllowedDate;
    const disabled = isPast || isReserved || isBeyondWindow;

    if (disabled) {
      dayBtn.disabled = true;
      dayBtn.classList.add("disabled");
    }

    const isSelectedStart =
      selectedStart &&
      date.getTime() === normalizeDate(selectedStart).getTime();
    const isSelectedEnd =
      selectedEnd &&
      date.getTime() === normalizeDate(selectedEnd).getTime();

    if (isSelectedStart || isSelectedEnd) {
      dayBtn.classList.add("selected");
    }

    if (selectedStart && selectedEnd && date > selectedStart && date < selectedEnd) {
      dayBtn.classList.add("in-range");
    }

    if (!disabled) {
      dayBtn.addEventListener("click", () => {
        const chosenDate = date;

        if (!selectedStart || selectedEnd) {
          selectedStart = chosenDate;
          selectedEnd = null;
          updateDateInputs();
          updateSelectedDatesText();
          renderCalendar(reservations);
          updateContinueButton();
          return;
        }

        if (chosenDate < selectedStart) {
          selectedStart = chosenDate;
          updateDateInputs();
          updateSelectedDatesText();
          renderCalendar(reservations);
          updateContinueButton();
          return;
        }

        if (!validateRange(selectedStart, chosenDate)) {
          selectedEnd = null;
          updateDateInputs();
          updateSelectedDatesText("Please select a range between 1 and 7 days.");
          renderCalendar(reservations);
          updateContinueButton();
          return;
        }

        if (rangeHasDisabledDates(selectedStart, chosenDate, reservations)) {
          selectedEnd = null;
          updateDateInputs();
          updateSelectedDatesText("Selected range includes reserved dates.");
          renderCalendar(reservations);
          updateContinueButton();
          return;
        }

        selectedEnd = chosenDate;
        updateDateInputs();
        updateSelectedDatesText();
        renderCalendar(reservations);
        updateContinueButton();
      });
    }

    daysGrid.appendChild(dayBtn);
  }
}

async function loadReservationsForSpot(spotId) {
  if (!spotId) {
    activeReservations = [];
    renderCalendar(activeReservations);
    return;
  }

  const spotRef = doc(db, "spots", spotId);
  const uniqueReservations = new Map();

  const queries = [
    query(collection(db, "reservations"), where("spot_ref", "==", spotRef)),
    query(collection(db, "reservations"), where("spot_id", "==", spotRef)),
  ];

  try {
    const snaps = await Promise.all(queries.map((q) => getDocs(q)));
    snaps.forEach((snap) => {
      snap.forEach((docSnap) => {
        uniqueReservations.set(docSnap.id, docSnap.data());
      });
    });
    activeReservations = Array.from(uniqueReservations.values());
  } catch (err) {
    console.error("Failed to load reservations", err);
    activeReservations = [];
  }

  renderCalendar(activeReservations);
}

/* ============================
    1) LOAD VENUE
============================ */
async function loadVenue() {
  const venueRef = doc(db, "venues", venueId);
  const snap = await getDoc(venueRef);

  if (!snap.exists()) {
    alert("Venue not found.");
    return;
  }

  const data = snap.data();
  if (data.max_booking_days) {
    MAX_BOOKING_DAYS_AHEAD = data.max_booking_days;
  }

  venueNameEl.textContent = data.name;
  venueImageEl.src = data.image_url || "placeholder.jpg";
  const venueType = data.venue_type;
  const isEventVenue = venueType === "EVENT";
  isPrivateVenue = venueType === "PRIVATE";

  document.getElementById("eventSection").style.display =
    isEventVenue ? "block" : "none";

  document.getElementById("sizeSection").style.display =
    isPrivateVenue ? "block" : "none";

  if (venueType === "PRIVATE") {
    const heroImg = document.getElementById("venueImage");
    if (heroImg) heroImg.style.display = "none";
  }

  if (dateSection) {
    dateSection.style.display = isPrivateVenue ? "block" : "none";
  }

  eventSelect.style.display = isEventVenue ? "block" : "none";
  continueBtn.innerText = isEventVenue
    ? "View Events & Reserve"
    : "Reserve Parking & Continue";

  // INIT MAP IMMEDIATELY (NO EVENT NEEDED)
  if (data.location) {
    initVenueMap(
      data.location.latitude,
      data.location.longitude
    );
  }

  if (!isPrivateVenue) {
    loadEvents();
  } else {
    renderCalendar(activeReservations);
  }
}

loadVenue();

function clearSelectedMarker() {
  if (!selectedMarker) return;

  const fallbackIcon = {
    url: "assets/Facebook Profile Picture.png",
    scaledSize: new google.maps.Size(20, 20),
  };

  selectedMarker.setIcon(selectedMarker.defaultIcon || fallbackIcon);

  selectedMarker = null;
}

/* ============================
    2) LOAD EVENTS FOR VENUE
============================ */
function formatEventDate(rawDate) {
  if (!rawDate) return "Date TBD";

  // Firestore Timestamp
  if (rawDate.seconds) {
    return new Date(rawDate.seconds * 1000).toLocaleString();
  }

  // ISO / string date
  const parsed = new Date(rawDate);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleString();
  }

  return "Date TBD";
}

async function loadEvents() {
  const q = query(
    collection(db, "events"),
    where("venue_ref", "==", doc(db, "venues", venueId)),
    where("is_active", "==", true)
  );

  const snap = await getDocs(q);

  eventSelect.innerHTML = `<option value="">Choose an event...</option>`;

  const events = [];

  snap.forEach((docSnap) => {
    const e = docSnap.data();

    let eventDate = null;

    // Normalize ONLY for sorting (not storage)
    if (e.event_date?.seconds) {
      eventDate = new Date(e.event_date.seconds * 1000);
    } else {
      const parsed = new Date(e.event_date);
      if (!isNaN(parsed.getTime())) {
        eventDate = parsed;
      }
    }

    // Skip invalid dates
    if (!eventDate) return;

    // Skip past events
    const now = new Date();
    if (eventDate < now) return;

    events.push({
      id: docSnap.id,
      name: e.event_name,
      date: eventDate,
      rawDate: e.event_date,
     });
  });

  // SORT: soonest → latest
  events.sort((a, b) => a.date - b.date);

  // Render dropdown
  events.forEach((e) => {
    const option = document.createElement("option");
    option.value = e.id;
    option.textContent =
  `${e.name} — ${e.date.toLocaleString([], {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
    eventSelect.appendChild(option);
  });
}

/* ============================
    3) WHEN EVENT SELECTED → LOAD SPOTS
============================ */
eventSelect.addEventListener("change", async () => {
  selectedEventId = eventSelect.value;
  selectedSpot = null;
  selectedSpotText.textContent = "No spot selected";
  updateContinueButton();
  if (isPrivateVenue) {
    resetDateSelection();
  }

  if (!selectedEventId) return;

  loadSpots(selectedEventId);
});

spotTypeSelect.addEventListener("change", async () => {
  const selectedType = spotTypeSelect.value;

  // Reset UI
  selectedSpot = null;
  selectedSpotText.textContent = "No spot selected";
  updateContinueButton();
  if (isPrivateVenue) {
    resetDateSelection();
  }

  // Clear existing markers
  markers.forEach(m => m.setMap(null));
  markers = [];

  if (!selectedType) return; // user chose "Select type..."

  loadSpotsByType(selectedType);
});

/* ============================
    4) LOAD SPOTS & PLOT ON MAP
============================ */
async function loadSpots(eventId) {
  const q = query(
    collection(db, "spots"),
    where("event_ref", "==", doc(db, "events", eventId)),
    where("venue_ref", "==", doc(db, "venues", venueId)),
    where("is_active", "==", true)
  );

  const snap = await getDocs(q);

  const spots = [];
  snap.forEach((doc) => spots.push({ id: doc.id, ...doc.data() }));

  renderSpotMarkers(spots);
}

async function loadSpotsByVenue() {
  const q = query(
    collection(db, "spots"),
    where("venue_ref", "==", doc(db, "venues", venueId)),
    where("is_active", "==", true)
  );

  const snap = await getDocs(q);

  const spots = [];
  snap.forEach((doc) => spots.push({ id: doc.id, ...doc.data() }));

  renderSpotMarkers(spots);
}

async function loadSpotsByType(spotType) {
  const q = query(
    collection(db, "spots"),
    where("venue_ref", "==", doc(db, "venues", venueId)),
    where("spot_type", "==", spotType),
    where("is_active", "==", true)
  );

  const snap = await getDocs(q);

  const spots = [];
  snap.forEach((doc) => spots.push({ id: doc.id, ...doc.data() }));

  renderSpotMarkers(spots);
}

/* ============================
    5) RENDER SPOT MARKERS
============================ */
function renderSpotMarkers(spots) {
  markers.forEach(m => m.setMap(null));
  markers = [];
  selectedMarker = null;

  spots.forEach((spot) => {
    if (!spot.location) return;

    const isAvailable = spot.is_available === true;
    const iconUrl = isAvailable
      ? "assets/Facebook Profile Picture.png"
      : "assets/RED MARKER ICON.png";

    const marker = new google.maps.Marker({
      position: {
        lat: spot.location.latitude,
        lng: spot.location.longitude,
      },
      map,
      icon: {
        url: iconUrl,
        scaledSize: new google.maps.Size(20, 20),
      },
    });

    marker.defaultIcon = {
      url: iconUrl,
      scaledSize: new google.maps.Size(20, 20),
    };

    marker.spot = spot; // attach Firestore spot

    markers.push(marker);

    if (!isAvailable) {
      return; // marker shows, but no click handler
    }

    marker.addListener("click", () => {
      clearSelectedMarker();

      marker.setIcon({
        url: marker.defaultIcon.url,
        scaledSize: new google.maps.Size(38, 38),
      });

      selectedMarker = marker;
      selectedSpot = spot;

      selectedSpotText.textContent =
        `Selected Spot: ${spot.spot_id}`;
      if (isPrivateVenue) {
        resetDateSelection();
        loadReservationsForSpot(spot.id);
      }
      updateContinueButton();
    });
  });

  // Optional: clear selection if user taps map
  map.addListener("click", () => {
    clearSelectedMarker();
    selectedSpot = null;
    selectedSpotText.textContent = "No spot selected";
    updateContinueButton();
  });

  if (spots.length > 0) {
    const bounds = new google.maps.LatLngBounds();

    spots.forEach(spot => {
      if (spot.location) {
        bounds.extend({
          lat: spot.location.latitude,
          lng: spot.location.longitude,
        });
      }
    });

    map.fitBounds(bounds);
  }
}

/* ============================
    6) CONTINUE BUTTON
============================ */
continueBtn.addEventListener("click", async () => {
  if (!selectedSpot) return;

  const user = auth.currentUser;
  const canProceed = await enforcePaymentMethod(user);
  if (!canProceed) return;

  // EVENT VENUE FLOW
  if (!isPrivateVenue) {
    if (!selectedEventId) return;

    const baseUrl = user ? "checkout.html" : "details.html";
    window.location.href =
      `${baseUrl}?event=${selectedEventId}&spot=${selectedSpot.id}&venue=${venueId}&flow=reservation`;
    return;
  }

  // PRIVATE VENUE FLOW
  const baseUrl = user ? "checkout.html" : "details.html";
  window.location.href =
    `${baseUrl}?spot=${selectedSpot.id}&venue=${venueId}&flow=reservation`;
});
