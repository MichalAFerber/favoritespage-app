// favoritespage.us — marketing site + self-service token portal.
// The page itself is a static asset served before this Worker runs; the only
// route that matters here is POST /api/signup, which issues a sync token into
// the same KV namespace the favorites Worker authenticates against.

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// KV keys this Worker owns (shared namespace — never touch `state:*`):
//   token:<sha256(token)>      → userId   (the mapping issue-token.sh writes)
//   signup:count:<YYYY-MM-DD>  → issued-today counter, TTL 2 days
//   signup:ip:<sha256(day|ip)> → per-IP cooldown marker, TTL = cooldown
async function handleSignup(request, env) {
  const cap = Number(env.SIGNUP_DAILY_CAP) || 0;
  if (cap <= 0) {
    return jsonResponse(503, { error: "closed", message: "Signups are paused right now — check back soon." });
  }

  const day = new Date().toISOString().slice(0, 10);

  // Per-IP cooldown first: a repeat caller burns zero KV writes. The IP is
  // hashed with the day so markers aren't linkable across days.
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipKey = "signup:ip:" + (await sha256Hex(day + "|" + ip));
  if (ip && (await env.SHORTCUTS_KV.get(ipKey))) {
    return jsonResponse(429, { error: "rate_limited", message: "One token per hour per connection — try again in a bit." });
  }

  // Global daily cap: keeps a signup flood from eating the KV free tier's
  // 1,000 writes/day out from under sync. Read-then-write can lose counts
  // under concurrency — this is a griefing ceiling, not bookkeeping, so
  // approximately-cap is fine.
  const countKey = "signup:count:" + day;
  const count = Number(await env.SHORTCUTS_KV.get(countKey)) || 0;
  if (count >= cap) {
    return jsonResponse(503, { error: "closed", message: "Today's tokens are gone — come back tomorrow." });
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64url(tokenBytes);
  // 5 random bytes ≈ 1 in 10^12 pair collisions — at this scale the worst
  // case matches deliberately sharing a token, so no existence check.
  const idBytes = crypto.getRandomValues(new Uint8Array(5));
  const userId = "u" + [...idBytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Exactly the mapping issue-token.sh writes; the plaintext token exists
  // only in this response.
  await env.SHORTCUTS_KV.put("token:" + (await sha256Hex(token)), userId);
  await env.SHORTCUTS_KV.put(countKey, String(count + 1), { expirationTtl: 172800 });
  const cooldown = Math.max(60, Number(env.SIGNUP_IP_COOLDOWN_SECS) || 3600);
  if (ip) await env.SHORTCUTS_KV.put(ipKey, "1", { expirationTtl: cooldown });

  return jsonResponse(200, { ok: true, userId, token });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/signup") {
      if (request.method !== "POST") return jsonResponse(405, { error: "method not allowed" });
      return handleSignup(request, env);
    }
    // Any other non-asset path: send them to the page, not a 404.
    return Response.redirect(url.origin + "/", 302);
  },
};
