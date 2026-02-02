import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const spotId = params.get("spot");

const spotLabelEl = document.getElementById("spotLabel");
const venueLabelEl = document.getElementById("venueLabel");
const confirmBtn = document.getElementById("confirmBtn");
const loadingEl = document.getElementById("loading");

if (spotLabelEl && spotId) {
  spotLabelEl.innerText = `You are parking in Spot ${spotId}`;
}

async function loadSpotMeta() {
  try {
    if (!spotId) return;
    const q = query(
      collection(db, "private_metered_parking"),
      where("zone_number", "==", spotId)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;
    const data = snap.docs[0].data();
    if (venueLabelEl) {
      venueLabelEl.innerText =
        data.location_name || data.venue_name || "Parking Location";
    }
  } catch (err) {
    console.error("Failed to load spot metadata:", err);
  }
}

async function enforcePaymentMethod(user) {
  if (!user) {
    return false;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    if (data.hasPaymentMethod === true) {
      return true;
    }
  } catch (err) {
    console.error("Failed to check payment status:", err);
  }

  window.location.href = spotId
    ? `./add-payment.html?spot=${encodeURIComponent(spotId)}`
    : "./add-payment.html";
  return false;
}

function showLoading(isLoading) {
  if (!confirmBtn || !loadingEl) return;
  confirmBtn.disabled = isLoading;
  loadingEl.classList.toggle("hidden", !isLoading);
}

function renderPendingNotice(secondsLeft) {
  let notice = document.getElementById("pendingNotice");

  if (!notice) {
    notice = document.createElement("div");
    notice.id = "pendingNotice";
    notice.style.marginTop = "16px";
    notice.style.padding = "14px";
    notice.style.borderRadius = "12px";
    notice.style.background = "rgba(255,255,255,0.12)";
    notice.style.color = "#ffffff";
    notice.style.textAlign = "center";
    notice.style.fontSize = "14px";
    notice.style.display = "flex";
    notice.style.flexDirection = "column";
    notice.style.gap = "6px";

    notice.innerHTML = `
      <strong>Please confirm or vacate the parking spot</strong>
      <span style="font-size:13px;opacity:0.85">
        Parking will begin automatically if the spot remains occupied.
      </span>
      <span id="pendingCountdown" style="font-weight:600;margin-top:4px"></span>
    `;

    document.querySelector(".confirm-container").appendChild(notice);
  }

  const countdownEl = document.getElementById("pendingCountdown");
  if (countdownEl) {
    countdownEl.textContent = `Confirming in ${secondsLeft}s`;
  }
}

async function confirmPendingSession(sessionId) {
  const res = await fetch("/api/parking/confirm-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId })
  });
  if (!res.ok) {
    throw new Error("Failed to confirm session");
  }
}

if (!confirmBtn) {
  throw new Error("Confirm button not found");
}

onAuthStateChanged(auth, async (user) => {
  await loadSpotMeta();

  if (!spotId) {
    if (loadingEl) {
      loadingEl.classList.remove("hidden");
      loadingEl.textContent = "Missing spot ID. Please rescan the QR code.";
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
    }
    return;
  }

  if (!user) {
    if (loadingEl) {
      loadingEl.classList.remove("hidden");
      loadingEl.textContent = "Sign-in required.";
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
    }
    return;
  }

  const canProceed = await enforcePaymentMethod(user);
  if (!canProceed) return;

  showLoading(true);

  try {
    const q = query(
      collection(db, "private_metered_parking"),
      where("zone_number", "==", spotId)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      showLoading(false);
      alert("Parking zone not found. Please rescan the QR code.");
      return;
    }

    const zoneDoc = snap.docs[0];
    const pendingKey = `pending_session_id_${spotId}`;
    const userRef = doc(db, "users", user.uid);

    let sessionRef = null;
    const existingId = sessionStorage.getItem(pendingKey);
    if (existingId) {
      const existingRef = doc(db, "parking_sessions", existingId);
      const existingSnap = await getDoc(existingRef);
      if (existingSnap.exists()) {
        sessionRef = existingRef;
      } else {
        sessionStorage.removeItem(pendingKey);
      }
    }

    if (!sessionRef) {
      const existingSessions = await getDocs(
        query(
          collection(db, "parking_sessions"),
          where("user_id", "==", userRef),
          where("zone_number", "==", spotId),
          where("status", "in", ["PENDING", "ACTIVE"])
        )
      );

      if (!existingSessions.empty) {
        sessionRef = existingSessions.docs[0].ref;
      }
    }

    if (!sessionRef) {
      const response = await fetch("/api/parking/create-pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zone_id: zoneDoc.ref.path,
          zone_number: spotId,
          user_id: user.uid
        })
      });
      const data = await response.json();
      if (!response.ok || !data.sessionId) {
        throw new Error(data.error || "Failed to create pending session");
      }
      sessionRef = doc(db, "parking_sessions", data.sessionId);
      sessionStorage.setItem(pendingKey, data.sessionId);
    }

    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists()) {
      throw new Error("Pending session not found");
    }

    const sessionData = sessionSnap.data();

    showLoading(false);

    if (sessionData.status === "ACTIVE") {
      window.location.href = "./my-spots.html?tab=active";
      return;
    }

    const CONFIRM_WINDOW_MS = 30_000;
    const pendingStartedAt = sessionData.pending_started_at
      ? sessionData.pending_started_at.toDate()
      : new Date();
    const elapsedMs = Date.now() - pendingStartedAt.getTime();
    let secondsLeft = Math.max(
      0,
      Math.ceil((CONFIRM_WINDOW_MS - elapsedMs) / 1000)
    );
    renderPendingNotice(secondsLeft);

    const countdownTimer = setInterval(async () => {
      secondsLeft -= 1;
      renderPendingNotice(Math.max(0, secondsLeft));

      if (secondsLeft <= 0) {
        clearInterval(countdownTimer);
        renderPendingNotice(0);

        confirmBtn.disabled = true;
        confirmBtn.style.opacity = "0.7";

        try {
          await confirmPendingSession(sessionRef.id);
        } catch (err) {
          console.error("Auto-confirm failed:", err);
        }
      }
    }, 1000);

    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      try {
        await confirmPendingSession(sessionRef.id);
      } catch (err) {
        console.error("Manual confirm failed:", err);
        confirmBtn.disabled = false;
      }
    });

    onSnapshot(sessionRef, (snap) => {
      if (!snap.exists()) return;
      if (snap.data().status === "ACTIVE") {
        window.location.href = "./my-spots.html?tab=active";
      }
    });
  } catch (err) {
    console.error("Parking session failed:", err);
    showLoading(false);
    alert("Could not start parking session.");
  }
});
