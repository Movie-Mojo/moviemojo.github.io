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
      group_id: "66666666-6666-6666-6666-666666666666",
      group_name: "My personal list",
      created_by: "11111111-1111-1111-1111-111111111111",
      member_count: 1,
    },
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
      added_by: "11111111-1111-1111-1111-111111111111",
      suggestion_note: "A great <movie> to discuss",
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
            updateUser: async ({ data }) => {
              Object.assign((fixture.user.user_metadata ||= {}), data);
              return { error: null };
            },
          },
          rpc: async (name, args) => {
            if (name === "mojo_join_group") {
              fixture.joinedInvite = args.invite_code;
              if (!fixture.groups.some((g) => g.group_id === args.invite_code))
                fixture.groups.push({
                  group_id: args.invite_code,
                  group_name: "Invited group",
                  created_by: fixture.user.id,
                  member_count: 2,
                });
              return { error: null };
            }
            if (name === "mojo_personal_list")
              return {
                data: "66666666-6666-6666-6666-666666666666",
                error: null,
              };
            if (name === "mojo_group_people")
              return {
                data: [
                  { id: fixture.user.id, name: "Alex", owner: true },
                  {
                    id: "55555555-5555-5555-5555-555555555555",
                    name: "Taylor",
                    owner: false,
                  },
                ],
                error: null,
              };
            if (name === "mojo_watched_profile") {
              if (args.action === "remove") fixture.historyRemoved = true;
              if (args.action === "restore") fixture.historyRemoved = false;
              const movie = {
                id: "history1",
                title: "Arrival",
                release_year: 2016,
              };
              return {
                data: {
                  name: "Sam",
                  movies: fixture.historyRemoved ? [] : [movie],
                  excluded:
                    args.person === fixture.user.id && fixture.historyRemoved
                      ? [movie]
                      : [],
                },
                error: null,
              };
            }
            if (name === "mojo_social") {
              fixture.socialCalls = (fixture.socialCalls || []).concat(args);
              return {
                data: {
                  friends: [
                    {
                      id: "33333333-3333-3333-3333-333333333333",
                      name: "Sam",
                      accepted: true,
                      incoming: false,
                    },
                  ],
                  invitations: [],
                },
                error: null,
              };
            }
            if (name === "mojo_set_suggestion_note")
              fixture.movies.find(
                (m) => m.id === args.target_entry,
              ).suggestion_note = args.note;
            return {
              data:
                name === "get_user_groups_with_counts"
                  ? fixture.groups
                  : name === "mojo_group_contributors"
                    ? [
                        {
                          user_id: fixture.user.id,
                          display_name: fixture.displayName || "Friend",
                        },
                      ]
                    : null,
              error: null,
            };
          },
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
                  data: {
                    approved: true,
                    streaming_services: fixture.services || [],
                    streaming_region: "US",
                    display_name: fixture.displayName || "Friend",
                  },
                  error: null,
                });
              },
              single() {
                return Promise.resolve({ data: { id: "saved" }, error: null });
              },
              update(value) {
                if (table === "user_profiles") {
                  if (value.streaming_services)
                    fixture.services = value.streaming_services;
                  if (value.display_name)
                    fixture.displayName = value.display_name;
                } else fixture.movies[0].watched = value.watched;
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
            {
              provider_id: 1796,
              provider_name: "Netflix with Ads",
              display_priority: 8,
            },
            {
              provider_id: 10001,
              provider_name: "Obscure Channel",
              display_priority: 9,
            },
            {
              provider_id: 10002,
              provider_name: "Obscure Channel Amazon Channel",
              display_priority: 10,
            },
            {
              provider_id: 9,
              provider_name: "Amazon Prime Video",
              display_priority: 2,
            },
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
            "watch/providers": {
              results: {
                US: {
                  link: "https://www.themoviedb.org/movie/27205-inception/watch?locale=US",
                  flatrate: [
                    {
                      provider_id: 8,
                      provider_name: "Netflix",
                      logo_path: "/logo.png",
                    },
                  ],
                  rent: [
                    {
                      provider_id: 2,
                      provider_name: "Apple TV",
                      logo_path: "/apple.png",
                    },
                  ],
                  buy: [
                    {
                      provider_id: 9,
                      provider_name: "Amazon Video",
                      logo_path: "/amazon.png",
                    },
                  ],
                  ads: [
                    {
                      provider_id: 73,
                      provider_name: "Tubi",
                      logo_path: "/tubi.png",
                    },
                  ],
                },
              },
            },
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
  assert(
    await page
      .locator(".added-by")
      .first()
      .textContent()
      .then((t) => t.includes("Friend")),
  );
  await page.locator(".movie-card").first().click();
  await page
    .getByRole("heading", { name: "With a subscription", exact: true })
    .waitFor();
  await page.getByRole("heading", { name: "Rent", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Buy", exact: true }).waitFor();
  assert.equal(await page.locator(".watch-offer").count(), 4);
  assert(
    (await page.locator(".watch-offer").first().getAttribute("href")).includes(
      "/27205-inception/watch",
    ),
  );
  await page.locator("#edit-note").fill("Movie night favorite!");
  await page.locator("#note-form button").click();
  await page.waitForFunction(
    () => testData.movies[0].suggestion_note === "Movie night favorite!",
  );
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
  await page.locator("[data-tab=profile]").click();
  assert.equal(await page.locator("#leave-group").count(), 0);
  await page.locator("#manage-watchlists").click();
  await page.getByRole("heading", { name: "Manage watchlists", exact: true }).waitFor();
  assert.equal(await page.locator("[data-remove-group]").count(), 1);
  assert.equal(await page.locator("[data-remove-group]").getAttribute("data-remove-group"), fixture.groups[1].group_id);
  const canceled = page.waitForEvent("dialog").then(async (dialog) => {
    assert(dialog.message().includes("Friday Night Crew"));
    await dialog.dismiss();
  });
  await page.locator("[data-remove-group]").click();
  await canceled;
  assert.equal(await page.locator("#modal-content [data-remove-group]").count(), 1);
  await page.locator("#close-modal").click();
  await page.locator("#my-watched-history").click();
  await page.getByRole("heading", { name: "Arrival", exact: true }).waitFor();
  await page.locator("[data-history=remove]").click();
  await page.getByText("No watched movies yet.", { exact: true }).waitFor();
  await page.locator("#modal-content details summary").click();
  await page.locator("[data-history=restore]").click();
  await page.getByRole("heading", { name: "Arrival", exact: true }).waitFor();
  await page.locator("#close-modal").click();
  await page.locator("#display-name").fill("Alex");
  await page.locator("#display-name-form button").click();
  await page.waitForFunction(() => testData.displayName === "Alex");
  await page.locator("#profile-services summary").click();
  assert.equal(
    await page
      .locator(
        "#profile-services .service-option:visible [name=profile-provider]",
      )
      .count(),
    2,
  );
  await page.locator('[name="profile-provider"][value="8"]').check();
  await page.locator('[name="profile-provider"][value="9"]').check();
  await page.locator("#streaming-profile button[type=submit]").click();
  await page.waitForFunction(() => testData.services?.length === 2);
  await page.evaluate(() => initialize(state.user));
  await page.locator("#profile-services summary").click();
  assert(
    await page.locator('[name="profile-provider"][value="8"]').isChecked(),
  );
  assert(
    await page.locator('[name="profile-provider"][value="9"]').isChecked(),
  );
  await page.locator("[data-tab=discover]").click();
  await page.locator("#results .movie-card").waitFor();
  for (let i = 0; i < 6; i++) {
    // Even an already-open panel must close when a shortcut is selected.
    await page.locator("details.filters").evaluate((panel) => panel.open = true);
    await page.locator(`[data-mood="${i}"]`).click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator("details.filters").evaluate((panel) => panel.open), false);
    assert.equal(await page.locator(`[data-mood="${i}"]`).getAttribute("aria-pressed"), "true");
    assert(await page.locator("#mood-description").isVisible());
    const params = new URL(urls.filter((u) => u.includes("/discover/movie")).at(-1)).searchParams;
    assert.equal(params.get("with_runtime.gte"), "40");
    assert.equal(params.get("vote_count.gte"), i === 5 ? "500" : "100");
    if (i === 0) { assert.equal(params.get("with_genres"), "35"); assert.equal(params.get("without_genres"), "27"); }
    if (i === 1) assert.equal(params.get("with_genres"), "53|9648");
    if (i === 2) assert.equal(params.get("with_genres"), "10751|16");
    if (i === 3) assert.equal(params.get("with_genres"), "878|14");
    if (i === 4) assert.equal(params.get("with_runtime.lte"), "90");
    if (i === 5) assert.equal(params.get("vote_average.gte"), "7.5");
  }
  await page.locator('[data-mood="5"]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-mood="5"]').getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#mood-description").isVisible(), false);
  await page.locator('[data-mood="4"]').click();
  await page.waitForTimeout(200);
  await page.locator("details.filters > summary").click();
  await page.locator("#discovery-services summary").click();
  await page.locator("#use-my-services").check();
  await page.locator("#year-from").fill("2000");
  await page.locator("#year-to").fill("2020");
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
  const lastDiscover = () =>
    new URL(urls.filter((u) => u.includes("/discover/movie")).at(-1));
  assert.equal(
    lastDiscover().searchParams.get("with_watch_providers"),
    "8|9|1796",
  );
  assert.equal(
    lastDiscover().searchParams.get("primary_release_date.gte"),
    "2000-01-01",
  );
  assert.equal(
    lastDiscover().searchParams.get("primary_release_date.lte"),
    "2020-12-31",
  );
  assert(!lastDiscover().searchParams.has("useMyServices"));
  await page.locator('[data-mood="1"]').click();
  await page.waitForTimeout(200);
  assert.equal(lastDiscover().searchParams.get("with_watch_providers"), "8|9|1796");
  assert.equal(lastDiscover().searchParams.get("with_watch_monetization_types"), "flatrate|free|ads");
  assert.equal(await page.locator("details.filters").evaluate((panel) => panel.open), false);
  await page.locator("details.filters > summary").click();
  await page.locator("#use-my-services").uncheck();
  await page.locator('[name="discovery-provider"][value="8"]').check();
  await page.locator('[name="discovery-provider"][value="9"]').check();
  await page.locator("#filter-form button[type=submit]").click();
  await page.waitForTimeout(200);
  assert.equal(
    lastDiscover().searchParams.get("with_watch_providers"),
    "8|9|1796",
  );
  await page.locator("#discovery-services .provider-search").fill("netflix");
  assert(
    await page.locator('[data-provider-name="amazon prime video"]').isHidden(),
  );
  await page.locator("#discovery-services .provider-search").fill("");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "/tmp/mojo-streaming-discover.png",
    fullPage: true,
  });
  await page.locator("#discovery-services .provider-search").fill("obscure");
  await page.locator('[name="discovery-provider"][value="10001"]').check();
  await page.locator("#discovery-services .provider-search").fill("");
  assert(
    await page.locator('[data-provider-name="obscure channel"]').isVisible(),
  );
  await page.locator("#filter-form button[type=submit]").click();
  await page.waitForTimeout(200);
  assert(
    lastDiscover().searchParams.get("with_watch_providers").includes("10001"),
  );
  await page.locator('[name="discovery-provider"][value="10001"]').uncheck();
  await page.locator('[name="discovery-provider"][value="8"]').uncheck();
  await page.locator('[name="discovery-provider"][value="9"]').uncheck();
  await page.locator("#filter-form button[type=submit]").click();
  await page.waitForTimeout(200);
  assert(!lastDiscover().searchParams.has("with_watch_providers"));
  assert.equal(lastDiscover().searchParams.get("with_watch_monetization_types"), "flatrate|free|ads");
  await page.locator('[data-availability="buy-rent"]').click();
  await page.waitForTimeout(300);
  assert.equal(lastDiscover().searchParams.get("with_watch_monetization_types"), "rent|buy");
  assert(!lastDiscover().searchParams.has("with_watch_providers"));
  assert.equal(await page.locator('[data-availability="buy-rent"]').getAttribute("aria-pressed"), "true");
  await page.locator('[data-availability="all"]').click();
  await page.waitForTimeout(300);
  assert(!lastDiscover().searchParams.has("with_watch_monetization_types"));
  assert.equal(await page.locator('[data-availability="all"]').getAttribute("aria-pressed"), "true");
  await page.locator('[data-availability="streaming"]').click();
  await page.waitForTimeout(300);
  assert.equal(lastDiscover().searchParams.get("with_watch_monetization_types"), "flatrate|free|ads");
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
  assert.equal(await page.locator("[data-remove-group]").count(), 0);
  assert.equal(await page.locator("[data-invite]").count(), 1);
  await page.locator("[data-members]").click();
  await page.getByRole("heading", { name: "Taylor", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add friend", exact: true }).click();
  await page.waitForFunction(() =>
    testData.socialCalls.some(
      (x) =>
        x.action === "request" &&
        x.target === "55555555-5555-5555-5555-555555555555",
    ),
  );
  await page.locator("#close-modal").click();
  await page.locator("[data-invite]").click();
  assert.equal(
    await page.locator("#invite-code").inputValue(),
    fixture.groups[1].group_id,
  );
  assert.equal(
    await page.locator("#invite-link").inputValue(),
    new URL(page.url()).origin + "/?invite=" + fixture.groups[1].group_id,
  );
  await page.locator("#send-direct-invite").click();
  await page.waitForFunction(() =>
    testData.socialCalls.some((x) => x.action === "invite"),
  );
  await page.locator("#close-modal").click();
  await page.locator("[data-tab=friends]").click();
  await page.getByRole("heading", { name: "Friends.", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Sam", exact: true }).waitFor();
  await page.locator("[data-history-person]").click();
  await page.getByRole("heading", { name: "Arrival", exact: true }).waitFor();
  assert.equal(await page.locator("[data-history]").count(), 0);
  await page.locator("#close-modal").click();
  await page
    .locator("#friend-code")
    .fill("44444444-4444-4444-4444-444444444444");
  await page.locator("#friend-request button").click();
  await page.waitForFunction(() =>
    testData.socialCalls.some((x) => x.action === "request"),
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "/tmp/mojo-friends.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("[data-tab=watchlist]").click();
  await page.screenshot({ path: "/tmp/mojo-desktop.png", fullPage: true });
  const baseURL = page.url().split("#")[0].split("?")[0];
  await page.goto(baseURL + "?invite=77777777-7777-7777-7777-777777777777");
  await page.locator("#accept-link").click();
  await page.waitForFunction(
    () => testData.joinedInvite === "77777777-7777-7777-7777-777777777777",
  );
  await page.locator("#close-modal").waitFor({ state: "hidden" });
  await page.addInitScript(() => {
    testData.user.user_metadata = {
      mojo_invite: "88888888-8888-8888-8888-888888888888",
    };
  });
  await page.goto(baseURL);
  await page.waitForFunction(
    () => testData.joinedInvite === "88888888-8888-8888-8888-888888888888",
  );
  await page.waitForFunction(
    () => testData.user.user_metadata.mojo_invite === null,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: mobile overflow, watchlist separation, picker excludes watched, mark watched, saved/reloaded streaming profiles, multi-select and My services filters, provider search, year ranges, title search, details, invites, desktop layout, no JS errors.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
