# Favorites

A fast, self-hosted favorites (speed-dial) page that syncs across devices. One Cloudflare Worker serves a single-file frontend and a tiny authenticated state API backed by Workers KV. No framework, no build step, no database, no accounts.

**Live instance:** https://app.favoritespage.us · **Marketing site and Favorites Pro:** https://favoritespage.us

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
- **Cross-device sync, one field** — paste your token into Settings → Sync → **License key** and every device converges on the same favorites and settings. Leave it blank and the app is fully functional local-only.
- **Per-device default page** — each device can open to a different page (e.g. a `mobile` page on your phone) without affecting the synced document.
- **Multi-user, no accounts** — each user has their own token and their own isolated document. There is no login page and no way for users to see each other's data. On your own instance, you issue tokens with `issue-token.sh`; on the hosted instance, the Favorites Pro license key from [favoritespage.us](https://favoritespage.us) is the token.

## How it is built

```
favorites/
├── public/
│   └── index.html    # the entire frontend: HTML + CSS + JS in one file
├── worker.js         # /api/state handler + auth, /icon proxy
├── issue-token.sh    # issue / map / revoke user tokens
└── wrangler.toml     # bindings, assets dir, custom domain route
```

- **Frontend** — one HTML file, inline CSS and JS, no bundler, no npm, no CDN dependencies. Cloudflare serves it as a static asset before the Worker is ever invoked. The one external script is the Plausible analytics tag, and it loads only on `app.favoritespage.us`, so a self-hosted copy sends TGWAB's analytics nothing.
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
- **Storage** — Workers KV, two key shapes (`token:<hash>` and `state:<userId>`), 100 KB cap per user document. The free tier allows 1,000 KV writes per day across all users; a handful of active users is fine.

## The marketing site (favoritespage.us)

The marketing site, Stripe checkout, and licensing for Favorites Pro (sync on the hosted instance, $3/year) live in their own repo, **[MichalAFerber/favoritespage](https://github.com/MichalAFerber/favoritespage)** — a second, independent Worker bound to the **same KV namespace**. A subscription mints a license key that is itself a token: it writes exactly the `token:<hash>` → `userId` mapping `issue-token.sh` writes, so the key works here immediately, and the mapping is deleted when the subscription ends (the user's `state:*` document is never touched). That repo's README has the details. A self-hosted instance needs none of it; you issue your own tokens with `issue-token.sh`.

## Using the app

1. Open the site. Tap **+** to add a favorite; long-press a tile to edit or delete it.
2. In the add/edit dialog, set an optional **Page** (leave blank for the main page) and an optional **Icon URL** that overrides the auto-detected icon; clear it to revert.
3. Use the **chip bar** to switch pages, or link straight to `?p=<page>`. The header **⇅** toggle switches the current page between alphabetical and manual order; in manual mode, long-press and drag tiles to rearrange them.
4. **Settings (gear)** — theme, desktop and mobile wallpaper URLs, background color, this device's default page, the sync token, and **Data** (export / import).
5. To sync a device: get a token (from `issue-token.sh` on your own instance, or your Favorites Pro license key on the hosted one), open Settings → Sync, paste it into **License key**, and save. That's the entire setup — the app always syncs against the site it was loaded from.

## Deploying your own

The app is MIT, and your instance issues its own tokens; the Favorites Pro subscription is only for the hosted instance. A few people fit comfortably on Cloudflare's free Workers plan.

Prerequisites: a Cloudflare account, [wrangler](https://developers.cloudflare.com/workers/wrangler/) 4 logged in with `wrangler login`, and `openssl` (`issue-token.sh` uses it).

1. Clone this repo and work in its `favorites/` directory. Run every command below from there, so wrangler reads `favorites/wrangler.toml`.

   ```bash
   git clone https://github.com/MichalAFerber/favoritespage-app.git
   cd favoritespage-app/favorites
   ```

2. In `wrangler.toml`, set `account_id` to your own Cloudflare account ID, and point the `[[routes]]` `pattern` at a hostname in a zone on that account, or delete the whole `[[routes]]` block to serve from your workers.dev address. Set `account_id` before the next step: wrangler creates the namespace in the account `wrangler.toml` names.

3. Create the KV namespace:

   ```bash
   wrangler kv namespace create favorites-state
   ```

   Put the id it prints in two places:

   - the `id` of the existing `[[kv_namespaces]]` entry in `wrangler.toml`. Keep `binding = "SHORTCUTS_KV"`: the Worker reads only that binding, and the snippet wrangler prints suggests a different name.
   - `NAMESPACE_ID` at the top of `issue-token.sh`, which writes token mappings to the namespace by its id.

4. Deploy:

   ```bash
   wrangler deploy
   ```

5. Issue yourself a token, where `you` is a user ID of up to 32 lowercase letters, digits, hyphens, or underscores. The script prints a new token once and stores only its SHA-256 hash in KV.

   ```bash
   ./issue-token.sh you
   ```

6. Open your instance, go to Settings (⚙) → Sync, paste the token into the **License key** field, and save. Do the same on each device: the app syncs with the site it was loaded from.

To check the deploy, use your hostname, or the workers.dev URL that `wrangler deploy` printed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<your-host>/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<your-host>/api/state   # 401
curl -s -H "Authorization: Bearer $TOKEN" https://<your-host>/api/state  # null until the first sync
```

## Maintaining users

Owner-side user management is `favorites/issue-token.sh`, run from the `favorites/` directory. Issuing a token *is* creating a user; there is nothing else to set up. On the hosted instance, Favorites Pro subscribers from [favoritespage.us](https://favoritespage.us) appear in KV the same way (`token:<hash>` → `u<hex>`), and every command below applies to them identically.

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
  wrangler kv key delete "state:<userId>" --namespace-id <your-namespace-id> --remote
  ```

- **Inspecting** — `wrangler kv key list --namespace-id <id> --remote` shows every user and token hash; `wrangler kv key get "state:<userId>" --namespace-id <id> --remote` shows a user's document; `wrangler tail` streams live request logs from the Worker named in `wrangler.toml`.
- **Keep `--remote`** — wrangler 4 runs `kv key` commands against local storage unless you pass it, so a delete without it changes nothing on Cloudflare. `issue-token.sh` already passes it.

## Credits

Favicon: [Favorites](https://img.icons8.com/stickers/100/favorites.png) icon by [Icons8](https://icons8.com).

## License

[MIT](LICENSE)
