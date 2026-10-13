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
          functions: { invoke: async (name, options) => {
            const res = await fetch("https://fhynhdekctvstiolykgo.supabase.co/functions/v1/" + name, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(options.body)});
            return {data:await res.json(),error:res.ok?null:{context:res}};
          } },
          auth: {
            mfa: {getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:"aal1",nextLevel:"aal1"},error:null}),listFactors:async()=>({data:{totp:[],phone:[]},error:null})},
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
                    bio:fixture.bio || "",
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
                  if(value.bio!==undefined) fixture.bio=value.bio;
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
  await page.route("**/functions/v1/movie-data", (r) => {
    const body = r.request().postDataJSON();
    const url = new URL("https://api.themoviedb.org/3/" + body.path);
    for (const [k,v] of Object.entries(body.params)) url.searchParams.set(k,v);
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
            videos: { results: [{ site: "YouTube", type: "Trailer", key: "test-trailer" }] },
            external_ids: { imdb_id: "tt1375666" },
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
  const result = await page.evaluate(async () => {
    const payload = '<img src=x onerror="window.auditXss=1"><script>window.auditXss=2</script>\"\'&';
    window.auditXss = 0;
    state.displayName = payload;
    state.groups[1].group_name = payload;
    state.movies[0].movies.title = payload;
    state.movies[0].suggestion_note = payload;
    watchlist();
    const title = document.querySelector('.movie-card h3').textContent;
    groups();
    const groupName = document.querySelectorAll('.group-card h3')[1].textContent;
    profile();
    const displayName = document.querySelector('#display-name').value;
    await new Promise(resolve=>setTimeout(resolve,100));
    return {escaped:title===payload && groupName===payload && displayName===payload, executed:window.auditXss};
  });
  assert(result.escaped && result.executed===0);
  console.log('PASS: malicious HTML in titles, notes, group names and display names rendered without execution. Mocked account only.');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
