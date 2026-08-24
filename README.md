# Favorites

A fast, self-hosted favorites (speed-dial) page that syncs across devices. One Cloudflare Worker serves a single-file frontend and a tiny authenticated state API backed by Workers KV. No framework, no build step, no database, no accounts.

**Live instance:** https://favorites.mykk.us · **Marketing site & self-service tokens:** https://favoritespage.us

## Features

- **Speed-dial grid** — add a name and a URL, get a tile. Bare domains work; `example.com` becomes `https://example.com` automatically, in both the add and edit dialogs.
- **Local files & folders** — `file:///` URLs are first-class, and pasted local paths (`C:\Users\me`, `\\server\share`, `/home/me`) convert automatically. File tiles get a folder icon, and because browsers refuse to open `file://` links from a web page, clicking one copies the location for pasting into the address bar (with a local-links extension installed, the click simply opens it). Bookmark imports keep their `file://` entries too.
- **Icons that just work** — a same-origin icon proxy resolves each tile through [Dashboard Icons](https://dashboardicons.com) (high-quality product logos, matched by host and by the shortcut's name), then DuckDuckGo's favicon service (a privacy choice over Google's), then the site's own favicon, then a colored letter-avatar — always returning an image, so there are no `404`s in the console. Any favorite can also set an explicit **Icon URL** (icons8, simpleicons, any image CDN) that overrides the whole chain.
- **Pages** — group tiles onto named pages via `?p=homelab`; a chip bar switches between them and the bare URL shows the main page. Page assignment is a per-favorite field; a tab-style **Home** chip always gets you back.
- **Sort your way** — tiles are alphabetical by default, or switch a page to **manual** with the header toggle and long-press-drag tiles into any order. Sort mode is remembered per page and synced.
- **Open how you like** — plain click opens in place; **Ctrl/Cmd-click** a new tab, **Shift-click** a new window, and right-click gives the normal browser menu.
- **Long-press to edit or delete** — 500 ms hold on any tile. Deletion uses a two-tap confirm (no browser `confirm()` dialogs).
- **Themes and backdrop** — dark or light theme, an optional background color, and separate **desktop and mobile wallpapers** (screens under 800px get the mobile image, live on rotate/resize).
- **Responsive layout** — tiles use large icons in a grid that packs as many per row as fit, dropping to exactly **three per row on portrait phones** (under 500px). The mobile wallpaper has its own, wider breakpoint (under 800px), so a phone in landscape keeps its wallpaper while switching to the denser grid. Tile labels wrap to **two lines** before truncating with an ellipsis (hover shows the full name).
- **Import & export** — Settings → Data exports the full document as JSON, and imports either that JSON or a browser bookmarks HTML file (folders become pages). Imports merge and de-duplicate; nothing is overwritten.
- **Cross-device sync, one field** — paste your sync token under Settings → Sync and every device converges on the same favorites and settings. Leave it blank and the app is fully functional local-only.
- **Per-device default page** — each device can open to a different page (e.g. a `mobile` page on your phone) without affecting the synced document.
- **Multi-user, no accounts** — each user has their own token and their own isolated document. There is no login page and no way for users to see each other's data. Tokens come from the owner (`issue-token.sh`) or, rate-limited, from the self-service portal at [favoritespage.us](https://favoritespage.us).

## How it is built

```
favorites/
├── public/
│   └── index.html    # the entire frontend: HTML + CSS + JS in one file
├── worker.js         # /api/state handler + auth, /icon proxy
├── issue-token.sh    # issue / map / revoke user tokens
└── wrangler.toml     # bindings, assets dir, custom domain route
```

- **Frontend** — one HTML file, inline CSS and JS, no bundler, no npm, no CDN dependencies. Cloudflare serves it as a static asset before the Worker is ever invoked.
- **API** — the Worker handles two routes:

  ```
  GET  /api/state   Authorization: Bearer <token>   → the user's JSON document, or literal null
  PUT  /api/state   Authorization: Bearer <token>   → 200 {"ok":true} | 400 bad json | 401 | 413 > 100 KB
  GET  /icon?host=<hostname>                         → always 200: an image (Dashboard Icons →
                                                       DuckDuckGo → site favicon → letter-avatar SVG)
  ```

- **Icon proxy** — `/icon` is unauthenticated and always returns an image, so the browser never talks to third-party icon services directly and never logs a `404`. Results are edge-cached for days; bumping the `v=` in the icon URL invalidates the cache when the resolution logic changes.
- **Auth** — the bearer token *is* the identity. The Worker hashes it (SHA-256) and looks up `token:<hash>` → `userId` in KV; the user's document lives at `state:<userId>`. Plaintext tokens are never stored server-side, and the sync token lives only in each device's local storage — never inside the synced document.
- **State document** — one JSON blob per user: `shortcuts` (each with a name, url, and optional `iconUrl` / `page`) plus `settings` (theme, desktop and mobile wallpaper URLs, background color, and per-page sort mode). The device-local default page is deliberately *not* in it.
- **Sync model** — last-write-wins on the document's `updatedAt`, whole document, per user. Two of *your own* devices editing offline resolve to the newest write; different users can never touch each other's documents. No merging, no CRDTs — deliberately.
- **Storage** — Workers KV, two key shapes (`token:<hash>` and `state:<userId>`), 100 KB cap per user document. The free tier allows 1,000 KV writes per day across all users; a handful of active users is fine. (The signup portal below adds short-lived `signup:*` throttle keys to the same namespace.)

## The marketing site (favoritespage.us)

The marketing site and self-service token portal live in their own repo, **[MichalAFerber/favoritespage](https://github.com/MichalAFerber/favoritespage)** — a second, independent Worker on the same pattern, bound to the **same KV namespace**, so a token issued there works here immediately (it writes exactly the `token:<hash>` → `userId` mapping `issue-token.sh` writes). Signups are rate-capped per IP and per day, with `SIGNUP_DAILY_CAP = "0"` as the kill switch back to invite-only; that repo's README has the details. Owner-issued tokens via `issue-token.sh` work exactly as before.

## Using the app

1. Open the site. Tap **+** to add a favorite; long-press a tile to edit or delete it.
2. In the add/edit dialog, set an optional **Page** (leave blank for the main page) and an optional **Icon URL** that overrides the auto-detected icon; clear it to revert.
3. Use the **chip bar** to switch pages, or link straight to `?p=<page>`. The header **⇅** toggle switches the current page between alphabetical and manual order; in manual mode, long-press and drag tiles to rearrange them.
4. **Settings (gear)** — theme, desktop and mobile wallpaper URLs, background color, this device's default page, the sync token, and **Data** (export / import).
5. To sync a device: get a token from the owner, open Settings → Sync, paste it, save. That's the entire setup — the app always syncs against the site it was loaded from.

## Deploying your own

Prerequisites: a Cloudflare account and [wrangler](https://developers.cloudflare.com/workers/wrangler/) logged in.

```bash
# 1. Create a KV namespace and put its id (and your account id) in wrangler.toml
wrangler kv namespace create favorites-state

# 2. Point the custom domain route in wrangler.toml at a domain in your zone
#    (or delete the [[routes]] block to use the workers.dev URL)

# 3. Deploy
cd favorites
wrangler deploy

# 4. Issue yourself a token (see below), then verify:
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/api/state   # 401
curl -s -H "Authorization: Bearer $TOKEN" https://<your-domain>/api/state  # null
```

## Maintaining users

Owner-side user management is `favorites/issue-token.sh`, run from the `favorites/` directory. Issuing a token *is* creating a user; there is nothing else to set up. Self-service users from [favoritespage.us](https://favoritespage.us) appear in KV the same way (`token:<hash>` → `u<hex>`), and every command below applies to them identically.

```bash
./issue-token.sh alice              # new user: generates a token, prints it ONCE,
                                    # and stores only its hash in KV
./issue-token.sh alice --existing   # map a token that is already on devices
                                    # (pasted silently from stdin — for migrations)
./issue-token.sh --revoke           # revoke a token (pasted silently);
                                    # the user's saved favorites are untouched
```

- **Onboarding** — run `./issue-token.sh <name>`, hand the printed token to the user (password manager recommended), and have them paste it under Settings → Sync. Done.
- **Rotation** — issue a new token for the same user id, have them update their devices, then revoke the old token. Their data is keyed by user id, not by token, so nothing is lost.
- **Offboarding** — `--revoke` kills access immediately. To also delete their data:

  ```bash
  wrangler kv key delete "state:<userId>" --namespace-id <your-namespace-id>
  ```

- **Inspecting** — `wrangler kv key list --namespace-id <id>` shows every user and token hash; `wrangler kv key get "state:<userId>" --namespace-id <id>` shows a user's document; `wrangler tail favorites` streams live request logs.

## Credits

Favicon: [Favorites](https://img.icons8.com/stickers/100/favorites.png) icon by [Icons8](https://icons8.com).

## License

[MIT](LICENSE)
