// Load Header
fetch("header.html")
  .then(r => r.text())
  .then(html => {
    const container = document.getElementById("header");
    if (container) {
      container.innerHTML = html;

      // Get the page's custom title if defined
      const titleTag = document.querySelector("[data-page-title]");
      if (titleTag) {
        document.getElementById("dynamic-header-title").innerText =
          titleTag.getAttribute("data-page-title");
      }
    }
  });

// Load Navbar
fetch("navbar.html")
  .then(r => r.text())
  .then(html => {
    const container = document.getElementById("navbar");
    if (container) {
      container.innerHTML = html;

      // Notify the page that navbar is ready
      document.dispatchEvent(new Event("navbarLoaded"));

      const centerBtn = document.querySelector(".nav-center");

      if (centerBtn) {
        centerBtn.addEventListener("click", () => {
          const currentPage = window.location.pathname.split("/").pop();

          // If user is already on nearby.html → open range menu
          if (currentPage === "nearby.html") {
            window.dispatchEvent(new Event("openRangePopup"));
            return;
          }

          // Otherwise → go to nearby.html
          window.location.href = "nearby.html";
        });
      }
    }
  });

// Additional center-button handler (DOM ready)
document.addEventListener("DOMContentLoaded", () => {

  const navCenter = document.getElementById("navCenterBtn");

  if (navCenter) {
    navCenter.addEventListener("click", (e) => {
      e.preventDefault(); // stop accidental page reload

      const onNearby = window.location.pathname.includes("nearby.html");

      if (onNearby) {
        console.log("Center button clicked ON nearby page → open range popup.");

        document.getElementById("radiusPopup").style.display = "block";
      } else {
        console.log("Center button clicked on another page → navigate to nearby.");
        window.location.href = "nearby.html";
      }
    });
  }

});

document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname.split("/").pop();

  document.querySelectorAll(".nav-item").forEach(item => {
    const target = item.getAttribute("data-target");
    if (target === path) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });
});
