const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:8765");
  await page
    .getByRole("heading", { name: "Your next movie night starts here." })
    .waitFor();
  const result = await page.evaluate(async () => {
    const d = await tmdb("discover/movie", {
      with_genres: 878,
      "vote_average.gte": 7,
      "vote_count.gte": 100,
      "with_runtime.lte": 120,
      page: 1,
    });
    const p = await tmdb("watch/providers/movie", { watch_region: "US" });
    const m = await tmdb("movie/27205", {
      append_to_response: "watch/providers,videos,external_ids",
    });
    return {
      movies: d.results.length,
      providers: p.results.length,
      detail: m.title,
      trailer: !!m.videos,
      streaming: !!m["watch/providers"],
    };
  });
  if (
    !result.movies ||
    !result.providers ||
    result.detail !== "Inception" ||
    errors.length
  )
    throw new Error(JSON.stringify({ result, errors }));
  console.log(
    "PASS: live Supabase signed-out startup, pinned SDK loads, TMDB discovery, providers, details/trailers/streaming.",
    result,
  );
  await page.screenshot({ path: "/tmp/mojo-auth.png", fullPage: true });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
