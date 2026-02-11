const container = document.getElementById("qr-container");

document.getElementById("generate").onclick = () => {
  const prefix = document.getElementById("prefix").value.trim();
  const start = Number(document.getElementById("start").value);
  const end = Number(document.getElementById("end").value);

  container.innerHTML = "";

  for (let i = start; i <= end; i++) {
    const num = String(i).padStart(2, "0");
    const spot = `${prefix}-${num}`;

    const url = `https://openspots.app/spot-entry.html?spot=${spot}`;
    const encoded = encodeURIComponent(url);

    const card = document.createElement("div");
    card.className = "qr-card";

    card.innerHTML = `
      <strong>${spot}</strong>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}" />
    `;

    container.appendChild(card);
  }
};

document.getElementById("export").onclick = async () => {
  const cards = document.querySelectorAll(".qr-card");

  if (!cards.length) {
    alert("Generate QR codes first.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];

    card.classList.add("pdf-export");

    const canvas = await html2canvas(card, {
      scale: 3,
      backgroundColor: "#ffffff",
      useCORS: true
    });

    const imgData = canvas.toDataURL("image/png");

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgSize = Math.min(pageWidth, pageHeight) * 0.9;
    const x = (pageWidth - imgSize) / 2;
    const y = (pageHeight - imgSize) / 2;

    if (i > 0) pdf.addPage();

    pdf.addImage(imgData, "PNG", x, y, imgSize, imgSize);

    card.classList.remove("pdf-export");
  }

  pdf.save("openspots-qr-codes.pdf");
};
