# Movie Mojo

A mobile-first movie-night app for private friend groups, hosted on GitHub Pages with Supabase authentication and storage and TMDB movie discovery.

## What's included

- Cinematic dark interface, bottom navigation, poster watchlists, and separate watched history.
- Equal-chance random picker from the selected group's unwatched movies.
- Title search and catalog discovery by genre, release dates, audience score, runtime, subscription streaming provider, and country. Title search and catalog filters are separate modes.
- Movie details, trailers, IMDb links, and streaming availability via TMDB / JustWatch.
- Personal lists use the same group model; invite friends whenever you want to share.
- Account approval, group invitations, checked write errors, and safe text rendering.
- Relative PWA URLs, home-screen support, and a network-first cached application shell. Live movies and authentication still need a network connection.

## Hosting

Serve this directory on GitHub Pages; no build step is required. `config.js` contains the Supabase public anon key and existing TMDB API key. Never put a Supabase service-role/secret key in browser code. Supabase JS is pinned in `index.html`.

For local preview: `python3 -m http.server 8765`.

## Database

`database-revamp.sql` records the schema/access changes applied for this release. It preserves existing lists, movies, accounts, and ratings. Approved users can access only groups they belong to; only creators can delete groups. Internal privileged functions live in `mojo_private`, which must remain outside the exposed Data API schemas. Public wrappers run as invoker. Account approvals remain an admin operation in the Supabase dashboard.

`mojo_create_group`, `mojo_join_group`, and `mojo_delete_group` perform group changes atomically. Invite codes are the group's UUID, so treat them like invitations and share only with intended members.

## Verification

Browser tests use Playwright and a local server. Set `NODE_PATH` to your Playwright installation when necessary. Set `CHROME_PATH` if Chrome is installed somewhere other than the macOS default.

- `node --check app.js`
- `node tests/browser.cjs`: fixture-based UI tests, mobile overflow, watched separation, picker, filters, search, details, invites, and desktop layout.
- `node tests/live-api.cjs`: live signed-out startup and TMDB API smoke tests. Does not sign in or modify user data.
- `tests/database-access.sql`: transactional database access tests; generated fixtures are rolled back.

Supabase's remaining platform advisories are an available Postgres security upgrade and disabled leaked-password protection. Configure these in the project dashboard.

Movie metadata is provided by TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming information is provided by JustWatch via TMDB.
