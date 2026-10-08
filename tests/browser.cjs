const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fixture = {
  user: {
    id: "11111111-1111-1111-1111-111111111111",
    email: "friend@example.com",
  },
  groups: [
    {
      group_id: "22222222-2222-2222-2222-222222222222",
      group_name: "Friday Night Crew",
      created_by: "11111111-1111-1111-1111-111111111111",
      member_count: 3,
    },
  ],
  movies: [
    {
      id: "list1",
      watched: false,
      movies: {
        id: "m1",
        tmdb_id: "27205",
        title: "Inception",
        release_year: 2010,
        poster_url:
          "https://image.tmdb.org/t/p/w342/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
      },
    },
    {
      id: "list2",
      watched: false,
      movies: {
        id: "m2",
        tmdb_id: "157336",
        title: "Interstellar",
        release_year: 2014,
        poster_url:
          "https://image.tmdb.org/t/p/w342/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
      },
    },
    {
      id: "list3",
      watched: true,
      movies: {
        id: "m3",
        tmdb_id: "155",
        title: "The Dark Knight",
        release_year: 2008,
        poster_url:
          "https://image.tmdb.org/t/p/w342/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
      },
    },
  ],
};
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ fixture }) => {
      window.testData = fixture;
      window.supabase = {
        createClient: () => ({
          auth: {
            onAuthStateChange: (fn) =>
              setTimeout(
                () => fn("INITIAL_SESSION", { user: fixture.user }),
                0,
              ),
            signOut: async () => ({ error: null }),
          },
          rpc: async (name, args) => ({
            data:
              name === "get_user_groups_with_counts" ? fixture.groups : null,
            error: null,
          }),
          from: (table) => {
            const chain = {
              select() {
                return chain;
              },
              eq() {
                return chain;
              },
              order() {
                return chain;
              },
              limit() {
                return chain;
              },
              maybeSingle() {
                return Promise.resolve({
                  data: { approved: true },
                  error: null,
                });
              },
              single() {
                return Promise.resolve({ data: { id: "saved" }, error: null });
              },
              update(value) {
                fixture.movies[0].watched = value.watched;
                chain.changed = true;
                return chain;
              },
              insert() {
                return chain;
              },
              delete() {
                return chain;
              },
              then(resolve) {
                return Promise.resolve({
                  data: chain.changed
                    ? [{ id: "list1" }]
                    : table === "group_movies"
                      ? fixture.movies
                      : [],
                  error: null,
                }).then(resolve);
              },
            };
            return chain;
          },
        }),
      };
    },
    { fixture },
  );
  await page.route("**/cdn.jsdelivr.net/**", (r) => r.fulfill({ body: "" }));
  const urls = [];
  await page.route("**/api.themoviedb.org/**", (r) => {
    const url = new URL(r.request().url());
    urls.push(url.toString());
    let data = url.pathname.includes("watch/providers/movie")
      ? {
          results: [
            { provider_id: 8, provider_name: "Netflix", display_priority: 1 },
          ],
        }
      : url.pathname.includes("/movie/")
        ? {
            id: 27205,
            title: "Inception",
            release_date: "2010-07-16",
            runtime: 148,
            overview: "A dream within a dream.",
            vote_average: 8.4,
            "watch/providers": { results: {} },
            videos: { results: [] },
          }
        : {
            results: [
              {
                id: 27205,
                title: "Inception",
                release_date: "2010-07-16",
                vote_average: 8.4,
                poster_path: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
              },
            ],
            total_pages: 2,
          };
    r.fulfill({ json: data });
  });
  await page.goto("http://localhost:8765");
  await page.getByRole("heading", { name: "The watchlist." }).waitFor();
  assert.equal(await page.locator(".movie-card").count(), 2);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "/tmp/mojo-watchlist.png", fullPage: true });
  await page.locator("#pick").click();
  assert(
    !(await page
      .locator("#modal-content")
      .textContent()
      .then((t) => t.includes("The Dark Knight"))),
  );
  await page.locator("#picked-watched").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".movie-card").length === 1,
  );
  await page.locator("[data-tab=discover]").click();
  await page.locator("#results .movie-card").waitFor();
  await page.selectOption("#with_genres", "878");
  await page.selectOption('[name="vote_average.gte"]', "7");
  await page.selectOption('[name="with_runtime.lte"]', "120");
  await page.locator("#filter-form .button").first().click();
  await page.waitForTimeout(300);
  assert(
    urls.some(
      (u) =>
        u.includes("with_genres=878") &&
        u.includes("vote_average.gte=7") &&
        u.includes("with_runtime.lte=120"),
    ),
  );
  await page.locator("#query").fill("Inception");
  await page.locator("#search-form").evaluate((f) => f.requestSubmit());
  await page.waitForTimeout(200);
  assert(
    urls.some(
      (u) => u.includes("/search/movie") && u.includes("query=Inception"),
    ),
  );
  await page.locator("#results .movie-card").click();
  await page.getByRole("heading", { name: "Inception", exact: true }).waitFor();
  await page.locator("#close-modal").click();
  await page.locator("[data-tab=groups]").click();
  await page.getByRole("heading", { name: "Your movie circles." }).waitFor();
  await page.locator("[data-invite]").click();
  assert.equal(
    await page.locator("#invite-code").inputValue(),
    fixture.groups[0].group_id,
  );
  await page.locator("#close-modal").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("[data-tab=watchlist]").click();
  await page.screenshot({ path: "/tmp/mojo-desktop.png", fullPage: true });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: mobile overflow, watchlist separation, picker excludes watched, mark watched, discovery filters, title search, details, invites, desktop layout, no JS errors.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
