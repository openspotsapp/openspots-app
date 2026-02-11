// login.js
import { auth } from "./firebase-init.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    try {
      // 🔥 REAL FIREBASE LOGIN
      await signInWithEmailAndPassword(auth, email, password);

      // Redirect to home
      window.location.href = "nearby.html";
    } catch (error) {
      console.error("Login error:", error);

      const errorEl = document.getElementById("error-message");
      if (errorEl) {
        errorEl.textContent = "Invalid email or password.";
        errorEl.style.display = "block";
      }
    }
  });
}

// 👁️ Toggle password visibility
const toggle = document.querySelector(".toggle-password");
const passwordEl = document.querySelector(".pass");

if (toggle && passwordEl) {
  toggle.addEventListener("click", () => {
    const isPassword = passwordEl.type === "password";

    passwordEl.type = isPassword ? "text" : "password";
    toggle.classList.toggle("fa-eye");
    toggle.classList.toggle("fa-eye-slash");
  });
}
