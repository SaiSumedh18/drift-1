// In-memory stand-in for Upstash's REST /pipeline endpoint. Used by the tests and by `npm run dev -- --mock`.
export function installMockRedis(url = "https://mock-redis.local") {
  const sets = new Map(), hashes = new Map(), counters = new Map();
  const realFetch = globalThis.fetch;

  const run = ([cmd, key, ...args]) => {
    switch (cmd.toUpperCase()) {
      case "SADD": {
        const s = sets.get(key) || new Set(); sets.set(key, s);
        let n = 0; for (const m of args) if (!s.has(m)) { s.add(m); n++; }
        return n;
      }
      case "SCARD": return (sets.get(key) || new Set()).size;
      case "SMEMBERS": return [...(sets.get(key) || [])];
      case "HSETNX": {
        const h = hashes.get(key) || new Map(); hashes.set(key, h);
        if (h.has(args[0])) return 0; h.set(args[0], args[1]); return 1;
      }
      case "HGETALL": return [...(hashes.get(key) || new Map())].flat();
      case "INCR": { const v = (counters.get(key) || 0) + 1; counters.set(key, v); return v; }
      case "EXPIRE": return 1;
      default: throw new Error(`mock: unsupported command ${cmd}`);
    }
  };

  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    if (!target.startsWith(url)) return realFetch(input, init);
    const commands = JSON.parse(init.body);
    const results = commands.map((c) => { try { return { result: run(c) }; } catch (e) { return { error: e.message }; } });
    return new Response(JSON.stringify(results), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  process.env.KV_REST_API_URL = url;
  process.env.KV_REST_API_TOKEN = "mock-token";
  return { restore: () => { globalThis.fetch = realFetch; }, sets, counters };
}
