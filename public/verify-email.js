import {
  getAuth,
  applyActionCode,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
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
    statusEl.textContent = "Email verified! Redirecting…";

    let resolved = false;
    const redirect = (url) => {
      if (resolved) return;
      resolved = true;
      window.location.href = url;
    };

    const timeoutId = setTimeout(() => {
      if (auth.currentUser) {
        redirect("/nearby.html");
      } else {
        redirect("/login.html");
      }
    }, 1200);

    onAuthStateChanged(auth, (user) => {
      clearTimeout(timeoutId);
      if (user) {
        redirect("/nearby.html");
      } else {
        redirect("/login.html");
      }
    });
  })
  .catch((error) => {
    console.error("Verification error:", error);
    statusEl.textContent = "This verification link is invalid or expired.";
  });
