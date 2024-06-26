let form = document.getElementById("lobby__form");

let displayName = sessionStorage.getItem("display_name");
if (displayName) {
  form.name.value = displayName;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();

  sessionStorage.setItem("display_name", e.target.name.value);

  let inviteCode = e.target.room.value;
  let name = e.target.name.value;

  console.log("name : ", name);
  console.log("inviteCode : ", inviteCode);
  if (!inviteCode && !name) {
    alert("veuillez des donnee correctes ");
    console.log("name : ", name);
    console.log("inviteCode : ", inviteCode);
  }
  window.location = `room.html?room=${inviteCode}&name=${name}`;
});
