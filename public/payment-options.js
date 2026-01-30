import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("managePaymentBtn");
  const cardStatus = document.getElementById("cardStatus");
  const cardLast4 = document.getElementById("cardLast4");

  if (btn) {
    btn.addEventListener("click", () => {
      window.location.href = "add-payment.html";
    });
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return;
    const data = snap.data() || {};

    if (data.hasPaymentMethod && data.payment_last4) {
      const brand = data.payment_brand || "Card";
      const prettyBrand = brand.charAt(0).toUpperCase() + brand.slice(1);
      if (cardStatus) {
        cardStatus.textContent = "On file";
      }
      if (cardLast4) {
        cardLast4.style.display = "block";
        cardLast4.textContent = `${prettyBrand} •••• ${data.payment_last4}`;
      }
      if (btn) {
        btn.textContent = "Manage payment method";
      }
    }
  });
});
