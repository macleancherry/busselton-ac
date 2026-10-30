import { describe, expect, it } from "vitest";
import { ByteSink, ByteSource } from "../src/core/binary";

const bytes = (s: ByteSink) => Array.from(s.bytes());

describe("ByteSink (little-endian writer)", () => {
  it("writes each value type as the expected bytes", () => {
    expect(bytes(new ByteSink().byte(0xab))).toEqual([0xab]);
    expect(bytes(new ByteSink().flag(true).flag(false))).toEqual([1, 0]);
    expect(bytes(new ByteSink().uint16(0x1234))).toEqual([0x34, 0x12]);
    expect(bytes(new ByteSink().int32(-2))).toEqual([0xfe, 0xff, 0xff, 0xff]);
    expect(bytes(new ByteSink().uint32(0xdeadbeef))).toEqual([0xef, 0xbe, 0xad, 0xde]);
    expect(bytes(new ByteSink().float(1))).toEqual([0, 0, 0x80, 0x3f]);
    expect(bytes(new ByteSink().floats([1, -2]))).toEqual([0, 0, 0x80, 0x3f, 0, 0, 0, 0xc0]);
    expect(bytes(new ByteSink().raw(new Uint8Array([9, 8, 7])))).toEqual([9, 8, 7]);
    expect(bytes(new ByteSink().text("DDS "))).toEqual([0x44, 0x44, 0x53, 0x20]);
    expect(bytes(new ByteSink().blob(new Uint8Array([5, 6])))).toEqual([2, 0, 0, 0, 5, 6]);
  });

  it("writes strings as a byte count then UTF-8", () => {
    expect(bytes(new ByteSink().str("abc"))).toEqual([3, 0, 0, 0, 97, 98, 99]);
    expect(bytes(new ByteSink().str("é"))).toEqual([2, 0, 0, 0, 0xc3, 0xa9]);
    expect(bytes(new ByteSink().str(""))).toEqual([0, 0, 0, 0]);
    expect(bytes(new ByteSink().blob(new Uint8Array(0)))).toEqual([0, 0, 0, 0]);
  });

  it("keeps earlier bytes when it grows", () => {
    const s = new ByteSink(16);
    for (let i = 0; i < 10000; i++) s.uint32(i);
    const out = s.bytes();
    expect(out.length).toBe(40000);
    const v = new DataView(out.buffer);
    for (let i = 0; i < 10000; i += 997) expect(v.getUint32(i * 4, true)).toBe(i);
  });
});

describe("ByteSource (little-endian reader)", () => {
  it("reads back everything the writer wrote, from a view with a non-zero offset", () => {
    const body = new ByteSink()
      .byte(7).flag(true).uint16(65535).int32(-123456).uint32(0xffffffff).float(0.1).floats([1.5, 2.5])
      .str("héllo").blob(new Uint8Array([1, 2, 3])).text("sc6969").bytes();
    const big = new Uint8Array(body.length + 13);
    big.set(body, 5);
    const r = new ByteSource(big.subarray(5, 5 + body.length));
    expect(r.byte()).toBe(7);
    expect(r.flag()).toBe(true);
    expect(r.uint16()).toBe(65535);
    expect(r.int32()).toBe(-123456);
    expect(r.uint32()).toBe(4294967295);
    expect(r.float()).toBe(Math.fround(0.1));
    expect(Array.from(r.floats(2))).toEqual([1.5, 2.5]);
    expect(r.str()).toBe("héllo");
    expect(Array.from(r.blob())).toEqual([1, 2, 3]);
    expect(r.text(6)).toBe("sc6969");
    expect(r.left).toBe(0);
  });

  it("throws when a read would run past the end", () => {
    expect(() => new ByteSource(new Uint8Array(3)).uint32()).toThrow();
    expect(() => new ByteSource(new Uint8Array(3)).float()).toThrow();
    expect(() => new ByteSource(new ByteSink().uint32(10).text("abc").bytes()).str()).toThrow();
    expect(() => new ByteSource(new ByteSink().uint32(4).raw(new Uint8Array(3)).bytes()).blob()).toThrow();
    // A view that ends before its buffer does must not read the bytes beyond it.
    const buf = new Uint8Array(16);
    expect(() => new ByteSource(buf.subarray(0, 2)).uint32()).toThrow();
  });
});
