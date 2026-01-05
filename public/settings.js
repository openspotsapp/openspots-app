import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

async function resolveUserProfile() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        resolve(null);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid));

        if (!snap.exists()) {
          resolve({
            email: user.email || "-"
          });
          return;
        }

        const data = snap.data();

        resolve({
          name: data.display_name || data.first_name || "Account",
          email: data.email || user.email || "-",
          phone: data.phone_number || "-",
        });

      } catch (err) {
        console.error("Failed to load user profile", err);
        resolve({
          email: user.email || "-"
        });
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const userNameEl = document.getElementById("userName");
  const userEmailEl = document.getElementById("userEmail");
  const userPhoneEl = document.getElementById("userPhone");
  const logoutBtn = document.getElementById("logoutBtn");
  const switchAttendantBtn = document.getElementById("switchAttendant");

  (async () => {
    const profile = await resolveUserProfile();

    if (!profile) {
      window.location.href = "login.html";
      return;
    }

    userNameEl.textContent = profile.name || "Account";
    userEmailEl.textContent = profile.email || "";
    userPhoneEl.textContent = profile.phone || "";
  })();

  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });

  switchAttendantBtn?.addEventListener("click", async (e) => {
    e.preventDefault();

    const user = auth.currentUser;
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    const operatorQuery = query(
      collection(db, "operators"),
      where("user_id", "==", doc(db, "users", user.uid))
    );

    const operatorSnap = await getDocs(operatorQuery);

    if (operatorSnap.empty) {
      alert("You are not registered as an attendant yet.");
      return;
    }

    const operator = operatorSnap.docs[0].data();

    if (operator.is_active === false) {
      alert("Your attendant access is inactive.");
      return;
    }

    window.location.href = "attendant.html";
  });
});
