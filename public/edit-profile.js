import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

let currentUserId = null;

/* ----------------------------------
   LOAD PROFILE DATA
---------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUserId = user.uid;

  const snap = await getDoc(doc(db, "users", user.uid));

  if (!snap.exists()) return;

  const data = snap.data();

  document.getElementById("firstName").value = data.first_name || "";
  document.getElementById("lastName").value = data.last_name || "";
  document.getElementById("email").value = data.email || user.email || "";
  document.getElementById("phone").value = data.phone_number || "";

  document.getElementById("vehicleColor").value =
    data.vehicle_color || "";

  document.getElementById("vehicleMakeModel").value =
    data.vehicle_make_model || "";

  document.getElementById("vehicleLicense").value =
    data.vehicle_license || "";
});

/* ----------------------------------
   SAVE PROFILE
---------------------------------- */
document
  .getElementById("editProfileForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentUserId) return;

    const payload = {
      first_name: document.getElementById("firstName").value.trim(),
      last_name: document.getElementById("lastName").value.trim(),
      phone_number: document.getElementById("phone").value.trim(),

      vehicle_color: document
        .getElementById("vehicleColor")
        .value.trim(),

      vehicle_make_model: document
        .getElementById("vehicleMakeModel")
        .value.trim(),

      vehicle_license: document
        .getElementById("vehicleLicense")
        .value.trim()
    };

    try {
      await updateDoc(doc(db, "users", currentUserId), payload);

      // Optional micro-feedback
      alert("Profile updated");

      // Return to settings
      window.location.href = "settings.html";
    } catch (err) {
      console.error("Failed to save profile", err);
      alert("Something went wrong. Try again.");
    }
  });
