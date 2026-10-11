const origins = new Set(["https://moviemojo.dev", "https://movie-mojo.github.io", "http://localhost:8765", "http://127.0.0.1:8765"]);
const integer = (v, min, max) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
const ids = (v) => /^\d+(?:[|,]\d+)*$/.test(v) && v.length <= 1000;
const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "1874-01-01" && v <= "2100-12-31" && new Date(v).toISOString().slice(0, 10) === v;
const rules = {
  ids: v => /^\d+(,\d+)*$/.test(v) && v.split(",").length <= 50 && v.split(",").every(id=>integer(id,1,999999999999)),
  include_availability: v => ["true","false"].includes(v),
  page: (v) => integer(v, 1, 500),
  query: (v) => v.trim().length > 0 && v.length <= 200,
  include_adult: (v) => v === "false",
  watch_region: (v) => /^[A-Z]{2}$/.test(v),
  with_genres: ids, without_genres: ids, with_watch_providers: ids,
  with_watch_monetization_types: (v) => /^(flatrate|free|ads|rent|buy)(\|(flatrate|free|ads|rent|buy))*$/.test(v),
  "vote_average.gte": (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 10,
  "vote_count.gte": (v) => integer(v, 0, 1000000),
  "with_runtime.gte": (v) => integer(v, 0, 1000),
  "with_runtime.lte": (v) => integer(v, 0, 1000),
  "primary_release_date.gte": date, "primary_release_date.lte": date,
  sort_by: (v) => ["popularity.desc", "vote_average.desc", "primary_release_date.desc", "primary_release_date.asc"].includes(v),
  append_to_response: (v) => v === "watch/providers,videos,external_ids",
};
export function movieURL(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !["path", "params"].includes(k))) throw Error("Invalid request");
  const path = body.path;
  if (!["discover/movie", "search/movie", "watch/providers/movie", "trending/movie/week", "movies/metadata"].includes(path) && !(typeof path === "string" && /^movie\/[1-9]\d{0,11}$/.test(path))) throw Error("Invalid endpoint");
  const params = body.params ?? {};
  if (typeof params !== "object" || Array.isArray(params)) throw Error("Invalid filters");
  const allowed = path === "movies/metadata" ? ["ids"] : path === "trending/movie/week" ? ["page", "include_availability"] : path === "search/movie" ? ["query", "page", "include_adult"] : path === "watch/providers/movie" ? ["watch_region"] : path.startsWith("movie/") ? ["append_to_response"] : Object.keys(rules).filter((k) => !["query", "append_to_response", "include_availability", "ids"].includes(k));
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [key, raw] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (!allowed.includes(key) || !["string", "number", "boolean"].includes(typeof raw) || !rules[key](String(raw))) throw Error("Invalid filters");
    url.searchParams.set(key, String(raw));
  }
  if (path === "movies/metadata" && !url.searchParams.has("ids")) throw Error("Missing ids");
  if (path === "search/movie" && !url.searchParams.has("query")) throw Error("Missing query");
  if (["search/movie", "discover/movie"].includes(path)) url.searchParams.set("include_adult", "false");
  return url;
}
async function readBody(req) {
  if (!req.body) throw Error("Missing body");
  const reader = req.body.getReader();
  let bytes = 0, text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 4096) { await reader.cancel(); throw Error("Too large"); }
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
export function createHandler({ env, fetch, now = Date.now }) {
  // Bounded per-isolate cache contains only public TMDB metadata, never user/session data.
  const cache = new Map();
  return async (req) => {
    const origin = req.headers.get("origin");
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (origins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
    if (origin && !origins.has(origin)) return reply(403, { error: "Origin not allowed" });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return reply(405, { error: "Use POST" });
    const authorization = req.headers.get("authorization") || "";
    if (!/^Bearer \S+$/i.test(authorization)) return reply(401, { error: "Sign in required" });
    let url;
    try { url = movieURL(await readBody(req)); }
    catch { return reply(400, { error: "Invalid movie request" }); }
    const secret = env("TMDB_API_KEY"), base = env("SUPABASE_URL"), key = env("SUPABASE_ANON_KEY");
    if (!secret || !base || !key) return reply(503, { error: "Movie service is not configured" });
    try {
      // Database validates the JWT and checks verified approval before incrementing shared counters.
      const gate = await fetch(`${base}/rest/v1/rpc/mojo_movie_request_allowed`, { method: "POST", headers: { authorization, apikey: key, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000) });
      if ([400, 401, 403].includes(gate.status)) return reply(403, { error: "Verified account required" });
      if (!gate.ok) return reply(503, { error: "Movie service temporarily unavailable" });
      const allowed = await gate.json();
      if (allowed !== true) { headers["Retry-After"] = "60"; return reply(429, { error: "Too many movie requests. Try again in a minute." }); }
      const cacheKey = url.toString(), hit = cache.get(cacheKey);
      if (hit && hit.expires > now()) return reply(200, hit.data);
      const includeAvailability = url.searchParams.get("include_availability") !== "false";
      url.searchParams.delete("include_availability");
      if (url.pathname.endsWith("/movies/metadata")) {
        const ids = [...new Set(url.searchParams.get("ids").split(","))];
        const results = new Array(ids.length);
        let next = 0;
        await Promise.all(Array.from({length:Math.min(5,ids.length)}, async () => {
          while(next < ids.length) {
            const index = next++, id = ids[index];
            const metadataKey = `metadata/${id}`;
            const saved = cache.get(metadataKey);
            if (saved && saved.expires > now()) {results[index]=saved.data; continue;}
            const response = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${encodeURIComponent(secret)}`, {headers:{Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(10000)});
            if(response.status === 404) {results[index]={id:Number(id)}; continue;}
            if(!response.ok) throw Error("Metadata unavailable");
            const movie = await response.json();
            const metadata = {id:movie.id,release_date:movie.release_date,vote_average:movie.vote_average,vote_count:movie.vote_count,genres:movie.genres};
            results[index]=metadata;
            if(cache.size>=500) cache.delete(cache.keys().next().value);
            cache.set(metadataKey,{data:metadata,expires:now()+300000});
          }
        }));
        const data = {results};
        if(cache.size>=500) cache.delete(cache.keys().next().value);
        cache.set(cacheKey,{data,expires:now()+300000});
        return reply(200,data);
      }
      url.searchParams.set("api_key", secret);
      const upstream = await fetch(url, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10000) });
      if (!upstream.ok) return reply(upstream.status === 404 ? 404 : 502, { error: "Movie information temporarily unavailable" });
      const data = await upstream.json();
      if (includeAvailability && url.pathname.endsWith("/trending/movie/week") && Array.isArray(data.results)) {
        // One authenticated request supplies availability for a bounded TMDB page.
        const movies = data.results.slice(0,20);
        let next = 0;
        await Promise.all(Array.from({length:Math.min(5,movies.length)}, async () => {
          while (next < movies.length) {
            const movie = movies[next++];
            if (!Number.isInteger(movie.id) || movie.id <= 0) continue;
            const providerURL = `https://api.themoviedb.org/3/movie/${movie.id}/watch/providers`;
            const saved = cache.get(providerURL);
            if (saved && saved.expires > now()) { movie.watch_availability = saved.data.results; continue; }
            const offers = await fetch(`${providerURL}?api_key=${encodeURIComponent(secret)}`, {headers:{Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(10000)});
            if (!offers.ok) throw Error("Availability unavailable");
            const availability = await offers.json();
            movie.watch_availability = availability.results || {};
            if (cache.size >= 500) cache.delete(cache.keys().next().value);
            cache.set(providerURL, {data:availability,expires:now()+300000});
          }
        }));
        data.results = movies;
      }

      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { data, expires: now() + 300000 });
      return reply(200, data);
    } catch { return reply(503, { error: "Movie information temporarily unavailable" }); }
  };
}
