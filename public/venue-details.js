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
const selectedSpotText = document.getElementById("selectedSpotText");
const continueBtn = document.getElementById("continueBtn");

let map;
let markers = [];
let selectedSpot = null;
let selectedEventId = null;
let selectedMarker = null;

/* ---------- Map-only init ---------- */
function initVenueMap(lat, lng) {
  map = new google.maps.Map(
    document.getElementById("venue-det-map"),
    {
      center: { lat, lng },
      zoom: 18,
      mapTypeId: "satellite",
      mapTypeControl: true,
      mapId: "8d193001f940fde3",
    }
  );
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
  venueNameEl.textContent = data.name;
  venueImageEl.src = data.image_url || "placeholder.jpg";

  // INIT MAP IMMEDIATELY (NO EVENT NEEDED)
  if (data.location) {
    initVenueMap(
      data.location.latitude,
      data.location.longitude
    );
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

loadEvents();

/* ============================
    3) WHEN EVENT SELECTED → LOAD SPOTS
============================ */
eventSelect.addEventListener("change", async () => {
  selectedEventId = eventSelect.value;
  selectedSpot = null;
  selectedSpotText.textContent = "No spot selected";
  continueBtn.disabled = true;

  if (!selectedEventId) return;

  loadSpots(selectedEventId);
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
      continueBtn.disabled = false;
    });
  });

  // Optional: clear selection if user taps map
  map.addListener("click", () => {
    clearSelectedMarker();
    selectedSpot = null;
    selectedSpotText.textContent = "No spot selected";
    continueBtn.disabled = true;
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
  if (!selectedSpot || !selectedEventId) return;

  const user = auth.currentUser;

  if (user) {
    // LOGGED-IN USER → SKIP DETAILS
    window.location.href =
      `checkout.html?event=${selectedEventId}&spot=${selectedSpot.id}&venue=${venueId}`;
  } else {
    // GUEST USER → GO TO DETAILS FORM
    window.location.href =
      `details.html?event=${selectedEventId}&spot=${selectedSpot.id}&venue=${venueId}`;
  }
});
