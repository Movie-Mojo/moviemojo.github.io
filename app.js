"use strict";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s, root = document) => root.querySelector(s);
const app = $("#app"),
  modal = $("#modal");
const state = {
  user: null,
  approved: false,
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
function card(movie, index) {
  const poster = movie.poster_url || image(movie.poster_path);
  const year =
    movie.release_year || movie.release_date?.slice(0, 4) || "Year unknown";
  return `<button class="movie-card" data-movie="${index}" aria-label="Details for ${esc(movie.title)}"><div class="poster-wrap">${poster ? `<img loading="lazy" src="${esc(poster)}" alt="${esc(movie.title)} poster" onerror="this.hidden=true">` : '<div class="poster-fallback">✦</div>'}${movie.vote_average ? `<span class="score">★ ${Number(movie.vote_average).toFixed(1)}</span>` : ""}</div><h3>${esc(movie.title)}</h3><p>${esc(year)}</p></button>`;
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
            "id,watched,added_by,added_at,movies(id,title,description,poster_url,release_year,tmdb_id)",
          )
          .eq("group_id", state.group.group_id)
          .order("added_at", { ascending: false }),
      )
    : [];
  state.movies = state.movies.filter((m) => m.movies);
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
    app.innerHTML = `<div class="auth"><p class="eyebrow">You're on the guest list</p><h1>Almost movie time.</h1><p class="subtitle">Your account needs approval before you can access private watch groups. Contact the admin at titav@titav.tech.</p><button id="approval-refresh" class="button full">Check approval</button><button id="logout" class="button secondary full">Sign out</button></div>`;
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
    ["watchlist", "discover", "groups", "profile"].includes(tab) &&
    tab !== state.tab
  ) {
    state.tab = tab;
    render();
  }
});
function auth(signup = false) {
  $("#navigation").hidden = true;
  app.innerHTML = `<section class="auth"><p class="eyebrow">Good movies. Better company.</p><h1>${signup ? "Join the movie night." : "Your next movie night starts here."}</h1><p class="subtitle">Find something worth watching. Save it with your people.</p><form id="auth-form"><div><label for="email">Email address</label><input id="email" type="email" autocomplete="email" required></div><div><label for="password">Password</label><input id="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required></div><button class="button" type="submit">${signup ? "Create account" : "Sign in"} →</button></form><p class="auth-switch muted">${signup ? "Already have an account?" : "New to Movie Mojo?"} <button class="link-button" id="auth-switch">${signup ? "Sign in" : "Create account"}</button></p>${signup ? '<p class="muted">Private by design. New accounts need admin approval.</p>' : '<button class="link-button" id="reset-password">Forgot password?</button>'}</section>`;
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
          ? await db.auth.signUp(credentials)
          : await db.auth.signInWithPassword(credentials),
      );
      if (signup)
        toast(
          "Account created. Check your email, then wait for admin approval.",
        );
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
  app.innerHTML = `<p class="eyebrow">Your movie night, sorted</p><h1>The watchlist.</h1><p class="subtitle">Less scrolling. More watching.</p><div class="toolbar"><select id="group-select" class="group-select" aria-label="Choose watchlist">${state.groups.map((g) => `<option value="${esc(g.group_id)}" ${g.group_id === state.group?.group_id ? "selected" : ""}>${esc(g.group_name)}</option>`).join("") || "<option>No watchlists yet</option>"}</select><button id="add-movie" class="button secondary">＋ Add a movie</button></div><section class="picker-hero"><div><p class="eyebrow">Let fate take the remote</p><h2>Can't decide tonight?</h2><p>One random pick from your unwatched movies.<br>Every movie gets an equal shot.</p></div><button class="button" id="pick">✦ Pick tonight</button></section><div class="section-row"><div class="pills"><button class="pill ${!state.watched ? "active" : ""}" id="unwatched">To watch</button><button class="pill ${state.watched ? "active" : ""}" id="watched">Watched</button></div><span class="count">${entries.length} movie${entries.length === 1 ? "" : "s"}</span></div><div class="grid">${entries.map((m, i) => card(m.movies, i)).join("") || empty(state.group ? "The opening scene." : "Bring your people together.", state.group ? "Add a few movies to get your next movie night started." : "Create a group, or a watchlist just for you.", `<button id="empty-action" class="button">${state.group ? "Find a movie" : "Create a watchlist"}</button>`)}</div><div class="manual"><button id="manual-add" class="link-button">Can't find it? Add a movie manually</button></div>`;
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
function discover() {
  app.innerHTML = `<p class="eyebrow">A little inspiration</p><h1>Find your next favorite.</h1><p class="subtitle">Follow a mood. Explore a genre. See what catches your eye.</p><form id="search-form" class="search-row"><input name="query" id="query" type="search" placeholder="Search movie titles…" aria-label="Movie title" value="${esc(state.query)}"><button class="button" type="submit">Search</button></form><details class="filters" ${state.mode === "discover" ? "open" : ""}><summary>Browse by filters</summary><form id="filter-form"><p class="muted">Filters browse the movie catalog. Title search runs separately.</p><div class="filter-grid">${select("with_genres", "Genre", [["", "All genres"], ...genres])}<div><label for="year-from">Released from</label><input id="year-from" name="primary_release_date.gte" type="date" value="${esc(state.filters["primary_release_date.gte"] || "")}"></div><div><label for="year-to">Released through</label><input id="year-to" name="primary_release_date.lte" type="date" value="${esc(state.filters["primary_release_date.lte"] || "")}"></div>${select(
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
  ])}<div><label for="with_watch_providers">Streaming service</label><select name="with_watch_providers" id="with_watch_providers"><option value="">Any service</option></select></div></div><label class="checkbox"><input type="checkbox" id="hide-watched" ${state.filters.hideWatched ? "checked" : ""}> Hide movies watched by this group</label><div class="filter-actions"><button class="button" type="submit">Find movies →</button><button class="button secondary" id="reset-filters" type="button">Reset</button></div></form></details><div class="section-row"><h2 id="results-title">${state.mode === "search" ? "Search results" : "Your next obsession"}</h2><span class="count">${state.group ? esc(state.group.group_name) : "Choose a group to save movies"}</span></div><div id="results" class="grid"></div><button class="button secondary full" id="load-more" hidden>Load more movies</button>`;
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
    const data = Object.fromEntries(new FormData(e.target));
    if (
      data["primary_release_date.gte"] &&
      data["primary_release_date.lte"] &&
      data["primary_release_date.gte"] > data["primary_release_date.lte"]
    ) {
      toast("The start date must come before the end date.");
      return;
    }
    state.filters = { ...data, hideWatched: $("#hide-watched").checked };
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
  $("#watch_region").onchange = () => loadProviders($("#watch_region").value);
  loadProviders(state.filters.watch_region || "US");
  if (state.results.length) renderResults();
  else fetchDiscover();
}
async function loadProviders(region) {
  const select = $("#with_watch_providers");
  try {
    const data = await tmdb("watch/providers/movie", { watch_region: region });
    if (!select?.isConnected) return;
    select.innerHTML =
      '<option value="">Any service</option>' +
      data.results
        .sort((a, b) => (a.display_priority || 0) - (b.display_priority || 0))
        .map(
          (p) =>
            `<option value="${p.provider_id}">${esc(p.provider_name)}</option>`,
        )
        .join("");
    select.value =
      state.filters.watch_region === region
        ? state.filters.with_watch_providers || ""
        : "";
  } catch (e) {
    toast(e.message);
  }
}
async function fetchDiscover(append = false) {
  const request = ++state.request;
  const nextPage = append ? state.page + 1 : 1;
  const results = $("#results");
  if (!append)
    results.innerHTML = '<p class="loading">Finding the good stuff…</p>';
  try {
    const f = state.filters;
    const params =
      state.mode === "search"
        ? { query: state.query }
        : {
            ...f,
            sort_by: f.sort_by || "popularity.desc",
            "vote_count.gte": 100,
            "primary_release_date.lte":
              f["primary_release_date.lte"] ||
              new Date().toISOString().slice(0, 10),
            with_watch_monetization_types: f.with_watch_providers
              ? "flatrate"
              : "",
            watch_region: f.watch_region || "US",
          };
    delete params.hideWatched;
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
    list.map(card).join("") ||
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
    data["watch/providers"]?.results?.[state.filters.watch_region || "US"];
  const region = state.filters.watch_region || "US";
  openModal(
    `${poster ? `<img class="detail-poster" src="${esc(poster)}" alt="${esc(movie.title)} poster">` : ""}<div class="detail-heading"><p class="eyebrow">${entry ? "On your watchlist" : "Worth a watch"}</p><h2>${esc(data.title || movie.title)}</h2><p class="muted">${esc(data.release_date?.slice(0, 4) || movie.release_year || "")} ${data.runtime ? "· " + data.runtime + " min" : ""}</p>${data.vote_average ? `<p>★ ${Number(data.vote_average).toFixed(1)} <span class="muted">TMDB audience score</span></p>` : ""}</div><p class="overview">${esc(data.overview || movie.description || "No synopsis available for this movie.")}</p>${providers?.flatrate?.length ? `<p class="muted">Streaming in ${region}</p><div class="provider-list">${providers.flatrate.map((p) => `<img src="${image(p.logo_path)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`).join("")}</div><a class="link-button" href="${esc(providers.link)}" target="_blank" rel="noopener">Check availability on TMDB / JustWatch ↗</a>` : '<p class="muted">No subscription streaming information available for this country.</p>'}<div class="details-actions">${entry ? `<button id="toggle-watched" class="button">${entry.watched ? "Move to watchlist" : "Mark watched"}</button><button id="remove-movie" class="button danger">Remove</button>` : `<label for="save-group">Save to watchlist</label><select id="save-group">${state.groups.map((g) => `<option value="${g.group_id}" ${g.group_id === state.group?.group_id ? "selected" : ""}>${esc(g.group_name)}</option>`).join("")}</select><button id="save-movie" class="button" ${!state.group ? "disabled" : ""}>＋ Add to watchlist</button>`}${trailer ? `<a class="button secondary" href="https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}" target="_blank" rel="noopener">Watch trailer ↗</a>` : ""}${data.external_ids?.imdb_id ? `<a class="button secondary" href="https://www.imdb.com/title/${encodeURIComponent(data.external_ids.imdb_id)}/" target="_blank" rel="noopener">IMDb ↗</a>` : ""}</div>`,
  );
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
        await saveMovie(data, $("#save-group").value);
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
async function saveMovie(movie, groupId) {
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
    await db
      .from("group_movies")
      .insert({ movie_id: id, group_id: groupId, added_by: state.user.id }),
  );
  if (groupId === state.group?.group_id) await loadMovies();
}
function manualAdd() {
  if (!state.group) {
    go("groups");
    return;
  }
  openModal(
    '<p class="eyebrow">Your own selection</p><h2>Add a movie manually</h2><form id="manual-form" class="form-panel"><label for="manual-title">Movie title</label><input id="manual-title" maxlength="200" required><button class="button full" style="margin-top:16px">Add to watchlist</button></form>',
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
      await saveMovie({ title }, state.group.group_id);
      modal.close();
      render();
      toast("Movie added.");
    });
  };
}
function groups() {
  app.innerHTML = `<p class="eyebrow">Better together</p><h1>Your movie circles.</h1><p class="subtitle">A list for your friends. A list for yourself. A place for every movie night.</p>${state.groups.map((g) => `<div class="group-card"><button class="group-open" data-group="${g.group_id}"><h3>${esc(g.group_name)}</h3><p class="muted">${g.member_count === 1 ? "Your own watchlist" : g.member_count + " people"} · Open watchlist →</p></button><button class="button secondary" data-invite="${g.group_id}">Invite</button></div>`).join("") || empty("Start your first circle.", "Create a list below, then invite your friends whenever you like.")}<div class="form-panel"><h3>Create a watchlist</h3><p class="muted">Keep it personal or share it with friends.</p><form id="create-group"><input id="group-name" placeholder="Friday night crew" maxlength="100" aria-label="Watchlist name" required><button class="button">Create →</button></form></div><div class="form-panel"><h3>Have an invite?</h3><p class="muted">Paste a group code to join your friends.</p><form id="join-group"><input id="group-code" placeholder="Group invite code" aria-label="Group invite code" required><button class="button secondary">Join group</button></form></div>`;
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
          `<p class="eyebrow">Save a seat for your friends</p><h2>Invite to ${esc(state.groups.find((g) => g.group_id === id).group_name)}</h2><p class="muted">Friends need an approved account. Share this code so they can join from the Groups tab.</p><input readonly id="invite-code" aria-label="Invite code" value="${id}"><button class="button full" id="copy-code" style="margin-top:16px">Copy invite code</button>`,
        );
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
  app.innerHTML = `<div class="profile"><p class="eyebrow">Your corner of the cinema</p><h1>Hey, movie lover.</h1><p class="subtitle">${esc(state.user.email)}</p><div class="form-panel"><h3>Movie Mojo, on your home screen</h3><p class="muted">On iPhone: open in Safari, tap Share, then Add to Home Screen. On Android: use your browser's Install app option.</p></div><div class="form-panel"><h3>Your current watchlist</h3><p class="muted">${esc(state.group?.group_name || "No watchlist selected")}</p>${state.group ? `<button id="leave-group" class="button danger">${state.group.created_by === state.user.id ? "Delete watchlist" : "Leave group"}</button>` : ""}</div><button class="button secondary" id="refresh-data">Refresh watchlists</button><button class="button secondary" id="logout">Sign out</button><p class="muted">Movie information provided by TMDB. Streaming availability provided by JustWatch via TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p></div>`;
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
    render();
    return;
  }
  app.innerHTML = '<p class="loading">Getting your watchlists ready…</p>';
  try {
    const profile = checked(
      await db
        .from("user_profiles")
        .select("approved")
        .eq("id", user.id)
        .maybeSingle(),
    );
    if (version !== authVersion) return;
    state.approved = !!profile?.approved;
    if (state.approved) await loadGroups();
    if (version !== authVersion) return;
    $("#navigation").hidden = !state.approved;
    state.tab = ["watchlist", "discover", "groups", "profile"].includes(
      location.hash.slice(1),
    )
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
