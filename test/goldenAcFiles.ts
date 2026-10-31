// The inputs behind test/fixtures/golden: outputs of cameras.ts, acFiles.ts and cspConfig.ts for
// synthetic Perth-area tracks. The fixtures were first written by the old (upstream-derived) modules,
// before the clean-room rewrite; the rewrite must reproduce them byte for byte, except the listed
// fixes (slug trailing `_`; the unused "test" bakery quality dropped). PNGs are compared by SHA-256.
import { createHash } from "node:crypto";
import { withDefaults } from "../src/core/options";
import { planRoad, type RoadPlan } from "../src/core/road";
import type { Vec2 } from "../src/core/geo";
import { camerasIni, placeCameras } from "../src/core/cameras";
import * as ac from "../src/core/acFiles";
import { bakedShadowParams, extConfig } from "../src/core/cspConfig";
import type { Hollow } from "../src/core/rainHollows";
import type { SoundEmitter } from "../src/core/trackSounds";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export const goldenOpts = withDefaults({ widthOverride: 8, banking: false });

/** The cameras spec's test plan: 30 points east 20 m apart, then a 20-point left bend of radius 200 m; heights 20. */
export function specPlan(): RoadPlan {
  const pts: Vec2[] = [];
  for (let i = 0; i < 30; i++) pts.push([i * 20, 0]);
  const cx = 29 * 20, cy = 200;
  for (let k = 1; k <= 20; k++) { const a = -Math.PI / 2 + (k / 20) * (Math.PI / 2); pts.push([cx + 200 * Math.cos(a), cy + 200 * Math.sin(a)]); }
  const plan = planRoad(pts, goldenOpts);
  for (const s of plan.samples) s.h = 20;
  return plan;
}

/** A 600 x 400 m rounded rectangle loop. */
function loopPlan(): RoadPlan {
  const pts: Vec2[] = [];
  const corner = (cx: number, cy: number, a0: number) => { for (let k = 0; k <= 8; k++) { const a = a0 + (k / 8) * (Math.PI / 2); pts.push([cx + 60 * Math.cos(a), cy + 60 * Math.sin(a)]); } };
  corner(540, 60, -Math.PI / 2); corner(540, 340, 0); corner(60, 340, Math.PI / 2); corner(60, 60, Math.PI);
  pts.push([...pts[0]] as Vec2);
  const plan = planRoad(pts, goldenOpts);
  for (const s of plan.samples) s.h = 5 + 0.002 * s.pos[0];
  return plan;
}

/** Every golden file's expected content, by file name in test/fixtures/golden. */
export function goldenOutputs(): Record<string, string> {
  const out: Record<string, string> = {};
  const opts = goldenOpts;
  const slope = (x: number, y: number) => 5 + 0.002 * x + 0.001 * y;
  out["cameras_spec.ini"] = camerasIni(placeCameras(specPlan(), opts, () => 20));
  out["cameras_loop.ini"] = camerasIni(placeCameras(loopPlan(), opts, slope));
  out["cameras_loop_blocked.ini"] = camerasIni(placeCameras(loopPlan(), opts, slope, (x) => x > 250 && x < 350));
  out["cameras_empty.ini"] = camerasIni([]);

  const PERTH: [number, number] = [115.86, -31.95];
  const surf: Record<string, string> = {};
  for (const traffic of [false, true]) for (const streetsValid of [false, true]) for (const at of [undefined, PERTH]) for (const unsealed of [false, true]) {
    surf[`t${+traffic}_s${+streetsValid}_a${at ? 1 : 0}_u${+unsealed}`] = ac.surfacesIni(traffic, streetsValid, at, unsealed);
  }
  surf["outside_australia"] = ac.surfacesIni(false, false, [10, 50]);
  out["surfaces.json"] = JSON.stringify(surf, null, 1) + "\n";
  const meta = { name: "Perth Test Loop" };
  out["ui_track_closed.json"] = ac.uiTrackJson(meta, { length: 2345.6, width: 7.4, pitboxes: 12, closed: true, centre: PERTH });
  out["ui_track_open.json"] = ac.uiTrackJson({ name: "Kings Park Run", description: "A run.", country: "Australia", city: "Perth", author: "Mac" },
    { length: 812.2, width: 6.5, pitboxes: 1, closed: false, centre: [-0.5, 0.25], traffic: true });
  const outline: [number, number][] = [[0, 0], [1000, 0], [1000, -500], [300, -480], [0, 0]];
  const big: [number, number][] = [[-3000, 200], [7000, 200], [6500, 4200], [0, 3000]];
  const tm = ac.trackMap(outline), tmBig = ac.trackMap(big);
  const streets = [{ pts: [[-50, 0], [1050, 0]] as [number, number][], width: 9 }, { pts: [[500, -600], [500, 100]] as [number, number][], width: 6 }];
  const sm = ac.streetMap(streets, outline), smSmall = ac.streetMap([], [[0, 0], [30, 10]]);
  out["map.json"] = JSON.stringify({
    trackMap: { ini: tm.ini, png: sha(tm.png) }, trackMapBig: { ini: tmBig.ini, png: sha(tmBig.png) },
    streetMap: { ini: sm.ini, png: sha(sm.png) }, streetMapSmall: { ini: smSmall.ini, png: sha(smSmall.png) },
    outline: sha(ac.outlinePng(outline)), outlineTall: sha(ac.outlinePng([[0, 0], [20, 900]])),
    previewClosed: sha(ac.previewPng(outline, true)), previewOpen: sha(ac.previewPng(big, false)),
  }, null, 1) + "\n";
  out["readme_imagery.txt"] = ac.readme(meta, "Landgate Locate");
  out["readme_null.txt"] = ac.readme(meta, null);
  out["slugs.json"] = JSON.stringify(Object.fromEntries(["Perth Test Loop", "Café  Strip!", "!!!", "", "  --x--  ",
    "Abcdefghijklmnopqrstuvwxyzabcdefghijklm nopqrstuv", "Ünïcødé Route — Kings Park"].map((n) => [n, ac.slugify(n)])), null, 1) + "\n";

  const hollows: Hollow[] = [
    { low: [50, 1.9, 4], centre: [51, 2, 4.5], depth: 0.1, area: 120, volume: 5, radius: 12 },
    { low: [-12.345, 0.5, -300.001], centre: [-12, 0.6, -300], depth: 0.034, area: 7.6, volume: 0.2, radius: 1.7 },
  ];
  const sounds: SoundEmitter[] = [{ kind: "surf", at: [100, -50, 0] }, { kind: "magpie", at: [20, 30, 6] }, { kind: "kookaburra", at: [-40, 10, 8] }];
  const pure = { at: PERTH, albedo: 0.55, coast: true, photoLight: { ambient: 0.6, diffuse: 0.5 } };
  const lights: [number, number, number][] = [[10, 20, 8.2], [-5, 3, 9], [-0.001, 0.004, 7]];
  const all = (soundMode: "lua" | "fmod") => ({ builtUp: true, radiusKm: 1.234, autotest: true, drySummer: true, sea: true, photoSea: true,
    trees: "trees/trees.txt", vines: true, hollows, sounds, soundMode, pure, flags: true, jettyTrain: true });
  out["ext_a_none.ini"] = extConfig([]);
  out["ext_b_lights_builtup.ini"] = extConfig(lights.slice(0, 2), { builtUp: true });
  out["ext_c_all_lua.ini"] = extConfig(lights, all("lua"));
  out["ext_c_all_fmod.ini"] = extConfig(lights, all("fmod"));
  out["ext_d_misc.ini"] = extConfig([], { hollows: [], sounds: [], soundMode: "fmod", photoSea: true, radiusKm: 0.3, builtUp: true, pure: { at: [10, 50] } });
  out["ext_e_lua_sounds_only.ini"] = extConfig([], { sounds, flags: false });
  out["baked_final.ini"] = bakedShadowParams();
  return out;
}
