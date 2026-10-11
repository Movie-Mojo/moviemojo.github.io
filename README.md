# Movie Mojo

A mobile-first movie-night app for private friend groups, hosted on GitHub Pages with Supabase authentication and storage and TMDB movie discovery.

## What's included

- Cinematic dark interface, bottom navigation, poster watchlists, and separate watched history.
- Equal-chance random picker from the selected group's unwatched movies.
- Title search and catalog discovery by genre, release dates, audience score, runtime, subscription streaming provider, and country. Title search and catalog filters are separate modes.
- Movie details, trailers, IMDb links, and streaming availability via TMDB / JustWatch.
- Streaming services saved in your profile with a country setting, searchable multi-select discovery filters, and a “My streaming services” shortcut. Multiple services match movies available on any selection. The chooser shows up to 25 major service families available in the selected country; choosing a family includes its plan and channel variants. Searching the chooser uses the full regional catalog, including services outside the default list. Any streaming service applies no provider restriction. Subscription, free, and ad-supported streaming are included.
- Compact release-year range with From and To controls.
- Personal lists use the same group model; invite friends whenever you want to share.
- Account approval, group invitations, checked write errors, and safe text rendering.
- Relative PWA URLs, home-screen support, and a network-first cached application shell. Live movies and authentication still need a network connection.

- Discover mood shortcuts preserve your streaming preferences.
- Watchlist cards show who suggested a movie and an optional note. Set your display name in Profile; only the contributor can edit their note.

## Hosting

Serve this directory on GitHub Pages; no build step is required. `config.js` contains the Supabase public anon key and existing TMDB API key. Never put a Supabase service-role/secret key in browser code. Supabase JS is pinned in `index.html`.

For local preview: `python3 -m http.server 8765`.

## Database

`database-suggestions.sql` adds display names and group-private suggestion notes with author-only editing.

`database-streaming.sql` adds private streaming preferences with column-limited profile updates; approval remains admin-only.

`database-revamp.sql` records the schema/access changes applied for this release. It preserves existing lists, movies, accounts, and ratings. Approved users can access only groups they belong to; only creators can delete groups. Internal privileged functions live in `mojo_private`, which must remain outside the exposed Data API schemas. Public wrappers run as invoker. Email-verified accounts are automatically approved by `database-auto-approval.sql`. Enable Confirm email in Supabase Auth; membership checks still protect private groups.

`mojo_create_group`, `mojo_join_group`, and `mojo_delete_group` perform group changes atomically. Invite codes are the group's UUID, so treat them like invitations and share only with intended members.

## Verification

Browser tests use Playwright and a local server. Set `NODE_PATH` to your Playwright installation when necessary. Set `CHROME_PATH` if Chrome is installed somewhere other than the macOS default.

- `node --check app.js`
- `node tests/browser.cjs`: fixture-based UI tests, mobile overflow, watched separation, picker, filters, search, details, invites, and desktop layout.
- `node tests/live-api.cjs`: live signed-out startup and TMDB API smoke tests. Does not sign in or modify user data.
- `tests/database-suggestions.sql`: transactional contributor privacy and note permissions checks.
- `tests/database-access.sql`: transactional database access tests; generated fixtures are rolled back.

Supabase's remaining platform advisories are an available Postgres security upgrade and disabled leaked-password protection. Configure these in the project dashboard.

Movie metadata is provided by TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming information is provided by JustWatch via TMDB.
