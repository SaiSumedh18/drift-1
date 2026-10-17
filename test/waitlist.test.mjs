import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installMockRedis } from "./mock-redis.mjs";
import handler from "../api/waitlist.js";

// minimal req/res doubles matching what Vercel passes to a Node function
function call({ method = "GET", body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method, body, headers: { "x-forwarded-for": "203.0.113.7", ...headers } };
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(payload) { resolve({ status: this.statusCode, headers: this.headers, json: JSON.parse(payload) }); },
    };
    handler(req, res);
  });
}

let mock;
beforeEach(() => {
  mock?.restore();
  mock = installMockRedis();
  process.env.ADMIN_TOKEN = "test-admin-token-123456";
});

test("joins the waitlist and normalises the email", async () => {
  const r = await call({ method: "POST", body: { email: "  Ada@Example.com " } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json, { ok: true, status: "joined", count: 1 });
  assert.ok(mock.sets.get("drift1:waitlist").has("ada@example.com"));
});

test("a duplicate email is accepted but not double-counted", async () => {
  await call({ method: "POST", body: { email: "ada@example.com" } });
  const r = await call({ method: "POST", body: { email: "ADA@example.com" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "already_joined");
  assert.equal(r.json.count, 1);
});

test("rejects invalid email addresses", async () => {
  for (const email of ["", "nope", "a@b", "x".repeat(300) + "@example.com"]) {
    const r = await call({ method: "POST", body: { email } });
    assert.equal(r.status, 400, email);
    assert.equal(r.json.error, "invalid_email");
  }
});

test("honeypot submissions look successful but are not stored", async () => {
  const r = await call({ method: "POST", body: { email: "bot@example.com", company: "Spam Inc" } });
  assert.equal(r.status, 200);
  assert.equal(mock.sets.get("drift1:waitlist"), undefined);
});

test("rate limits after 5 attempts per minute from one IP", async () => {
  for (let i = 0; i < 5; i++) await call({ method: "POST", body: { email: `p${i}@example.com` } });
  const r = await call({ method: "POST", body: { email: "p6@example.com" } });
  assert.equal(r.status, 429);
  assert.equal(r.headers["retry-after"], "60");
});

test("public GET returns only the count", async () => {
  await call({ method: "POST", body: { email: "ada@example.com" } });
  const r = await call();
  assert.deepEqual(r.json, { count: 1 });
});

test("admin GET returns entries only with the right token", async () => {
  await call({ method: "POST", body: { email: "ada@example.com" } });
  const wrong = await call({ headers: { authorization: "Bearer wrong-token-000000000" } });
  assert.deepEqual(wrong.json, { count: 1 });
  const ok = await call({ headers: { authorization: "Bearer test-admin-token-123456" } });
  assert.equal(ok.json.entries.length, 1);
  assert.equal(ok.json.entries[0].email, "ada@example.com");
  assert.match(ok.json.entries[0].joinedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("other methods get 405", async () => {
  const r = await call({ method: "DELETE" });
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, "GET, POST");
});

test("reports 503 when no database is connected", async () => {
  mock.restore();
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const r = await call({ method: "POST", body: { email: "ada@example.com" } });
  assert.equal(r.status, 503);
  assert.equal(r.json.error, "storage_unconfigured");
  mock = installMockRedis();
});
