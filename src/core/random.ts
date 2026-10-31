// Busselton fork: seeded randomness shared by every generator (docs/specs/scenery.md).
//
// rng(seed) is a stream of uniform numbers in [0, 1) from a 32-bit counter run through an
// integer finaliser (Chris Wellons' "lowbias32" constants, public domain). Same seed, same stream,
// on every platform: only 32-bit integer maths, no floats until the last divide.
//
// placeSeed / placeRandom tie a random choice to a spot on the map instead of to where the spot
// falls in a list, so adding or reordering things elsewhere leaves it alone.

/** The 32-bit finaliser: a good avalanche, so neighbouring inputs give unrelated outputs. */
export function mix32(n: number): number {
  let z = n >>> 0;
  z ^= z >>> 16;
  z = Math.imul(z, 0x21f0aaad);
  z ^= z >>> 15;
  z = Math.imul(z, 0x735a2d97);
  z ^= z >>> 15;
  return z >>> 0;
}

const GOLDEN = 0x9e3779b9;

/** Uniform numbers in [0, 1) from a seed. */
export function rng(seed: number): () => number {
  // Mix the seed first so small seeds (1, 2, 3...) start far apart.
  let state = mix32((seed | 0) ^ 0x5bd1e995);
  return () => {
    state = (state + GOLDEN) >>> 0;
    return mix32(state) / 4294967296;
  };
}

/** A seed from a local position (rounded to 10 cm) and a salt naming what the draw is for. */
export function placeSeed(x: number, y: number, salt = 0): number {
  const ix = Math.round(x * 10) | 0, iy = Math.round(y * 10) | 0;
  let h = mix32(ix ^ Math.imul(salt | 0, 0x27d4eb2f));
  h = mix32(h ^ iy ^ 0x165667b1);
  return mix32(h + GOLDEN);
}

/** A number in [0, 1) that belongs to a position: the same spot and salt always give the same one. */
export function placeRandom(x: number, y: number, salt = 0): number {
  return placeSeed(x, y, salt) / 4294967296;
}
