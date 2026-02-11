import { auth } from "./firebase-init.js";
import {
  confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

const form = document.getElementById("changePasswordForm");
const status = document.getElementById("statusMessage");

const params = new URLSearchParams(window.location.search);
const oobCode = params.get("oobCode");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const newPass = document.getElementById("newPassword").value;
  const confirmPass = document.getElementById("confirmPassword").value;

  if (newPass !== confirmPass) {
    status.textContent = "Passwords do not match.";
    status.style.color = "red";
    return;
  }

  try {
    await confirmPasswordReset(auth, oobCode, newPass);

    status.textContent = "Password changed successfully.";

    setTimeout(() => {
      window.location.href = "login.html";
    }, 2000);
  } catch (err) {
    status.textContent = "Invalid or expired link.";
    status.style.color = "red";
    console.error(err);
  }
});
