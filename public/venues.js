// ======================================================
// FIRESTORE
// ======================================================
import {
  getFirestore,
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const db = getFirestore();

// ======================================================
// UI ELEMENTS
// ======================================================
const venueListEl = document.getElementById("venueList");
const searchInput = document.getElementById("venueSearchInput");

let allVenues = []; // local cache

// ======================================================
// Fetch Venues
// ======================================================
async function loadVenues() {
  const q = query(collection(db, "venues"), orderBy("name"));
  const snapshot = await getDocs(q);

  allVenues = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  renderVenues(allVenues);
}

loadVenues();

// ======================================================
// Render Function
// ======================================================
function renderVenues(list) {
  venueListEl.innerHTML = "";

  list.forEach((v) => {
    const rawType = v.venue_type;

    const venueType =
      typeof rawType === "string"
        ? rawType.replace("VenueType.", "")
        : rawType?.name || rawType?.enumValue || "";

    let priceText = "";
    let availabilityText = "";

    if (venueType === "PRIVATE") {
      priceText = v.price_per_week
        ? `$${v.price_per_week}/week`
        : v.price_per_day
        ? `$${v.price_per_day}/day`
        : "Contact for pricing";

      availabilityText = `${v.reservable_spots_available ?? 0} available`;
    } else {
      // EVENT + any other venue types
      priceText = v.price_per_hour
        ? `$${v.price_per_hour}`
        : "Pricing varies";

      availabilityText = `${v.available_spots ?? 0}`;
    }

    const card = document.createElement("div");
    card.className = "venue-card";
    card.innerHTML = `
      <img class="venue-img" src="${v.image_url}" alt="${v.name}" />

      <div class="venue-info">
        <div class="venue-title">${v.name}</div>
        <div class="venue-address">${v.address}</div>
      </div>

      <div class="venue-meta">
        <div class="venue-price">${priceText}</div>
        <div class="venue-spots">${availabilityText}</div>
      </div>
    `;

    card.addEventListener("click", () => {
      window.location.href = `venue-details.html?venue=${v.id}`;
    });

    
    venueListEl.appendChild(card);
  });
}

// ======================================================
// Search Logic
// ======================================================
searchInput.addEventListener("input", () => {
  const term = searchInput.value.toLowerCase();

  const filtered = allVenues.filter((v) =>
    v.name.toLowerCase().includes(term) ||
    v.address.toLowerCase().includes(term)
  );

  renderVenues(filtered);
});
