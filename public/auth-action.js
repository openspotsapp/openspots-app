import { auth } from "./firebase-init.js";
import {
  applyActionCode,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");
const oobCode = params.get("oobCode");

if (!mode || !oobCode) {
  window.location.href = "/login.html";
}

switch (mode) {
  case "resetPassword":
    window.location.href = `/change-password.html?oobCode=${oobCode}`;
    break;

  case "verifyEmail":
    applyActionCode(auth, oobCode)
      .then(() => {
        // Email verified successfully
        onAuthStateChanged(auth, (user) => {
          if (user) {
            // User is already logged in → send them to app
            window.location.href = "/nearby.html";
          } else {
            // User is not logged in → send to login
            window.location.href = "/login.html";
          }
        });
      })
      .catch((error) => {
        console.error("Email verification failed:", error);
        window.location.href = "/login.html";
      });
    break;

  case "verifyAndChangeEmail":
    window.location.href = `/verify-email.html?oobCode=${oobCode}`;
    break;

  default:
    window.location.href = "/login.html";
}
