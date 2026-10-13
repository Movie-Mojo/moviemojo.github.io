"use strict";
const sessionKey = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
let sessionMemory = new Map();
function stored(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
let keepSignedIn =
  stored(sessionStorage, "mojo-session-mode") === "tab"
    ? false
    : stored(localStorage, "mojo-session-mode") === "persistent" ||
      !!stored(localStorage, sessionKey);
const authStorage = {
  getItem(key) {
    return (
      stored(keepSignedIn ? localStorage : sessionStorage, key) ||
      sessionMemory.get(key) ||
      null
    );
  },
  setItem(key, value) {
    try {
      (keepSignedIn ? localStorage : sessionStorage).setItem(key, value);
      sessionMemory.delete(key);
    } catch {
      sessionMemory.set(key, value);
    }
  },
  removeItem(key) {
    sessionMemory.delete(key);
    for (const storage of [localStorage, sessionStorage])
      try {
        storage.removeItem(key);
      } catch {}
  },
};
function chooseSessionStorage(keep) {
  keepSignedIn = keep;
  try {
    sessionStorage.setItem("mojo-session-mode", keep ? "persistent" : "tab");
    localStorage.setItem("mojo-session-mode", keep ? "persistent" : "tab");
  } catch {}
}
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: sessionKey,
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
const $ = (s, root = document) => root.querySelector(s);
const app = $("#app");
let modal = $("#modal");
const state = {
  user: null,
  approved: false,
  displayName: "",
  bio: "",
  mfaRequired: false,
  mfaFactors: [],
  profileSort: "added",
  profileReverse: false,
  profileGenre: "",
  profileEditing: false,
  profileHistory: null,
  contributors: {},
  streamingServices: [],
  streamingRegion: "US",
  groups: [],
  group: null,
  movies: [],
  tab: "watchlist",
  watched: false,
  dnf: false,
  personalRatings: {},
  groupRatings: {},
  profileInfo: null,
  friendProfile: null,
  completedMovies: [],
  watchSort: "added",
  watchReverse: false,
  watchGenre: "",
  results: [],
  page: 1,
  total: 1,
  mode: "discover",
  viewingMode: "all",
  query: "",
  filters: { mood: "Trending Now", trending: true },
  request: 0,
};
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const image = (path) => (path ? `https://image.tmdb.org/t/p/w342${path}` : "");
let toastTimer,
  authVersion = 0;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").style.display = "none"), 4500);
}
async function run(button, action) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await action();
  } catch (e) {
    console.error(e);
    toast(e.message || "Something went wrong. Please try again.");
  } finally {
    if (button) button.disabled = false;
  }
}
function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}
async function tmdb(path, params = {}) {
  const filters = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const { data, error } = await db.functions.invoke("movie-data", { body: { path, params: filters } });
  if (error) {
    const status = error.context?.status;
    throw new Error(status === 429
      ? "Too many movie requests. Try again in a minute."
      : status === 401 || status === 403
        ? "Please sign in with a verified account to find movies."
        : "Movie information is temporarily unavailable. Please try again.");
  }
  return data;
}
function movieCredits() {
  return `<section class="movie-credits" aria-label="About and credits"><h2>About & credits</h2><a class="tmdb-credit" href="https://www.themoviedb.org/" target="_blank" rel="noopener"><img src="./assets/tmdb-logo.svg" alt="The Movie Database (TMDB)" width="130" height="11"></a><p>Movie data and images provided by TMDB.</p><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>Streaming availability provided by <a href="https://www.justwatch.com/" target="_blank" rel="noopener">JustWatch</a> via TMDB.</p></section>`;
}
let cancelCardPresses = () => {};
let modalDismissAction = null;
const modalOverlay=$("#modal-overlay");
let modalReturnFocus=null, modalBodyOverflow="", modalInertRoots=[];
Object.defineProperty(modal,"open",{get:()=>!modalOverlay.hidden});
function closeModal() {
  ++detailRequest;
  const dismiss=modalDismissAction;modalDismissAction=null;
  if(dismiss)run(null,dismiss);
  const wasOpen=modal.open;
  try {
    cancelCardPresses();
    modal.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
  } finally {
    // Visibility and background interactivity have one explicit owner.
    modalOverlay.hidden=true;
    modal.removeAttribute("open");
    modal.classList.remove("movie-detail-dialog","from-card");
    $("#modal-content").replaceChildren();
    for(const root of modalInertRoots)root.inert=false;
    modalInertRoots=[];
    if(wasOpen)document.body.style.overflow=modalBodyOverflow;
    const focus=modalReturnFocus;modalReturnFocus=null;
    if(wasOpen && focus?.isConnected && !focus.closest("[inert]"))focus.focus({preventScroll:true});
  }
}
function showAppModal() {
 modalReturnFocus=document.activeElement;
 modalBodyOverflow=document.body.style.overflow;
 document.body.style.overflow="hidden";
 modalInertRoots=[document.querySelector("header"),app,$("#navigation")].filter(root=>root && !root.inert);
 modalInertRoots.forEach(root=>root.inert=true);
 modalOverlay.hidden=false;modal.setAttribute("open","");
 $("#close-modal").focus({preventScroll:true});
}
function openModal(html, source = null) {
  cancelCardPresses();
  const start = source?.getBoundingClientRect();
  $("#modal-content").innerHTML = html;
  if (!modal.open) {
    modal.classList.toggle("from-card", !!start);
    showAppModal();
    if (start && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const end = modal.getBoundingClientRect();
      modal.animate([
        {opacity:.35, transform:`translate(${start.x + start.width/2 - end.x - end.width/2}px, ${start.y + start.height/2 - end.y - end.height/2}px) scale(${Math.max(.15,start.width/end.width)}, ${Math.max(.15,start.height/end.height)})`,borderRadius:"14px"},
        {opacity:1, transform:"none",borderRadius:"24px"}
      ], {duration:650,easing:"cubic-bezier(.16,1,.3,1)"});
    }
  }
}
$("#close-modal").onclick=closeModal;
modalOverlay.addEventListener("click",event=>{if(event.target===modalOverlay)closeModal();});
modalOverlay.addEventListener("keydown",event=>{
 if(event.key==="Escape"){event.preventDefault();closeModal();return;}
 if(event.key!=="Tab" || !modal.open)return;
 const controls=[...modal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(control=>control.getClientRects().length && !control.closest("[hidden]"));
 const first=controls[0],last=controls.at(-1);
 if(!first){event.preventDefault();modal.focus();return;}
 if(event.shiftKey && (document.activeElement===first || document.activeElement===modal)){event.preventDefault();last.focus();}
 else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
});
function empty(title, body, action = "") {
  return `<div class="empty"><h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>${action}</div>`;
}
function contributorName(entry) {
  return entry.added_by === state.user?.id
    ? state.displayName || "You"
    : state.contributors[entry.added_by] || "Group member";
}
function card(movie, index, entry = null) {
  const poster = movie.poster_url || image(movie.poster_path);
  const year = movie.release_year || movie.release_date?.slice(0, 4) || "Year unknown";
  const note = entry?.suggestion_note ? `<p class="card-note">“${esc(entry.suggestion_note)}”</p>` : "";
  const onList = !entry && state.movies.some(item=>String(item.movies.tmdb_id)===String(movie.id));
  const contributor = entry ? `<p class="added-by">Added by ${esc(contributorName(entry))}</p>${note}` : "";
  const movieCard = `<button class="movie-card" data-movie="${index}" aria-label="Details for ${esc(movie.title)}"><div class="poster-wrap">${poster ? `<img loading="lazy" src="${esc(poster)}" alt="${esc(movie.title)} poster" onerror="this.hidden=true">` : '<div class="poster-fallback">✦</div>'}${movie.vote_average ? `<span class="score">★ ${Number(movie.vote_average).toFixed(1)}</span>` : ""}</div><h3>${esc(movie.title)}</h3><p>${esc(year)}</p>${entry?.dnf ? '<p class="dnf-badge">Did not finish</p>' : ""}${entry && (entry.watched || entry.dnf) && state.groupRatings[entry.movies.id]?.average != null ? `<p class="personal-rating-badge">Group rating · ${Number(state.groupRatings[entry.movies.id].average).toFixed(1)}/5</p>` : ""}${contributor}${onList ? '<p class="on-list-badge">On this watchlist · Tap for details</p>' : ""}</button>`;
  if (!entry) return movieCard;
  return `<div class="movie-card-wrap">${movieCard}<button class="card-menu-button" data-card-menu="${index}" aria-label="Actions for ${esc(movie.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button></div>`;
}
let scrollRevealObserver;
function revealScrollingCards() {
  scrollRevealObserver?.disconnect();
  app.querySelectorAll(".scroll-pending").forEach(el => el.classList.remove("scroll-pending"));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  const rows = new Map();
  app.querySelectorAll(".grid > .movie-card, .grid > .movie-card-wrap, .grid > .profile-history-card").forEach(card => {
    const key = card.offsetTop;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(card);
  });
  const pendingRows = new Map();
  scrollRevealObserver = new IntersectionObserver(items => {
    for (const item of items) {
      if (!item.isIntersecting) continue;
      const row = pendingRows.get(item.target) || [];
      for (const card of row) {
        card.classList.remove("scroll-pending");
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
          card.animate([{opacity:0,transform:"translateY(36px)"},{opacity:.15,offset:.2},{opacity:1,transform:"none"}], {duration:900,easing:"cubic-bezier(.25,.6,.25,1)"});
      }
      scrollRevealObserver.unobserve(item.target);
      pendingRows.delete(item.target);
    }
  }, {threshold:0, rootMargin:"0px 0px -80px 0px"});
  for (const row of rows.values()) {
    if (row[0].getBoundingClientRect().top < innerHeight - 80) continue;
    row.forEach(card => card.classList.add("scroll-pending"));
    pendingRows.set(row[0], row);
    scrollRevealObserver.observe(row[0]);
  }
}
const movieDetailCache = new Map();
function loadMovieDetails(movie) {
  const id = movie.tmdb_id || (Number.isInteger(movie.id) ? movie.id : null);
  if (!id) return Promise.resolve(movie);
  if (!movieDetailCache.has(id)) {
    const request = tmdb(`movie/${id}`, {append_to_response:"watch/providers,videos,external_ids"}).catch(error => { movieDetailCache.delete(id); throw error; });
    movieDetailCache.set(id, request);
    if (movieDetailCache.size > 40) movieDetailCache.delete(movieDetailCache.keys().next().value);
  }
  return movieDetailCache.get(id);
}
function bindCards(list, entries = false) {
  cancelCardPresses();
  const cancels = [];
  cancelCardPresses = () => cancels.forEach(cancel => cancel());
  revealScrollingCards();
  app.querySelectorAll("[data-movie]").forEach(btn => {
    const item = list[Number(btn.dataset.movie)];
    const savedEntry = entries ? item : state.movies.find(entry=>String(entry.movies.tmdb_id)===String(item.id));
    let timer, origin, suppressClick = false, longPressHandled = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    cancels.push(cancel);
    btn.onclick = e => {
      if (suppressClick) { e.preventDefault(); suppressClick = false; return; }
      run(null, () => details(entries ? item.movies : item, savedEntry || null, btn));
    };
    btn.addEventListener("pointerdown", () => { loadMovieDetails(entries ? item.movies : item).catch(() => {}); }, {passive:true});
    if (!entries) return;
    btn.onpointerdown = e => {
      cancel(); suppressClick = false; longPressHandled = false;
      if (e.button !== 0 || !e.isPrimary) return;
      origin = {x:e.clientX,y:e.clientY};
      timer = setTimeout(() => {
        timer = null; if (!btn.isConnected) return; suppressClick = true; longPressHandled = true; movieActions(item, btn);
      }, 550);
    };
    btn.onpointermove = e => {
      if (origin && Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>10) cancel();
    };
    btn.onpointerup = cancel;
    btn.onpointercancel = cancel;
    btn.onpointerleave = cancel;
    btn.oncontextmenu = e => { e.preventDefault(); cancel(); if (longPressHandled) return; longPressHandled = true; suppressClick = true; movieActions(item, btn); };
  });
  app.querySelectorAll("[data-card-menu]").forEach(btn => {
    btn.onclick = () => movieActions(list[Number(btn.dataset.cardMenu)], btn.closest(".movie-card-wrap").querySelector(".movie-card"));
  });
}
function movieActions(entry, source = null) {
  ++detailRequest;
  const targets = state.groups.filter(g => g.group_id !== state.group?.group_id);
  openModal(`<p class="eyebrow">Movie actions</p><h2>${esc(entry.movies.title)}</h2><div class="quick-movie-actions"><button id="quick-watched" class="button">${entry.watched ? "Move to watchlist" : "Mark watched"}</button><button id="quick-dnf" class="button secondary">${entry.dnf ? "Move to watchlist" : "Did not finish"}</button>${personalRatingPanel(entry)}${groupRatingPanel(entry)}<button id="quick-details" class="button secondary">Movie details</button>${targets.length ? `<label for="quick-target">Another watchlist</label><select id="quick-target">${targets.map(g => `<option value="${esc(g.group_id)}">${esc(g.group_name)}</option>`).join("")}</select><div class="quick-transfer"><button id="quick-copy" class="button secondary">Copy to list</button><button id="quick-move" class="button secondary">Move to list</button></div>` : ""}<button id="quick-remove" class="button danger">Remove from this list</button></div>`, source);
  bindPersonalRating(entry);
  $("#quick-dnf").onclick=e=>entry.dnf ? run(e.currentTarget,async()=>{await setDnf(entry,false);closeModal();}) : completionDialog(entry,"dnf");
  $("#quick-details").onclick = () => details(entry.movies, entry);
  $("#quick-watched").onclick = e => entry.watched ? run(e.currentTarget, async () => { await setWatched(entry,false); closeModal(); }) : completionDialog(entry,"watched");
  for (const action of ["copy","move"]) {
    const button = $("#quick-"+action);
    if (!button) continue;
    button.onclick = e => run(e.currentTarget, async () => {
      const target = $("#quick-target").value;
      if (!targets.some(g => g.group_id === target)) throw new Error("Choose a watchlist.");
      const duplicate = checked(await db.from("group_movies").select("id").eq("group_id",target).eq("movie_id",entry.movies.id).limit(1));
      if (duplicate.length) throw new Error("This movie is already on that watchlist.");
      if (action === "move") {
        const rows = checked(await db.from("group_movies").update({group_id:target}).eq("id",entry.id).select("id"));
        if (!rows.length) throw new Error("This movie could not be moved. Refresh and try again.");
      } else {
        checked(await db.from("group_movies").insert({group_id:target,movie_id:entry.movies.id,added_by:state.user.id,suggestion_note:entry.suggestion_note || "",watched:entry.watched,watched_at:entry.watched_at || null,dnf:!!entry.dnf,dnf_at:entry.dnf_at || null}));
      }
      await loadMovies(); render(); closeModal(); toast(action === "move" ? "Moved to watchlist." : "Copied to watchlist.");
    });
  }
  $("#quick-remove").onclick = e => run(e.currentTarget, async () => {
    if (!confirm(`Remove “${entry.movies.title}” from this watchlist?`)) return;
    const rows = checked(await db.from("group_movies").delete().eq("id",entry.id).select("id"));
    if (!rows.length) throw new Error("You do not have permission to remove this movie.");
    await loadMovies(); render(); closeModal(); toast("Removed from watchlist.");
  });
}
async function loadGroups() {
  state.personalGroup = checked(await db.rpc("mojo_personal_list"));
  state.groups = checked(await db.rpc("get_user_groups_with_counts", { uid: state.user.id })) || [];
  const saved = localStorage.getItem(`mojo-group-${state.user.id}`);
  state.group =
    state.groups.find((g) => g.group_id === (state.group?.group_id || saved)) ||
    state.groups.find((g) => g.group_id === state.personalGroup) ||
    state.groups[0] ||
    null;
  await loadMovies();
}
async function loadMovies() {
  if (!state.group) { state.movies=[]; state.contributors={}; return; }
  const [movieRows, contributorRows, ratingRows, completedRows, groupRatingRows] = await Promise.all([
    db.from("group_movies").select("id,watched,watched_at,dnf,dnf_at,added_by,added_at,suggestion_note,movies(id,title,description,poster_url,release_year,tmdb_id)").eq("group_id",state.group.group_id).order("added_at",{ascending:false}),
    db.rpc("mojo_group_contributors",{target_group:state.group.group_id}),
    db.from("movie_ratings").select("movie_id,stars").eq("user_id",state.user.id),
    db.rpc("mojo_completed_movies"),
    db.rpc("mojo_group_ratings",{target_group:state.group.group_id})
  ]);
  state.groupRatings=Object.fromEntries((checked(groupRatingRows) || []).map(movie=>[movie.movie_id,movie]));
  state.completedMovies=(checked(completedRows) || []).map(movie=>movie.movie_id);
  state.personalRatings=Object.fromEntries((checked(ratingRows) || []).map(rating=>[rating.movie_id,rating.stars]));
  state.movies = (checked(movieRows) || []).filter(m=>m.movies);
  state.contributors = Object.fromEntries((checked(contributorRows) || []).map(p=>[p.user_id,p.display_name]));
}

async function switchGroup(id) {
  state.group = state.groups.find((g) => g.group_id === id);
  localStorage.setItem(`mojo-group-${state.user.id}`, id);
  await loadMovies();
  render();
}
let renderedPage;
function render() {
  updateAccountControl();
  if (state.mfaRequired) { renderMfaLogin(); return; }
  scrollRevealObserver?.disconnect();
  if (renderedPage !== state.tab) {
    app.getAnimations().forEach(animation => animation.cancel());
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      app.animate([{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"none"}], {duration:420,easing:"cubic-bezier(.2,.7,.2,1)"});
    renderedPage = state.tab;
  }
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  if (!state.user) {
    auth();
    return;
  }
  if (!state.approved) {
    app.innerHTML = `<div class="auth"><p class="eyebrow">You're on the guest list</p><h1>Almost movie time.</h1><p class="subtitle">Verify your email before opening your watchlists. Check your inbox for the confirmation link, then sign in again.</p><button id="approval-refresh" class="button full">Check verification</button><button id="logout" class="button secondary full">Sign out</button></div>`;
    $("#approval-refresh").onclick = (e) =>
      run(e.currentTarget, () => initialize(state.user));
    $("#logout").onclick = logout;
    return;
  }
  (
    ({
      watchlist: watchlist,
      discover: discover,
      groups: groups,
      friends: friends,
      profile: profile,
    })[state.tab] || watchlist
  )();
}
function go(tab) {
  closeModal();state.friendProfile=null;
  state.tab = tab;
  location.hash = tab;
  render();
  window.scrollTo({ top: 0 });
}
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => (b.onclick = () => go(b.dataset.tab)));
$("#account-button").onclick = () => {
  if (state.user && !state.mfaRequired) {
    if(state.tab === "profile") settingsMenu(); else go("profile");
  }
};
window.addEventListener("hashchange", () => {
  const tab = location.hash.slice(1);
  if (
    ["watchlist", "discover", "groups", "friends", "profile"].includes(tab) &&
    tab !== state.tab
  ) {
    closeModal();state.friendProfile=null;
    state.tab = tab;
    render();
  }
});
const inviteFromURL = new URL(location.href).searchParams.get("invite");
if (inviteFromURL && /^[0-9a-f-]{36}$/i.test(inviteFromURL)) {
  localStorage.setItem("mojo-pending-invite", inviteFromURL);
  localStorage.removeItem("mojo-dismissed-invite");
}
function pendingInvite() {
  return localStorage.getItem("mojo-pending-invite");
}
async function handleInvite() {
  const code = pendingInvite() || state.user?.user_metadata?.mojo_invite;
  if (!code || (!pendingInvite() && localStorage.getItem("mojo-dismissed-invite") === code)) return;
  const automatic = state.user?.user_metadata?.mojo_invite === code;
  const clear = async () => {
    modalDismissAction = null;
    localStorage.setItem("mojo-dismissed-invite", code);
    localStorage.removeItem("mojo-pending-invite");
    const url = new URL(location.href);
    url.searchParams.delete("invite");
    history.replaceState(null, "", url);
    if (state.user?.user_metadata?.mojo_invite) {
      checked(await db.auth.updateUser({ data: { mojo_invite: null } }));
      state.user.user_metadata.mojo_invite = null;
    }
  };
  const valid = checked(await db.rpc("mojo_invite_valid", {invite_code:code}));
  if (!valid) { await clear(); toast("This invite is no longer available. Ask for a new link."); return; }
  const join = async () => {
    const groupId = checked(await db.rpc("mojo_accept_invite", { invite_code: code }));
    await clear();
    await loadGroups();
    await switchGroup(groupId);
    closeModal();
    go("watchlist");
    toast("Your group watchlist is ready.");
  };
  if (automatic) {
    try {
      await join();
    } catch (e) {
      toast(e.message);
      await clear();
    }
    return;
  }
  openModal(
    '<h2>You’re invited to a movie group.</h2><p>Join this group to share its watchlist with the people in it.</p><button id="accept-link" class="button">Join group</button><button id="dismiss-link" class="button secondary">Not now</button>',
  );
  modalDismissAction = clear;
  $("#accept-link").onclick = (e) => run(e.currentTarget, async () => {
    try { await join(); } catch (error) {
      if (checked(await db.rpc("mojo_invite_valid", {invite_code:code})) === false) { await clear(); closeModal(); }
      throw error;
    }
  });
  $("#dismiss-link").onclick = async () => {
    await clear();
    closeModal();
  };
}
function auth(signup = false) {
  $("#navigation").hidden = true;
  app.innerHTML = `<section class="auth"><p class="eyebrow">Good movies. Better company.</p><h1>${signup ? "Join the movie night." : "Your next movie night starts here."}</h1><p class="subtitle">${pendingInvite() ? "You’ve been invited. Sign in or create an account and verify your email to join." : "Find something worth watching. Save it with your people."}</p><form id="auth-form"><div><label for="email">Email address</label><input id="email" type="email" autocomplete="email" required></div><div><label for="password">Password</label><input id="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required></div><label class="checkbox"><input id="keep-signed-in" type="checkbox" ${keepSignedIn ? "checked" : ""}> Keep me signed in on this device</label><p class="muted">Leave unchecked on shared devices. Unchecked sessions last for this browser tab; your browser may restore them when restoring tabs.</p><button class="button" type="submit">${signup ? "Create account" : "Sign in"} →</button></form><p class="auth-switch muted">${signup ? "Already have an account?" : "New to Movie Mojo?"} <button class="link-button" id="auth-switch">${signup ? "Sign in" : "Create account"}</button></p>${signup ? '<p class="muted">Verify your email to get started. Your watchlists stay private to their members.</p>' : '<button class="link-button" id="reset-password">Forgot password?</button>'}${movieCredits()}</section>`;
  $("#auth-switch").onclick = () => auth(!signup);
  $("#auth-form").onsubmit = (e) => {
    e.preventDefault();
    run($("#auth-form button"), async () => {
      const credentials = {
        email: $("#email").value.trim(),
        password: $("#password").value,
      };
      chooseSessionStorage($("#keep-signed-in").checked);
      checked(
        signup
          ? await db.auth.signUp({
              ...credentials,
              options: {
                emailRedirectTo: location.origin + location.pathname,
                data: pendingInvite() ? { mojo_invite: pendingInvite() } : {},
              },
            })
          : await db.auth.signInWithPassword(credentials),
      );
      if (signup)
        toast("Check your email and confirm your address to start watching.");
    });
  };
  if (!signup)
    $("#reset-password").onclick = (e) =>
      run(e.currentTarget, async () => {
        const email = $("#email").value.trim();
        if (!email) throw new Error("Enter your email address first.");
        checked(
          await db.auth.resetPasswordForEmail(email, {
            redirectTo: location.origin + location.pathname,
          }),
        );
        toast("Check your email for a password reset link.");
      });
}
const watchMetadata = new Map();
function sortedWatchEntries(entries, key = state.watchSort, reverse = state.watchReverse) {
  if(key === "added") return reverse ? [...entries].reverse() : entries;
  const value = entry => {
    const movie = entry.movies, metadata = watchMetadata.get(String(movie.tmdb_id));
    if(key === "name") return movie.title;
    if(key === "date") return metadata?.release_date || (movie.release_year ? String(movie.release_year) : null);
    if(key === "rating") return metadata?.vote_count > 0 ? metadata.vote_average : null;

  };
  return [...entries].sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(av==null && bv==null) return a.movies.title.localeCompare(b.movies.title);
    if(av==null) return 1;
    if(bv==null) return -1;
    const order=key === "rating" ? bv-av : String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"});
    return (reverse ? -order : order) || a.movies.title.localeCompare(b.movies.title);
  });
}
async function loadWatchMetadata(movies = state.movies.map(entry=>entry.movies)) {
      const ids=[...new Set(movies.map(movie=>movie.tmdb_id).filter(id=>id && !watchMetadata.has(String(id))))];
      for(let i=0;i<ids.length;i+=50) {
        const data=await tmdb("movies/metadata",{ids:ids.slice(i,i+50).join(",")});
        data.results.forEach(movie=>watchMetadata.set(String(movie.id),movie));
      }
}
function watchSortMenu() {
  openModal(`<details class="movie-options-section" open><summary>Sort</summary><div class="watch-sort-options">${[["added","Recently added"],["name","Name"],["date","Release date"],["rating","TMDB rating"]].map(([key,label])=>`<button class="button ${state.watchSort===key ? "" : "secondary"}" data-watch-sort="${key}" aria-pressed="${state.watchSort===key}">${label}</button>`).join("")}</div><p class="muted">Unknown dates and ratings appear last.</p></details><details class="movie-options-section"><summary>Filter</summary><p class="muted">Genre</p><div class="watch-genre-options">${[["","All genres"],...genres].map(([id,name])=>`<button class="button ${String(id)===state.watchGenre ? "" : "secondary"}" data-watch-genre="${id}" aria-pressed="${String(id)===state.watchGenre}">${esc(name)}</button>`).join("")}</div></details>`);
  modal.querySelectorAll("[data-watch-sort]").forEach(button=>button.onclick=()=>run(button,async()=>{
    const key=button.dataset.watchSort;
    if(["date","rating"].includes(key)) {
      await loadWatchMetadata();
    }
    state.watchSort=key; state.watchReverse=false;
    watchlist(); closeModal();
  }));
  modal.querySelectorAll("[data-watch-genre]").forEach(button=>button.onclick=()=>run(button,async()=>{
    if(button.dataset.watchGenre) await loadWatchMetadata();
    state.watchGenre=button.dataset.watchGenre;
    watchlist(); closeModal();
  }));
}
function watchlist() {
  const previousPills = app.querySelector(".pills");
  const entries = sortedWatchEntries(state.movies.filter((m) => (state.dnf ? !!m.dnf : !m.dnf && !!m.watched === state.watched) && (!state.watchGenre || watchMetadata.get(String(m.movies.tmdb_id))?.genres?.some(g=>String(g.id)===state.watchGenre))));
  app.innerHTML = `<p class="eyebrow">Your movie night, sorted</p><h1>The watchlist.</h1><p class="subtitle">Less scrolling. More watching.</p><div class="toolbar"><select id="group-select" class="group-select" aria-label="Choose watchlist">${state.groups.map((g) => `<option value="${esc(g.group_id)}" ${g.group_id === state.group?.group_id ? "selected" : ""}>${esc(g.group_name)}</option>`).join("") || "<option>No watchlists yet</option>"}</select><button id="add-movie" class="button secondary">Find a movie</button></div><section class="picker-hero"><div><p class="eyebrow">Let fate take the remote</p><h2>Can't decide tonight?</h2><p>One random pick from your unwatched movies.<br>Every movie gets an equal shot.</p></div><button class="button" id="pick">✦ Pick tonight</button></section><div class="section-row"><div class="pills"><button class="pill ${!state.watched && !state.dnf ? "active" : ""}" id="unwatched">To watch</button><button class="pill ${state.watched && !state.dnf ? "active" : ""}" id="watched">Watched</button><button class="pill ${state.dnf ? "active" : ""}" id="dnf" title="Did not finish" aria-label="Did not finish movies">DNF</button></div><div class="watch-sort-controls"><button id="watch-sort" class="button secondary ${state.watchGenre || state.watchSort!=="added" ? "options-active" : ""}" aria-label="Sort and filter movies" title="Sort and filter movies"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg></button><button id="watch-reverse" class="button secondary" aria-label="Reverse sort order" aria-pressed="${state.watchReverse}" title="Reverse sort order"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16m-4-4 4 4 4-4M17 20V4m-4 4 4-4 4 4"/></svg></button><span class="count">${entries.length} movie${entries.length === 1 ? "" : "s"}</span></div></div><div class="grid">${entries.map((m, i) => card(m.movies, i, m)).join("") || empty(state.watchGenre ? "No movies in this genre." : state.group ? "The opening scene." : "Bring your people together.", state.watchGenre ? "Choose All genres to see your full list." : state.group ? "Add a few movies to get your next movie night started." : "Create a group, or a watchlist just for you.", state.watchGenre ? '<button id="clear-watch-genre" class="button">Clear genre filter</button>' : `<button id="empty-action" class="button">${state.group ? "Find a movie" : "Create a watchlist"}</button>`)}</div>`;
  if (previousPills) {
    app.querySelector(".pills").replaceWith(previousPills);
    previousPills.querySelector("#unwatched").classList.toggle("active", !state.watched && !state.dnf);
    previousPills.querySelector("#watched").classList.toggle("active", state.watched && !state.dnf);
    previousPills.querySelector("#dnf").classList.toggle("active",state.dnf);
  }
  $("#watch-sort").onclick = watchSortMenu;
  $("#watch-reverse").onclick = () => { state.watchReverse=!state.watchReverse; watchlist(); };
  $("#group-select").onchange = (e) =>
    run(e.currentTarget, () => switchGroup(e.target.value));
  $("#add-movie").onclick = () => go("discover");
  $("#unwatched").onclick = () => {
    state.watched = false; state.dnf=false;
    watchlist();
  };
  $("#watched").onclick = () => {
    state.watched = true; state.dnf=false;
    watchlist();
  };
  $("#dnf").onclick=()=>{state.dnf=true;state.watched=false;watchlist();};
  $("#pick").onclick = pick;
  $(".picker-hero").hidden = !state.movies.some(movie => !movie.watched && !movie.dnf);
  if ($("#empty-action"))
    $("#empty-action").onclick = () => go(state.group ? "discover" : "groups");
  if ($("#clear-watch-genre")) $("#clear-watch-genre").onclick = () => { state.watchGenre=""; watchlist(); };
  bindCards(entries, true);
}
function randomIndex(length) {
  const limit = 4294967296 - (4294967296 % length);
  const n = new Uint32Array(1);
  do {
    crypto.getRandomValues(n);
  } while (n[0] >= limit);
  return n[0] % length;
}
function pick() {
  const candidates = state.movies.filter((m) => !m.watched && !m.dnf);
  if (!candidates.length) {
    toast("Add an unwatched movie to this list first.");
    return;
  }
  const chosen = candidates[randomIndex(candidates.length)],
    m = chosen.movies;
  openModal(
    `<div class="picked"><p class="eyebrow">Tonight's feature presentation</p>${m.poster_url ? `<img class="detail-poster" src="${esc(m.poster_url)}" alt="${esc(m.title)} poster">` : '<div class="poster-fallback">✦</div>'}<h2>${esc(m.title)}</h2><p class="muted">${esc(m.release_year || "")} · Picked from ${candidates.length} unwatched movies</p><div class="details-actions"><button class="button" id="picked-detail">Movie details</button><button class="button secondary" id="pick-again">✦ Pick again</button><button class="button secondary" id="picked-watched">Mark watched</button></div></div>`,
  );
  $("#pick-again").onclick = pick;
  $("#picked-detail").onclick = (e) =>
    run(e.currentTarget, () => details(m, chosen));
  $("#picked-watched").onclick=()=>completionDialog(chosen,"watched");
}
const genres = [
  [28, "Action"],
  [12, "Adventure"],
  [16, "Animation"],
  [35, "Comedy"],
  [80, "Crime"],
  [99, "Documentary"],
  [18, "Drama"],
  [10751, "Family"],
  [14, "Fantasy"],
  [36, "History"],
  [27, "Horror"],
  [10402, "Music"],
  [9648, "Mystery"],
  [10749, "Romance"],
  [878, "Science fiction"],
  [53, "Thriller"],
  [10752, "War"],
  [37, "Western"],
];
function select(name, label, options) {
  return `<div><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([v, l]) => `<option value="${v}" ${String(state.filters[name] || "") === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
}
const moodShortcuts = [
  { label: "Trending Now", description: "Movies getting attention this week · ranked by current interest", filters: { trending: true } },
  { label: "Recent Releases", description: "Released in the past year · newest first · at least 20 votes", filters: { recentRelease: true, "vote_count.gte": "20", "with_runtime.gte": "40", sort_by: "primary_release_date.desc" } },
  { label: "Highly rated", description: "Rated 7.5+ with at least 500 votes · highest rated first", filters: { "vote_average.gte": "7.5", "vote_count.gte": "500", "with_runtime.gte": "40", sort_by: "vote_average.desc" } },
  { label: "Make me laugh", description: "Comedies rated 6+ · excludes horror", filters: { with_genres: "35", without_genres: "27", "vote_average.gte": "6", "with_runtime.gte": "40" } },
  { label: "Keep me guessing", description: "Mysteries and thrillers rated 6.5+", filters: { with_genres: "53|9648", "vote_average.gte": "6.5", "with_runtime.gte": "40" } },
  { label: "Family night", description: "Family and animated movies rated 6+ · excludes horror · check age ratings before watching", filters: { with_genres: "10751|16", without_genres: "27", "vote_average.gte": "6", "with_runtime.gte": "40" } },
  { label: "Out of this world", description: "Science fiction and fantasy rated 6.5+", filters: { with_genres: "878|14", "vote_average.gte": "6.5", "with_runtime.gte": "40" } },
  { label: "Under 90 minutes", description: "Feature-length movies from 40–90 minutes, rated 6+", filters: { "with_runtime.gte": "40", "with_runtime.lte": "90", "vote_average.gte": "6" } },
  { label: "Give me chills", description: "Horror movies rated 6+", filters: { with_genres: "27", "vote_average.gte": "6", "with_runtime.gte": "40" } },
  { label: "Get my heart racing", description: "Action movies rated 6.5+", filters: { with_genres: "28", "vote_average.gte": "6.5", "with_runtime.gte": "40" } },
  { label: "Sweep me away", description: "Romance movies rated 6.5+", filters: { with_genres: "10749", "vote_average.gte": "6.5", "with_runtime.gte": "40" } },
];
function updateMoodControls() {
  const mood = moodShortcuts.find((m) => m.label === state.filters.mood);
  app.querySelectorAll("[data-mood]").forEach((button) => {
    const active = mood?.label === moodShortcuts[Number(button.dataset.mood)].label;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#mood-description").textContent = mood ? mood.description + " · Your services and availability choice still apply. Tap again to clear." : "";
  $("#mood-description").hidden = !mood;
  const genre = $("#with_genres");
  genre.querySelector('[data-mood-option]')?.remove();
  if (state.filters.with_genres?.includes("|")) {
    const option = new Option(mood?.label || "Mood selection", state.filters.with_genres);
    option.dataset.moodOption = "true";
    genre.add(option);
  }
  for (const select of $("#filter-form").querySelectorAll("select[name]"))
    select.value = state.filters[select.name] || (select.name === "watch_region" ? state.streamingRegion : select.name === "sort_by" ? "popularity.desc" : "");
  $("#year-from").value = state.filters.yearFrom || "";
  $("#year-to").value = state.filters.yearTo || "";
}
function discover() {
  app.innerHTML = `<p class="eyebrow">A little inspiration</p><h1>Find your next favorite.</h1><p class="subtitle">Follow a mood. Explore a genre. See what catches your eye.</p><div class="mood-shortcuts" aria-label="Movie mood shortcuts">${moodShortcuts.map((m, i) => `<button class="mood-chip ${state.filters.mood === m.label ? "active" : ""}" aria-pressed="${state.filters.mood === m.label}" type="button" data-mood="${i}">${m.label}</button>`).join("")}</div><p class="mood-scroll-hint">More moods → Scroll sideways</p><p id="mood-description" class="muted" hidden></p><form id="search-form" class="search-row"><input name="query" id="query" type="search" placeholder="Search movie titles…" aria-label="Movie title" value="${esc(state.query)}"><button class="button" type="submit">Search</button></form><details class="filters"><summary>Browse by filters</summary><form id="filter-form"><p class="muted">Filters browse the movie catalog. Title search runs separately.</p><div class="filter-grid">${select("with_genres", "Genre", [["", "All genres"], ...genres])}<fieldset class="release-years"><legend>Release year</legend><div class="year-range"><div><label for="year-from">From</label><input id="year-from" name="yearFrom" type="number" min="1874" max="2100" placeholder="Any" inputmode="numeric" value="${esc(state.filters.yearFrom || "")}"></div><span aria-hidden="true">–</span><div><label for="year-to">To</label><input id="year-to" name="yearTo" type="number" min="1874" max="2100" placeholder="Any" inputmode="numeric" value="${esc(state.filters.yearTo || "")}"></div></div></fieldset>${select(
    "vote_average.gte",
    "Minimum audience score",
    [
      ["", "Any score"],
      [6, "6+ / 10"],
      [6.5, "6.5+ / 10"],
      [7, "7+ / 10"],
      [7.5, "7.5+ / 10"],
      [8, "8+ / 10"],
    ],
  )}${select("sort_by", "Sort by", [
    ["popularity.desc", "Popular"],
    ["vote_average.desc", "Highest rated"],
    ["primary_release_date.desc", "Newest releases"],
  ])}<div class="streaming-filter"><label>Streaming services</label><div id="discovery-services"></div></div></div><details class="advanced-filters"><summary>Advanced filters</summary><div class="filter-grid"><div class="cast-filter"><label for="cast-search">Actor / actress</label><div id="cast-picker"></div></div>${select("with_runtime.lte", "Runtime", [
    ["", "Any length"],
    [90, "Under 90 minutes"],
    [120, "Under 2 hours"],
    [150, "Under 2½ hours"],
  ])}${select("watch_region", "Country", [
    ["US", "United States"],
    ["GB", "United Kingdom"],
    ["CA", "Canada"],
    ["AU", "Australia"],
  ])}</div></details><label class="checkbox"><input type="checkbox" id="hide-watched" ${state.filters.hideWatched ? "checked" : ""}> Hide movies watched by this group</label><div class="filter-actions"><button class="button" type="submit">Find movies →</button><button class="button secondary" id="reset-filters" type="button">Reset</button></div></form></details><div class="section-row"><h2 id="results-title">${state.mode === "search" ? "Search results" : state.filters.trending ? "Trending this week" : "Your next obsession"}</h2><span class="count">${state.group ? esc(state.group.group_name) : "Choose a group to save movies"}</span></div><div class="availability-switch" role="group" aria-label="Movie availability"><button type="button" data-availability="all" aria-pressed="${state.viewingMode === "all"}">All</button><button type="button" data-availability="streaming" aria-pressed="${state.viewingMode === "streaming"}">Streaming</button><button type="button" data-availability="buy-rent" aria-pressed="${state.viewingMode === "buy-rent"}">Buy/Rent</button></div><p id="availability-hint" class="muted" hidden>Title search shows all matches. Choose an availability option to return to browsing.</p><div id="results" class="grid"></div><button class="button secondary full" id="load-more" hidden>Load more movies</button><div class="manual"><button id="manual-add" class="link-button">Can't find it? Add a movie manually</button></div>`;
  $("#results-title").parentElement.querySelector(".count").outerHTML = `<select id="discover-watchlist" class="discover-list-select" aria-label="Current Discover watchlist">${state.groups.map(group=>`<option value="${esc(group.group_id)}" ${group.group_id===state.group?.group_id ? "selected" : ""}>${esc(group.group_name)}</option>`).join("")}</select>`;
  $("#discover-watchlist").onchange = e => run(e.currentTarget,()=>switchGroup(e.target.value));
  app.querySelectorAll("[data-availability]").forEach((button) => {
    button.onclick = () => {
      state.viewingMode = button.dataset.availability;
      state.mode = "discover";
      state.query = "";
      $("#query").value = "";
      app.querySelectorAll("[data-availability]").forEach((option) =>
        option.setAttribute("aria-pressed", String(option.dataset.availability === state.viewingMode)),
      );
      fetchDiscover();
    };
  });
  $("#manual-add").onclick = manualAdd;
  app.querySelectorAll("[data-mood]").forEach(
    (button) =>
      (button.onclick = () => {
        const mood = moodShortcuts[Number(button.dataset.mood)];
        const clear = state.filters.mood === mood.label;
        state.filters = {
          watch_region: state.filters.watch_region || state.streamingRegion,
          castPeople: state.filters.castPeople || [],
          castMatch: state.filters.castMatch || "any",
          with_cast: state.filters.with_cast || "",
          providerIds: state.filters.providerIds || [],
          useMyServices: !!state.filters.useMyServices,
          hideWatched: !!state.filters.hideWatched,
          ...(clear ? {} : mood.filters),
          mood: clear ? "" : mood.label,
        };
        state.mode = "discover";
        state.query = "";
        state.page = 1;
        state.results = [];
        $("#query").value = "";
        updateMoodControls();
        $("details.filters").open = false;
        fetchDiscover();
      }),
  );
  $("#search-form").onsubmit = (e) => {
    e.preventDefault();
    state.query = $("#query").value.trim();
    if (!state.query) {
      toast("Enter a movie title.");
      return;
    }
    state.mode = "search";
    state.page = 1;
    fetchDiscover();
  };
  bindCastPicker();
  $("#filter-form").onsubmit = (e) => {
    e.preventDefault();
    if (!$("#discovery-services .service-picker")) {
      toast("Wait for streaming services to load before applying filters.");
      return;
    }
    const data = Object.fromEntries(new FormData(e.target));
    if (
      data.yearFrom &&
      data.yearTo &&
      Number(data.yearFrom) > Number(data.yearTo)
    ) {
      toast("The first release year must be no later than the last.");
      return;
    }
    const providerIds = new FormData(e.target)
      .getAll("discovery-provider")
      .map(Number);
    const useMyServices = !!$("#use-my-services")?.checked;
    if (useMyServices && !state.streamingServices.length) {
      toast("Add your streaming services in Profile first.");
      return;
    }
    delete data["discovery-provider"];
    delete data["provider-search"];
    state.filters = {
      ...data,
      castPeople: castSelection.slice(),
      castMatch: $("#cast-match").value,
      with_cast: castSelection.map(person=>person.id).join($("#cast-match").value==="all" ? "," : "|"),
      providerIds,
      useMyServices,
      hideWatched: $("#hide-watched").checked,
    };
    state.mode = "discover";
    state.query = "";
    $("#query").value = "";
    state.page = 1;
    updateMoodControls();
    fetchDiscover();
  };
  $("#reset-filters").onclick = () => {
    state.filters = {};
    state.query = "";
    state.mode = "discover";
    state.page = 1;
    state.results = [];
    discover();
  };
  $("#load-more").onclick = (e) =>
    run(e.currentTarget, () => fetchDiscover(true));
  $("#watch_region").value =
    state.filters.watch_region || state.streamingRegion;
  $("#watch_region").onchange = () =>
    loadProviders($("#watch_region").value, "discovery-services", [], false);
  loadProviders(
    state.filters.watch_region || state.streamingRegion,
    "discovery-services",
    state.filters.providerIds || [],
    state.filters.useMyServices,
  );
  updateMoodControls();
  if (state.results.length) renderResults();
  else fetchDiscover();
}
// Major service families. Plan and channel variants share one selection.
const serviceFamilies = [
  ["Netflix", /^netflix\b/i],
  ["Amazon Prime Video", /^(amazon )?prime video\b/i],
  ["Disney+", /^disney(\+| plus)/i],
  ["Hulu", /^hulu\b/i],
  ["HBO Max", /^(hbo max|hbo|\bmax\b)/i],
  ["Apple TV+", /^apple tv (plus|\+)|^apple tv\+|^apple tv$/i],
  ["Paramount+", /^paramount(\+| plus)/i],
  ["Peacock", /^peacock\b/i],
  ["Tubi", /^tubi\b/i],
  ["The Roku Channel", /^(the )?roku channel\b/i],
  ["Pluto TV", /^pluto tv\b/i],
  ["Discovery+", /^discovery(\+| plus)/i],
  ["Starz", /^starz(play)?\b/i],
  ["Showtime", /^showtime\b/i],
  ["AMC+", /^amc(\+| plus)/i],
  ["BritBox", /^britbox\b/i],
  ["Acorn TV", /^acorn tv\b/i],
  ["Criterion Channel", /^(the )?criterion channel\b/i],
  ["MUBI", /^mubi\b/i],
  ["Shudder", /^shudder\b/i],
  ["Crunchyroll", /^crunchyroll\b/i],
  ["MGM+", /^(mgm(\+| plus)|epix)\b|^mgm\+/i],
  ["PBS", /^pbs\b/i],
  ["Hallmark+", /^hallmark\b/i],
  ["CuriosityStream", /^curiosity\s?stream\b/i],
  ["NOW", /^now( tv| cinema| entertainment)?$/i],
  ["ITVX", /^itvx\b/i],
  ["BBC iPlayer", /^bbc iplayer\b/i],
  ["Channel 4", /^(channel 4|all 4)\b/i],
  ["BFI Player", /^bfi player\b/i],
  ["Stan", /^stan\b/i],
  ["Crave", /^crave\b/i],
];
function serviceIdentity(provider) {
  const family = serviceFamilies.find(([, pattern]) =>
    pattern.test(provider.provider_name),
  );
  if (family) return family[0];
  return provider.provider_name
    .replace(
      /\s+(amazon channel|amazon channels|apple tv channel|apple tv channels|roku premium channel|with ads|with advertisement|ad-supported|ad supported|premium|standard)$/gi,
      "",
    )
    .trim();
}
function groupedProviders(providers, includeAll = false) {
  const groups = new Map();
  for (const provider of providers) {
    const identity = serviceIdentity(provider);
    const key = identity.toLowerCase();
    if (!groups.has(key))
      groups.set(key, {
        ...provider,
        provider_name: identity,
        variantIds: [],
        searchNames: [],
      });
    const group = groups.get(key);
    group.variantIds.push(provider.provider_id);
    group.searchNames.push(provider.provider_name.toLowerCase());
  }
  const major = serviceFamilies
    .map(([name]) => groups.get(name.toLowerCase()))
    .filter(Boolean);
  if (!includeAll) return major.slice(0, 25);
  const majorNames = new Set(major.map((p) => p.provider_name.toLowerCase()));
  return [
    ...major,
    ...[...groups.values()]
      .filter((p) => !majorNames.has(p.provider_name.toLowerCase()))
      .sort((a, b) => a.provider_name.localeCompare(b.provider_name)),
  ];
}
async function providersForRegion(region) {
  if (!providerCache.has(region)) {
    const data = await tmdb("watch/providers/movie", {
      watch_region: region === "all" ? "" : region,
    });
    providerCache.set(region, data.results);
  }
  return providerCache.get(region);
}
async function expandServiceIds(ids, region) {
  if (!ids.length) return [];
  const selected = new Set(ids.map(Number));
  const providers = await providersForRegion("all");
  for (const group of groupedProviders(providers, true)) {
    if (group.variantIds.some((id) => selected.has(id)))
      group.variantIds.forEach((id) => selected.add(id));
  }
  return [...selected];
}
const providerCache = new Map();
async function loadProviders(region, target, selected = [], useMy = false) {
  const host = $("#" + target);
  if (!host) return;
  const token = Symbol();
  host.requestToken = token;
  host.innerHTML = '<p class="muted">Loading services…</p>';
  const isDiscovery = target === "discovery-services";
  try {
    const regionalProviders = await providersForRegion(region);
    const providers = groupedProviders(regionalProviders, true);
    const defaultIds = new Set(
      groupedProviders(regionalProviders).map((p) => p.provider_id),
    );
    if (!host.isConnected || host.requestToken !== token) return;
    const name = isDiscovery ? "discovery-provider" : "profile-provider";
    const selectedSet = new Set(selected.map(Number));
    const catalog = await providersForRegion("all");
    if (!host.isConnected || host.requestToken !== token) return;
    const selectedFamilies = new Set(
      catalog
        .filter((p) => selectedSet.has(p.provider_id))
        .map((p) => serviceIdentity(p).toLowerCase()),
    );
    const savedServiceIds=new Set(state.streamingServices.map(Number));
    const savedFamilies=new Set(catalog.filter(provider=>savedServiceIds.has(provider.provider_id)).map(provider=>serviceIdentity(provider).toLowerCase()));
    host.innerHTML = `<details class="service-picker"><summary><span class="service-summary">${isDiscovery ? "Any streaming service" : "Choose your services"}</span></summary><div class="service-options">${isDiscovery ? `<label class="service-option my-services"><input id="use-my-services" type="checkbox" ${useMy && state.streamingServices.length ? "checked" : ""} ${!state.streamingServices.length ? "disabled" : ""}><span>My streaming services<small>${state.streamingServices.length ? state.streamingServices.length + " saved in Settings" : "Configure your services in Settings first"}</small></span></label>${!state.streamingServices.length ? '<a href="#profile" class="configure-services">Set up streaming services</a>' : ""}` : ""}<input class="provider-search" type="search" placeholder="Find a service…" aria-label="Find a streaming service"><div class="provider-list-options">${providers.map((p) => `<label class="service-option" data-provider-name="${esc(p.provider_name.toLowerCase())}" data-search-names="${esc(p.provider_name.toLowerCase() + " " + p.searchNames.join(" "))}" data-default="${defaultIds.has(p.provider_id)}"><input type="checkbox" name="${name}" value="${p.provider_id}" ${p.variantIds.some((id) => selectedSet.has(id)) || selectedFamilies.has(p.provider_name.toLowerCase()) ? "checked" : ""}>${p.logo_path ? `<img src="${image(p.logo_path)}" alt="" loading="lazy">` : ""}<span>${esc(p.provider_name)}</span></label>`).join("")}</div><p class="provider-empty muted" hidden>No services match that name.</p></div></details>`;
    const setupLink=host.querySelector(".configure-services");
    if(setupLink) setupLink.onclick=e=>{e.preventDefault(); streamingSettings();};
    const updateSummary = () => {
      const count = host.querySelectorAll(
        `input[name="${name}"]:checked:enabled`,
      ).length;
      const mine = !!$("#use-my-services", host)?.checked;
      $(".service-summary", host).textContent = mine
        ? `My services${count ? " + " + count + " more" : ""}`
        : count
          ? `${count} service${count === 1 ? "" : "s"} selected`
          : isDiscovery
            ? "Any streaming service"
            : "Choose your services";
    };
    host.addEventListener("change", updateSummary, {
      signal: createPickerSignal(host),
    });
    updateSummary();
    const filterRows = () => {
      const e = { target: $(".provider-search", host) };
      const query = e.target.value.trim().toLowerCase();
      let visible = 0;
      const mine=!!$("#use-my-services",host)?.checked;
      host.querySelectorAll("[data-provider-name]").forEach((row) => {
        const included=mine && savedFamilies.has(row.dataset.providerName);
        $("input",row).disabled=included;
        row.hidden = included || (query
          ? !row.dataset.searchNames.includes(query)
          : row.dataset.default !== "true" && !$("input", row).checked);
        if (!row.hidden) visible++;
      });
      $(".provider-empty", host).hidden = visible > 0;
      $(".provider-empty", host).textContent=mine ? "No additional services match. Your saved services are already included." : "No services match that name.";
      updateSummary();
    };
    $(".provider-search", host).oninput = filterRows;
    host.addEventListener("change", filterRows, {
      signal: host.pickerController.signal,
    });
    filterRows();
  } catch (e) {
    if (!host.isConnected || host.requestToken !== token) return;
    host.innerHTML =
      '<p class="muted">Could not load services.</p><button type="button" class="link-button">Try again</button>';
    $("button", host).onclick = () =>
      loadProviders(region, target, selected, useMy);
  }
}
function createPickerSignal(host) {
  host.pickerController?.abort();
  host.pickerController = new AbortController();
  return host.pickerController.signal;
}
async function fetchDiscover(append = false) {
  let published = false;
  const request = ++state.request;
  const nextPage = append ? state.page + 1 : 1;
  const results = $("#results");
  if (!append)
    results.innerHTML = '<div class="discovery-loading" role="status"><span class="loading-orbit" aria-hidden="true"></span><p>Finding your next watch</p><span class="muted">Checking movies and viewing options…</span></div>';
  try {
    const f = state.filters;
    if (
      state.mode !== "search" &&
      f.useMyServices &&
      !state.streamingServices.length
    )
      throw new Error(
        "Add streaming services in Profile, or turn off My streaming services.",
      );
    const selectedServiceIds = [
      ...new Set([
        ...(f.providerIds || []),
        ...(f.useMyServices ? state.streamingServices : []),
      ]),
    ];
    const providerIds =
      state.mode === "search"
        ? []
        : await expandServiceIds(
            selectedServiceIds,
            f.watch_region || state.streamingRegion,
          );
    const params =
      state.mode === "search"
        ? { query: state.query }
        : {
            ...f,
            sort_by: f.sort_by || "popularity.desc",
            "vote_count.gte": f["vote_count.gte"] || 100,
            "primary_release_date.gte": f.recentRelease
              ? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
              : f.yearFrom ? `${f.yearFrom}-01-01` : "",
            "primary_release_date.lte": f.yearTo
              ? `${f.yearTo}-12-31`
              : new Date().toISOString().slice(0, 10),
            with_watch_providers: providerIds.join("|"),
            with_watch_monetization_types: state.viewingMode === "buy-rent"
              ? "rent|buy"
              : state.viewingMode === "all" ? "" : "flatrate|free|ads",
            watch_region: f.watch_region || state.streamingRegion,
          };
    for (const key of [
      "castPeople",
      "castMatch",
      "hideWatched",
      "providerIds",
      "useMyServices",
      "yearFrom",
      "yearTo",
      "mood",
      "recentRelease",
      "trending",
    ])
      delete params[key];
    const data = await tmdb(
      state.mode === "search" ? "search/movie" : f.trending && !f.with_cast ? "trending/movie/week" : "discover/movie",
      f.trending && !f.with_cast && state.mode !== "search" ? {page:nextPage, include_availability:state.viewingMode !== "all" || providerIds.length > 0} : { ...params, page: nextPage, include_adult: false },
    );
    if (request !== state.request || !results.isConnected) return;
    let lastPage = nextPage;
    const totalPages = Math.min(data.total_pages || 1, 500);
    const trending = f.trending && !f.with_cast && state.mode !== "search";
    const types = state.viewingMode === "buy-rent" ? ["rent","buy"] : state.viewingMode === "all" ? ["flatrate","free","ads","rent","buy"] : ["flatrate","free","ads"];
    const selectMovies = async batch => {
      let movies = batch.filter(movie => !movie.adult);
      if (trending && (state.viewingMode !== "all" || providerIds.length)) {
        const available = movies.map(movie => {
          const offers = movie.watch_availability?.[f.watch_region || state.streamingRegion];
          return types.some(type => offers?.[type]?.some(provider => !providerIds.length || providerIds.includes(provider.provider_id)));
        });
        movies = movies.filter((_,i) => available[i]);
      }
      return movies;
    };
    const previous = append ? state.results : [];
    let movies = await selectMovies(data.results);
    if (state.mode === "search") {
      const normalize = title => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
      const query = normalize(state.query);
      movies = movies.filter(movie=>/^\d{4}-\d{2}-\d{2}$/.test(movie.release_date || "") && !/soundtrack|original score/i.test(movie.title || ""));
      movies.sort((a,b)=>Number(normalize(b.title)===query)-Number(normalize(a.title)===query) || (b.vote_count || 0)-(a.vote_count || 0) || (b.popularity || 0)-(a.popularity || 0));
    }

    const publish = () => {
      published = true;
      state.page = lastPage;
      state.total = totalPages;
      state.results = [...previous, ...movies].filter((movie,i,list) => list.findIndex(other=>other.id===movie.id)===i);
      renderResults();
    };
    if (request !== state.request || !results.isConnected) return;
    publish();
  } catch (e) {
    if (request === state.request && results.isConnected) {
      if (!append && !published)
        results.innerHTML = empty(
          "An intermission.",
          e.message,
          '<button id="retry-search" class="button">Try again</button>',
        );
      if ($("#retry-search"))
        $("#retry-search").onclick = () => fetchDiscover();
      else toast(e.message);
    }
  }
}
function renderResults() {
  if ($("#availability-hint")) $("#availability-hint").hidden = state.mode !== "search";
  if ($("#results-title"))
    $("#results-title").textContent =
      state.mode === "search" ? "Search results" : state.filters.trending ? "Trending this week" : "Your next obsession";
  const watched = new Set(
    state.movies.filter((m) => m.watched).map((m) => String(m.movies.tmdb_id)),
  );
  const list = state.results.filter(
    (m) => !state.filters.hideWatched || !watched.has(String(m.id)),
  );
  $("#results").innerHTML =
    list.map((m, i) => card(m, i)).join("") ||
    empty(
      "No matches this time.",
      state.filters.mood
        ? `No ${state.filters.mood.toLowerCase()} matches with your current services and availability. Try All, choose more services, or tap the shortcut again to clear it.`
        : "Try a broader genre, date range, or lower audience score.",
    );
  $("#load-more").hidden = state.page >= state.total;
  bindCards(list);
}
function watchOptions(providers, region) {
  const safeLink = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === "https:" ? u.href : null;
    } catch {
      return null;
    }
  };
  const link = safeLink(providers?.link);
  const categories = [
    ["flatrate", "With a subscription", "Included with a subscription"],
    ["free", "Watch free", "Free"],
    ["ads", "Free with ads", "Ad-supported"],
    ["rent", "Rent", "Check rental price"],
    ["buy", "Buy", "Check purchase price"],
  ];
  const sections = categories
    .filter(([key]) => providers?.[key]?.length)
    .map(
      ([key, label, caption]) =>
        `<section class="watch-options-section"><h3>${label}</h3><div class="watch-offers">${providers[
          key
        ]
          .map((p) => {
            const content = `${p.logo_path ? `<img src="${image(p.logo_path)}" alt="" loading="lazy">` : ""}<span><strong>${esc(p.provider_name)}</strong><small>${caption}${link ? ' · ' + (key === "flatrate" || key === "free" || key === "ads" ? "Stream now" : "View offers") + ' <svg class="offer-link-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>' : ""}</small></span>`;
            return link
              ? `<a class="watch-offer" href="${esc(link)}" target="_blank" rel="noopener" aria-label="View ${esc(p.provider_name)} ${key === "buy" ? "purchase" : key === "rent" ? "rental" : "streaming"} offers for this movie on TMDB">${content}</a>`
              : `<div class="watch-offer">${content}</div>`;
          })
          .join("")}</div></section>`,
    )
    .join("");
  return `<section class="watch-options"><h2>Where to watch</h2><p class="muted">Availability in ${esc(region)} · JustWatch via TMDB</p>${sections || '<p class="muted">No viewing options reported for this country.</p>'}${sections && link ? '<p class="muted">Links open this movie’s TMDB watch page, where you can choose a service. Rental and purchase prices are not supplied here; confirm the current price before paying.</p>' : ""}</section>`;
}
let detailRequest = 0;
async function details(movie, entry = null, source = null, ownHistory = false, friendHistory = null) {
  const request = ++detailRequest;
  modal.classList.add("movie-detail-dialog");
  const initialPoster = movie.poster_url || image(movie.poster_path);
  openModal(`${initialPoster ? `<img class="detail-poster" src="${esc(initialPoster)}" alt="${esc(movie.title)} poster">` : ""}<div class="detail-heading"><p class="eyebrow">${entry ? "On your watchlist" : "Worth a watch"}</p><h2>${esc(movie.title)}</h2><p class="muted">${esc(movie.release_year || movie.release_date?.slice(0,4) || "")}</p></div><p class="overview">${esc(movie.overview || movie.description || "")}</p><p class="muted">Loading trailer and viewing options…</p>`, source);
  let data = movie;
  try { data = await loadMovieDetails(movie); } catch (e) { toast(e.message); }
  if (!modal.open || request !== detailRequest) return;
  const destinationMemberships = entry && state.tab === "discover" ? checked(await db.from("group_movies").select("group_id").eq("movie_id",entry.movies.id)) : [];
  if (!modal.open || request !== detailRequest) return;
  const poster = movie.poster_url || image(data.poster_path);
  const trailer = data.videos?.results?.find(
    (v) => v.site === "YouTube" && v.type === "Trailer",
  );
  const providers =
    data["watch/providers"]?.results?.[
      state.filters.watch_region || state.streamingRegion
    ];
  const region = state.filters.watch_region || state.streamingRegion;
  openModal(
    `${poster ? `<img class="detail-poster" src="${esc(poster)}" alt="${esc(movie.title)} poster">` : ""}<div class="detail-heading"><p class="eyebrow">${entry ? "On your watchlist" : "Worth a watch"}</p><h2>${esc(data.title || movie.title)}</h2><p class="muted">${esc(data.release_date?.slice(0, 4) || movie.release_year || "")} ${data.runtime ? "· " + data.runtime + " min" : ""}</p>${data.vote_average ? `<p>★ ${Number(data.vote_average).toFixed(1)} <span class="muted">TMDB audience score</span></p>` : ""}${trailer || data.external_ids?.imdb_id ? `<div class="movie-links">${trailer ? `<a class="movie-link" href="https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}" target="_blank" rel="noopener" aria-label="Watch trailer on YouTube"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg> Trailer</a>` : ""}${data.external_ids?.imdb_id ? `<a class="movie-link" href="https://www.imdb.com/title/${encodeURIComponent(data.external_ids.imdb_id)}/" target="_blank" rel="noopener" aria-label="View movie on IMDb">IMDb <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg></a>` : ""}</div>` : ""}</div>${!entry && !ownHistory ? `<div class="movie-save"><label for="save-group">Add to watchlist</label><div class="movie-save-row"><select id="save-group" ${!state.groups.length ? "disabled" : ""}>${state.groups.length ? state.groups.map((g) => `<option value="${g.group_id}" ${g.group_id === state.group?.group_id ? "selected" : ""}>${esc(g.group_name)}</option>`).join("") : '<option>Create a watchlist first</option>'}</select><button id="save-movie" class="button" ${!state.groups.length ? "disabled" : ""}>Add</button></div><button id="save-watched" type="button" class="link-button save-watched" ${!state.groups.length ? "disabled" : ""}>Add as already watched</button><details class="save-note"><summary>Add a note (optional)</summary><label for="suggestion-note">Suggestion note</label><textarea id="suggestion-note" maxlength="500" rows="2" placeholder="Why should we watch this?"></textarea></details></div>` : ""}${entry ? `<div class="movie-save movie-watchlist"><button id="toggle-watched" class="button">${entry.watched ? "Move to watchlist" : "Mark watched"}</button><button id="toggle-dnf" class="button secondary">${entry.dnf ? "Move to watchlist" : "Did not finish"}</button><p class="muted status-scope">Status applies to everyone in this group.</p>${personalRatingPanel(entry)}${groupRatingPanel(entry)}<div class="suggestion"><p class="muted">Added by ${esc(contributorName(entry))}</p>${entry.suggestion_note ? `<blockquote>${esc(entry.suggestion_note)}</blockquote>` : ""}${entry.added_by === state.user.id ? `<details class="save-note"><summary>${entry.suggestion_note ? "Edit note" : "Add a note (optional)"}</summary><form id="note-form"><label for="edit-note">Your suggestion note (optional)</label><textarea id="edit-note" maxlength="500" rows="2" placeholder="Why should we watch this?">${esc(entry.suggestion_note || "")}</textarea><button class="button secondary" type="submit">Save note</button></form></details>` : ""}</div></div>` : ""}<p class="overview">${esc(data.overview || movie.description || "No synopsis available for this movie.")}</p>${watchOptions(providers, region)}${entry ? `<div class="details-actions"><button id="remove-movie" class="button danger">Remove</button></div>` : ""}`,
  );
  if(friendHistory) $(".detail-heading").insertAdjacentHTML("afterend",`<div class="movie-save"><p class="history-status">${movie.status==="dnf" ? "Did not finish" : "Watched"}</p><p>${esc(friendHistory.name)}’s rating: ${movie.personal_rating ? movie.personal_rating+"/5" : "Not rated"}</p></div>`);
  if(ownHistory) {
    const historyEntry={movies:movie,watched:movie.status!=="dnf",dnf:movie.status==="dnf"};
    $(".detail-heading").insertAdjacentHTML("afterend",`<div class="movie-save"><p class="history-status">${movie.status==="dnf" ? "Did not finish" : "Watched"}</p><button id="personal-history-status" class="button secondary">${movie.status==="dnf" ? "Mark watched for me" : "Did not finish for me"}</button>${personalRatingPanel(historyEntry)}</div>`);
    bindPersonalRating(historyEntry);
    $("#personal-history-status").onclick=event=>run(event.currentTarget,async()=>{state.profileHistory=checked(await db.rpc("mojo_set_history_status",{movie:movie.id,completion:movie.status==="dnf" ? "watched" : "dnf"}));closeModal();renderProfilePage(false);toast("Your history updated.");});
  }
  if (entry && state.tab === "discover") {
    const memberships = destinationMemberships;
    if (!modal.open || request !== detailRequest) return;
    const occupied = new Set(memberships.map(row=>row.group_id));
    occupied.add(state.group?.group_id);
    const targets=state.groups.filter(group=>!occupied.has(group.group_id));
    $(".movie-watchlist").insertAdjacentHTML("beforeend", `<div class="copy-watchlist"><label for="copy-group">Already on ${esc(state.group?.group_name || "this watchlist")}${targets.length ? " · Add to another" : ""}</label>${targets.length ? `<div class="movie-save-row"><select id="copy-group" aria-label="Add to another watchlist">${targets.map(group=>`<option value="${esc(group.group_id)}">${esc(group.group_name)}</option>`).join("")}</select><button id="copy-watchlist" class="button">Add</button></div>` : '<div class="movie-save-row"><select disabled aria-label="Add to another watchlist"><option>No available lists</option></select><button class="button" disabled>Add</button></div>'}</div>`);
    if ($("#copy-watchlist")) $("#copy-watchlist").onclick = e => run(e.currentTarget,async()=>{
      const target=$("#copy-group").value;
      if(!targets.some(group=>group.group_id===target)) throw Error("Choose a watchlist.");
      const duplicate=checked(await db.from("group_movies").select("id").eq("group_id",target).eq("movie_id",entry.movies.id).limit(1));
      if(duplicate.length) throw Error("This movie is already on that watchlist.");
      checked(await db.from("group_movies").insert({group_id:target,movie_id:entry.movies.id,added_by:state.user.id,suggestion_note:entry.suggestion_note || ""}));
      await loadMovies();
      closeModal(); toast("Added to "+targets.find(group=>group.group_id===target).group_name+".");
    });
  }
  if ($("#note-form"))
    $("#note-form").onsubmit = (e) => {
      e.preventDefault();
      run($("#note-form button"), async () => {
        checked(
          await db.rpc("mojo_set_suggestion_note", {
            target_entry: entry.id,
            note: $("#edit-note").value.trim(),
          }),
        );
        await loadMovies();
        render();
        closeModal();
        toast("Suggestion note saved.");
      });
    };
  if (entry) {
    bindPersonalRating(entry);
    $("#toggle-dnf").onclick=e=>entry.dnf ? run(e.currentTarget,async()=>{await setDnf(entry,false);closeModal();}) : completionDialog(entry,"dnf");
    $("#toggle-watched").onclick = e=>entry.watched ? run(e.currentTarget,async()=>{await setWatched(entry,false);closeModal();}) : completionDialog(entry,"watched");
    $("#remove-movie").onclick = (e) =>
      run(e.currentTarget, async () => {
        if (!confirm(`Remove “${movie.title}” from this watchlist?`)) return;
        const rows = checked(
          await db
            .from("group_movies")
            .delete()
            .eq("id", entry.id)
            .select("id"),
        );
        if (!rows.length)
          throw new Error("You do not have permission to remove this movie.");
        await loadMovies();
        render();
        closeModal();
        toast("Removed from watchlist.");
      });
  } else if(!ownHistory) {
    ["#save-movie","#save-watched"].forEach(selector=>{
      $(selector).onclick=e=>run(e.currentTarget,async()=>{
        const watched=selector==="#save-watched";
        const other=$(watched ? "#save-movie" : "#save-watched");
        other.disabled=true;
        try {
          const groupId=$("#save-group").value;
          const groupName=state.groups.find(group=>group.group_id===groupId)?.group_name || "your watchlist";
          await saveMovie(data,groupId,$("#suggestion-note").value,watched);
          closeModal();
          toast(watched ? "Added to watched movies in "+groupName+"." : "Added to "+groupName+".");
        } finally { if(other.isConnected) other.disabled=false; }
      });
    });
  }
}
async function setWatched(entry, value) {
  const rows = checked(
    await db
      .from("group_movies")
      .update({
        watched: value,
        dnf: false,
        dnf_at: null,
        watched_at: value ? new Date().toISOString() : null,
      })
      .eq("id", entry.id)
      .select("id"),
  );
  if (!rows.length)
    throw new Error("This movie could not be updated. Refresh and try again.");
  state.profileHistory=null;
  await loadMovies();
  render();
  toast(value ? "Added to watched movies." : "Moved back to your watchlist.");
}
async function saveMovie(movie, groupId, note = "", watched = false) {
  note = note.trim();
  if (note.length > 500) throw new Error("Keep your note to 500 characters.");
  if (!groupId) throw new Error("Create a watchlist first.");
  const existingMovieId = typeof movie.id === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(movie.id) ? movie.id : null;
  const tmdbId = movie.tmdb_id || (Number.isInteger(movie.id) ? String(movie.id) : null);
  let existing = existingMovieId ? [{id:existingMovieId}] : tmdbId
    ? checked(
        await db.from("movies").select("id").eq("tmdb_id", tmdbId).limit(1),
      )
    : [];
  let id = existing[0]?.id;
  if (!id) {
    const record = checked(
      await db
        .from("movies")
        .insert({
          title: movie.title,
          tmdb_id: tmdbId,
          release_year: parseInt(movie.release_date?.slice(0, 4)) || null,
          description: movie.overview || null,
          poster_url: image(movie.poster_path) || null,
        })
        .select("id")
        .single(),
    );
    id = record.id;
  }
  const duplicate = checked(
    await db
      .from("group_movies")
      .select("id")
      .eq("group_id", groupId)
      .eq("movie_id", id)
      .limit(1),
  );
  if (duplicate.length)
    throw new Error("This movie is already on that watchlist.");
  checked(
    await db.from("group_movies").insert({
      movie_id: id,
      group_id: groupId,
      added_by: state.user.id,
      suggestion_note: note,
      watched,
      watched_at: watched ? new Date().toISOString() : null,
    }),
  );
  state.profileHistory=null;
  if (groupId === state.group?.group_id) await loadMovies();
}
function manualAdd() {
  if (!state.group) {
    go("groups");
    return;
  }
  openModal(
    '<p class="eyebrow">Your own selection</p><h2>Add a movie manually</h2><form id="manual-form" class="form-panel"><label for="manual-title">Movie title</label><input id="manual-title" maxlength="200" required><label for="manual-note">Suggestion note (optional)</label><textarea id="manual-note" maxlength="500" rows="3" placeholder="Why should we watch this?"></textarea><button class="button full" style="margin-top:16px">Add to watchlist</button></form>',
  );
  $("#manual-form").onsubmit = (e) => {
    e.preventDefault();
    run($("#manual-form button"), async () => {
      const title = $("#manual-title").value.trim();
      if (!title) throw new Error("Enter a title.");
      const duplicate = state.movies.some(
        (m) => m.movies.title.toLowerCase() === title.toLowerCase(),
      );
      if (duplicate) throw new Error("This title is already on your list.");
      await saveMovie({ title }, state.group.group_id, $("#manual-note").value);
      closeModal();
      render();
      toast("Movie added.");
    });
  };
}
async function social(action = "list", target = null, gid = null) {
  return checked(await db.rpc("mojo_social", { action, target, gid }));
}
async function watchedProfile(person) {
  const own = person === state.user.id;
  const data = checked(await db.rpc("mojo_watched_profile", { person }));
  const rows = (list, removed = false) =>
    list
      .map(
        (m) =>
          `<div class="history-movie">${m.poster_url ? `<img src="${esc(m.poster_url)}" alt="" loading="lazy">` : ""}<div><h3>${esc(m.title)}</h3><p class="muted">${esc(m.release_year || "")} · ${m.status==="dnf" ? "Did not finish" : "Watched"}</p>${own ? `<button class="link-button" data-history="${removed ? "restore" : "remove"}" data-movie="${m.id}">${removed ? "Restore to my history" : "I didn’t watch this — remove"}</button>` : ""}</div></div>`,
      )
      .join("");
  openModal(
    `<p class="eyebrow">Movie memories</p><h2>${own ? "Your watch history" : esc(data.name) + "’s watch history"}</h2><div class="history-list">${rows(data.movies) || '<p class="muted">No watched movies yet.</p>'}</div>${own && data.excluded.length ? `<details><summary>Removed from my history (${data.excluded.length})</summary>${rows(data.excluded, true)}</details>` : ""}`,
  );
  $("#modal-content")
    .querySelectorAll("[data-history]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          run(b, async () => {
            checked(
              await db.rpc("mojo_watched_profile", {
                person,
                action: b.dataset.history,
                movie: b.dataset.movie,
              }),
            );
            await watchedProfile(person);
            toast(
              b.dataset.history === "remove"
                ? "Removed from your history."
                : "Restored to your history.",
            );
          })),
    );
}
async function friends() {
  if(state.friendProfile)return viewFriendProfile(state.friendProfile);
  app.innerHTML =
    '<p class="eyebrow">Your movie people</p><h1>Friends.</h1><p class="muted">Loading friends…</p>';
  try {
    const data = await social();
    if (state.tab !== "friends" || state.friendProfile) return;
    app.innerHTML = friendsPageMarkup(data);
    $("#copy-friend").onclick = (e) =>
      run(e.currentTarget, async () => {
        await navigator.clipboard.writeText(state.user.id);
        toast("Friend code copied.");
      });
    app
      .querySelectorAll("[data-history-person]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            run(b, () => viewFriendProfile(b.dataset.historyPerson))),
      );
    $("#refresh-friends").onclick = () => friends();
    $("#friend-request").onsubmit = (e) => {
      e.preventDefault();
      run($("#friend-request button"), async () => {
        await social("request", $("#friend-code").value.trim());
        await friends();
        toast("Friend request sent.");
      });
    };
    app.querySelectorAll("[data-social]").forEach(
      (b) =>
        (b.onclick = () =>
          run(b, async () => {
            await social(b.dataset.social, b.dataset.target);
            if (b.dataset.social === "join") await loadGroups();
            await friends();
            toast("Updated.");
          })),
    );
  } catch (e) {
    if (state.tab === "friends")
      app.innerHTML = empty(
        "Could not load friends",
        e.message,
        '<button id="retry-friends" class="button">Try again</button>',
      );
    if ($("#retry-friends")) $("#retry-friends").onclick = () => friends();
  }
}
async function inviteFriends(groupId) {
  const data = await social();
  const list = data.friends.filter((f) => f.accepted);
  const area = $("#direct-invite");
  if (!area) return;
  area.innerHTML = `<h3>Invite a friend</h3>${list.length ? `<select id="invite-friend" aria-label="Friend to invite">${list.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select><button id="send-direct-invite" class="button">Send invitation</button>` : '<p class="muted">Add friends from the Friends tab to invite them directly.</p>'}`;
  if ($("#send-direct-invite"))
    $("#send-direct-invite").onclick = (e) =>
      run(e.currentTarget, async () => {
        await social("invite", $("#invite-friend").value, groupId);
        toast("Invitation sent. Your friend can accept it in Friends.");
      });
}
async function groupPeople(id) {
  const [people, data] = await Promise.all([
    db.rpc("mojo_group_people", { target_group: id }).then(checked),
    social(),
  ]);
  const group = state.groups.find((g) => g.group_id === id);
  openModal(
    `<p class="eyebrow">Your movie circle</p><h2>${esc(group?.group_name || "Group")} members</h2><div id="group-people">${people
      .map((p) => {
        const f = data.friends.find((f) => f.id === p.id);
        return `<div class="form-panel"><h3>${esc(p.id === state.user.id ? state.displayName || "You" : p.name)}${p.id === state.user.id && state.displayName && state.displayName.toLowerCase() !== "you" ? " · You" : ""}</h3>${p.owner ? '<p class="muted">Group creator</p>' : ""}${p.id === state.user.id ? "" : f?.accepted ? '<p class="muted">Friends ✓</p>' : f ? (f.incoming ? `<button class="button" data-member-action="accept" data-person="${p.id}">Accept friend request</button>` : '<p class="muted">Friend request sent</p>') : `<button class="button secondary" data-member-action="request" data-person="${p.id}">Add friend</button>`}</div>`;
      })
      .join("")}</div>`,
  );
  $("#group-people")
    .querySelectorAll("[data-member-action]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          run(b, async () => {
            await social(b.dataset.memberAction, b.dataset.person);
            await groupPeople(id);
            toast(
              b.dataset.memberAction === "accept"
                ? "Friend request accepted."
                : "Friend request sent.",
            );
          })),
    );
}
function groups() {
  app.innerHTML = `<p class="eyebrow">Better together</p><h1>Your movie circles.</h1><p class="subtitle">A list for your friends. A list for yourself. A place for every movie night.</p>${state.groups.map((g) => `<div class="group-card"><button class="group-open" data-group="${g.group_id}"><h3>${esc(g.group_name)}</h3><p class="muted">${g.member_count === 1 ? "Your own watchlist" : g.member_count + " people"} · Open watchlist →</p></button>${g.group_id === state.personalGroup ? '<p class="muted">Only you · Personal list</p>' : `<div class="group-buttons"><button class="button secondary" data-members="${g.group_id}">Members</button><button class="button secondary" data-invite="${g.group_id}">Invite</button></div>`}</div>`).join("") || empty("Start your first circle.", "Create a list below, then invite your friends whenever you like.")}<div class="form-panel"><h3>Create a watchlist</h3><p class="muted">Keep it personal or share it with friends.</p><form id="create-group"><input id="group-name" placeholder="Friday night crew" maxlength="100" aria-label="Watchlist name" required><button class="button">Create →</button></form></div><div class="form-panel"><h3>Have an invite?</h3><p class="muted">Paste a group code to join your friends.</p><form id="join-group"><input id="group-code" placeholder="Group invite code" aria-label="Group invite code" required><button class="button secondary">Join group</button></form></div>`;
  app
    .querySelectorAll("[data-members]")
    .forEach(
      (b) => (b.onclick = () => run(b, () => groupPeople(b.dataset.members))),
    );
  app.querySelectorAll("[data-group]").forEach(
    (b) =>
      (b.onclick = () =>
        run(b, async () => {
          await switchGroup(b.dataset.group);
          go("watchlist");
        })),
  );
  app.querySelectorAll("[data-invite]").forEach(
    (b) =>
      (b.onclick = () => run(b, async () => {
        const id = b.dataset.invite;
        const invitation = checked(await db.rpc("mojo_share_invite", { target_group: id }));
        const token = invitation.token;
        openModal(
          `<p class="eyebrow">Save a seat for your friends</p><h2>Invite to ${esc(state.groups.find((g) => g.group_id === id).group_name)}</h2><p class="muted">Share the invitation link below. Friends can sign in or create an account to join.</p><div id="direct-invite"></div><label for="invite-link">Share invite link</label><input readonly id="invite-link" value="${esc(location.origin + location.pathname + "?invite=" + token)}"><button id="copy-invite-link" class="button">Copy invite link</button><button id="share-invite-link" class="button secondary">Share invitation</button><p class="muted">This invitation expires ${esc(new Date(invitation.expires_at).toLocaleDateString())} (7 days after creation). Anyone with the link can join after verifying their email.</p><input readonly id="invite-code" aria-label="Invite code" value="${token}"><button class="button full" id="copy-code" style="margin-top:16px">Copy invite code</button>`,
        );
        const link = location.origin + location.pathname + "?invite=" + token;
        $("#copy-invite-link").onclick = (e) =>
          run(e.currentTarget, async () => {
            await navigator.clipboard.writeText(link);
            toast("Invite link copied.");
          });
        $("#share-invite-link").onclick = (e) =>
          run(e.currentTarget, async () => {
            if (navigator.share) {
              try {
                await navigator.share({
                  title: "Join my Movie Mojo group",
                  text: `Join ${state.groups.find((g) => g.group_id === id)?.group_name || "my group"} on Movie Mojo: ${link}`,
                  url: link,
                });
              } catch (err) {
                if (err.name !== "AbortError") throw err;
              }
            } else {
              await navigator.clipboard.writeText(link);
              toast("Invite link copied.");
            }
          });
        inviteFriends(id).catch((e) => toast(e.message));
        $("#copy-code").onclick = (e) =>
          run(e.currentTarget, async () => {
            try {
              await navigator.clipboard.writeText(token);
              toast("Invite copied.");
            } catch {
              $("#invite-code").select();
              toast("Select and copy the code above.");
            }
          });
      })),
  );
  $("#create-group").onsubmit = (e) => {
    e.preventDefault();
    run($("#create-group button"), async () => {
      const name = $("#group-name").value.trim();
      if (!name) throw new Error("Enter a watchlist name.");
      checked(await db.rpc("mojo_create_group", { group_name: name }));
      await loadGroups();
      render();
      toast("Watchlist created.");
    });
  };
  $("#join-group").onsubmit = (e) => {
    e.preventDefault();
    run($("#join-group button"), async () => {
      const code = $("#group-code").value.trim();
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          code,
        )
      )
        throw new Error("That invite code does not look right.");
      checked(await db.rpc("mojo_join_group", { invite_code: code }));
      await loadGroups();
      render();
      toast("You joined the group.");
    });
  };
}
function manageWatchlists() {
  openModal(`<h2>Manage watchlists</h2><p class="muted">Delete lists you own or leave groups you joined.</p>${state.groups.map((g) => `<div class="form-panel"><h3>${esc(g.group_name)}</h3><p class="muted">${g.group_id === state.personalGroup ? "Your permanent personal list · Only you" : `${g.member_count} ${g.member_count === 1 ? "member" : "members"} · ${g.created_by === state.user.id ? "You own this list" : "Shared group"}`}</p>${g.group_id === state.personalGroup ? "" : `<button class="button danger full" data-remove-group="${g.group_id}">${g.created_by === state.user.id ? "Delete watchlist" : "Leave group"}</button>`}</div>`).join("")}`);
  $("#modal-content").querySelectorAll("[data-remove-group]").forEach((button) => {
    button.onclick = () => run(button, async () => {
      const group = state.groups.find((g) => g.group_id === button.dataset.removeGroup);
      if (!group || group.group_id === state.personalGroup) return;
      const own = group.created_by === state.user.id;
      if (!confirm(own
        ? `Delete “${group.group_name}” and its group ratings permanently?`
        : `Leave “${group.group_name}”?`)) return;
      if (own) checked(await db.rpc("mojo_delete_group", { target_group: group.group_id }));
      else {
        const rows = checked(await db.from("group_members").delete()
          .eq("group_id", group.group_id).eq("user_id", state.user.id).select("id"));
        if (!rows.length) throw new Error("Could not leave the group.");
      }
      if (state.group?.group_id === group.group_id) state.group = null;
      await loadGroups();
      render();
      manageWatchlists();
      toast(own ? "Watchlist deleted." : "You left the group.");
    });
  });
}
function profile() { renderProfilePage(); }
async function logout() {
  await run($("#logout"), async () => {
    checked(await db.auth.signOut({ scope: "local" }));
    state.group = null;
    state.groups = [];
    state.movies = [];
    state.results = [];
    state.profileHistory=null;
    closeModal();
  });
}
async function initialize(user) {
  const version = ++authVersion;
  state.personalRatings={};state.groupRatings={};state.profileInfo=null;state.friendProfile=null;
  state.completedMovies=[];
  state.user = user;
  state.approved = false;
  state.mfaRequired = false;
  updateAccountControl();
  $("#navigation").hidden = true;
  if (!user) {
    state.approved = false;
    state.displayName = "";
    state.bio = "";
    state.profileHistory=null;
    state.mfaFactors=[];
    state.contributors = {};
    state.streamingServices = [];
    state.streamingRegion = "US";
    state.filters = {mood:"Trending Now",trending:true};
    render();
    return;
  }
  app.innerHTML = '<section class="startup-shell" aria-busy="true" aria-label="Loading watchlists"><p class="eyebrow">Your movie night, sorted</p><h1>The watchlist.</h1><p role="status" class="muted">Getting your watchlists ready…</p><div class="skeleton-toolbar"></div><div class="skeleton-hero"></div><div class="grid">'+Array.from({length:10},()=>'<div class="skeleton-card"><div></div><span></span></div>').join('')+'</div></section>';
  try {
    const assurance = checked(await db.auth.mfa.getAuthenticatorAssuranceLevel());
    const factors = checked(await db.auth.mfa.listFactors());
    const verifiedFactors = factors.totp.filter(factor=>factor.status==="verified");
    if (version !== authVersion) return;
    if(verifiedFactors.length && assurance.currentLevel !== "aal2") {
      state.mfaRequired=true; state.approved=false; state.groups=[]; state.movies=[]; state.profileHistory=null;
      state.mfaFactors=verifiedFactors;
      updateAccountControl(); renderMfaLogin(); return;
    }
    const profile = checked(
      await db
        .from("user_profiles")
        .select("approved, streaming_services, streaming_region, display_name, bio")
        .eq("id", user.id)
        .maybeSingle(),
    );
    if (version !== authVersion) return;
    state.approved = !!profile?.approved;
    state.displayName = profile?.display_name || "";
    state.bio = profile?.bio || "";
    state.streamingServices = profile?.streaming_services || [];
    state.streamingRegion = profile?.streaming_region || "US";
    if (state.approved) await loadGroups();
    if (version !== authVersion) return;
    $("#navigation").hidden = !state.approved;
    state.tab = [
      "watchlist",
      "discover",
      "groups",
      "friends",
      "profile",
    ].includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : "watchlist";
    render();
    if (state.approved) await handleInvite();
  } catch (e) {
    if (version !== authVersion) return;
    app.innerHTML = empty(
      "Could not load your watchlists.",
      e.message,
      '<button class="button" id="retry-init">Try again</button><button class="button secondary" id="logout">Sign out</button>',
    );
    $("#retry-init").onclick = () => initialize(user);
    $("#logout").onclick = logout;
  }
}
db.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") {
    setTimeout(() => {
      openModal(
        '<h2>Set a new password</h2><form id="new-password-form" class="form-panel"><label for="new-password">New password</label><input id="new-password" type="password" minlength="6" autocomplete="new-password" required><button class="button full" style="margin-top:16px">Save password</button></form>',
      );
      $("#new-password-form").onsubmit = (e) => {
        e.preventDefault();
        run($("#new-password-form button"), async () => {
          checked(
            await db.auth.updateUser({ password: $("#new-password").value }),
          );
          closeModal();
          toast("Password updated.");
        });
      };
    }, 0);
  }
  if (
    event === "INITIAL_SESSION" ||
    event === "SIGNED_OUT" ||
    (event === "SIGNED_IN" && state.user?.id !== session?.user?.id)
  )
    setTimeout(() => initialize(session?.user || null), 0);
});
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("./sw.js").catch(console.error),
  );
