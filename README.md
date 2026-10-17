# DRIFT-1

**Live demo:** https://drift-1.vercel.app (the 3D hero, the synth and a working waitlist). A static mirror without the API is at https://saisumedh18.github.io/drift-1/.

A concept landing page for a pocket drone synthesizer, where **the hero is the instrument**.

A liquid-chrome form and a live Web Audio drone share three controls (Drift, Tone and Space). Turn a knob and the sound and the surface change together. The synth's loudness drives the surface in real time, and you can press into the form to dent it. Everything below the hero stays still on purpose: one strong interaction, and the rest of the page breathes.

> DRIFT-1 and Kiln Instruments are a design concept. The waitlist is real: it stores sign-ups in Redis through a serverless API.

## What's in it

- **Liquid-chrome shader.** A sphere displaced by animated simplex noise in the vertex shader, with normals rebuilt per vertex, lit by a procedural photo-studio environment (cyc wall, softboxes, amber kicker). No textures or models are downloaded.
- **Real synthesis.** Three detuned voices (D2, A2, F3) feed a resonant low-pass filter with an LFO, then a damped feedback delay and a compressor, all built with the Web Audio API. Sound starts only when you press play.
- **One parameter set, two outputs.** Each knob maps to real units that are printed on the page (filter LFO 0.02–4 Hz, cutoff 280 Hz–3.2 kHz, feedback 0–82 %) and also drives the visuals (noise speed, frequency, amplitude and colour temperature).
- **Pointer physics.** Raycast onto the form: hovering makes a shallow dent, pressing makes a deep one with a raised rim.
- **Accessible hardware UI.** The knobs are `role="slider"` controls that work with drag, mouse wheel and arrow, Page Up/Down, Home and End keys.
- **Serverless waitlist API.** `POST /api/waitlist` validates and normalises emails, dedupes them in a Redis set, rate-limits by hashed IP (5 a minute), and has a honeypot field for bots. `GET` returns the public count, or the full list when called with the admin token. Covered by 9 tests.
- **Admin page.** `/admin.html` lists sign-ups with timestamps and copies all emails, behind `ADMIN_TOKEN`.
- **Performance care.** Fewer vertices and a lower pixel ratio on phones, rendering pauses when the hero is off screen, and `prefers-reduced-motion` is respected.

## Architecture

```
Browser ── static files (index.html, styles.css, main.js, admin.html)
   │
   └── fetch /api/waitlist ──► Vercel serverless function (api/waitlist.js)
                                   └── Upstash Redis (REST): SADD / HSETNX / SCARD, INCR for rate limits
```

## Stack

Three.js r128 · GLSL · Web Audio API · Vercel Functions (Node 20+) · Upstash Redis · no build step, no npm dependencies

## Run locally

```bash
npm test                 # 9 API tests, in-memory Redis
npm run dev -- --mock    # site + API at http://localhost:5174, in-memory Redis
```

With a real database, set `KV_REST_API_URL` and `KV_REST_API_TOKEN` and run `npm run dev`.

## Deploy (Vercel)

1. Import this repo on Vercel: Add New → Project → Deploy. No settings needed.
2. Storage tab → Create Database → **Upstash for Redis** → connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Settings → Environment Variables → add `ADMIN_TOKEN` (a long random string, at least 16 characters).
4. Redeploy. The waitlist is live, and `/admin.html` shows sign-ups.

Until step 2 is done, the form reports that the waitlist database isn't connected yet.
