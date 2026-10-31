// Busselton fork: stepping a shop verandah or awning down a sloping street.
//
// Country main streets on a hill (Margaret River, Augusta, Dunsborough) don't have one verandah at
// one height along a 40 m front: it steps down the slope, shop by shop. A front laid flat from its
// lowest corner ran metres under the footpath at its high end; laid from its highest, it floated.
// `slopeSteps` splits a front into runs whose ground varies by no more than `rise`, each run then
// set from its own ground (shops.ts, buildings.ts' awnings).

export interface SlopeStep {
  /** Where the step starts and ends along the front, metres. */
  t0: number;
  t1: number;
  /** The lowest and highest ground under the step (everything `sample` returned for it). */
  lo: number;
  hi: number;
}

/**
 * Splits a front `len` metres long into steps. `sample(t)` gives the ground heights that matter at
 * `t` along it (at the wall, under the outer edge). The front is sampled every `every` metres; a
 * new step starts where carrying on would make the step's lowest ground, or its highest, vary by
 * more than `rise`, but no step is shorter than `minLen` (on a very steep street a step's ground
 * varies by more). A front whose ground stays within `rise` is one step.
 */
export function slopeSteps(
  len: number,
  sample: (t: number) => number[],
  opts: { rise?: number; minLen?: number; every?: number } = {},
): SlopeStep[] {
  const rise = opts.rise ?? 0.6, minLen = opts.minLen ?? 2.5, every = opts.every ?? 0.5;
  const n = Math.max(1, Math.ceil(len / every));
  const ts = Array.from({ length: n + 1 }, (_, i) => (len * i) / n);
  const lo: number[] = [], hi: number[] = [];
  for (const t of ts) {
    const v = sample(t);
    lo.push(Math.min(...v));
    hi.push(Math.max(...v));
  }
  // How the ground changes along the front: the lowest and the highest at each point, each judged
  // on its own (a footpath higher than the shop floor all along is a cross-fall, not a slope).
  const steps: SlopeStep[] = [];
  const range = (a: number[], i: number, j: number) => {
    let mn = Infinity, mx = -Infinity;
    for (let k = i; k <= j; k++) { mn = Math.min(mn, a[k]); mx = Math.max(mx, a[k]); }
    return [mn, mx];
  };
  const push = (i: number, j: number, t1: number) => steps.push({ t0: ts[i], t1, lo: range(lo, i, j)[0], hi: range(hi, i, j)[1] });
  let s = 0;
  for (let i = 1; i <= n; i++) {
    const [l0, l1] = range(lo, s, i), [h0, h1] = range(hi, s, i);
    // Break before sample i when it would spread the step too far, the step is long enough, and
    // what's left is long enough to be a step of its own.
    if (Math.max(l1 - l0, h1 - h0) > rise && ts[i - 1] - ts[s] >= minLen && len - ts[i - 1] >= minLen) {
      push(s, i - 1, ts[i - 1]);
      s = i - 1;
    }
  }
  push(s, n, len);
  return steps;
}
