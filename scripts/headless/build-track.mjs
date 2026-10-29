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
// SHOTS=0.1,0.35,0.6 (fractions of the lap, lng:lat:lookLng:lookLat:height, or L:x:y:lookX:lookY:height in local
// metres) also saves renders, and SHOTS=auto a standard set (the drive and every roundabout); from the
// three.js preview as out/<slug>.shot<n>.png (the photo ground only: no ksMultilayer or CSP).
// car0..car9 looks at parked cars spread through the list.
//
// Downloads (aerial photos, map tiles, Overpass, routing, Mapillary) are cached in out/cache for
// CACHE_DAYS (default 14), so a rebuild only fetches what's new. NO_CACHE=1 fetches everything fresh
// (and refreshes the cache); BUILD_CACHE=<dir> puts it somewhere else.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { unzipSync, zipSync } from "fflate";

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
  // Every outside request goes through here: answered from the cache when it can be, otherwise
  // fetched outside the page (some networks' proxies strip CORS headers from third-party APIs, so the
  // header is put back) and cached.
  const cacheDir = process.env.BUILD_CACHE ?? join(root, "out", "cache");
  const cacheDays = Number(process.env.CACHE_DAYS ?? 14);
  const useCache = !process.env.NO_CACHE && cacheDays > 0;
  mkdirSync(cacheDir, { recursive: true });
  let hits = 0, misses = 0;
  await page.route(/^https:\/\//, async (r) => {
    // NET_LOG=1 logs each outside request as it starts and ends (for hangs).
    const req = r.request();
    const url = req.url();
    const key = createHash("sha256").update(`${req.method()} ${url} ${req.postData() ?? ""}`).digest("hex");
    const body = join(cacheDir, `${key}.bin`), meta = join(cacheDir, `${key}.json`);
    if (useCache && existsSync(meta) && existsSync(body)) {
      try {
        const m = JSON.parse(readFileSync(meta, "utf8"));
        if (Date.now() - m.at < cacheDays * 86_400_000) {
          hits++;
          await r.fulfill({ status: m.status, headers: { ...m.headers, "access-control-allow-origin": "*" }, body: readFileSync(body) });
          return;
        }
      } catch {
        // a broken entry: fetch it again
      }
    }
    if (process.env.NET_LOG) log("net start", url.slice(0, 160));
    try {
      const res = await r.fetch({ timeout: 120_000 });
      if (process.env.NET_LOG) log("net done", res.status(), url.slice(0, 100));
      const bytes = await res.body();
      misses++;
      // Only good answers are kept: not errors, and not Overpass's "timed out" replies (a 200 with a remark).
      const bad = /overpass|interpreter/.test(url) && bytes.length < 400_000 && /"remark"/.test(bytes.toString("utf8"));
      if (res.status() === 200 && !bad) {
        const headers = { ...res.headers() };
        delete headers["set-cookie"];
        writeFileSync(body, bytes);
        // No URL stored: some carry an API token.
        writeFileSync(meta, JSON.stringify({ at: Date.now(), status: res.status(), headers }));
      }
      await r.fulfill({ status: res.status(), headers: { ...res.headers(), "access-control-allow-origin": "*" }, body: bytes });
    } catch {
      await r.abort().catch(() => {});
    }
  });
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
  // What houses look like: HOUSE_LOOKS=out/<slug>.looks.json (from house_looks.py), and/or hand-set looks
  // ({at, facade?, colour?, front?, hedgeHeight?, trees?, specFile?} each), comma-separated.
  // Several files, comma-separated: later ones win (e.g. photo looks, then hand-set ones).
  if (process.env.HOUSE_LOOKS) {
    const looks = process.env.HOUSE_LOOKS.split(",").flatMap((f) => {
      const l = JSON.parse(readFileSync(resolve(root, f.trim()), "utf8"));
      // A look with "specFile" is built from that spec (scripts/blender/house.py's parts mode).
      return (l.houses ?? l).map((h) => (h.specFile ? { ...h, spec: JSON.parse(readFileSync(resolve(root, h.specFile), "utf8")) } : h));
    });
    await page.evaluate((l) => { window.__houseLooks = l; }, looks);
  }
  // Build options with no UI control (e.g. noTrace zones) go straight to the build.
  // Hand-made layers (the route's "layers" folders, and LAYERS=dir,dir): each <name>.kn5 goes into the
  // track over the generated one (models.ini), and its <name>.json sidecar ({ "replaces": [{ "at":
  // [lng, lat], "radius": m, "trees"?: false }] }) clears the generated houses and trees it stands on.
  const layerDirs = [...(spec.layers ?? []), ...(process.env.LAYERS ? process.env.LAYERS.split(",") : [])].map((d) => resolve(root, d.trim()));
  const layers = layerDirs.flatMap((d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".kn5")).map((f) => join(d, f)) : []));
  const clears = layers.flatMap((f) => {
    const side = f.replace(/\.kn5$/, ".json");
    return existsSync(side) ? JSON.parse(readFileSync(side, "utf8")).replaces ?? [] : [];
  });
  if (layers.length) log(`layers: ${layers.map((f) => basename(f)).join(", ")}; ${clears.length} areas cleared for them`);
  if (layers.length && !spec.build?.origin) log("WARNING: layers on a route with no build.origin: the map moves with the route, so they may not line up");
  const buildOpts = clears.length ? { ...(spec.build ?? {}), clears: [...(spec.build?.clears ?? []), ...clears] } : spec.build;
  if (buildOpts) await page.evaluate((b) => { window.__buildOptions = b; }, buildOpts);
  for (const p of spec.pins) await page.evaluate((pt) => window.__app.addPin(pt), p);
  await page.fill("#name", spec.name);

  log("routing", spec.pins.length, "pins");
  await page.waitForSelector("#build:not([disabled])", { timeout: 60_000 });
  const routeErr = await page.locator("#route-error").evaluate((e) => (e.hidden ? "" : e.textContent));
  if (routeErr) throw new Error(routeErr);
  log("route", await page.textContent("#route-length"), await page.textContent("#route-kind"));

  await page.click("#build");
  let last = "", changed = Date.now();
  // A build that shows no progress for this long has hung (seen once: a download that never finished
  // or failed); stop it so a retry loop can build again.
  const STALL = Number(process.env.BUILD_STALL_MIN ?? 10) * 60_000;
  let stalled = () => {};
  const stall = new Promise((_, fail) => { stalled = fail; });
  const progress = setInterval(async () => {
    const t = await page.textContent("#progress-text").catch(() => "");
    if (t && t !== last) {
      log(" ", (last = t));
      changed = Date.now();
    } else if (Date.now() - changed > STALL) {
      stalled(new Error(`build stalled: no progress for ${STALL / 60_000} min at "${last}"`));
    }
  }, 2000);
  try {
    await Promise.race([
      page.waitForFunction(
        () => !document.getElementById("result").hidden || !document.getElementById("build-error").hidden,
        undefined,
        { timeout: TIMEOUT, polling: 1000 },
      ),
      stall,
    ]);
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
  let zipBytes = Buffer.concat(parts);
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
  // What the traffic graph was built from, to rework it offline (scripts/check/traffic_rebuild.ts).
  const trafficInput = await page.evaluate(() => window.__app.result().trafficInput);
  if (trafficInput) writeFileSync(join(root, "out", `${slug}.traffic-input.json`), JSON.stringify(trafficInput));

  const out = join(root, "out");
  mkdirSync(out, { recursive: true });
  if (layers.length) {
    // The layers go in beside the generated track, and models.ini loads them all.
    const files = unzipSync(new Uint8Array(zipBytes));
    const names = [`${slug}.kn5`, ...layers.map((f) => `layer_${basename(f)}`)];
    layers.forEach((f, k) => { files[`${slug}/${names[k + 1]}`] = new Uint8Array(readFileSync(f)); });
    files[`${slug}/models.ini`] = new TextEncoder().encode(names.map((n, k) => `[MODEL_${k}]\r\nFILE=${n}\r\nPOSITION=0,0,0\r\nROTATION=0,0,0\r\n`).join("\r\n"));
    zipBytes = Buffer.from(zipSync(files, { level: 6 }));
  }
  writeFileSync(join(out, `${slug}.zip`), zipBytes);
  writeFileSync(join(out, `${slug}.stats.json`), JSON.stringify({ route: basename(routeFile), stats, table }, null, 2));
  if (process.env.SHOTS) {
    // Each shot is a lap fraction, or "lng:lat:lookLng:lookLat:height" for a fixed view.
    // SHOTS=auto: the same views on every build of a track, for before/after comparisons
    // (render_diff.py): five spots round the drive, and each roundabout (up to six) from above.
    const fracs = process.env.SHOTS === "auto"
      ? ["0.02", "0.2", "0.4", "0.6", "0.8", ...(await page.evaluate(() =>
        window.__app.result().plan.roundabouts.slice(0, 6).map((rb) => `L:${rb.c[0]}:${rb.c[1] - 30}:${rb.c[0]}:${rb.c[1]}:${rb.hc + 16}:${rb.hc}`)))]
      : process.env.SHOTS.split(",");
    // Clear this track's shots from earlier builds, so a set never mixes old and new views.
    for (const f of readdirSync(out)) if (f.startsWith(`${slug}.shot`) && f.endsWith(".png")) rmSync(join(out, f));
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
        if (f.startsWith("L:")) {
          // Local metres (x east, y north): L:x:y:lookX:lookY:height[:lookHeight].
          const [x, y, lx, ly, h, lh] = f.slice(2).split(":").map(Number);
          pv.view([x, h, -y], [lx, Number.isFinite(lh) ? lh : h * 0.6, -ly]);
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
  log(`wrote out/${slug}.zip (${(zipBytes.length / 1e6).toFixed(1)} MB); downloads: ${hits} from the cache, ${misses} fetched`);
  for (const [k, v] of table) log(`  ${k}: ${v}`);
} finally {
  await browser.close();
  vite.kill();
}
