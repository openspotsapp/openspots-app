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
    window.location.href = `/verify-email.html?oobCode=${oobCode}`;
    break;

  case "verifyAndChangeEmail":
    window.location.href = `/verify-email.html?oobCode=${oobCode}`;
    break;

  default:
    window.location.href = "/login.html";
}
