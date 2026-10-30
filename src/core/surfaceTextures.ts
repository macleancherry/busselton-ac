// Busselton fork: tileable surface textures for spec buildings' yards and fittings (specHouse.ts):
// brick pavers, concrete paving, timber boards, canvas, Colorbond steel and painted steel, each in
// the colour the spec gives. Each covers 2 m x 2 m (the spec's UVs repeat every 2 m), 256 px, and
// goes through buildingScenery, which adds a normal map from its shading for relief.

import { encodePng } from "./png";
import { fill, rng, valueNoise } from "./textures";

export type SurfaceKind = "brick" | "concrete" | "timber" | "canvas" | "colorbond" | "steel";
export const SURFACE_KINDS: SurfaceKind[] = ["brick", "concrete", "timber", "canvas", "colorbond", "steel"];

type RGB = [number, number, number];
const W = 256; // 128 px a metre
const clamp = (v: number) => Math.max(0, Math.min(255, v));
const tint = (c: RGB, k: number, n = 0): RGB => [clamp(c[0] * k + n), clamp(c[1] * k + n), clamp(c[2] * k + n)];

/** A 2 m square tile of `kind` in roughly the colour `rgb` (PNG). */
export function surfaceTexture(kind: SurfaceKind, rgb: RGB): Uint8Array {
  const r = rng(503 + SURFACE_KINDS.indexOf(kind) * 17);
  const noise = valueNoise(W, W, 16, 504 + kind.length);
  const fine = valueNoise(W, W, 64, 505);
  let shade: (x: number, y: number, i: number) => RGB;
  if (kind === "brick") {
    // Clay pavers 230 x 115 mm in stretcher bond, sand joints, each brick its own shade, worn edges.
    const L = 32, H = 16, J = 1.3; // px (128 px/m): 8 bricks and 16 courses a tile, so it repeats cleanly
    const tones = Array.from({ length: 400 }, () => 0.78 + r() * 0.34);
    const cols = W / L;
    shade = (x, y, i) => {
      const row = Math.floor(y / H), off = (row % 2) * (L / 2);
      const bx = Math.floor((x + off) / L), u = (x + off) % L, v = y % H;
      const n = (noise[i] - 0.5) * 18 + (fine[i] - 0.5) * 14;
      if (u < J || v < J) return tint([196, 182, 156], 0.9, n * 0.4); // sand in the joints
      const edge = Math.min(u - J, L - u, v - J, H - v) < 1.6 ? 0.9 : 1;
      return tint(rgb, tones[(row * cols + (bx % cols)) % 400] * edge, n);
    };
  } else if (kind === "concrete") {
    // Broom-finished slabs with saw cuts every metre, a little staining.
    shade = (x, y, i) => {
      const n = (noise[i] - 0.5) * 22 + (fine[i] - 0.5) * 10 + (Math.sin((y / W) * Math.PI * 2 * 40) * 2);
      if (x % 128 < 1.5 || y % 128 < 1.5) return tint(rgb, 0.72, n * 0.3);
      return tint(rgb, 1, n);
    };
  } else if (kind === "timber") {
    // Boards 140 mm wide along u with 8 mm gaps, grain streaks and the odd knot.
    const B = 16, G = 1; // 16 boards a tile
    const tones = Array.from({ length: 64 }, () => 0.82 + r() * 0.3);
    const knots = Array.from({ length: 10 }, () => [r() * W, r() * W] as [number, number]);
    shade = (x, y, i) => {
      const board = Math.floor(y / B), v = y % B;
      if (v < G) return tint(rgb, 0.35);
      const t = (x / W) * Math.PI * 2;
      const grain = Math.sin(t * 9 + Math.sin(t * 2 + board) * 2 + v * 0.35 + board * 1.7) * 0.06;
      let k = tones[board % 64] + grain + (noise[i] - 0.5) * 0.12;
      for (const [kx, ky] of knots) if (Math.hypot(x - kx, (y - ky) * 2) < 3.5) k *= 0.7;
      return tint(rgb, k);
    };
  } else if (kind === "canvas") {
    // Woven fabric: a fine weave, soft folds, a hem line round the tile edge.
    shade = (x, y, i) => {
      const weave = ((x % 4 < 2) !== (y % 4 < 2) ? 0.97 : 1.02);
      const fold = 0.94 + 0.06 * Math.sin(((x + y) / W) * Math.PI * 2 * 3 + noise[i] * 3);
      const hem = x < 3 || y < 3 ? 0.88 : 1;
      return tint(rgb, weave * fold * hem, (fine[i] - 0.5) * 6);
    };
  } else if (kind === "colorbond") {
    // Corrugated steel panels: ribs every 76 mm along u, darker in the valleys.
    shade = (x, _y, i) => {
      const k = 0.86 + 0.14 * Math.sin((x / W) * Math.PI * 2 * 26);
      return tint(rgb, k, (noise[i] - 0.5) * 8);
    };
  } else {
    // Painted steel: nearly flat, light streaks.
    shade = (_x, y, i) => tint(rgb, 0.96 + 0.04 * Math.sin((y / W) * Math.PI * 2 * 8), (noise[i] - 0.5) * 8);
  }
  return encodePng(fill(W, W, shade), W, W, { alpha: false });
}
