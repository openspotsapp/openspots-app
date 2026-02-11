import { auth } from "./firebase-init.js";
import {
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("forgotForm");
  const status = document.getElementById("statusMessage");
  const emailInput = document.getElementById("resetEmail");

  if (!form || !status || !emailInput) {
    console.error("Forgot password elements not found");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    if (!email) {
      status.textContent = "Please enter a valid email.";
      status.style.color = "red";
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email, {
        url: "https://openspots.app/change-password.html",
        handleCodeInApp: true
      });

      status.textContent = "Reset link sent. Check your email.";
      status.style.color = "#2f6f62";
    } catch (err) {
      console.error(err);
      status.textContent = err.message || "Unable to send reset email.";
      status.style.color = "red";
    }
  });
});
