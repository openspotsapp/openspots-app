import { auth, db } from "./firebase-init.js";

import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
  const citySelect = document.getElementById("citySelect");
  const airportSelect = document.getElementById("airportSelect");
  const reserveAirBtn = document.getElementById("reserveAirBtn");

  let selectedAirportId = null;
  let startPicker;
  let endPicker;

  async function loadCities() {
    citySelect.innerHTML =
      '<option selected disabled>Choose City...</option>';

    const snapshot = await getDocs(
      query(collection(db, "Airports"), where("is_active", "==", true))
    );

    const cities = new Set();

    snapshot.forEach(docSnap => {
      const { city } = docSnap.data();
      if (city) cities.add(city);
    });

    [...cities]
      .sort()
      .forEach(city => {
        const opt = document.createElement("option");
        opt.value = city;
        opt.textContent = city;
        citySelect.appendChild(opt);
      });
  }

  loadCities();

citySelect.addEventListener("change", async () => {
  airportSelect.innerHTML =
    '<option selected disabled>Choose Airport...</option>';
  airportSelect.disabled = false;
  selectedAirportId = null;

  const selectedCity = citySelect.value;

  const q = query(
    collection(db, "Airports"),
    where("city", "==", selectedCity),
    where("is_active", "==", true)
  );

  const snapshot = await getDocs(q);

  snapshot.forEach(docSnap => {
    const airport = docSnap.data();
    const opt = document.createElement("option");
    opt.value = docSnap.id; // Firestore doc ID
    opt.textContent = `${airport.name} (${airport.code})`;
    airportSelect.appendChild(opt);
  });

  validateReserveButton();
});

  function validateReserveButton() {
    const ready =
      citySelect.value &&
      selectedAirportId &&
      startPicker?.selectedDates?.length &&
      endPicker?.selectedDates?.length;

    reserveAirBtn.disabled = !ready;
    reserveAirBtn.classList.toggle("enabled", ready);
  }

  airportSelect.addEventListener("change", () => {
    selectedAirportId = airportSelect.value;
    validateReserveButton();
  });

  reserveAirBtn.addEventListener("click", async () => {
    if (!startPicker?.selectedDates[0] || !endPicker?.selectedDates[0]) return;

    const user = auth.currentUser;
    if (user) {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.exists() ? snap.data() : {};

        if (data.hasPaymentMethod !== true) {
          window.location.href = "add-payment.html";
          return;
        }
      } catch (err) {
        console.error("Failed to check payment status:", err);
        window.location.href = "add-payment.html";
        return;
      }
    }

    const airportId = selectedAirportId;
    window.location.href = `airport-details.html?airportId=${airportId}`;
  });

  const startInput = document.querySelector("#startTime");
  const endInput = document.querySelector("#endTime");

  if (!startInput || !endInput) {
    console.warn("Flatpickr inputs not found — skipping init");
    return;
  }

  startPicker = flatpickr(startInput, {
    enableTime: true,
    dateFormat: "Y-m-d h:i K",
    time_24hr: false,
    disableMobile: true,
    plugins: [
      new confirmDatePlugin({
        confirmText: "OK",
        showAlways: false
      })
    ],
    onChange: selectedDates => {
      endPicker?.set("minDate", selectedDates[0]);
      validateReserveButton();
    }
  });

  endPicker = flatpickr(endInput, {
    enableTime: true,
    dateFormat: "Y-m-d h:i K",
    time_24hr: false,
    disableMobile: true,
    plugins: [
      new confirmDatePlugin({
        confirmText: "OK",
        showAlways: false
      })
    ],
    onChange: validateReserveButton
  });
});
