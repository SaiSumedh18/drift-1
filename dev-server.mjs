// Local dev server: serves the static site and the /api/waitlist function.
//   npm run dev             uses real Redis if KV_REST_API_URL / KV_REST_API_TOKEN are set
//   npm run dev -- --mock   uses an in-memory Redis so you can try the form offline
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
if (process.argv.includes("--mock")) {
  const { installMockRedis } = await import("./test/mock-redis.mjs");
  installMockRedis();
  console.log("Using in-memory Redis (--mock).");
}
const { default: waitlist } = await import("./api/waitlist.js");

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json" };
const PORT = Number(process.env.PORT) || 5174;

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/api/waitlist") return waitlist(req, res);
  const file = normalize(join(root, path === "/" ? "index.html" : path));
  if (!file.startsWith(root) || file.includes(`${root}test`) || file.includes(`${root}api`)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`DRIFT-1 running at http://localhost:${PORT}`));
