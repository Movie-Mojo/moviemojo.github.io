const profileGlyphs = {
  account:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M5 19a7 7 0 0 1 14 0"/>',
  settings:'<path d="M9.2 3.5h5.6l.5 2.2 1.7 1 2.2-.7 2.8 4.8-1.7 1.5v2l1.7 1.5-2.8 4.8-2.2-.7-1.7 1-.5 2.2H9.2l-.5-2.2-1.7-1-2.2.7L2 15.8l1.7-1.5v-2L2 10.8 4.8 6l2.2.7 1.7-1Z" transform="translate(0 -1.25)"/><circle cx="12" cy="12" r="3"/>',
  edit:'<path d="m15 4 5 5-10 10-6 1 1-6Z M13 6l5 5"/>',
  sliders:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>'
};
const profileIcon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${profileGlyphs[name]}</svg>`;
function updateAccountControl() {
  const button=$("#account-button"), settings=state.user && state.approved && state.tab === "profile" && !state.mfaRequired;
  button.innerHTML=profileIcon(settings ? "settings" : "account");
  button.setAttribute("aria-label",settings ? "Open settings" : "Open profile");
  button.disabled=state.mfaRequired || !!(state.user && !state.approved);
}
let profileLoadVersion=0;
async function renderProfilePage(refresh=true) {
  const version=++profileLoadVersion;
  const draftName=!refresh ? $("#display-name")?.value : null, draftBio=!refresh ? $("#profile-bio")?.value : null;
  app.innerHTML=`<section class="personal-profile"><p class="eyebrow">Your corner of the cinema</p><h1>${esc(state.displayName || "Your profile")}</h1><p class="subtitle">${esc(state.user.email)}</p><form id="display-name-form" class="profile-identity"><label for="display-name">Name</label><input id="display-name" aria-label="Your display name" maxlength="60" required value="${esc(draftName ?? state.displayName)}" placeholder="Your name"><label for="profile-bio">Bio</label><textarea id="profile-bio" maxlength="500" rows="3" placeholder="A little about you and your taste in movies">${esc(draftBio ?? state.bio)}</textarea><button class="button secondary">Save profile</button></form><div class="section-row profile-history-heading"><h2>Watched movies</h2><div class="watch-sort-controls"><button id="profile-options" class="button secondary icon-control ${state.profileGenre || state.profileSort!=="added" ? "options-active" : ""}" aria-label="Sort and filter watched movies">${profileIcon("sliders")}</button><button id="profile-reverse" class="button secondary icon-control" aria-label="Reverse watched movie order" aria-pressed="${state.profileReverse}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16m-4-4 4 4 4-4M17 20V4m-4 4 4-4 4 4"/></svg></button><button id="profile-edit-history" class="button secondary icon-control" aria-label="${state.profileEditing ? "Finish editing watched history" : "Edit watched history"}" aria-pressed="${state.profileEditing}">${profileIcon("edit")}</button></div></div><p class="muted history-hint">${state.profileGenre ? esc(genres.find(genre=>String(genre[0])===state.profileGenre)?.[1] || "Selected genre")+" · " : ""}${state.profileEditing ? "Remove movies you didn’t watch. Group lists stay unchanged." : "Movies marked watched across your groups."}</p><div id="profile-history" class="grid"><p class="loading">Loading your movie history…</p></div><div id="profile-excluded"></div></section>`;
  $("#display-name-form").onsubmit=e=>{e.preventDefault();run($("#display-name-form button"),async()=>{
    const name=$("#display-name").value.trim(), bio=$("#profile-bio").value.trim();
    if(!name) throw Error("Enter your name.");
    const rows=checked(await db.from("user_profiles").update({display_name:name,bio}).eq("id",state.user.id).select("id"));
    if(!rows.length) throw Error("Could not save your profile.");
    state.displayName=name; state.bio=bio; $(".personal-profile h1").textContent=name; toast("Profile saved.");
  });};
  $("#profile-edit-history").onclick=()=>{state.profileEditing=!state.profileEditing;renderProfilePage(false);};
  $("#profile-reverse").onclick=()=>{state.profileReverse=!state.profileReverse;renderProfilePage(false);};
  $("#profile-options").onclick=profileHistoryOptions;
  try {
    if(refresh || !state.profileHistory) state.profileHistory=checked(await db.rpc("mojo_watched_profile",{person:state.user.id}));
    if(version!==profileLoadVersion || state.tab!=="profile") return;
    renderProfileHistory();
  } catch(error) {
    if(version!==profileLoadVersion || state.tab!=="profile") return;
    $("#profile-history").innerHTML='<div class="empty"><p>Could not load watched movies.</p><button id="retry-history" class="button secondary">Try again</button></div>';
    $("#retry-history").onclick=()=>renderProfilePage();
  }
}
function renderProfileHistory() {
  const history=state.profileHistory;
  const rows=(history.movies || []).filter(movie=>!state.profileGenre || watchMetadata.get(String(movie.tmdb_id))?.genres?.some(genre=>String(genre.id)===state.profileGenre));
  const sorted=sortedWatchEntries(rows.map(movie=>({movies:movie})),state.profileSort,state.profileReverse);
  $("#profile-history").innerHTML=sorted.map(({movies:movie},i)=>`<div class="profile-history-card">${card(movie,i)}${state.profileEditing ? `<button class="history-remove" data-profile-remove="${esc(movie.id)}" aria-label="Remove ${esc(movie.title)} from my watched history">Remove</button>` : ""}</div>`).join("") || '<div class="empty"><p>No watched movies'+(state.profileGenre ? ' in this genre.' : ' yet.')+'</p></div>';
  app.querySelectorAll("#profile-history [data-movie]").forEach(button=>button.onclick=()=>run(null,()=>details(sorted[Number(button.dataset.movie)].movies,null,button)));
  app.querySelectorAll("[data-profile-remove]").forEach(button=>button.onclick=()=>run(button,async()=>{
    state.profileHistory=checked(await db.rpc("mojo_watched_profile",{person:state.user.id,action:"remove",movie:button.dataset.profileRemove}));
    await renderProfilePage(false); toast("Removed from your watched history.");
  }));
  $("#profile-excluded").innerHTML=state.profileEditing && history.excluded?.length ? `<details class="profile-restores"><summary>Removed from your history (${history.excluded.length})</summary>${history.excluded.map(movie=>`<div class="section-row"><span>${esc(movie.title)}</span><button class="link-button" data-profile-restore="${esc(movie.id)}">Restore</button></div>`).join("")}</details>` : "";
  revealScrollingCards();
  app.querySelectorAll("[data-profile-restore]").forEach(button=>button.onclick=()=>run(button,async()=>{
    state.profileHistory=checked(await db.rpc("mojo_watched_profile",{person:state.user.id,action:"restore",movie:button.dataset.profileRestore}));
    await renderProfilePage(false);toast("Restored to your history.");
  }));
}
function profileHistoryOptions() {
  openModal(`<form id="profile-history-options" class="settings-form"><details class="movie-options-section" open><summary>Sort</summary><label for="profile-sort">Sort by</label><select id="profile-sort"><option value="added">Recently watched</option><option value="name">Name</option><option value="date">Release date</option><option value="rating">TMDB rating</option></select></details><details class="movie-options-section"><summary>Filter</summary><label for="profile-genre">Genre</label><select id="profile-genre"><option value="">All genres</option>${genres.map(([id,name])=>`<option value="${id}">${esc(name)}</option>`).join("")}</select></details><button class="button">Apply</button></form>`);
  $("#profile-sort").value=state.profileSort; $("#profile-genre").value=state.profileGenre;
  $("#profile-history-options").onsubmit=e=>{e.preventDefault();run(e.target.querySelector("button"),async()=>{
    const sort=$("#profile-sort").value, genre=$("#profile-genre").value;
    if(genre || ["date","rating"].includes(sort)) await loadWatchMetadata(state.profileHistory.movies);
    state.profileSort=sort;state.profileGenre=genre; closeModal();renderProfilePage(false);
  });};
}
function settingsBack() { return '<button class="link-button settings-back" id="settings-back">← Settings</button>'; }
function bindSettingsBack() {$("#settings-back").onclick=settingsMenu;}
function settingsMenu() {
  if(!state.user || !state.approved || state.mfaRequired) return;
  openModal(`<p class="eyebrow">Make Movie Mojo yours</p><h2>Settings</h2><div class="settings-categories"><button data-settings="security"><strong>Security</strong><span>Password and two-factor authentication</span></button><button data-settings="streaming"><strong>Streaming</strong><span>Your services and country</span></button><button data-settings="lists"><strong>Watchlists</strong><span>Manage your lists and refresh data</span></button><button data-settings="about"><strong>About</strong><span>Home screen installation and credits</span></button></div><button id="settings-logout" class="button secondary full">Sign out</button>`);
  modal.querySelectorAll("[data-settings]").forEach(button=>button.onclick=()=>{
    if(button.dataset.settings==="security") run(button,securitySettings);
    if(button.dataset.settings==="streaming") streamingSettings();
    if(button.dataset.settings==="lists") watchlistSettings();
    if(button.dataset.settings==="about") aboutSettings();
  });
  $("#settings-logout").onclick=logout;
}
function watchlistSettings() {
  openModal(`${settingsBack()}<h2>Watchlists</h2><p class="muted">Manage lists you own or leave shared groups.</p><button id="manage-watchlists" class="button secondary full">Manage watchlists</button><button id="refresh-data" class="button secondary full">Refresh watchlists</button>`);
  bindSettingsBack();$("#manage-watchlists").onclick=manageWatchlists;
  $("#refresh-data").onclick=e=>run(e.currentTarget,async()=>{await loadGroups();state.profileHistory=null;profile();toast("Watchlists refreshed.");});
}
function aboutSettings() {
  openModal(`${settingsBack()}<h2>About Movie Mojo</h2><p class="muted">Add Movie Mojo to your home screen.</p><p>iPhone: Safari → Share → Add to Home Screen.<br>Android: use your browser’s Install app option.</p>${movieCredits()}`);bindSettingsBack();
}
function streamingSettings() {
  openModal(`${settingsBack()}<h2>Streaming preferences</h2><p class="muted">Choose your services to use My streaming services in Discover.</p><form id="streaming-profile" class="settings-form"><label for="profile-region">Country</label><select id="profile-region"><option value="US">United States</option><option value="GB">United Kingdom</option><option value="CA">Canada</option><option value="AU">Australia</option></select><div id="profile-services"></div><button class="button" type="submit">Save streaming services</button></form>`);bindSettingsBack();
  $("#profile-region").value = state.streamingRegion;
  loadProviders(
    state.streamingRegion,
    "profile-services",
    state.streamingServices,
  );
  $("#profile-region").onchange = () =>
    loadProviders($("#profile-region").value, "profile-services");
  $("#streaming-profile").onsubmit = (e) => {
    e.preventDefault();
    run($("#streaming-profile button[type=submit]"), async () => {
      if (!$("#profile-services .service-picker"))
        throw new Error("Wait for streaming services to load before saving.");
      const ids = new FormData(e.target).getAll("profile-provider").map(Number);
      const region = $("#profile-region").value;
      const rows = checked(
        await db
          .from("user_profiles")
          .update({ streaming_services: ids, streaming_region: region })
          .eq("id", state.user.id)
          .select("id"),
      );
      if (!rows.length)
        throw new Error(
          "Could not save your streaming services. Please try again.",
        );
      state.streamingServices = ids;
      state.streamingRegion = region;
      const discoveryServices=$("#discovery-services");
      if(discoveryServices) {
        const expanded=!!discoveryServices.querySelector("details")?.open;
        const selected=Array.from(discoveryServices.querySelectorAll('input[name="discovery-provider"]:checked'),input=>Number(input.value));
        const useMy=!!discoveryServices.querySelector("#use-my-services")?.checked;
        const search=discoveryServices.querySelector(".provider-search")?.value || "";
        await loadProviders($("#watch_region").value,"discovery-services",selected,useMy);
        const picker=discoveryServices.querySelector("details");
        if(picker) picker.open=expanded;
        const searchInput=discoveryServices.querySelector(".provider-search");
        if(searchInput && search) {searchInput.value=search;searchInput.dispatchEvent(new Event("input",{bubbles:true}));}
      }
      toast("Streaming services saved.");
    });
  };

}
