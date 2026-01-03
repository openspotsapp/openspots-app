import { auth } from "./firebase-init.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

document.addEventListener("DOMContentLoaded", () => {
  console.log("Auth.js loaded and DOM ready.");

  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");

  // LOGIN HANDLER
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value.trim();
      const errorBox = document.getElementById("error-message");

      try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = "nearby.html";
      } catch (err) {
        errorBox.style.display = "block";
        errorBox.textContent = "Incorrect login. Please try again.";
      }
    });
  }

  // SIGNUP HANDLER
  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const firstName = document.getElementById("firstName").value.trim();
      const lastName = document.getElementById("lastName").value.trim();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value.trim();
      const confirm = document.getElementById("confirm").value.trim();
      const errorBox = document.getElementById("error-message");

      if (password !== confirm) {
        errorBox.style.display = "block";
        errorBox.textContent = "Passwords do not match.";
        return;
      }

      try {
        await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(auth.currentUser);
        window.location.href = "accSetup.html";
      } catch (err) {
        errorBox.style.display = "block";
        errorBox.textContent = "Account could not be created.";
      }
    });
  }
});
