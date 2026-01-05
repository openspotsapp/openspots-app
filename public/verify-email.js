import { getAuth, applyActionCode } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { app } from "./firebase-init.js";

const auth = getAuth(app);
const params = new URLSearchParams(window.location.search);
const oobCode = params.get("oobCode");
const statusEl = document.getElementById("status");

if (!oobCode) {
  window.location.href = "/login.html";
}

applyActionCode(auth, oobCode)
  .then(() => {
    statusEl.textContent = "Email verified! Redirecting to login…";
    setTimeout(() => {
      window.location.href = "/login.html";
    }, 2500);
  })
  .catch((error) => {
    console.error("Verification error:", error);
    statusEl.textContent = "This verification link is invalid or expired.";
  });
