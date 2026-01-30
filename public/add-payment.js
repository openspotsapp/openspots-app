import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const stripePublicKey = "pk_test_51ShIrzDMJJmdLkf9RMOjnKPKzC9zfc8KzCuU1IwJC9OMANvShxeKd4EiK7g7qehKw041Dd78jXbG8qRnARMd6AKD00E30da1ki";

function setStatus(message, isError = false) {
  const statusEl = document.getElementById("paymentStatus");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#8a2b2b" : "#1f3a33";
}

document.addEventListener("DOMContentLoaded", () => {
  const addPaymentBtn = document.getElementById("addPaymentBtn");
  const userEmailEl = document.getElementById("userEmail");
  const stripe = window.Stripe ? Stripe(stripePublicKey) : null;

  addPaymentBtn.disabled = true;
  setStatus("Checking your account...");

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : {};
      const firstName = data.first_name || data.firstName || "";
      const lastName = data.last_name || data.lastName || "";
      const fullName = `${firstName} ${lastName}`.trim();
      userEmailEl.textContent = fullName || data.display_name || user.email || "Unknown user";

      if (data.hasPaymentMethod === true) {
        addPaymentBtn.disabled = true;
        addPaymentBtn.textContent = "Card already added";
        setStatus("");
        return;
      }
    } catch (err) {
      console.error("Failed to load user name:", err);
      userEmailEl.textContent = user.email || "Unknown user";
    }
    addPaymentBtn.disabled = false;
    setStatus("");
  });

  addPaymentBtn.addEventListener("click", async () => {
    const user = auth.currentUser;

    if (!user) {
      window.location.href = "login.html";
      return;
    }

    if (!stripe) {
      setStatus("Stripe failed to load. Please refresh and try again.", true);
      return;
    }

    addPaymentBtn.disabled = true;
    setStatus("Starting secure setup...");

    try {
      const API_BASE =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1"
          ? "http://localhost:5500"
          : "";

      const response = await fetch(`${API_BASE}/create-setup-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email
        })
      });

      const data = await response.json();

      if (!response.ok || !data.sessionId) {
        throw new Error(data.error || "Failed to start setup session");
      }

      await stripe.redirectToCheckout({
        sessionId: data.sessionId
      });
    } catch (err) {
      console.error("Setup session error:", err);
      setStatus("Could not start setup. Please try again.", true);
      addPaymentBtn.disabled = false;
    }
  });
});
