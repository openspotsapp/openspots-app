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

document.addEventListener("DOMContentLoaded", async () => {
  const addPaymentBtn = document.getElementById("addPaymentBtn");
  const userEmailEl = document.getElementById("userEmail");
  const stripe = window.Stripe ? Stripe(stripePublicKey) : null;
  const params = new URLSearchParams(window.location.search);
  const spot = params.get("spot");
  const flow = params.get("flow");

  addPaymentBtn.disabled = true;
  setStatus("Checking your account...");

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      setStatus("Please sign in to continue.", true);
      return;
    }

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : {};
      const firstName = data.first_name || data.firstName || "";
      const lastName = data.last_name || data.lastName || "";
      const fullName = `${firstName} ${lastName}`.trim();
      userEmailEl.textContent =
        fullName || data.display_name || user.email || "Unknown user";

      if (data.hasPaymentMethod === true) {
        window.location.href = spot
          ? `./confirm-spot.html?spot=${encodeURIComponent(spot)}`
          : "./confirm-spot.html";
        return;
      }

      addPaymentBtn.disabled = false;
      setStatus("");
    } catch (err) {
      console.error("Failed to load user:", err);
      userEmailEl.textContent = user.email || "Unknown user";
      addPaymentBtn.disabled = false;
      setStatus("");
    }
  });

  addPaymentBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    const spotParam = spot;

    if (!user) {
      setStatus("Please refresh to continue.", true);
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
          email: user.email,
          spot: spotParam,
          flow: flow || null
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
