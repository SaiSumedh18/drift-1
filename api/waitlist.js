// Waitlist API for DRIFT-1 (Vercel serverless function).
//
//   POST /api/waitlist   { email, company? }  -> join the waitlist
//   GET  /api/waitlist                         -> { count } (public)
//   GET  /api/waitlist   Authorization: Bearer <ADMIN_TOKEN> -> full list (admin)
//
// Storage is Redis over Upstash's REST API, so there are no dependencies.
// Env (set automatically by Vercel's Upstash for Redis integration):
//   KV_REST_API_URL / KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)
//   ADMIN_TOKEN                            (you choose it; unlocks the admin list)

import { createHash, timingSafeEqual } from "node:crypto";

const SET_KEY = "drift1:waitlist";            // unique, lowercased emails
const JOINED_KEY = "drift1:waitlist:joined";  // email -> ISO timestamp of first sign-up
const RATE_LIMIT = 5;                         // sign-up attempts per IP per minute
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;

export function redisConfig(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redis(cfg, commands) {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis responded ${res.status}`);
  const out = await res.json();
  return out.map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function isAdmin(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length < 16) return false;
  const given = Buffer.from(String(req.headers.authorization || ""));
  const want = Buffer.from(`Bearer ${expected}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

function clientKey(req) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  // store a hash, not the raw IP
  return "drift1:rl:" + createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  // plain Node request (local dev): read the stream, capped at 4 KB
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 4096) break; }
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  const cfg = redisConfig();
  if (!cfg) {
    return send(res, 503, { error: "storage_unconfigured", message: "The waitlist database is not connected yet." });
  }

  try {
    if (req.method === "GET") {
      if (isAdmin(req)) {
        const [emails, joinedFlat] = await redis(cfg, [["SMEMBERS", SET_KEY], ["HGETALL", JOINED_KEY]]);
        const joined = {};
        for (let i = 0; i < (joinedFlat || []).length; i += 2) joined[joinedFlat[i]] = joinedFlat[i + 1];
        const entries = (emails || [])
          .map((email) => ({ email, joinedAt: joined[email] || null }))
          .sort((a, b) => String(b.joinedAt).localeCompare(String(a.joinedAt)));
        return send(res, 200, { count: entries.length, entries });
      }
      const [count] = await redis(cfg, [["SCARD", SET_KEY]]);
      return send(res, 200, { count });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return send(res, 405, { error: "method_not_allowed" });
    }

    const body = await readBody(req);

    // honeypot: real people never see or fill this field
    if (body.company) return send(res, 200, { ok: true, status: "joined" });

    const email = String(body.email || "").trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return send(res, 400, { error: "invalid_email", message: "Enter an email address like name@example.com." });
    }

    const rl = clientKey(req);
    const [hits] = await redis(cfg, [["INCR", rl], ["EXPIRE", rl, 60, "NX"]]);
    if (hits > RATE_LIMIT) {
      res.setHeader("Retry-After", "60");
      return send(res, 429, { error: "rate_limited", message: "Too many attempts. Try again in a minute." });
    }

    const [added, , count] = await redis(cfg, [
      ["SADD", SET_KEY, email],
      ["HSETNX", JOINED_KEY, email, new Date().toISOString()],
      ["SCARD", SET_KEY],
    ]);
    return send(res, added ? 201 : 200, { ok: true, status: added ? "joined" : "already_joined", count });
  } catch (err) {
    console.error("waitlist error:", err.message);
    return send(res, 502, { error: "storage_error", message: "The waitlist is having trouble. Try again shortly." });
  }
}
