import { db, auth } from "./firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

async function getVenueData(venueRefOrId) {
  if (!venueRefOrId) return null;

  let venueRef;

  if (typeof venueRefOrId === "string") {
    venueRef = doc(db, "venues", venueRefOrId);
  } else {
    venueRef = venueRefOrId;
  }

  try {
    const snap = await getDoc(venueRef);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.error("Error loading venue:", err);
    return null;
  }
}

const params = new URLSearchParams(window.location.search);
const reservationId = params.get("reservationId") || params.get("res");

if (!reservationId) {
  alert("Missing reservation ID");
  throw new Error("Missing reservation ID");
}

const venueNameEl = document.getElementById("venueName");
const eventNameEl = document.getElementById("eventName");
const eventDateEl = document.getElementById("eventDate");
const spotLabelEl = document.getElementById("spotId");
const statusTextEl = document.getElementById("status");
const pricePaidEl = document.getElementById("pricePaid");

auth.onAuthStateChanged(async (user) => {
  if (!user) return;

  try {
    const reservationRef = doc(
      db,
      "reservations",
      reservationId
    );
    const snap = await getDoc(reservationRef);

    if (!snap.exists()) {
      alert("Reservation not found");
      return;
    }

    const reservation = snap.data();
    let spot = null;

    if (reservation.spot_ref) {
      const spotSnap = await getDoc(reservation.spot_ref);
      if (spotSnap.exists()) {
        spot = { id: spotSnap.id, ...spotSnap.data() };
      }
    }

    const checkinUrl = `${window.location.origin}/checkin.html?reservationId=${reservationId}`;

    const qrImageEl = document.getElementById("qrImage");
    if (qrImageEl) {
      const encodedUrl = encodeURIComponent(checkinUrl);
      qrImageEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodedUrl}`;
    }

    const confirmationEl = document.getElementById("confirmationCode");
    if (confirmationEl && reservationId) {
      confirmationEl.textContent = reservationId.slice(-6).toUpperCase();
    }

    // ===== Venue Image (SAFE ADDITION) =====
    const venueImageEl = document.getElementById("venueImage");

    if (reservation.venue_id && venueImageEl) {
      const venue = await getVenueData(reservation.venue_id);

      if (venue && venue.image_url) {
        venueImageEl.src = venue.image_url;
      }
    }

    if (venueNameEl) venueNameEl.textContent = reservation.venue_name || "Venue";
    if (eventNameEl) eventNameEl.textContent = reservation.event_name || "";
    if (eventDateEl) {
      eventDateEl.textContent = reservation.start_time
        ? new Date(reservation.start_time.seconds * 1000).toLocaleString()
        : "";
    }

    if (spotLabelEl) spotLabelEl.textContent = reservation.spot_label || "—";
    if (statusTextEl) statusTextEl.textContent = reservation.status || "—";
    if (pricePaidEl) {
      const priceValue =
        reservation.price_paid ?? reservation.price ?? null;
      pricePaidEl.textContent =
        priceValue !== null ? `$${priceValue}` : "—";
    }

    const directionsBtn = document.getElementById("getDirectionsBtn");
    if (directionsBtn) {
      directionsBtn.addEventListener("click", () => {
        openSpotDirections(spot);
      });
    }

  } catch (err) {
    console.error(err);
    alert("Something went wrong loading this reservation.");
  }
});

function openSpotDirections(spot) {
  if (!spot || !spot.location) {
    alert("Location not available for this spot.");
    return;
  }

  const loc = spot.location;

  // ✅ Support both Firestore GeoPoint shapes
  const lat =
    typeof loc.latitude === "number"
      ? loc.latitude
      : typeof loc.lat === "number"
      ? loc.lat
      : null;

  const lng =
    typeof loc.longitude === "number"
      ? loc.longitude
      : typeof loc.lng === "number"
      ? loc.lng
      : null;

  if (lat === null || lng === null) {
    console.error("Invalid spot location:", loc);
    alert("Invalid spot coordinates.");
    return;
  }

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.open(mapsUrl, "_blank");
}
