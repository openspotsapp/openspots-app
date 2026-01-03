/* =========================================================
   APP.JS – OpenSpots Unified Script
   Handles Stripe redirect, Firebase contact form, and modals
========================================================= */

// =========================
// STRIPE PAYMENT HANDLER
// =========================
function goToStripe() {
  // Replace with your Stripe payment link
  const stripeUrl = "https://buy.stripe.com/test_1234567890";
  window.location.href = stripeUrl;
}

// =========================
// FIREBASE CONTACT FORM SETUP
// =========================
import { db } from "./firebase-init.js";
import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

// =========================
// CONTACT FORM SUBMISSION
// =========================
const contactForm = document.getElementById("contactForm");
const contactSubmit = document.getElementById("contactSubmit");
const successModal = document.getElementById("contactSuccess");
const errorModal = document.getElementById("contactError");
const modalCloseButtons = document.querySelectorAll("[data-close-modal]");

if (contactForm) {
  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Honeypot check
    const company = document.getElementById("company")?.value;
    if (company) return; // bot trap

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const reason = document.getElementById("reason").value.trim();
    const message = document.getElementById("message").value.trim();

    if (!name || !email || !reason || !message) {
      showModal("error");
      return;
    }

    // Disable button while sending
    contactSubmit.disabled = true;
    contactSubmit.textContent = "Sending...";

    try {
      await addDoc(collection(db, "contact_messages"), {
        name,
        email,
        phone,
        reason,
        message,
        timestamp: serverTimestamp(),
      });

      contactForm.reset();
      showModal("success");
    } catch (error) {
      console.error("Error sending message:", error);
      showModal("error");
    } finally {
      contactSubmit.disabled = false;
      contactSubmit.textContent = "Send Message";
    }
  });
}

// =========================
// MODAL HANDLERS
// =========================
function showModal(type) {
  if (type === "success") {
    successModal.removeAttribute("hidden");
    successModal.style.display = "flex";
  } else {
    errorModal.removeAttribute("hidden");
    errorModal.style.display = "flex";
  }
}

modalCloseButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.closest(".modal").style.display = "none";
  });
});

window.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal")) {
    e.target.style.display = "none";
  }
});

// ==============================
// NAV MENU TOGGLE (Global)
// ==============================
window.toggleMenu = function () {
  const navList = document.querySelector('nav ul');
  if (navList) navList.classList.toggle('active');
};

// ===============================
//  FIREBASE: AI EMAIL CAPTURE
// ===============================
const aiForm = document.getElementById("aiForm");
if (aiForm) {
  aiForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const aiEmail = document.getElementById("aiEmail").value.trim();

    try {
      const docRef = await addDoc(collection(db, "ai_interest"), {
        email: aiEmail,
        timestamp: new Date(),
      });

      aiForm.reset();
      showAiModal("aiSuccessModal");
      console.log("AI interest added with ID:", docRef.id);
    } catch (error) {
      console.error("Error adding AI interest:", error);
      showAiModal("aiErrorModal");
    }
  });
}

// =============================
//  AI MODAL HANDLERS
// =============================
function showAiModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
}

function closeAiModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.style.display = "none";
    document.body.style.overflow = "auto";
  }
}

// ===============================
//  AI MODAL CLOSE (GLOBAL HOOK)
// ===============================
window.closeAiModal = function (id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.style.display = "none";
    modal.classList.remove("active");
    document.body.style.overflow = "auto";
  }
};
