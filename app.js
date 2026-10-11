"use strict";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s, root = document) => root.querySelector(s);
const app = $("#app"),
  modal = $("#modal");
const state = {
  user: null,
  approved: false,
  displayName: "",
  contributors: {},
  streamingServices: [],
  streamingRegion: "US",
  groups: [],
  group: null,
  movies: [],
  tab: "watchlist",
  watched: false,
  results: [],
  page: 1,
  total: 1,
  mode: "discover",
  query: "",
  filters: {},
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
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  for (const [k, v] of Object.entries(params))
    if (v !== "" && v != null) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(
      "Movie information is temporarily unavailable. Please try again.",
    );
  return res.json();
}
function openModal(html) {
  $("#modal-content").innerHTML = html;
  if (!modal.open) modal.showModal();
}
$("#close-modal").onclick = () => modal.close();
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.close();
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
  const year =
    movie.release_year || movie.release_date?.slice(0, 4) || "Year unknown";
  return `<button class="movie-card" data-movie="${index}" aria-label="Details for ${esc(movie.title)}"><div class="poster-wrap">${poster ? `<img loading="lazy" src="${esc(poster)}" alt="${esc(movie.title)} poster" onerror="this.hidden=true">` : '<div class="poster-fallback">✦</div>'}${movie.vote_average ? `<span class="score">★ ${Number(movie.vote_average).toFixed(1)}</span>` : ""}</div><h3>${esc(movie.title)}</h3><p>${esc(year)}</p>${entry ? `<p class="added-by">Added by ${esc(contributorName(entry))}</p>${entry.suggestion_note ? `<p class="card-note">“${esc(entry.suggestion_note)}”</p>` : ""}` : ""}</button>`;
}
function bindCards(list, entries = false) {
  app
    .querySelectorAll("[data-movie]")
    .forEach(
      (btn) =>
        (btn.onclick = () =>
          run(btn, () =>
            details(
              entries
                ? list[Number(btn.dataset.movie)].movies
                : list[Number(btn.dataset.movie)],
              entries ? list[Number(btn.dataset.movie)] : null,
            ),
          )),
    );
}
async function loadGroups() {
  state.groups =
    checked(
      await db.rpc("get_user_groups_with_counts", { uid: state.user.id }),
    ) || [];
  const saved = localStorage.getItem(`mojo-group-${state.user.id}`);
  state.group =
    state.groups.find((g) => g.group_id === (state.group?.group_id || saved)) ||
    state.groups[0] ||
    null;
  await loadMovies();
}
async function loadMovies() {
  state.movies = state.group
    ? checked(
        await db
          .from("group_movies")
          .select(
            "id,watched,added_by,added_at,suggestion_note,movies(id,title,description,poster_url,release_year,tmdb_id)",
          )
          .eq("group_id", state.group.group_id)
          .order("added_at", { ascending: false }),
      )
    : [];
  state.movies = state.movies.filter((m) => m.movies);
  const contributors = state.group
    ? checked(
        await db.rpc("mojo_group_contributors", {
          target_group: state.group.group_id,
        }),
      ) || []
    : [];
  state.contributors = Object.fromEntries(
    contributors.map((p) => [p.user_id, p.display_name]),
  );
}
async function switchGroup(id) {
  state.group = state.groups.find((g) => g.group_id === id);
  localStorage.setItem(`mojo-group-${state.user.id}`, id);
  await loadMovies();
  render();
}
function render() {
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
  state.tab = tab;
  location.hash = tab;
  render();
  window.scrollTo({ top: 0 });
}
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => (b.onclick = () => go(b.dataset.tab)));
$("#account-button").onclick = () => {
  if (state.user) go("profile");
};
window.addEventListener("hashchange", () => {
  const tab = location.hash.slice(1);
  if (
    ["watchlist", "discover", "groups", "friends", "profile"].includes(tab) &&
    tab !== state.tab
  ) {
    state.tab = tab;
    render();
  }
});
function auth(signup = false) {
  $("#navigation").hidden = true;
  app.innerHTML = `<section class="auth"><p class="eyebrow">Good movies. Better company.</p><h1>${signup ? "Join the movie night." : "Your next movie night starts here."}</h1><p class="subtitle">Find something worth watching. Save it with your people.</p><form id="auth-form"><div><label for="email">Email address</label><input id="email" type="email" autocomplete="email" required></div><div><label for="password">Password</label><input id="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required></div><button class="button" type="submit">${signup ? "Create account" : "Sign in"} →</button></form><p class="auth-switch muted">${signup ? "Already have an account?" : "New to Movie Mojo?"} <button class="link-button" id="auth-switch">${signup ? "Sign in" : "Create account"}</button></p>${signup ? '<p class="muted">Verify your email to get started. Your watchlists stay private to their members.</p>' : '<button class="link-button" id="reset-password">Forgot password?</button>'}</section>`;
  $("#auth-switch").onclick = () => auth(!signup);
  $("#auth-form").onsubmit = (e) => {
    e.preventDefault();
    run($("#auth-form button"), async () => {
      const credentials = {
        email: $("#email").value.trim(),
        password: $("#password").value,
      };
      checked(
        signup
          ? await db.auth.signUp({
              ...credentials,
              options: { emailRedirectTo: location.origin + location.pathname },
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
function watchlist() {
  const entries = state.movies.filter((m) => !!m.watched === state.watched);
  app.innerHTML = `<p class="eyebrow">Your movie night, sorted</p><h1>The watchlist.</h1><p class="subtitle">Less scrolling. More watching.</p><div class="toolbar"><select id="group-select" class="group-select" aria-label="Choose watchlist">${state.groups.map((g) => `<option value="${esc(g.group_id)}" ${g.group_id === state.group?.group_id ? "selected" : ""}>${esc(g.group_name)}</option>`).join("") || "<option>No watchlists yet</option>"}</select><button id="add-movie" class="button secondary">＋ Add a movie</button></div><section class="picker-hero"><div><p class="eyebrow">Let fate take the remote</p><h2>Can't decide tonight?</h2><p>One random pick from your unwatched movies.<br>Every movie gets an equal shot.</p></div><button class="button" id="pick">✦ Pick tonight</button></section><div class="section-row"><div class="pills"><button class="pill ${!state.watched ? "active" : ""}" id="unwatched">To watch</button><button class="pill ${state.watched ? "active" : ""}" id="watched">Watched</button></div><span class="count">${entries.length} movie${entries.length === 1 ? "" : "s"}</span></div><div class="grid">${entries.map((m, i) => card(m.movies, i, m)).join("") || empty(state.group ? "The opening scene." : "Bring your people together.", state.group ? "Add a few movies to get your next movie night started." : "Create a group, or a watchlist just for you.", `<button id="empty-action" class="button">${state.group ? "Find a movie" : "Create a watchlist"}</button>`)}</div><div class="manual"><button id="manual-add" class="link-button">Can't find it? Add a movie manually</button></div>`;
  $("#group-select").onchange = (e) =>
    run(e.currentTarget, () => switchGroup(e.target.value));
  $("#add-movie").onclick = () => go("discover");
  $("#unwatched").onclick = () => {
    state.watched = false;
    watchlist();
  };
  $("#watched").onclick = () => {
    state.watched = true;
    watchlist();
  };
  $("#pick").onclick = pick;
  $("#manual-add").onclick = manualAdd;
  if ($("#empty-action"))
    $("#empty-action").onclick = () => go(state.group ? "discover" : "groups");
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
  const candidates = state.movies.filter((m) => !m.watched);
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
  $("#picked-watched").onclick = (e) =>
    run(e.currentTarget, async () => {
      await setWatched(chosen, true);
      modal.close();
    });
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
  { label: "Make me laugh", filters: { with_genres: "35" } },
  { label: "Keep me guessing", filters: { with_genres: "53|9648" } },
  { label: "Family night", filters: { with_genres: "10751" } },
  { label: "Out of this world", filters: { with_genres: "878|14" } },
  { label: "Under 90 minutes", filters: { "with_runtime.lte": "90" } },
  {
    label: "Highly rated",
    filters: { "vote_average.gte": "8", sort_by: "vote_average.desc" },
  },
];
function discover() {
  app.innerHTML = `<p class="eyebrow">A little inspiration</p><h1>Find your next favorite.</h1><p class="subtitle">Follow a mood. Explore a genre. See what catches your eye.</p><div class="mood-shortcuts" aria-label="Movie mood shortcuts">${moodShortcuts.map((m, i) => `<button class="mood-chip ${state.filters.mood === m.label ? "active" : ""}" data-mood="${i}">${m.label}</button>`).join("")}</div><form id="search-form" class="search-row"><input name="query" id="query" type="search" placeholder="Search movie titles…" aria-label="Movie title" value="${esc(state.query)}"><button class="button" type="submit">Search</button></form><details class="filters" ${state.mode === "discover" ? "open" : ""}><summary>Browse by filters</summary><form id="filter-form"><p class="muted">Filters browse the movie catalog. Title search runs separately.</p><div class="filter-grid">${select("with_genres", "Genre", [["", "All genres"], ...(state.filters.mood && state.filters.with_genres?.includes("|") ? [[state.filters.with_genres, "Mood selection"]] : []), ...genres])}<fieldset class="release-years"><legend>Release year</legend><div class="year-range"><div><label for="year-from">From</label><input id="year-from" name="yearFrom" type="number" min="1874" max="2100" placeholder="Any" inputmode="numeric" value="${esc(state.filters.yearFrom || "")}"></div><span aria-hidden="true">–</span><div><label for="year-to">To</label><input id="year-to" name="yearTo" type="number" min="1874" max="2100" placeholder="Any" inputmode="numeric" value="${esc(state.filters.yearTo || "")}"></div></div></fieldset>${select(
    "vote_average.gte",
    "Minimum audience score",
    [
      ["", "Any score"],
      [6, "6+ / 10"],
      [7, "7+ / 10"],
      [8, "8+ / 10"],
    ],
  )}${select("with_runtime.lte", "Runtime", [
    ["", "Any length"],
    [90, "Under 90 minutes"],
    [120, "Under 2 hours"],
    [150, "Under 2½ hours"],
  ])}${select("sort_by", "Sort by", [
    ["popularity.desc", "Popular"],
    ["vote_average.desc", "Highest rated"],
    ["primary_release_date.desc", "Newest releases"],
  ])}${select("watch_region", "Country", [
    ["US", "United States"],
    ["GB", "United Kingdom"],
    ["CA", "Canada"],
    ["AU", "Australia"],
  ])}<div class="streaming-filter"><label>Streaming services</label><div id="discovery-services"></div></div></div><label class="checkbox"><input type="checkbox" id="hide-watched" ${state.filters.hideWatched ? "checked" : ""}> Hide movies watched by this group</label><div class="filter-actions"><button class="button" type="submit">Find movies →</button><button class="button secondary" id="reset-filters" type="button">Reset</button></div></form></details><div class="section-row"><h2 id="results-title">${state.mode === "search" ? "Search results" : "Your next obsession"}</h2><span class="count">${state.group ? esc(state.group.group_name) : "Choose a group to save movies"}</span></div><div id="results" class="grid"></div><button class="button secondary full" id="load-more" hidden>Load more movies</button>`;
  app.querySelectorAll("[data-mood]").forEach(
    (button) =>
      (button.onclick = () => {
        const mood = moodShortcuts[Number(button.dataset.mood)];
        state.filters = {
          watch_region: state.filters.watch_region || state.streamingRegion,
          providerIds: state.filters.providerIds || [],
          useMyServices: !!state.filters.useMyServices,
          hideWatched: !!state.filters.hideWatched,
          ...mood.filters,
          mood: mood.label,
        };
        state.mode = "discover";
        state.query = "";
        state.page = 1;
        state.results = [];
        discover();
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
      providerIds,
      useMyServices,
      hideWatched: $("#hide-watched").checked,
    };
    state.mode = "discover";
    state.query = "";
    $("#query").value = "";
    state.page = 1;
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
    host.innerHTML = `<details class="service-picker"><summary><span class="service-summary">${isDiscovery ? "Any streaming service" : "Choose your services"}</span></summary><div class="service-options">${isDiscovery ? `<label class="service-option my-services"><input id="use-my-services" type="checkbox" ${useMy ? "checked" : ""}><span>My streaming services<small>${state.streamingServices.length ? state.streamingServices.length + " saved in Profile" : "Add services in Profile first"}</small></span></label>` : ""}<input class="provider-search" type="search" placeholder="Find a service…" aria-label="Find a streaming service"><div class="provider-list-options">${providers.map((p) => `<label class="service-option" data-provider-name="${esc(p.provider_name.toLowerCase())}" data-search-names="${esc(p.provider_name.toLowerCase() + " " + p.searchNames.join(" "))}" data-default="${defaultIds.has(p.provider_id)}"><input type="checkbox" name="${name}" value="${p.provider_id}" ${p.variantIds.some((id) => selectedSet.has(id)) || selectedFamilies.has(p.provider_name.toLowerCase()) ? "checked" : ""}>${p.logo_path ? `<img src="${image(p.logo_path)}" alt="" loading="lazy">` : ""}<span>${esc(p.provider_name)}</span></label>`).join("")}</div><p class="provider-empty muted" hidden>No services match that name.</p></div></details>`;
    const updateSummary = () => {
      const count = host.querySelectorAll(
        `input[name="${name}"]:checked`,
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
      host.querySelectorAll("[data-provider-name]").forEach((row) => {
        row.hidden = query
          ? !row.dataset.searchNames.includes(query)
          : row.dataset.default !== "true" && !$("input", row).checked;
        if (!row.hidden) visible++;
      });
      $(".provider-empty", host).hidden = visible > 0;
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
  const request = ++state.request;
  const nextPage = append ? state.page + 1 : 1;
  const results = $("#results");
  if (!append)
    results.innerHTML = '<p class="loading">Finding the good stuff…</p>';
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
            "vote_count.gte": 100,
            "primary_release_date.gte": f.yearFrom ? `${f.yearFrom}-01-01` : "",
            "primary_release_date.lte": f.yearTo
              ? `${f.yearTo}-12-31`
              : new Date().toISOString().slice(0, 10),
            with_watch_providers: providerIds.join("|"),
            with_watch_monetization_types: providerIds.length
              ? "flatrate|free|ads"
              : "",
            watch_region: f.watch_region || state.streamingRegion,
          };
    for (const key of [
      "hideWatched",
      "providerIds",
      "useMyServices",
      "yearFrom",
      "yearTo",
      "mood",
    ])
      delete params[key];
    const data = await tmdb(
      state.mode === "search" ? "search/movie" : "discover/movie",
      { ...params, page: nextPage, include_adult: false },
    );
    if (request !== state.request || !results.isConnected) return;
    state.page = nextPage;
    state.total = Math.min(data.total_pages || 1, 500);
    state.results = append ? [...state.results, ...data.results] : data.results;
    renderResults();
  } catch (e) {
    if (request === state.request && results.isConnected) {
      if (!append)
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
  if ($("#results-title"))
    $("#results-title").textContent =
      state.mode === "search" ? "Search results" : "Your next obsession";
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
      "Try a broader genre, date range, or lower audience score.",
    );
  $("#load-more").hidden = state.page >= state.total;
  bindCards(list);
}
async function details(movie, entry = null) {
  openModal('<p class="loading">Loading the feature…</p>');
  let data = movie;
  if (movie.tmdb_id || Number.isInteger(movie.id)) {
    try {
      data = await tmdb(`movie/${movie.tmdb_id || movie.id}`, {
        append_to_response: "watch/providers,videos,external_ids",
      });
    } catch (e) {
      toast(e.message);
    }
  }
  if (!modal.open) return;
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
    `${poster ? `<img class="detail-poster" src="${esc(poster)}" alt="${esc(movie.title)} poster">` : ""}<div class="detail-heading"><p class="eyebrow">${entry ? "On your watchlist" : "Worth a watch"}</p><h2>${esc(data.title || movie.title)}</h2><p class="muted">${esc(data.release_date?.slice(0, 4) || movie.release_year || "")} ${data.runtime ? "· " + data.runtime + " min" : ""}</p>${data.vote_average ? `<p>★ ${Number(data.vote_average).toFixed(1)} <span class="muted">TMDB audience score</span></p>` : ""}</div><p class="overview">${esc(data.overview || movie.description || "No synopsis available for this movie.")}</p>${providers?.flatrate?.length ? `<p class="muted">Streaming in ${region}</p><div class="provider-list">${providers.flatrate.map((p) => `<img src="${image(p.logo_path)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`).join("")}</div><a class="link-button" href="${esc(providers.link)}" target="_blank" rel="noopener">Check availability on TMDB / JustWatch ↗</a>` : '<p class="muted">No subscription streaming information available for this country.</p>'}${entry ? `<div class="suggestion"><p class="muted">Added by ${esc(contributorName(entry))}</p>${entry.suggestion_note ? `<blockquote>${esc(entry.suggestion_note)}</blockquote>` : ""}${entry.added_by === state.user.id ? `<form id="note-form"><label for="edit-note">Your suggestion note (optional)</label><textarea id="edit-note" maxlength="500" rows="3" placeholder="Why should we watch this?">${esc(entry.suggestion_note || "")}</textarea><button class="button secondary" type="submit">Save note</button></form>` : ""}</div>` : ""}<div class="details-actions">${entry ? `<button id="toggle-watched" class="button">${entry.watched ? "Move to watchlist" : "Mark watched"}</button><button id="remove-movie" class="button danger">Remove</button>` : `<label for="save-group">Save to watchlist</label><select id="save-group">${state.groups.map((g) => `<option value="${g.group_id}" ${g.group_id === state.group?.group_id ? "selected" : ""}>${esc(g.group_name)}</option>`).join("")}</select><label for="suggestion-note">Suggestion note (optional)</label><textarea id="suggestion-note" maxlength="500" rows="3" placeholder="I’ve heard this is great!"></textarea><button id="save-movie" class="button" ${!state.group ? "disabled" : ""}>＋ Add to watchlist</button>`}${trailer ? `<a class="button secondary" href="https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}" target="_blank" rel="noopener">Watch trailer ↗</a>` : ""}${data.external_ids?.imdb_id ? `<a class="button secondary" href="https://www.imdb.com/title/${encodeURIComponent(data.external_ids.imdb_id)}/" target="_blank" rel="noopener">IMDb ↗</a>` : ""}</div>`,
  );
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
        modal.close();
        toast("Suggestion note saved.");
      });
    };
  if (entry) {
    $("#toggle-watched").onclick = (e) =>
      run(e.currentTarget, async () => {
        await setWatched(entry, !entry.watched);
        modal.close();
      });
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
        modal.close();
        toast("Removed from watchlist.");
      });
  } else
    $("#save-movie").onclick = (e) =>
      run(e.currentTarget, async () => {
        await saveMovie(
          data,
          $("#save-group").value,
          $("#suggestion-note").value,
        );
        modal.close();
        toast("Added to your watchlist.");
      });
}
async function setWatched(entry, value) {
  const rows = checked(
    await db
      .from("group_movies")
      .update({
        watched: value,
        watched_at: value ? new Date().toISOString() : null,
      })
      .eq("id", entry.id)
      .select("id"),
  );
  if (!rows.length)
    throw new Error("This movie could not be updated. Refresh and try again.");
  await loadMovies();
  render();
  toast(value ? "Added to watched movies." : "Moved back to your watchlist.");
}
async function saveMovie(movie, groupId, note = "") {
  note = note.trim();
  if (note.length > 500) throw new Error("Keep your note to 500 characters.");
  if (!groupId) throw new Error("Create a watchlist first.");
  const tmdbId = movie.id ? String(movie.id) : null;
  let existing = tmdbId
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
    }),
  );
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
      modal.close();
      render();
      toast("Movie added.");
    });
  };
}
async function social(action = "list", target = null, gid = null) {
  return checked(await db.rpc("mojo_social", { action, target, gid }));
}
async function friends() {
  app.innerHTML =
    '<p class="eyebrow">Your movie people</p><h1>Friends.</h1><p class="muted">Loading friends…</p>';
  try {
    const data = await social();
    if (state.tab !== "friends") return;
    app.innerHTML = `<p class="eyebrow">Your movie people</p><h1>Friends.</h1><p class="subtitle">Find your people. Plan your next movie night.</p><div class="form-panel"><h3>Your friend code</h3><p class="muted">Share this with a friend. Set your display name in Profile so they recognize you.</p><input readonly value="${state.user.id}" aria-label="Your friend code"><button id="copy-friend" class="button secondary">Copy friend code</button></div><div class="form-panel"><h3>Add a friend</h3><form id="friend-request"><input id="friend-code" placeholder="Paste their friend code" required aria-label="Friend code"><button class="button">Send request</button></form></div><h2>Group invitations</h2>${data.invitations.map((i) => `<div class="form-panel"><h3>${esc(i.group)}</h3><p>${esc(i.sender)} invited you</p><button class="button" data-social="join" data-target="${i.id}">Accept invitation</button><button class="button secondary" data-social="decline" data-target="${i.id}">Decline</button></div>`).join("") || '<p class="muted">No pending group invitations.</p>'}<h2>Your friends & requests</h2>${data.friends.map((f) => `<div class="form-panel"><h3>${esc(f.name)}</h3>${f.accepted ? '<p class="muted">Friends</p>' : `<p class="muted">${f.incoming ? "Wants to be your friend" : "Request sent"}</p>`}${!f.accepted && f.incoming ? `<button class="button" data-social="accept" data-target="${f.id}">Accept request</button>` : ""}<button class="button secondary" data-social="remove" data-target="${f.id}">${f.accepted ? "Remove friend" : f.incoming ? "Decline request" : "Cancel request"}</button></div>`).join("") || '<p class="muted">Add your first movie friend above.</p>'}<button id="refresh-friends" class="button secondary">Refresh friends</button>`;
    $("#copy-friend").onclick = (e) =>
      run(e.currentTarget, async () => {
        await navigator.clipboard.writeText(state.user.id);
        toast("Friend code copied.");
      });
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
        return `<div class="form-panel"><h3>${esc(p.id === state.user.id ? state.displayName || "You" : p.name)}${p.id === state.user.id ? " · You" : ""}</h3>${p.owner ? '<p class="muted">Group creator</p>' : ""}${p.id === state.user.id ? "" : f?.accepted ? '<p class="muted">Friends ✓</p>' : f ? (f.incoming ? `<button class="button" data-member-action="accept" data-person="${p.id}">Accept friend request</button>` : '<p class="muted">Friend request sent</p>') : `<button class="button secondary" data-member-action="request" data-person="${p.id}">Add friend</button>`}</div>`;
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
  app.innerHTML = `<p class="eyebrow">Better together</p><h1>Your movie circles.</h1><p class="subtitle">A list for your friends. A list for yourself. A place for every movie night.</p>${state.groups.map((g) => `<div class="group-card"><button class="group-open" data-group="${g.group_id}"><h3>${esc(g.group_name)}</h3><p class="muted">${g.member_count === 1 ? "Your own watchlist" : g.member_count + " people"} · Open watchlist →</p></button><div class="group-buttons"><button class="button secondary" data-members="${g.group_id}">Members</button><button class="button secondary" data-invite="${g.group_id}">Invite</button></div></div>`).join("") || empty("Start your first circle.", "Create a list below, then invite your friends whenever you like.")}<div class="form-panel"><h3>Create a watchlist</h3><p class="muted">Keep it personal or share it with friends.</p><form id="create-group"><input id="group-name" placeholder="Friday night crew" maxlength="100" aria-label="Watchlist name" required><button class="button">Create →</button></form></div><div class="form-panel"><h3>Have an invite?</h3><p class="muted">Paste a group code to join your friends.</p><form id="join-group"><input id="group-code" placeholder="Group invite code" aria-label="Group invite code" required><button class="button secondary">Join group</button></form></div>`;
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
      (b.onclick = () => {
        const id = b.dataset.invite;
        openModal(
          `<p class="eyebrow">Save a seat for your friends</p><h2>Invite to ${esc(state.groups.find((g) => g.group_id === id).group_name)}</h2><p class="muted">Friends need an email-verified account. Share this code so they can join from the Groups tab.</p><div id="direct-invite"></div><input readonly id="invite-code" aria-label="Invite code" value="${id}"><button class="button full" id="copy-code" style="margin-top:16px">Copy invite code</button>`,
        );
        inviteFriends(id).catch((e) => toast(e.message));
        $("#copy-code").onclick = (e) =>
          run(e.currentTarget, async () => {
            try {
              await navigator.clipboard.writeText(id);
              toast("Invite copied.");
            } catch {
              $("#invite-code").select();
              toast("Select and copy the code above.");
            }
          });
      }),
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
function profile() {
  app.innerHTML = `<div class="profile"><p class="eyebrow">Your corner of the cinema</p><h1>Hey, movie lover.</h1><p class="subtitle">${esc(state.user.email)}</p><div class="form-panel"><h3>Your name</h3><p class="muted">Shown to your groups when you suggest a movie.</p><form id="display-name-form"><input id="display-name" aria-label="Your display name" maxlength="60" value="${esc(state.displayName)}" placeholder="What should your friends call you?" required><button class="button" type="submit">Save name</button></form></div><div class="form-panel"><h3>Your streaming services</h3><p class="muted">Save the services you have, then choose “My streaming services” in Discover.</p><form id="streaming-profile" class="streaming-profile"><div><label for="profile-region">Country</label><select id="profile-region"><option value="US">United States</option><option value="GB">United Kingdom</option><option value="CA">Canada</option><option value="AU">Australia</option></select></div><div id="profile-services"></div><button class="button" type="submit">Save streaming services</button></form></div><div class="form-panel"><h3>Movie Mojo, on your home screen</h3><p class="muted">On iPhone: open in Safari, tap Share, then Add to Home Screen. On Android: use your browser's Install app option.</p></div><div class="form-panel"><h3>Your current watchlist</h3><p class="muted">${esc(state.group?.group_name || "No watchlist selected")}</p>${state.group ? `<button id="leave-group" class="button danger">${state.group.created_by === state.user.id ? "Delete watchlist" : "Leave group"}</button>` : ""}</div><button class="button secondary" id="refresh-data">Refresh watchlists</button><button class="button secondary" id="logout">Sign out</button><p class="muted">Movie information provided by TMDB. Streaming availability provided by JustWatch via TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p></div>`;
  $("#display-name-form").onsubmit = (e) => {
    e.preventDefault();
    run($("#display-name-form button"), async () => {
      const name = $("#display-name").value.trim();
      if (!name) throw new Error("Enter your name.");
      const rows = checked(
        await db
          .from("user_profiles")
          .update({ display_name: name })
          .eq("id", state.user.id)
          .select("id"),
      );
      if (!rows.length) throw new Error("Could not save your name.");
      state.displayName = name;
      toast("Name saved.");
    });
  };
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
      state.results = [];
      toast("Streaming services saved.");
    });
  };
  $("#logout").onclick = logout;
  $("#refresh-data").onclick = (e) =>
    run(e.currentTarget, async () => {
      await loadGroups();
      render();
      toast("Watchlists refreshed.");
    });
  if ($("#leave-group"))
    $("#leave-group").onclick = (e) =>
      run(e.currentTarget, async () => {
        const own = state.group.created_by === state.user.id;
        if (
          !confirm(
            own
              ? "Delete this watchlist and its group ratings permanently?"
              : "Leave this group?",
          )
        )
          return;
        if (own)
          checked(
            await db.rpc("mojo_delete_group", {
              target_group: state.group.group_id,
            }),
          );
        else {
          const rows = checked(
            await db
              .from("group_members")
              .delete()
              .eq("group_id", state.group.group_id)
              .eq("user_id", state.user.id)
              .select("id"),
          );
          if (!rows.length) throw new Error("Could not leave the group.");
        }
        state.group = null;
        await loadGroups();
        go("groups");
        toast(own ? "Watchlist deleted." : "You left the group.");
      });
}
async function logout() {
  await run($("#logout"), async () => {
    checked(await db.auth.signOut());
    state.group = null;
    state.groups = [];
    state.movies = [];
    state.results = [];
  });
}
async function initialize(user) {
  const version = ++authVersion;
  state.user = user;
  $("#navigation").hidden = true;
  if (!user) {
    state.approved = false;
    state.displayName = "";
    state.contributors = {};
    state.streamingServices = [];
    state.streamingRegion = "US";
    state.filters = {};
    render();
    return;
  }
  app.innerHTML = '<p class="loading">Getting your watchlists ready…</p>';
  try {
    const profile = checked(
      await db
        .from("user_profiles")
        .select("approved, streaming_services, streaming_region, display_name")
        .eq("id", user.id)
        .maybeSingle(),
    );
    if (version !== authVersion) return;
    state.approved = !!profile?.approved;
    state.displayName = profile?.display_name || "";
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
          modal.close();
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
