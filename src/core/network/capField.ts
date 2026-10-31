// One height field per ribbon-capped junction (docs/specs/road-network.md, "Junction fields").
// Route legs are fixed: on its cap the field is exactly the route's own row (centre height, bank,
// grade and the crown), so the route ribbon needs no change. Street legs conform: on their caps the
// field is the base plane, and the streets are eased to it (streetEase). In between, an inverse
// distance blend of the leg surfaces and the base plane, which equals each leg surface on its cap
// and leaves it with the same slope.

import { dot, segDist, sub, type P2 } from "./geom";
import { profileAt, terrainProfile, type HeightAt, type Plane, planeAt } from "./heights";
import type { RJunction, RLeg, RouteRibbon } from "./ribbons";

export interface CapFieldOptions {
  /** Streets are draped this far above the ground (sideStreets.ts); a street junction sits there too. */
  streetLift?: number;
  sigma?: number;
  maxGrade?: number;
  maxGradeRoundabout?: number;
  ringFall?: number;
}

const D = { streetLift: 0.1, sigma: 15, maxGrade: 0.04, maxGradeRoundabout: 0.025, ringFall: 0.02 };

export interface CapField {
  base: Plane;
  /** The field is the base plane (plus a roundabout's fall): no route legs. */
  planar: boolean;
  /** Indices of the priority road's two legs, when there is one. */
  through?: [number, number];
  /** Leg surfaces (exact on their caps). */
  legSurface: ((p: P2) => number)[];
  fall: (p: P2) => number;
  h: (p: P2) => number;
}

function fitPlane(pts: { p: P2; h: number; w: number }[], o: P2): Plane {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const { p, h, w } of pts) {
    const r = [1, p[0] - o[0], p[1] - o[1]];
    for (let i = 0; i < 3; i++) {
      b[i] += w * r[i] * h;
      for (let j = 0; j < 3; j++) A[i][j] += w * r[i] * r[j];
    }
  }
  for (let i = 1; i < 3; i++) A[i][i] += 1e-6;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return { o, h0: M[0][3] / (M[0][0] || 1e-12), g: [M[1][3] / (M[1][1] || 1e-12), M[2][3] / (M[2][2] || 1e-12)] };
}

function clampGrade(pl: Plane, max: number): Plane {
  const g = Math.hypot(pl.g[0], pl.g[1]);
  return g <= max ? pl : { ...pl, g: [(pl.g[0] / g) * max, (pl.g[1] / g) * max] };
}

/** The route's surface at its row `i`, extended: height, bank, crown (clamped at the edges) and grade outward. */
export function routeRowSurface(route: RouteRibbon, i: number, dir: 1 | -1): (p: P2) => number {
  const S = route.samples, n = S.length, s = S[i];
  const prev = route.closed ? S[(i - 1 + n) % n] : S[Math.max(0, i - 1)];
  const next = route.closed ? S[(i + 1) % n] : S[Math.min(n - 1, i + 1)];
  let ds = next.s - prev.s;
  if (ds <= 0) ds += route.length;
  const grade = ds > 0.1 ? (next.h - prev.h) / ds : 0;
  const half = s.width / 2;
  const d: P2 = [s.tan[0] * dir, s.tan[1] * dir];
  return (p) => {
    const q = sub(p, s.pos);
    const t = Math.max(-half, Math.min(half, dot(q, s.left)));
    // Grade along the route, so outward = dir * along.
    return s.h + s.bank * t - (s.crown ?? route.crown) * Math.abs(t) + grade * dir * dot(q, d);
  };
}

export function capField(j: RJunction, route: RouteRibbon | null, terrain: HeightAt, o: CapFieldOptions = {}): CapField {
  const opt = { ...D, ...o };
  const legs = j.legs;
  const ring = j.ring;
  const fall = (p: P2) => {
    if (!ring) return 0;
    const rho = Math.hypot(p[0] - ring.c[0], p[1] - ring.c[1]);
    return -opt.ringFall * (Math.max(ring.rIn, Math.min(ring.rOut, rho)) - ring.rIn);
  };
  const routeLegs = legs.map((l, i) => ({ l, i })).filter((x) => x.l.kind === "route");
  const rowSurf = legs.map((l) => (l.kind === "route" && route ? routeRowSurface(route, l.at, l.dir) : null));
  // Terrain at the street caps (smoothed along the leg), lifted to the streets' drape.
  const terr = legs.map((l) => {
    if (l.kind === "route") return { h: rowSurf[legs.indexOf(l)]!(l.cap.c), g: 0 };
    const pr = terrainProfile(l.line, terrain, opt.sigma);
    const h = profileAt(pr, l.trim) + opt.streetLift;
    const g = (profileAt(pr, l.trim + 1) - profileAt(pr, Math.max(0, l.trim - 1))) / (l.trim + 1 - Math.max(0, l.trim - 1));
    return { h, g };
  });
  const [x0, y0, x1, y1] = j.box;
  const samples: { p: P2; h: number; w: number }[] = [];
  const sx = Math.max(1, (x1 - x0) / 12), sy = Math.max(1, (y1 - y0) / 12);
  for (let x = x0; x <= x1; x += sx) for (let y = y0; y <= y1; y += sy) if (j.sdf([x, y]) < 0) samples.push({ p: [x, y], h: terrain(x, y) + opt.streetLift, w: 1 });
  const centre = j.centre;
  let base: Plane;
  let through: [number, number] | undefined;
  if (routeLegs.length >= 2 && !ring) {
    // The route is the priority road: the plane through its two most opposite caps, with its banks across.
    let a = routeLegs[0], b = routeLegs[1], best = Infinity;
    for (const p of routeLegs) for (const q of routeLegs) if (p.i < q.i) {
      const c = dot(p.l.cap.d, q.l.cap.d);
      if (c < best) { best = c; a = p; b = q; }
    }
    through = [a.i, b.i];
    const A = a.l.cap.c, B = b.l.cap.c, ha = terr[a.i].h, hb = terr[b.i].h;
    const ax = sub(B, A), L = Math.hypot(ax[0], ax[1]) || 1;
    const u: P2 = [ax[0] / L, ax[1] / L], v: P2 = [-u[1], u[0]];
    const bank = (l: RLeg) => {
      const s = route!.samples[l.at];
      return s.bank * dot(s.left, v);
    };
    const gv = (bank(a.l) + bank(b.l)) / 2;
    const gu = (hb - ha) / L;
    base = { o: A, h0: ha, g: [u[0] * gu + v[0] * gv, u[1] * gu + v[1] * gv] };
  } else if (routeLegs.length) {
    // A roundabout the route goes round: fitted through the route's caps, weighted heavily.
    const pts = legs.map((l, i) => ({ p: l.cap.c, h: terr[i].h - fall(l.cap.c), w: l.kind === "route" ? 50 : 5 }));
    base = clampGrade(fitPlane([...pts, ...samples.map((s) => ({ ...s, h: s.h - fall(s.p) }))], centre), opt.maxGradeRoundabout);
  } else {
    // Streets only: the spec's rule (a through road of two equal top-class legs, else a weighted fit).
    const order = legs.map((_, i) => i).sort((p, q) => legs[q].rank - legs[p].rank);
    if (!ring && legs.length >= 3) {
      const [a, b] = order;
      const third = legs[order[2]];
      if (legs[a].rank === legs[b].rank && dot(legs[a].cap.d, legs[b].cap.d) < Math.cos((135 * Math.PI) / 180) && (legs.length === 3 || third.rank < legs[a].rank)) through = [a, b];
    }
    if (through) {
      const A = legs[through[0]].cap.c, B = legs[through[1]].cap.c, ha = terr[through[0]].h, hb = terr[through[1]].h;
      const ax = sub(B, A), L = Math.hypot(ax[0], ax[1]) || 1;
      const u: P2 = [ax[0] / L, ax[1] / L], v: P2 = [-u[1], u[0]];
      const tp = fitPlane(samples.length >= 3 ? samples : legs.map((l, i) => ({ p: l.cap.c, h: terr[i].h, w: 1 })), centre);
      const gu = (hb - ha) / L, gv = dot(tp.g, v);
      base = clampGrade({ o: A, h0: ha, g: [u[0] * gu + v[0] * gv, u[1] * gu + v[1] * gv] }, opt.maxGrade);
    } else {
      const pts = legs.map((l, i) => ({ p: l.cap.c, h: terr[i].h - fall(l.cap.c), w: 10 * (l.rank + 1) }));
      base = clampGrade(fitPlane([...pts, ...samples.map((s) => ({ ...s, h: s.h - fall(s.p) }))], centre), ring ? opt.maxGradeRoundabout : opt.maxGrade);
    }
  }
  // Leg surfaces: the route's rows (less the ring's fall, which is constant outside the ring); the base for streets.
  const legSurface = legs.map((l, i) => {
    const rs = rowSurf[i];
    if (!rs) return (p: P2) => planeAt(base, p);
    const f = fall(l.cap.c);
    return (p: P2) => rs(p) - f;
  });
  const planar = routeLegs.length === 0;
  const caps = legs.map((l) => [[l.cap.c[0] - l.cap.left[0] * l.hw, l.cap.c[1] - l.cap.left[1] * l.hw], [l.cap.c[0] + l.cap.left[0] * l.hw, l.cap.c[1] + l.cap.left[1] * l.hw]] as [P2, P2]);
  const Dsize = Math.max(4, Math.hypot(x1 - x0, y1 - y0) / 4);
  const W0 = 1 / (Dsize * Dsize);
  const h = planar
    ? (p: P2) => planeAt(base, p) + fall(p)
    : (p: P2) => {
      let num = planeAt(base, p) * W0, den = W0;
      for (let i = 0; i < legs.length; i++) {
        const d = segDist(p, caps[i][0], caps[i][1]).d;
        if (d < 1e-7) return legSurface[i](p) + fall(p);
        const w = 1 / (d * d);
        num += legSurface[i](p) * w;
        den += w;
      }
      return num / den + fall(p);
    };
  return { base, planar, ...(through ? { through } : {}), legSurface, fall, h };
}
