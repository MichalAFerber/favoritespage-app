# CLAUDE.md — favorites.mykk.us

Runbook for Claude Code. Read this before touching anything.

## What this is

Multi-user favorites/speed-dial page. One Cloudflare Worker serves a static
single-file HTML app and a tiny token-authenticated state API backed by
Workers KV. No framework, no build step, no database, no accounts or login
UI. Keep it that way. A second, independent Worker (`marketing/`) serves the
marketing site at favoritespage.us with rate-limited self-service token
issuance — see "Marketing site" below.

- **Live URL:** https://favorites.mykk.us
- **Marketing site:** https://favoritespage.us (Worker `favoritespage-us`)
- **Worker name:** `favorites`
- **Cloudflare account:** TechGuyWithABeard (`8a0d49b1f3fdcdadec135562ec8a4fdc`)
  — the CF credentials on this machine can see multiple accounts (GEA LLC,
  ThompsonBlack LLC). **Only ever operate in the TGWAB account.**
- **KV namespace:** `favorites-state` (`71257de3aef04824ad72e7597d0ed8ac`),
  binding `SHORTCUTS_KV`. Keys: `token:<sha256(token)>` → userId (auth), and
  `state:<userId>` → that user's document.
- **Custom domain:** provisioned via `custom_domain = true` route in
  wrangler.toml. DNS + cert are managed by the deploy. Do not create DNS
  records manually.

## Repo layout

```
favorites/            # the app — favorites.mykk.us
├── public/
│   └── index.html    # the entire frontend (HTML+CSS+JS, single file)
├── worker.js         # /api/state handler + auth
├── issue-token.sh    # issue / map / revoke per-user sync tokens
└── wrangler.toml     # bindings, assets dir, custom domain route
marketing/            # the marketing site — favoritespage.us
├── public/
│   └── index.html    # single-file marketing page + token portal UI
├── worker.js         # POST /api/signup (self-service token issuance)
└── wrangler.toml     # SAME KV namespace, favoritespage.us custom domain
```

Static assets are served before either Worker is invoked. `favorites/worker.js`
only ever sees requests that don't match an asset — in practice, `/api/state`;
`marketing/worker.js` only ever sees `/api/signup` (everything else non-asset
302s to `/`).

## API contract (do not break)

```
GET  /api/state   Authorization: Bearer <user's token>
  → 200 JSON document or literal `null` if never synced
PUT  /api/state   Authorization: Bearer <user's token>, body = JSON ≤ 100 KB
  → 200 {"ok":true}
  → 400 bad json | 401 bad/missing token | 413 too large
GET  /icon?host=<hostname>   (unauthenticated — serves <img> tags)
  → always 200 image: Dashboard Icons → DuckDuckGo favicon → site
    /favicon.ico → generated letter-avatar SVG. 400 for non-hostname
    input. Edge-cached; never 404s (that's the point — no console noise).
```

The token is the entire identity: the Worker hashes it (SHA-256), looks up
`token:<hash>` in KV to get the userId, and reads/writes `state:<userId>`.
There is no other user management — issuing a token creates a user.

Marketing Worker (favoritespage.us), same KV namespace:

```
POST /api/signup   (no auth — self-service, rate-limited)
  → 200 {"ok":true,"userId":"u<10 hex>","token":"<base64url>"} — token shown once
  → 429 per-IP cooldown (SIGNUP_IP_COOLDOWN_SECS, default 1 h; key signup:ip:<sha256(day|ip)>)
  → 503 daily cap reached or signups paused (SIGNUP_DAILY_CAP, default 25; key signup:count:<date>)
```

Both knobs live in `marketing/wrangler.toml` `[vars]`; `SIGNUP_DAILY_CAP = "0"`
is the kill switch back to invite-only. The signup Worker writes only
`token:<hash>` mappings and its own TTL'd `signup:*` keys — never `state:*`.
Raw IPs are never stored (day-salted hash), and rejected calls burn zero KV
writes. The caps exist to protect the KV free tier's 1,000 writes/day.

State document shape (per user):

```json
{
  "shortcuts": [{ "id": "sc_...", "name": "GitHub", "url": "https://github.com", "iconUrl": "https://…/icon.png", "page": "homelab" }],
  "settings": { "theme": "dark", "wallpaperUrl": "", "wallpaperUrlMobile": "", "bgColor": "", "pageSort": { "homelab": "manual" } },
  "updatedAt": 1751600000000
}
```

`settings.pageSort` maps a page name to `"manual"`; pages absent from it
render alphabetically. In manual mode the stored array order (per page) is
the source of truth and drag-reordering rewrites it.

`iconUrl` is optional — when present it overrides the favicon service for
that shortcut. `page` is optional — it assigns the shortcut to a named page
(lowercase-normalized) shown via `?p=<page>` in the UI; absent means the
main page.

Conflict model is last-write-wins on `updatedAt`, whole document, per user.
This is deliberate — users never share a document, so do not introduce
merging, CRDTs, or per-item versioning.

The sync token lives only in device-local storage on the client and is
intentionally excluded from the synced document. Keep that separation. The
client always talks to its own origin (`location.origin + "/api/state"`) —
there is no endpoint setting.

## Deploy

```bash
cd favorites
wrangler deploy
```

The repo is also connected to the Worker via Workers Builds (Git
integration): every push to `main` after the connection triggers a build
that runs `npx wrangler deploy`. The build's **root directory must be
`favorites`** — the wrangler config is not at the repo root. Note that
connecting the repo does not build retroactively; only pushes made after
the connection fire builds.

The marketing Worker deploys from `marketing/` via
`.github/workflows/deploy-marketing.yml` (push to `main` touching
`marketing/**`). It is NOT covered by the Workers Builds connection above —
that one is rooted at `favorites/`. Its first deploy needs the
favoritespage.us zone present in the TGWAB account.

## Users and tokens

All from `favorites/` (scripts shell out to wrangler):

```bash
./issue-token.sh alice              # new user: generates + prints a token, stores its hash
./issue-token.sh alice --existing   # map a token already on devices (paste, silent)
./issue-token.sh --revoke           # revoke a token (paste, silent); state doc survives
```

The printed token is shown once and never stored server-side — hand it to the
user for their password manager; they enter it on each device (Settings →
Sync). Rotation = issue a new token for the same userId, then revoke the old
one; state is untouched because it keys on userId, not the token.

## Verify after deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://favorites.mykk.us/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://favorites.mykk.us/api/state   # 401
curl -s -H "Authorization: Bearer $TOKEN" https://favorites.mykk.us/api/state  # JSON or null
```

## Ops

```bash
wrangler tail favorites                                                              # live logs
wrangler kv key list --namespace-id 71257de3aef04824ad72e7597d0ed8ac                 # list users + token hashes
wrangler kv key get "state:<userId>" --namespace-id 71257de3aef04824ad72e7597d0ed8ac # inspect a user's state
wrangler kv key delete "state:<userId>" --namespace-id 71257de3aef04824ad72e7597d0ed8ac # wipe one user (their clients re-seed on next push)
```

KV free tier allows 1,000 writes/day across all users — a handful of active
users is fine; watch this before inviting more.

## Frontend conventions

- Single file. Inline CSS + JS. No bundler, no npm, no CDN dependencies —
  with one deliberate exception: a `<script defer>` in `<head>` loading
  the self-hosted Plausible instance (`plausible.thompsonblack.us`) for
  privacy-friendly, cookieless analytics. Do not remove it as "a CDN
  dependency"; it is intentional. There is no Google Analytics.
- All state mutations go through `persist()` — never call the cache or sync
  layer directly from a handler.
- Tile icons come from the Worker's same-origin `/icon?host=` proxy
  (Dashboard Icons → DuckDuckGo → site favicon → letter-avatar SVG), so the
  Dashboard Icons slugs are tried most-specific first: a small host alias
  map (gmail, outlook, admin-center), the slugified shortcut NAME (the
  client sends `n=` — "Google AI Studio" → google-ai-studio, the strongest
  signal for products under paths), `<brand>-<subdomain>` (google-calendar,
  proton-mail), true middle labels (console.firebase.google.com →
  firebase), then the bare brand — never generic before specific, or
  every Google product tile shows the G. Each slug is tried against the
  native Dashboard Icons repo, then selfh.st's (both on jsdelivr). Bump the `v=` in the icon URLs
  (worker cacheKey + index.html img src) when resolution logic changes;
  icons are cached for days at the edge and in browsers. The
  client never talks to third-party icon services and never logs 404s. The
  DuckDuckGo step is a privacy choice — do not swap it for Google's favicon
  service. `img.onerror` keeps the client-side letter avatar as the
  offline fallback. A shortcut's optional `iconUrl` overrides the proxy
  entirely (icons8, simpleicons, any image CDN).
- Wallpaper renders `cover` / `no-repeat` / `center` / `fixed` — it fills
  the viewport (cropping overflow) now that each device class can have a
  properly shaped image. Viewports under 800px use
  `wallpaperUrlMobile` when set (falling back to the desktop wallpaper),
  via a matchMedia listener so rotation/resize re-applies live.
- Page must remain fully functional with sync unconfigured (local-only mode).
- Multiple pages: `?p=homelab` filters the grid to that page's shortcuts; no
  param = main page. Filtering is display-only — pages live inside the one
  synced document, and page names are normalized to lowercase.
- Device-local storage holds exactly three things, none of them synced: the
  sync token, the default page (which page a bare URL opens; explicit `?p=`
  always wins, and the Home chip links to `?p=` as the escape hatch), and
  nothing else. Keep it that way.
- Sort is per page: alphabetical by default, `"manual"` via the header
  toggle. Manual mode = long-press lifts a tile, drag reorders, release
  without movement opens the edit dialog. Drag listeners go on `document`
  while lifted — moving the tile in the DOM releases pointer capture, so
  capture cannot be used.
- Settings → Data: Export downloads the state JSON; Import merges (never
  replaces) a favorites JSON or a Netscape bookmarks HTML (folders become
  pages; http(s) and file:// kept, other schemes skipped), deduped on
  (url, page), and aborts if the merged doc would exceed the 100 KB cap.
- `file://` favorites are first-class: `normalizeUrl` converts pasted local
  paths (`C:\…`, `\\server\share`, `/home/…`) to file URLs, file tiles show a
  folder glyph on the avatar color, and clicking one copies the URL with an
  explanatory toast — browsers refuse file:// navigation from https, so the
  copy IS the feature (the href stays real for right-click and local-links
  extensions). The click handler calls `stopPropagation()` so the Plausible
  outbound-links listener never sees local paths — keep it that way.
- Tile labels clamp at two lines (`-webkit-line-clamp: 2` +
  `overflow-wrap: anywhere`), full name in the label's `title`.
- Long-press = edit/delete. Pointer Events, 500 ms threshold, 10 px move
  tolerance. Native `confirm()` is banned (breaks in sandboxed iframes);
  destructive actions use two-tap confirm. The `contextmenu` handler must
  never cancel the long-press timer for touch — Android fires contextmenu
  at ~500 ms and would race it.
- Wallpaper URL is escaped via `cssUrl()` before hitting `background-image`.
  Any new user-supplied string that touches CSS or HTML gets the same
  treatment.

## Guardrails

- **No CORS headers.** Same-origin by design. If a request needs CORS, the
  architecture is wrong — stop and flag it.
- Never commit or echo a sync token. Plaintext tokens exist only in users'
  password managers and devices; the server stores only SHA-256 hashes.
- Don't touch zones/DNS outside `favorites.mykk.us` and `favoritespage.us`.
  Never operate in the GEA or ThompsonBlack accounts.
- Don't add auth complexity (OAuth, accounts, sessions, login UI). Per-user
  bearer tokens are the design, not a placeholder. The one sanctioned
  issuance path besides `issue-token.sh` is the marketing Worker's capped
  `/api/signup` — owner's decision, with `SIGNUP_DAILY_CAP = "0"` as the way
  back to invite-only. Don't loosen its caps or add account features on top.
- 100 KB PUT cap (per user) stays. If a user's state outgrows it, that's a
  design conversation with the owner, not a limit bump.
- Ask before: deleting the KV namespace, changing the route/domain, or
  revoking/rotating another user's token.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| 401 for one user | Their token has no KV mapping — revoked, never issued, or pasted with whitespace. Re-issue with `./issue-token.sh <userId>` or re-map with `--existing`. |
| 401 for everyone | Token mappings gone from KV (namespace wiped?). Check `kv key list` for `token:` keys. |
| Domain not resolving | Route missing — check `wrangler deploy` output created the custom domain; zone must be mykk.us in TGWAB account. |
| "Push failed" in UI, tail shows 413 | That user's state > 100 KB. Find what bloated it (`kv key get "state:<userId>" \| wc -c`) — likely a data-URL pasted as wallpaper or icon. |
| Edits from one device vanish | Expected under last-write-wins if two of the *same user's* devices edited while one was offline. Newest `updatedAt` wins. Not a bug. Different users can never affect each other's documents. |
| Icons blank | DuckDuckGo icon service hiccup or new TLD — fallback avatar should show; if not, check `img.onerror` wiring. Or the shortcut's `iconUrl` override points at a dead image. |
