// Little-endian byte output and input for the AC file formats (kn5, fast_lane.ai).
// Written from docs/specs/binary.md.

const encodeUtf8 = (s: string) => new TextEncoder().encode(s);
const utf8 = new TextDecoder("utf-8");

/** Appends little-endian values; storage doubles whenever it fills, so long writes stay linear. */
export class ByteSink {
  #store: Uint8Array;
  #dv: DataView;
  #used = 0;

  constructor(expectedBytes = 65536) {
    this.#store = new Uint8Array(Math.max(expectedBytes, 16));
    this.#dv = new DataView(this.#store.buffer);
  }

  /** Bytes written so far. */
  get size(): number {
    return this.#used;
  }

  /** Makes room for `n` more bytes and returns where they start. */
  #grab(n: number): number {
    const start = this.#used;
    const end = start + n;
    if (end > this.#store.length) {
      let cap = this.#store.length;
      do cap *= 2; while (cap < end);
      const bigger = new Uint8Array(cap);
      bigger.set(this.#store.subarray(0, start));
      this.#store = bigger;
      this.#dv = new DataView(bigger.buffer);
    }
    this.#used = end;
    return start;
  }

  byte(x: number): this {
    const p = this.#grab(1);
    this.#store[p] = x;
    return this;
  }

  flag(x: boolean): this {
    return this.byte(x ? 1 : 0);
  }

  uint16(x: number): this {
    const p = this.#grab(2);
    this.#dv.setUint16(p, x, true);
    return this;
  }

  int32(x: number): this {
    const p = this.#grab(4);
    this.#dv.setInt32(p, x, true);
    return this;
  }

  uint32(x: number): this {
    const p = this.#grab(4);
    this.#dv.setUint32(p, x, true);
    return this;
  }

  float(x: number): this {
    const p = this.#grab(4);
    this.#dv.setFloat32(p, x, true);
    return this;
  }

  floats(xs: ArrayLike<number>): this {
    const p = this.#grab(4 * xs.length);
    for (let k = 0; k < xs.length; k++) this.#dv.setFloat32(p + 4 * k, xs[k], true);
    return this;
  }

  raw(chunk: Uint8Array): this {
    const p = this.#grab(chunk.length);
    this.#store.set(chunk, p);
    return this;
  }

  /** ASCII with no length prefix (file magic). */
  text(ascii: string): this {
    const p = this.#grab(ascii.length);
    for (let k = 0; k < ascii.length; k++) this.#store[p + k] = ascii.charCodeAt(k);
    return this;
  }

  /** u32 byte count, then the UTF-8 bytes. */
  str(s: string): this {
    const enc = encodeUtf8(s);
    return this.uint32(enc.length).raw(enc);
  }

  /** u32 byte count, then the bytes. */
  blob(chunk: Uint8Array): this {
    return this.uint32(chunk.length).raw(chunk);
  }

  /** A fresh copy of exactly the bytes written. */
  bytes(): Uint8Array {
    return this.#store.slice(0, this.#used);
  }
}

/** Reads little-endian values from a Uint8Array, which may be a view into a larger buffer. */
export class ByteSource {
  readonly #src: Uint8Array;
  readonly #dv: DataView;
  #pos = 0;

  constructor(src: Uint8Array) {
    this.#src = src;
    this.#dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  }

  get position(): number {
    return this.#pos;
  }

  /** Bytes not yet read. */
  get left(): number {
    return this.#src.length - this.#pos;
  }

  /** Moves past `n` bytes, returning where they start; throws if they aren't all there. */
  #advance(n: number): number {
    const start = this.#pos;
    if (!(n >= 0) || start + n > this.#src.length) {
      throw new RangeError(`unexpected end of data: wanted ${n} bytes at offset ${start}, ${this.#src.length - start} left`);
    }
    this.#pos = start + n;
    return start;
  }

  skip(n: number): void {
    this.#advance(n);
  }

  byte(): number {
    return this.#src[this.#advance(1)];
  }

  flag(): boolean {
    return this.byte() !== 0;
  }

  uint16(): number {
    return this.#dv.getUint16(this.#advance(2), true);
  }

  int32(): number {
    return this.#dv.getInt32(this.#advance(4), true);
  }

  uint32(): number {
    return this.#dv.getUint32(this.#advance(4), true);
  }

  float(): number {
    return this.#dv.getFloat32(this.#advance(4), true);
  }

  /** `n` floats into a new Float32Array. */
  floats(n: number): Float32Array {
    const p = this.#advance(4 * n);
    const got = new Float32Array(n);
    for (let k = 0; k < n; k++) got[k] = this.#dv.getFloat32(p + 4 * k, true);
    return got;
  }

  /** `n` u16 values into a new Uint16Array. */
  uint16s(n: number): Uint16Array {
    const p = this.#advance(2 * n);
    const got = new Uint16Array(n);
    for (let k = 0; k < n; k++) got[k] = this.#dv.getUint16(p + 2 * k, true);
    return got;
  }

  /** A view of the next `n` bytes (not a copy). */
  raw(n: number): Uint8Array {
    const p = this.#advance(n);
    return this.#src.subarray(p, p + n);
  }

  /** `n` bytes of ASCII. */
  text(n: number): string {
    return String.fromCharCode(...this.raw(n));
  }

  /** u32 byte count, then UTF-8. */
  str(): string {
    return utf8.decode(this.raw(this.uint32()));
  }

  /** A copy of a u32-length-prefixed byte run. */
  blob(): Uint8Array {
    return this.raw(this.uint32()).slice();
  }
}
