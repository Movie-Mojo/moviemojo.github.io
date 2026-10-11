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
    const endpoint = SUPABASE_URL + "/functions/v1/movie-data";
    const body = JSON.stringify({path:"discover/movie",params:{page:1}});
    const unauthenticated = await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",apikey:SUPABASE_ANON_KEY},body});
    const anonymous = await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+SUPABASE_ANON_KEY},body});
    return {unauthenticated:unauthenticated.status,anonymous:anonymous.status,frontendKey:typeof TMDB_API_KEY};
  });
  if (result.unauthenticated !== 401 || result.anonymous !== 403 || result.frontendKey !== "undefined" || errors.length)
    throw new Error(JSON.stringify({result,errors}));
  console.log("PASS: signed-out startup, live proxy rejects missing/anonymous user tokens, no frontend TMDB key.",result);
  await page.screenshot({ path: "/tmp/mojo-auth.png", fullPage: true });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
