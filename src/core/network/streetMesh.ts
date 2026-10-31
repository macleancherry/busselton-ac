// networkCore phase 2: the streets between junctions as meshes (docs/specs/road-network.md, "Meshes";
// fresh code, not the old sideStreets builder). Each street is one ribbon per carriageway between its
// junction caps (a divided road is two, with a raised median island between them), draped on the
// ground the junctions eased it to, and run on to the route's surface at a mouth the old core still
// builds. Kerbed streets get the junctions' kerb profile (gutter, face, top) along both sides, ending
// at the caps where the junction's own corner kerb carries on, and sloping back down to the ground
// behind. Two-way main streets get a dashed centre line, wide carriageways a lane line.
//
// Rows sit on the street's own points (the junction caps are points of it, put there by
// insertStreetCaps), with extra rows every 3 m; a row's direction at one of the street's own points is
// the central difference of its neighbours, as the cap was made with, so cap rows are the caps exactly.

import type { Kn5MeshNode } from "../kn5";
import { MeshBuilder } from "../mesh";
import { ChunkedMesh } from "../meshKit";
import { band, KERB, KERB_BACK, orientedQuad, PAINT_LIFT, type Builder } from "./dress";
import { add, dist, lengths, mul, smoothstep, sub, unit, type P2 } from "./geom";

export interface MeshStreet {
  pts: P2[];
  width: number;
  widths?: number[];
  joins: number[];
  cls: string;
  oneway?: 1 | -1;
  median?: number;
  surface?: string;
}

export interface StreetMeshOptions {
  /** The ground the street drapes on (eased to each junction's field at its caps). */
  ground: (x: number, y: number) => number;
  /** The street's height above that ground (the junction fields expect the same lift). */
  lift: number;
  /** The surface a mouth meets (the route's, an old-core ring's), or null: the street stays draped. */
  joinZ: (p: P2) => number | null;
  /** Leave out the quad of street `st` from arc s0 to s1 (a junction covers it). */
  skip?: (st: MeshStreet, s0: number, s1: number) => boolean;
  /** Room from a point to asphalt that isn't street `si`'s own (another street, the route). */
  clear?: (p: P2, si: number) => number;
  kerbed: (si: number) => boolean;
  markings: boolean;
  material: (si: number) => string | { material: string; perStreet: true };
  /** Physics key for a material (gravel streets have their own), else STREET. */
  surfaceKey?: (material: string) => string | undefined;
  /** Texture repeat along the street, metres. */
  uvLength?: number;
}

export interface StreetMeshes {
  road: Kn5MeshNode[];
  dress: Kn5MeshNode[];
  markings: Kn5MeshNode[];
  /** Street indices that got a kerb (their junction corners are kerbed too). */
  kerbed: Set<number>;
  triangles: number;
}

/** Strip behind the kerb (from the road edge), the dash and gap of a centre line, the line's width. */
const STRIP = 1.2;
const DASH = 3, GAP = 9, LINE_W = 0.1;
const RAMP = 1.5;
const MOUTH_BLEND = 10;

interface Row { p: P2; d: P2; left: P2; w: number; s: number }

/** The street's rows: its own points plus extra ones every `step` metres. */
export function streetRows(st: MeshStreet, step = 3): Row[] {
  const pts = st.pts, n = pts.length;
  const cum = lengths(pts);
  const wAt = (k: number) => st.widths?.[k] ?? st.width;
  const rows: Row[] = [];
  const dirAt = (k: number): P2 => (k > 0 && k < n - 1 ? unit(sub(pts[k + 1], pts[k - 1])) : k === 0 ? unit(sub(pts[1], pts[0])) : unit(sub(pts[n - 1], pts[n - 2])));
  for (let k = 0; k < n; k++) {
    const d = dirAt(k);
    rows.push({ p: pts[k], d, left: [-d[1], d[0]], w: wAt(k), s: cum[k] });
    if (k === n - 1) continue;
    const L = cum[k + 1] - cum[k];
    const m = Math.ceil(L / step);
    if (m <= 1) continue;
    const sd = unit(sub(pts[k + 1], pts[k]));
    for (let q = 1; q < m; q++) {
      const f = q / m;
      rows.push({ p: add(pts[k], mul(sub(pts[k + 1], pts[k]), f)), d: sd, left: [-sd[1], sd[0]], w: wAt(k) + (wAt(k + 1) - wAt(k)) * f, s: cum[k] + L * f });
    }
  }
  return rows;
}

export function buildStreetMeshes(streets: MeshStreet[], o: StreetMeshOptions): StreetMeshes {
  const surfaces = new Map<string, ChunkedMesh>();
  const dressSinks = new Map<string, MeshBuilder[]>();
  const sink = (name: string, need: number): MeshBuilder => {
    let list = dressSinks.get(name);
    if (!list) { list = [new MeshBuilder()]; dressSinks.set(name, list); }
    if (list[list.length - 1].vertexCount + need > 60000) list.push(new MeshBuilder());
    return list[list.length - 1];
  };
  const kerbedSet = new Set<number>();
  const uvL = o.uvLength ?? 8;
  let triangles = 0;

  streets.forEach((st, si) => {
    const rows = streetRows(st);
    const n = rows.length;
    if (n < 2) return;
    const total = rows[n - 1].s;
    const choice = o.material(si);
    const mat = typeof choice === "string" ? choice : choice.material;
    const joinS = st.joins.map((k) => lengths(st.pts)[k]);
    const dJoin = (s: number) => Math.min(Infinity, ...joinS.map((j) => Math.abs(s - j)));
    const zEdge = (x: P2, s: number) => {
      const draped = o.ground(x[0], x[1]) + o.lift;
      const dj = dJoin(s);
      if (dj >= MOUTH_BLEND) return draped;
      const r = o.joinZ(x);
      if (r === null) return draped;
      return r - 0.02 + (draped - (r - 0.02)) * smoothstep(dj / MOUTH_BLEND);
    };
    const quadOn = rows.slice(0, -1).map((r, k) => !o.skip?.(st, r.s, rows[k + 1].s));
    if (!quadOn.some(Boolean)) return;
    // Carriageways: [offset of the centre, width] per row; a divided road has two.
    const med = st.median && st.median > 0.3 ? st.median : 0;
    const ways: { off: (r: Row) => number; width: (r: Row) => number; side: 0 | 1 | -1 }[] = med
      ? ([1, -1] as const).map((side) => ({ side, off: (r: Row) => side * (med / 2 + (r.w - med) / 4), width: (r: Row) => (r.w - med) / 2 }))
      : [{ side: 0, off: () => 0, width: (r: Row) => r.w }];
    const edgeZ: Map<string, number> = new Map();
    const edgePoint = (r: Row, wi: number, e: 1 | -1): P2 => add(r.p, mul(r.left, ways[wi].off(r) + (e * ways[wi].width(r)) / 2));
    const zOfEdge = (k: number, wi: number, e: 1 | -1) => {
      const key = `${k},${wi},${e}`;
      let z = edgeZ.get(key);
      if (z === undefined) { z = zEdge(edgePoint(rows[k], wi, e), rows[k].s); edgeZ.set(key, z); }
      return z;
    };
    // Road surface.
    if (!surfaces.has(mat)) surfaces.set(mat, new ChunkedMesh(0));
    for (let wi = 0; wi < ways.length; wi++) {
      const mb = surfaces.get(mat)!.next(n * 2);
      const base = mb.vertexCount;
      rows.forEach((r, k) => {
        for (const e of [1, -1] as const) {
          const x = edgePoint(r, wi, e);
          mb.vertex([x[0], x[1], zOfEdge(k, wi, e)], e > 0 ? 0 : 1, typeof choice === "string" ? r.s / uvL : r.s / Math.max(1, total));
        }
      });
      for (let k = 0; k < n - 1; k++) {
        if (!quadOn[k]) continue;
        const p = base + k * 2, q = p + 2;
        mb.quad(p, p + 1, q + 1, q);
        triangles += 2;
      }
    }
    // Kerbs along the outer edges: amount per row, ramped over 1.5 m where it stops.
    const kerbedHere = o.kerbed(si);
    if (kerbedHere) {
      let any = false;
      for (let wi = 0; wi < ways.length; wi++) {
        for (const e of [1, -1] as const) {
          // Outer edges only (a divided road's inner edges face the median).
          if (ways[wi].side !== 0 && e !== ways[wi].side) continue;
          const raw = rows.map((r, k) => {
            if (dJoin(r.s) < r.w / 2 + 3) return 0;
            const x = edgePoint(r, wi, e);
            const out = mul(r.left, e);
            if (o.clear && o.clear(add(x, mul(out, KERB_BACK + 0.3)), si) < 0.3) return 0;
            if (o.clear && o.clear(add(x, mul(out, 0.05)), si) < 0.05) return 0;
            return (k > 0 && quadOn[k - 1]) || (k < n - 1 && quadOn[k]) ? 1 : 0;
          });
          // Distance along to the nearest row without a kerb.
          const amt = rows.map((r) => {
            let d = Infinity;
            raw.forEach((v, q) => { if (!v) d = Math.min(d, Math.abs(rows[q].s - r.s)); });
            return smoothstep(Math.min(1, d / RAMP));
          });
          // Runs of kerbed quads.
          for (let k = 0; k < n - 1;) {
            if (!quadOn[k] || !(raw[k] || raw[k + 1]) || amt[k] + amt[k + 1] < 1e-3) { k++; continue; }
            let m = k;
            while (m < n - 1 && quadOn[m] && (raw[m] || raw[m + 1]) && amt[m] + amt[m + 1] >= 1e-3) m++;
            const idx = rows.slice(k, m + 1).map((_, q) => k + q);
            const run = idx.map((q) => edgePoint(rows[q], wi, e));
            const normals = idx.map((q) => mul(rows[q].left, e));
            const z = idx.map((q) => zOfEdge(q, wi, e));
            const arc = idx.map((q) => rows[q].s);
            // orientedQuad makes 4 vertices a quad; two profile segments share a sink.
            const need = run.length * 8;
            const sinksK: Builder[] = [sink("1GRASS_STRIP_S", need), sink("1GRASS_STRIP_S", 0), sink("1KERB_S", need), sink("1KERB_S", 0), sink("1STREET_GUTTER_S", need / 2)];
            band(sinksK, run, normals, z, (q) => {
              const kk = amt[idx[q]];
              const back = add(run[q], mul(normals[q], STRIP));
              const gz = o.ground(back[0], back[1]) + 0.03 - z[q];
              const top = KERB.height * kk;
              const zb = top + (Math.min(top + 0.02, gz) - top) * kk;
              return [[STRIP, zb - 0.6], [STRIP, zb], [KERB_BACK * kk, top], [(KERB.gutter + KERB.faceRun) * kk, top], [KERB.gutter * kk, -KERB.dip * kk], [0, 0]];
            }, arc);
            any = true;
            k = m;
          }
        }
      }
      if (any) kerbedSet.add(si);
    }
    // The median island: a kerb up from each carriageway's inner edge, grass on top, closed at its ends.
    if (med >= 0.6) {
      const half = med / 2;
      const kb = Math.min(KERB_BACK, half);
      const prof: [number, number][] = [[half, KERB.height + 0.02], [kb, KERB.height], [Math.min(KERB.gutter + KERB.faceRun, half), KERB.height], [Math.min(KERB.gutter, half - 0.01), -KERB.dip], [0, 0]];
      for (let k = 0; k < n - 1;) {
        if (!quadOn[k]) { k++; continue; }
        let m = k;
        while (m < n - 1 && quadOn[m]) m++;
        const idx = rows.slice(k, m + 1).map((_, q) => k + q);
        const need = idx.length * 8;
        const sinksM: Builder[] = [sink("1GRASS_MEDIAN_S", need), sink("1KERB_SM", need * 2), sink("1KERB_SM", 0), sink("1STREET_GUTTER_S", need)];
        for (const wi of [0, 1]) {
          const e = (-ways[wi].side) as 1 | -1;
          const run = idx.map((q) => edgePoint(rows[q], wi, e));
          const normals = idx.map((q) => mul(rows[q].left, e));
          band(sinksM, run, normals, idx.map((q) => zOfEdge(q, wi, e)), () => prof, idx.map((q) => rows[q].s));
        }
        // End faces where the island stops (a junction cap, the street's end).
        for (const q of [k, m]) {
          const r = rows[q];
          const out = q === k ? mul(r.d, -1) : r.d;
          const zl = zOfEdge(q, 0, -1), zr = zOfEdge(q, 1, 1);
          const pl = edgePoint(r, 0, -1), pr = edgePoint(r, 1, 1);
          const across = (t: number): P2 => add(pl, mul(sub(pr, pl), t));
          const sec = prof.slice().reverse();
          const top: [number, number, number][] = [
            ...sec.map(([t, dz]) => { const p = across(t / med); return [p[0], p[1], zl + dz] as [number, number, number]; }),
            ...prof.slice(1).map(([t, dz]) => { const p = across(1 - t / med); return [p[0], p[1], zr + dz] as [number, number, number]; }),
          ];
          const mbE = sink("1KERB_SM", top.length + 2);
          for (let a = 0; a < top.length - 1; a++) {
            const b0: [number, number, number] = [top[a][0], top[a][1], Math.min(zl, zr) - 0.05];
            const b1: [number, number, number] = [top[a + 1][0], top[a + 1][1], Math.min(zl, zr) - 0.05];
            orientedQuad(mbE, [b0, b1, top[a + 1], top[a]], [[0, 0], [1, 0], [1, 1], [0, 1]], [out[0], out[1], 0]);
          }
        }
        k = m;
      }
    }
    // Markings: a dashed centre line on two-way main streets; a lane line on wide carriageways.
    if (o.markings && (st.surface === undefined || !/unpaved|gravel|dirt|ground|compacted/.test(st.surface))) {
      const main = /^(primary|secondary|tertiary)/.test(st.cls);
      const lines: { off: (r: Row) => number; wi: number }[] = [];
      if (!med && !st.oneway && main && st.width >= 6.4) lines.push({ off: () => 0, wi: 0 });
      ways.forEach((w, wi) => {
        const cw = w.width(rows[0]);
        if (cw >= 6.4 && (med || st.oneway)) lines.push({ off: (r) => w.off(r), wi });
      });
      // Not within 12 m of a mouth, nor 2 m of a junction cap.
      const nearCap = (s: number) => rows.some((r, k) => k < n - 1 && !quadOn[k] && s > r.s - 2 && s < rows[k + 1].s + 2);
      for (const ln of lines) {
        const mb = sink("MARKINGS_S", Math.ceil(total / (DASH + GAP)) * 8 + 8);
        for (let s0 = 1; s0 + DASH <= total - 1; s0 += DASH + GAP) {
          if (dJoin(s0) < 12 || dJoin(s0 + DASH) < 12 || nearCap(s0) || nearCap(s0 + DASH)) continue;
          const pts: [number, number, number][][] = [];
          for (const s of [s0, s0 + DASH / 2, s0 + DASH]) {
            let k = 0;
            while (k < n - 2 && rows[k + 1].s < s) k++;
            const a = rows[k], b = rows[k + 1];
            const f = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s || 1)));
            const c = add(a.p, mul(sub(b.p, a.p), f));
            const d = unit(add(mul(a.d, 1 - f), mul(b.d, f)));
            const left: P2 = [-d[1], d[0]];
            const r: Row = { ...a, w: a.w + (b.w - a.w) * f };
            const ctr = add(c, mul(left, ln.off(r)));
            // The carriageway is flat across: its height at the line is the edges' mean.
            const zl = zOfEdge(k, ln.wi, 1) * (1 - f) + zOfEdge(k + 1, ln.wi, 1) * f;
            const zr = zOfEdge(k, ln.wi, -1) * (1 - f) + zOfEdge(k + 1, ln.wi, -1) * f;
            const z = (zl + zr) / 2 + PAINT_LIFT;
            pts.push([[ctr[0] + left[0] * LINE_W / 2, ctr[1] + left[1] * LINE_W / 2, z], [ctr[0] - left[0] * LINE_W / 2, ctr[1] - left[1] * LINE_W / 2, z]]);
          }
          for (let q = 0; q < pts.length - 1; q++) {
            const i0 = mb.vertex(pts[q][0], 0, 0), i1 = mb.vertex(pts[q][1], 1, 0), i2 = mb.vertex(pts[q + 1][1], 1, 1), i3 = mb.vertex(pts[q + 1][0], 0, 1);
            mb.quad(i0, i1, i2, i3);
          }
        }
      }
    }
  });

  const road: Kn5MeshNode[] = [];
  let i = 0;
  for (const [mat, cm] of surfaces) {
    for (const m of cm.all()) {
      m.normals = null;
      road.push(m.toKn5(`1${o.surfaceKey?.(mat) ?? "STREET"}_${String(i++).padStart(3, "0")}`, mat));
    }
  }
  const dress: Kn5MeshNode[] = [], markings: Kn5MeshNode[] = [];
  const MAT: Record<string, string> = { "1GRASS_STRIP_S": "grass", "1KERB_S": "concrete", "1STREET_GUTTER_S": "concrete", "1GRASS_MEDIAN_S": "grass", "1KERB_SM": "concrete", MARKINGS_S: "paint" };
  for (const [name, list] of dressSinks) list.forEach((mb, q) => {
    if (!mb.indices.length) return;
    triangles += mb.indices.length / 3;
    const node = mb.toKn5(`${name}${String(q).padStart(3, "0")}`, MAT[name], name === "MARKINGS_S" ? { castShadows: false } : undefined);
    (name === "MARKINGS_S" ? markings : dress).push(node);
  });
  return { road, dress, markings, kerbed: kerbedSet, triangles };
}

export { dist };
