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
// Every build writes out/<slug>.inputs.json: the downloads it used (cache keys and hosts, no URLs).
// SNAPSHOT=<dir> builds only from a frozen snapshot of them (scripts/snapshot/snapshot.mjs), offline:
// anything not in it fails the build ("not in the snapshot"), whatever its age. SNAPSHOT_FILL=1 fetches
// what's missing and adds it to the snapshot instead.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { unzipSync, zipSync } from "fflate";
import { applyPreset } from "./presets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const routeFile = process.argv[2];
if (!routeFile) {
  console.error("usage: node scripts/headless/build-track.mjs <route.json>");
  process.exit(1);
}
const spec = applyPreset(JSON.parse(readFileSync(routeFile, "utf8")));
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
  // What the build used (cache key -> host), for out/<slug>.inputs.json and snapshots.
  const used = new Map();
  const snapshot = process.env.SNAPSHOT ? resolve(process.env.SNAPSHOT) : null;
  const snapFill = !!process.env.SNAPSHOT_FILL;
  let snapMissing = 0;
  if (snapshot) { mkdirSync(snapshot, { recursive: true }); log(`building from the snapshot ${snapshot}${snapFill ? " (filling gaps)" : " only"}`); }
  await page.route(/^https:\/\//, async (r) => {
    // NET_LOG=1 logs each outside request as it starts and ends (for hangs).
    const req = r.request();
    const url = req.url();
    const key = createHash("sha256").update(`${req.method()} ${url} ${req.postData() ?? ""}`).digest("hex");
    const host = (() => { try { return new URL(url).host; } catch { return "?"; } })();
    if (snapshot) {
      const sb = join(snapshot, `${key}.bin`), sm = join(snapshot, `${key}.json`);
      if (existsSync(sm) && existsSync(sb)) {
        const m = JSON.parse(readFileSync(sm, "utf8"));
        hits++;
        used.set(key, host);
        await r.fulfill({ status: m.status, headers: { ...m.headers, "access-control-allow-origin": "*" }, body: readFileSync(sb) });
        return;
      }
      if (!snapFill) {
        snapMissing++;
        if (snapMissing <= 5) log(`not in the snapshot: ${host}${new URL(url).pathname.slice(0, 60)}`);
        await r.abort().catch(() => {});
        return;
      }
    }
    const body = join(cacheDir, `${key}.bin`), meta = join(cacheDir, `${key}.json`);
    if (useCache && !snapshot && existsSync(meta) && existsSync(body)) {
      try {
        const m = JSON.parse(readFileSync(meta, "utf8"));
        if (Date.now() - m.at < cacheDays * 86_400_000) {
          hits++;
          used.set(key, host);
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
        used.set(key, host);
        if (snapshot) {
          writeFileSync(join(snapshot, `${key}.bin`), bytes);
          writeFileSync(join(snapshot, `${key}.json`), JSON.stringify({ at: Date.now(), status: res.status(), headers }));
        }
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
  // The route's own "looks" files (e.g. routes/landmarks/looks.json) come first, then HOUSE_LOOKS.
  const lookFiles = [...(spec.looks ?? []), ...(process.env.HOUSE_LOOKS ? process.env.HOUSE_LOOKS.split(",") : [])];
  // Looks with a "specFile" are landmarks: they're no longer built into the base. The base clears
  // their spots, and scripts/polish/landmarks.ts builds each as its own layer (lm_<slug>.kn5) and adds
  // it to the zip at the end, the same as a polish-only update does (ROADMAP.md, generate-freeze-polish).
  let landmarks = [];
  if (lookFiles.length) {
    const looks = lookFiles.flatMap((f) => {
      const l = JSON.parse(readFileSync(resolve(root, f.trim()), "utf8"));
      return l.houses ?? l;
    });
    landmarks = looks.filter((h) => h.specFile).map((h) => ({ name: h.name ?? basename(h.specFile, ".json"), at: h.at }));
    await page.evaluate(([l, lm]) => { window.__houseLooks = l; window.__landmarks = lm; }, [looks.filter((h) => !h.specFile), landmarks]);
  }
  const polish = (more) => execFileSync("npx", ["tsx", "scripts/polish/landmarks.ts", routeFile, ...more], { cwd: root, env: process.env, encoding: "utf8" });
  const landmarkClears = landmarks.length ? JSON.parse(polish(["--clears"])) : [];
  if (landmarks.length) log(`landmarks (built as layers): ${landmarks.map((l) => l.name).join(", ")}`);
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
  const allClears = [...clears, ...landmarkClears];
  let buildOpts = allClears.length ? { ...(spec.build ?? {}), clears: [...(spec.build?.clears ?? []), ...allClears] } : spec.build;
  // Several layouts on one map (src/core/layouts.ts): the route's own drive is layout "layout.id"
  // (default "main"), and each entry of "layouts" ({ id, name, pins, loop? } or { id, name,
  // spawns: [{ at: [lng, lat], heading }] }) another, on the same world. A layout's "challenges"
  // (hand-picked checkpoints, as build.challenges) go in its own challenges.ini.
  const mainLayout = spec.layouts?.length ? { id: spec.layout?.id ?? "main", name: spec.layout?.name ?? spec.name } : null;
  if (mainLayout) buildOpts = { ...(buildOpts ?? {}), layout: mainLayout.id };
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
  if (mainLayout) {
    log("layouts:", [mainLayout.id, ...spec.layouts.map((l) => l.id)].join(", "));
    const extra = await page.evaluate(async ({ layouts, options, mainId, name }) => {
      const { route } = await import("/src/services/osm.ts");
      const { layoutFiles } = await import("/src/core/layouts.ts");
      const { trackObjects } = await import("/src/core/track.ts");
      const r = window.__app.result();
      const files = {};
      const b64 = (u) => {
        let bin = "";
        for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return btoa(bin);
      };
      const ti = r.trafficInput;
      const world = {
        slug: r.slug, proj: r.proj, model: r.model, options, meta: { name }, mainAi: r.files[`${r.slug}/${mainId}/ai/fast_lane.ai`],
        lines: ti ? ti.roads.map((rd) => rd.pts) : undefined, speeds: ti ? ti.roads.map((rd) => rd.speed) : undefined, rings: ti ? ti.roundabouts.map((rb) => ({ c: rb.c, rOut: rb.rOut })) : undefined,
        // Landmarks (looks built from a spec): the automatic test photographs them.
        landmarks: (window.__landmarks ?? []).map((h) => ({ name: h.name, at: r.proj.toLocal(h.at) })),
      };
      for (const l of layouts) {
        const coords = l.pins ? (await route(l.loop ? [...l.pins, l.pins[0]] : l.pins)).coords : undefined;
        const f = layoutFiles(world, { id: l.id, name: l.name, coords, spawns: l.spawns, challenges: l.challenges }, trackObjects);
        for (const [k, v] of Object.entries(f)) files[k] = b64(v);
        // The world's surfaces (and traffic) are every layout's.
        for (const d of ["surfaces.ini", "traffic.json"]) {
          const src = r.files[`${r.slug}/${mainId}/data/${d}`];
          if (src) files[`${r.slug}/${l.id}/data/${d}`] = b64(src);
        }
      }
      return files;
    }, { layouts: spec.layouts, options: { ...(spec.build ?? {}) }, mainId: mainLayout.id, name: spec.name });
    const files = unzipSync(new Uint8Array(zipBytes));
    for (const [k, v] of Object.entries(extra)) files[k] = new Uint8Array(Buffer.from(v, "base64"));
    zipBytes = Buffer.from(zipSync(files, { level: 6 }));
  }
  if (layers.length) {
    // The layers go in beside the generated track, and models.ini loads them all.
    const files = unzipSync(new Uint8Array(zipBytes));
    const names = [`${slug}.kn5`, ...layers.map((f) => `layer_${basename(f)}`)];
    layers.forEach((f, k) => { files[`${slug}/${names[k + 1]}`] = new Uint8Array(readFileSync(f)); });
    const ini = (list) => new TextEncoder().encode(list.map((n, k) => `[MODEL_${k}]\r\nFILE=${n}\r\nPOSITION=0,0,0\r\nROTATION=0,0,0\r\n`).join("\r\n"));
    const perLayout = Object.keys(files).filter((k) => /\/models_[^/]+\.ini$/.test(k));
    if (perLayout.length) {
      // Each layout loads the world, its dummies and the layers.
      for (const k of perLayout) files[k] = ini([`${slug}.kn5`, `layout_${k.match(/models_([^/]+)\.ini$/)[1]}.kn5`, ...names.slice(1)]);
    } else files[`${slug}/models.ini`] = ini(names);
    zipBytes = Buffer.from(zipSync(files, { level: 6 }));
  }
  writeFileSync(join(out, `${slug}.zip`), zipBytes);
  if (landmarks.length) log(polish([`out/${slug}.zip`, "--into"]).trim());
  // The downloads this build used: what a snapshot of it needs (scripts/snapshot/snapshot.mjs).
  const hostCount = {};
  for (const h of used.values()) hostCount[h] = (hostCount[h] ?? 0) + 1;
  writeFileSync(join(out, `${slug}.inputs.json`), JSON.stringify({ route: basename(routeFile), built: new Date().toISOString(), snapshot: snapshot ? basename(snapshot) : null, hosts: hostCount, keys: [...used.keys()].sort() }, null, 1));
  if (snapshot && snapMissing) log(`WARNING: ${snapMissing} downloads weren't in the snapshot (refresh it with SNAPSHOT_FILL=1 if that's intended)`);
  writeFileSync(join(out, `${slug}.stats.json`), JSON.stringify({ route: basename(routeFile), stats, table }, null, 2));
  if (process.env.SHOTS) {
    // Each shot is a lap fraction, or "lng:lat:lookLng:lookLat:height" for a fixed view.
    // SHOTS=auto: the same views on every build of a track, for before/after comparisons
    // (render_diff.py): five spots round the drive, and each roundabout (up to six) from above.
    // "auto" can also be one item of a list: SHOTS=auto,L:...
    const auto = ["0.02", "0.2", "0.4", "0.6", "0.8", ...(await page.evaluate(() =>
      window.__app.result().plan.roundabouts.slice(0, 6).map((rb) => `L:${rb.c[0]}:${rb.c[1] - 30}:${rb.c[0]}:${rb.c[1]}:${rb.hc + 16}:${rb.hc}`)))];
    const fracs = process.env.SHOTS.split(",").flatMap((f) => (f.trim() === "auto" ? auto : [f.trim()]));
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
