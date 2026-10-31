// Busselton fork: runs of a per-sample flag along the road, wrapping round on a closed loop.
// Shared by markings (barrier line tidying) and kerbs (gap closing, stub dropping).

/** A run of samples: `start`, then `len` samples on. On a closed plan `start + len` may pass n (it wraps). */
export interface Run {
  start: number;
  len: number;
}

/** Maximal runs where `on[i]` is truthy. On a closed plan a run through the seam is one run. */
export function flagRuns(on: ArrayLike<unknown>, closed: boolean): Run[] {
  const n = on.length;
  const out: Run[] = [];
  if (n === 0) return out;
  if (!closed) {
    for (let i = 0; i < n; ) {
      if (!on[i]) { i++; continue; }
      let e = i;
      while (e < n && on[e]) e++;
      out.push({ start: i, len: e - i });
      i = e;
    }
    return out;
  }
  let off = -1;
  for (let i = 0; i < n; i++) if (!on[i]) { off = i; break; }
  if (off < 0) return [{ start: 0, len: n }];
  // Scan once round the loop, starting just after an off sample, so no run is split at the seam.
  for (let k = 1; k <= n; ) {
    const i = (off + k) % n;
    if (!on[i]) { k++; continue; }
    let len = 0;
    while (k + len <= n && on[(off + k + len) % n]) len++;
    out.push({ start: i, len });
    k += len;
  }
  return out;
}

/** Sets on every off run shorter than `maxLen` samples with on samples at both ends (an open plan's ends don't count). */
export function closeGaps(on: boolean[], closed: boolean, maxLen: number): void {
  const n = on.length;
  if (!on.some(Boolean)) return;
  for (const r of flagRuns(on.map((x) => !x), closed)) {
    if (r.len >= maxLen) continue;
    if (!closed && (r.start === 0 || r.start + r.len >= n)) continue;
    for (let k = 0; k < r.len; k++) on[(r.start + k) % n] = true;
  }
}

/** Sets off every on run shorter than `minLen` samples. */
export function dropStubs(on: boolean[], closed: boolean, minLen: number): void {
  const n = on.length;
  for (const r of flagRuns(on, closed)) {
    if (r.len >= minLen) continue;
    for (let k = 0; k < r.len; k++) on[(r.start + k) % n] = false;
  }
}
