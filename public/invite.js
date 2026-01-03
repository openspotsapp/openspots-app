document.getElementById("shareInvite").addEventListener("click", async () => {
  const url = "https://openspots.app";

  if (navigator.share) {
    await navigator.share({
      title: "OpenSpots",
      text: "Reserve parking spots instantly with OpenSpots.",
      url
    });
  } else {
    navigator.clipboard.writeText(url);
    alert("Invite link copied!");
  }
});
