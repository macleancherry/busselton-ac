// Parked cars, put back where the photo had them. The car painter (carpark.ts)
// takes cars out of the ground photo; this puts a simple low-poly car in each
// one's place, pointing the same way and close to its colour, so car parks and
// kerbs aren't empty. Visual mesh plus an invisible box to hit.
//
// One car: a lower body, a cabin with dark glass, four wheels. About 60 triangles.

import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import { MAX_MESH_VERTICES, type Kn5MeshNode } from "./kn5";
import { MeshBuilder, type Vec3 } from "./mesh";
import { encodePng } from "./png";
import { pad } from "./roadMesh";
import { box, ChunkedMesh } from "./scenery";
import { fill } from "./textures";

export interface ParkedCar {
  /** Centre, local metres. */
  at: Vec2;
  /** Unit vector along the car. */
  dir: Vec2;
  /** Paint: index into PAINT. */
  paint: number;
}

/** Common car colours in Australia, roughly how they look from above (sRGB 0-255). */
export const PAINT: [number, number, number][] = [
  [236, 236, 234], // white
  [244, 244, 240], // white
  [186, 189, 193], // silver
  [118, 121, 126], // grey
  [62, 64, 68], // gunmetal
  [24, 24, 27], // black
  [28, 42, 82], // navy
  [40, 84, 150], // blue
  [150, 26, 28], // red
  [88, 22, 28], // maroon
  [36, 72, 48], // green
  [196, 180, 146], // beige
];
/** Swatches after the paints: window glass, tyres, lights. */
const GLASS = PAINT.length, TYRE = PAINT.length + 1;
const SWATCHES = PAINT.length + 2;

/**
 * The paint for a colour seen from the air (0-1). Most cars are white, silver, grey or black, and
 * shade in the photo reads blue, so a car only gets a colour when the photo is clearly coloured:
 * otherwise a neutral by brightness.
 */
export function paintFor(rgb: [number, number, number]): number {
  const l = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const chroma = Math.max(...rgb) - Math.min(...rgb);
  const blueCast = rgb[2] >= rgb[0] && rgb[2] >= rgb[1];
  if (chroma < (blueCast ? 0.2 : 0.12)) {
    // Neutrals, brightest first: white, silver, grey, gunmetal, black.
    if (l > 0.62) return l > 0.75 ? 1 : 0;
    if (l > 0.48) return 2;
    if (l > 0.33) return 3;
    if (l > 0.2) return 4;
    return 5;
  }
  const c = rgb.map((v) => Math.min(1, Math.max(0, 0.5 + (v - l) * 1.6 + (l - 0.45) * 1.25)) * 255);
  let best = 0, bestD = Infinity;
  PAINT.forEach((p, i) => {
    if (i <= 5) return;
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** The swatch atlas: one 16 px column per paint, then glass and tyre. */
export function carTexture(): Uint8Array {
  const w = 16 * SWATCHES, h = 16;
  return encodePng(fill(w, h, (x) => {
    const k = Math.floor(x / 16);
    if (k < PAINT.length) return PAINT[k];
    return k === GLASS ? [22, 28, 34] : [20, 20, 20];
  }), w, h);
}

const u = (swatch: number) => (swatch + 0.5) / SWATCHES;

/** One car into `mb`: faces given as rings of local points, counter-clockwise from outside. */
function addCar(mb: MeshBuilder, car: ParkedCar, z: number): void {
  const [fx, fy] = car.dir, sx = -fy, sy = fx;
  const P = (f: number, s: number, h: number): Vec3 => [car.at[0] + fx * f + sx * s, car.at[1] + fy * f + sy * s, z + h];
  const face = (pts: Vec3[], swatch: number) => {
    const i = mb.vertexCount;
    for (const p of pts) mb.vertex(p, u(swatch), 0.5);
    for (let k = 1; k + 1 < pts.length; k++) mb.tri(i, i + k, i + k + 1);
  };
  /** A box-like solid from a bottom and top rectangle (front, back, half widths), sides one swatch, top another. */
  const solid = (b: [number, number, number, number], t: [number, number, number, number], side: number, top: number, front = side) => {
    const [bf, bb, bw, bh] = b, [tf, tb, tw, th] = t;
    const B = [P(bf, -bw, bh), P(bf, bw, bh), P(bb, bw, bh), P(bb, -bw, bh)];
    const T = [P(tf, -tw, th), P(tf, tw, th), P(tb, tw, th), P(tb, -tw, th)];
    // Corners run front-right, front-left, back-left, back-right (s is to the left): counter-clockwise from above.
    face([T[0], T[1], T[2], T[3]], top);
    face([B[0], B[1], T[1], T[0]], front); // front
    face([B[1], B[2], T[2], T[1]], side); // left
    face([B[2], B[3], T[3], T[2]], front); // back
    face([B[3], B[0], T[0], T[3]], side); // right
  };
  const p = car.paint;
  // Lower body: 4.5 x 1.8 m, from 0.3 to 0.95 m, the bonnet a touch lower at the front.
  solid([2.25, -2.25, 0.9, 0.3], [2.2, -2.2, 0.9, 0.95], p, p);
  // Cabin: glass sides and ends, painted roof.
  solid([1.0, -1.45, 0.86, 0.95], [0.35, -1.15, 0.7, 1.45], GLASS, p, GLASS);
  // Wheels: dark blocks just inside the body's corners, showing under it.
  for (const f of [1.4, -1.4]) {
    for (const s of [0.74, -0.74]) {
      const c = (df: number, ds: number, h: number) => P(f + df, s + ds, h);
      const r = 0.33, w = 0.11;
      const ring = (ds: number) => [c(r, ds, 0.02), c(r, ds, 0.62), c(-r, ds, 0.62), c(-r, ds, 0.02)];
      const o = ring(Math.sign(s) * w), i = ring(-Math.sign(s) * w);
      face(s > 0 ? [o[3], o[2], o[1], o[0]] : o, TYRE); // outer face
      face(s > 0 ? [o[0], o[1], i[1], i[0]] : [i[0], i[1], o[1], o[0]], TYRE); // front of tyre
      face(s > 0 ? [o[2], o[3], i[3], i[2]] : [i[2], i[3], o[3], o[2]], TYRE); // back of tyre
    }
  }
}

/** Visual cars (PARKED_CARS) and their invisible collision boxes (1WALL_CAR). */
export function buildParkedCars(cars: ParkedCar[], ground: HeightFn): Kn5MeshNode[] {
  const meshes: MeshBuilder[] = [];
  let mb = new MeshBuilder();
  const walls = new ChunkedMesh(24);
  for (const car of cars) {
    if (mb.vertexCount + 120 > MAX_MESH_VERTICES) {
      meshes.push(mb);
      mb = new MeshBuilder();
    }
    const z = ground(car.at[0], car.at[1]);
    addCar(mb, car, z);
    box(walls.next(), car.at, car.dir, 4.4, 1.75, z - 0.3, z + 1.4);
  }
  meshes.push(mb);
  return [
    ...meshes.filter((m) => m.indices.length).map((m, i) => m.toKn5(`PARKED_CARS_${pad(i)}`, "parked_car")),
    ...walls.all().map((m, i) => m.toKn5(`1WALL_CAR_${pad(i)}`, "wall", { renderable: false, castShadows: false })),
  ];
}
