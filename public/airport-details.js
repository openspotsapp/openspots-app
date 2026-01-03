import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
  doc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("operatorsList");
  const params = new URLSearchParams(window.location.search);
  const airportId = params.get("airportId");

  if (!airportId) {
    container.innerHTML = "<p>No airport selected.</p>";
    return;
  }

  try {
    const q = query(
      collection(db, "airport_operators"),
      where("airport_ref", "==", doc(db, "Airports", airportId)),
      where("is_active", "==", true)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      container.innerHTML = "<p>No operators available.</p>";
      return;
    }

    snapshot.forEach(docSnap => {
  const op = docSnap.data();

  container.insertAdjacentHTML(
    "beforeend",
    `
    <div class="venue-card">
      <img src="${op.image_url || ''}" alt="${op.name}" />
      <div class="venue-info">
        <h3>${op.name}</h3>
        <p>Shuttle every ${op.shuttle_frequency_min} min</p>
        <p>${op.total_spots} total spots</p>
        <a href="${op.operator_contact}" target="_blank">Visit site</a>
      </div>
    </div>
    `
  );
});
  } catch (err) {
    console.error("Operator load error:", err);
    container.innerHTML = "<p>Error loading operators.</p>";
  }
});
