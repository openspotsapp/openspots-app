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
    }
  });

document.addEventListener("navbarLoaded", () => {
  const centerBtn = document.querySelector(".nav-center");

  if (!centerBtn) return;

  centerBtn.onclick = () => {
    const isNearby = window.location.pathname.includes("nearby.html");

    if (isNearby) {
      window.dispatchEvent(new Event("openRangePopup"));
    } else {
      window.location.href = "nearby.html";
    }
  };
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
