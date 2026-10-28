// Build a track without clicking: runs the real app in headless Chromium, drops
// the pins, presses Build and saves the zip. Same code path as the browser UI.
//
//   node scripts/headless/build-track.mjs routes/foreshore.json
//
// A route file:
//   {
//     "name": "Busselton Foreshore",
//     "loop": true,
//     "pins": [[115.33054, -33.65499], [115.33056, -33.65034], ...],   // lng, lat
//     "options": { "imagery": "high", "trees": "normal" },              // optional: ids of <select>s/<input>s in the UI
//     "build": { "noTrace": [{ "at": [115.3445, -33.6500], "radius": 150 }] }  // optional: BuildOptions with no UI control
//   }
//
// Writes out/<slug>.zip and out/<slug>.stats.json. Needs `npx playwright install chromium` once.
// Stops without writing anything when data didn't arrive after retries (Overpass, map tiles):
// ALLOW_MISSING_DATA=1 keeps such a build.
//
// SHOTS=0.1,0.35,0.6 (fractions of the lap, or lng:lat:lookLng:lookLat:height) also saves driver's-eye renders from the
// three.js preview as out/<slug>.shot<n>.png (the photo ground only: no ksMultilayer or CSP).
// car0..car9 looks at parked cars spread through the list.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const routeFile = process.argv[2];
if (!routeFile) {
  console.error("usage: node scripts/headless/build-track.mjs <route.json>");
  process.exit(1);
}
const spec = JSON.parse(readFileSync(routeFile, "utf8"));
// KEY=value lines from .env.local (gitignored), without overriding the real environment.
const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const PORT = Number(process.env.PORT ?? 5199);
const TIMEOUT = Number(process.env.BUILD_TIMEOUT_MIN ?? 30) * 60_000;

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// Vite dev server: the build reads public/dem through it, and the dev-only test hook (__app) exists there.
const vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error("vite did not start")), 60_000);
  vite.stdout.on("data", (d) => {
    if (String(d).includes("Local:")) {
      clearTimeout(t);
      ok();
    }
  });
  vite.on("exit", (c) => fail(new Error(`vite exited ${c}`)));
});

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  // A normal desktop user agent: Landgate's CDN turns away "HeadlessChrome" with a 403.
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, timezoneId: "Australia/Perth", userAgent });
  page.on("console", (m) => {
    if (m.type() === "error") log("page error:", m.text());
  });
  page.on("pageerror", (e) => log("page exception:", e.message));
  if (process.env.CORS_SHIM) {
    // Some networks (proxies) strip CORS headers from third-party APIs; fetch those
    // outside the page and hand them back with the header put back.
    await page.route(/^https:\/\//, async (r) => {
      // NET_LOG=1 logs each outside request as it starts and ends (for hangs).
      const url = r.request().url();
      if (process.env.NET_LOG) log("net start", url.slice(0, 160));
      try {
        const res = await r.fetch({ timeout: 120_000 });
        if (process.env.NET_LOG) log("net done", res.status(), url.slice(0, 100));
        await r.fulfill({ response: res, headers: { ...res.headers(), "access-control-allow-origin": "*" } });
      } catch {
        await r.abort().catch(() => {});
      }
    });
  }
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__app);

  // Options first, so routing and naming see them.
  await page.fill("#name", spec.name);
  if (spec.loop) await page.check("#loop");
  // Set controls directly: some sit in collapsed sections and aren't clickable.
  // The Mapillary token comes from the environment (or a gitignored .env.local), never a route file:
  // the routes are public.
  const options = { ...(spec.options ?? {}) };
  if (process.env.MAPILLARY_TOKEN) options.mapillaryToken = process.env.MAPILLARY_TOKEN;
  for (const [id, value] of Object.entries(options)) {
    const ok = await page.evaluate(([id, value]) => {
      const el = document.getElementById(id);
      if (!el) return false;
      if (el.type === "checkbox") el.checked = !!value;
      else el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, [id, value]);
    if (!ok) throw new Error(`no control #${id} in the UI`);
  }
  // What houses look like from street photos: HOUSE_LOOKS=out/<slug>.looks.json (from house_looks.py).
  if (process.env.HOUSE_LOOKS) {
    const looks = JSON.parse(readFileSync(resolve(root, process.env.HOUSE_LOOKS), "utf8"));
    await page.evaluate((l) => { window.__houseLooks = l; }, looks.houses ?? looks);
  }
  // Build options with no UI control (e.g. noTrace zones) go straight to the build.
  if (spec.build) await page.evaluate((b) => { window.__buildOptions = b; }, spec.build);
  for (const p of spec.pins) await page.evaluate((pt) => window.__app.addPin(pt), p);
  await page.fill("#name", spec.name);

  log("routing", spec.pins.length, "pins");
  await page.waitForSelector("#build:not([disabled])", { timeout: 60_000 });
  const routeErr = await page.locator("#route-error").evaluate((e) => (e.hidden ? "" : e.textContent));
  if (routeErr) throw new Error(routeErr);
  log("route", await page.textContent("#route-length"), await page.textContent("#route-kind"));

  await page.click("#build");
  let last = "";
  const progress = setInterval(async () => {
    const t = await page.textContent("#progress-text").catch(() => "");
    if (t && t !== last) log(" ", (last = t));
  }, 2000);
  try {
    await page.waitForFunction(
      () => !document.getElementById("result").hidden || !document.getElementById("build-error").hidden,
      undefined,
      { timeout: TIMEOUT, polling: 1000 },
    );
  } finally {
    clearInterval(progress);
  }
  const buildErr = await page.locator("#build-error").evaluate((e) => (e.hidden ? "" : e.textContent));
  if (buildErr) throw new Error(buildErr);
  // Data that never arrived (after retries) makes a quietly different track: stop, unless asked not to.
  const missing = await page.evaluate(() => window.__app.dataWarnings());
  if (missing.length) {
    log("MISSING DATA:", missing.join("; "));
    if (!process.env.ALLOW_MISSING_DATA) throw new Error("build is missing data (build again, or set ALLOW_MISSING_DATA=1 to keep it)");
  }

  // The zip comes out of the page in pieces: one base64 string of a few hundred MB crashes it.
  const zipLength = await page.evaluate(async () => {
    const a = document.getElementById("download");
    window.__zipBuf = new Uint8Array(await (await fetch(a.href)).arrayBuffer());
    return window.__zipBuf.length;
  });
  const CHUNK = 16 * 1024 * 1024;
  const parts = [];
  for (let off = 0; off < zipLength; off += CHUNK) {
    const b64 = await page.evaluate(([o, n]) => {
      const buf = window.__zipBuf.subarray(o, o + n);
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    }, [off, CHUNK]);
    parts.push(Buffer.from(b64, "base64"));
  }
  await page.evaluate(() => { window.__zipBuf = null; });
  const zipBytes = Buffer.concat(parts);
  const { slug, stats, table, centreline, sampleKeys, houses } = await page.evaluate(async () => {
    const r = window.__app.result();
    const table = [...document.querySelectorAll("#result-stats div")].map((d) => [d.querySelector("dt")?.textContent, d.querySelector("dd")?.textContent]);
    // The built centreline in lng/lat with its height and width, for checking against the photo and the DEM.
    const centreline = r.plan.samples.map((s) => {
      const [lng, lat] = r.proj.toLngLat(s.pos);
      return [+lng.toFixed(7), +lat.toFixed(7), +s.h.toFixed(3), +(s.width ?? NaN)];
    });
    return { slug: r.slug, stats: r.stats, table, centreline, sampleKeys: Object.keys(r.plan.samples[0] ?? {}), houses: r.houses };
  });
  mkdirSync(join(root, "out"), { recursive: true });
  writeFileSync(join(root, "out", `${slug}.centreline.json`), JSON.stringify({ sampleKeys, centreline }));
  // House fronts, for matching to street photos (scripts/mapillary/house_looks.py).
  writeFileSync(join(root, "out", `${slug}.houses.json`), JSON.stringify(houses ?? []));

  const out = join(root, "out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${slug}.zip`), zipBytes);
  writeFileSync(join(out, `${slug}.stats.json`), JSON.stringify({ route: basename(routeFile), stats, table }, null, 2));
  if (process.env.SHOTS) {
    // Each shot is a lap fraction, or "lng:lat:lookLng:lookLat:height" for a fixed view.
    const fracs = process.env.SHOTS.split(",");
    for (const [n, f] of fracs.entries()) {
      const png = await page.evaluate((f) => {
        const r = window.__app.result(), pv = window.__app.preview();
        if (f.startsWith("car")) {
          // car<N>: from 10 m beside and 4 m above the Nth parked car (spread over the list), looking at it.
          const cars = r.parked ?? [];
          if (!cars.length) return "";
          const c = cars[Math.floor((Number(f.slice(3)) / 10) * cars.length) % cars.length];
          const g = r.plan.samples[0].h;
          const e = [c.at[0] - c.dir[1] * 10 + c.dir[0] * 4, c.at[1] + c.dir[0] * 10 + c.dir[1] * 4];
          pv.view([e[0], g + 4, -e[1]], [c.at[0], g, -c.at[1]]);
          return document.getElementById("preview-canvas").toDataURL("image/png").split(",")[1];
        }
        if (f.includes(":")) {
          const [x, y, lx, ly, h] = f.split(":").map(Number);
          const e = r.proj.toLocal([x, y]), t = r.proj.toLocal([lx, ly]);
          pv.view([e[0], h, -e[1]], [t[0], h * 0.6, -t[1]]);
          return document.getElementById("preview-canvas").toDataURL("image/png").split(",")[1];
        }
        const ss = r.plan.samples, i = Math.floor(Number(f) * ss.length) % ss.length, s = ss[i], a = ss[(i + 15) % ss.length];
        // AC space: x east, y up, z south.
        pv.view([s.pos[0], s.h + 1.2, -s.pos[1]], [a.pos[0], a.h + 1.0, -a.pos[1]]);
        return document.getElementById("preview-canvas").toDataURL("image/png").split(",")[1];
      }, f);
      if (png) writeFileSync(join(out, `${slug}.shot${n}.png`), Buffer.from(png, "base64"));
    }
    log(`wrote ${fracs.length} shots`);
  }
  log(`wrote out/${slug}.zip (${(zipBytes.length / 1e6).toFixed(1)} MB)`);
  for (const [k, v] of table) log(`  ${k}: ${v}`);
} finally {
  await browser.close();
  vite.kill();
}
