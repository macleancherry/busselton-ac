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

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, timezoneId: "Australia/Perth" });
  page.on("console", (m) => {
    if (m.type() === "error") log("page error:", m.text());
  });
  page.on("pageerror", (e) => log("page exception:", e.message));
  if (process.env.CORS_SHIM) {
    // Some networks (proxies) strip CORS headers from third-party APIs; fetch those
    // outside the page and hand them back with the header put back.
    await page.route(/^https:\/\//, async (r) => {
      try {
        const res = await r.fetch({ timeout: 120_000 });
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
  for (const [id, value] of Object.entries(spec.options ?? {})) {
    const el = page.locator(`#${id}`);
    const tag = await el.evaluate((e) => `${e.tagName}:${e.type ?? ""}`);
    if (tag.startsWith("SELECT")) await el.selectOption(String(value));
    else if (tag.endsWith("checkbox")) await (value ? el.check() : el.uncheck());
    else await el.fill(String(value));
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

  const { slug, zip, stats, table, centreline, sampleKeys } = await page.evaluate(async () => {
    const a = document.getElementById("download");
    const buf = new Uint8Array(await (await fetch(a.href)).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const r = window.__app.result();
    const table = [...document.querySelectorAll("#result-stats div")].map((d) => [d.querySelector("dt")?.textContent, d.querySelector("dd")?.textContent]);
    // The built centreline in lng/lat with its height and width, for checking against the photo and the DEM.
    const centreline = r.plan.samples.map((s) => {
      const [lng, lat] = r.proj.toLngLat(s.pos);
      return [+lng.toFixed(7), +lat.toFixed(7), +s.h.toFixed(3), +(s.width ?? NaN)];
    });
    return { slug: r.slug, zip: btoa(bin), stats: r.stats, table, centreline, sampleKeys: Object.keys(r.plan.samples[0] ?? {}) };
  });
  mkdirSync(join(root, "out"), { recursive: true });
  writeFileSync(join(root, "out", `${slug}.centreline.json`), JSON.stringify({ sampleKeys, centreline }));

  const out = join(root, "out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${slug}.zip`), Buffer.from(zip, "base64"));
  writeFileSync(join(out, `${slug}.stats.json`), JSON.stringify({ route: basename(routeFile), stats, table }, null, 2));
  log(`wrote out/${slug}.zip (${(Buffer.from(zip, "base64").length / 1e6).toFixed(1)} MB)`);
  for (const [k, v] of table) log(`  ${k}: ${v}`);
} finally {
  await browser.close();
  vite.kill();
}
