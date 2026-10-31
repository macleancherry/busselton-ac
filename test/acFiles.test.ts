// Track folder text and image files, from docs/specs/acFiles.md "Tests to write".
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELEVATION_CREDIT, MAPILLARY_CREDIT, outlinePng, previewPng, readme, slugify, streetMap, surfacesIni, trackMap,
  TRAFFIC_READY_TAG, uiTrackJson,
} from "../src/core/acFiles";
import { decodeOwnPng } from "../src/core/png";

const PERTH: [number, number] = [115.86, -31.95];

describe("slugify", () => {
  it("makes folder names", () => {
    expect(slugify("Busselton Foreshore")).toBe("busselton_foreshore");
    expect(slugify("Café  Strip!")).toBe("cafe_strip");
    expect(slugify("  --x--  ")).toBe("x");
    expect(slugify("")).toBe("real_road");
    expect(slugify("!!!")).toBe("real_road");
  });

  it("cuts long names to 40 characters without a trailing underscore", () => {
    const name = "a".repeat(39) + " " + "b".repeat(20);
    expect(slugify(name)).toBe("a".repeat(39));
    const long = "The Quite Long Scenic Coastal Drive Around The Bay";
    expect(long.length).toBeGreaterThan(40);
    const s = slugify(long);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s).not.toMatch(/^_|_$/);
    // A leading separator doesn't use up the 40 characters.
    expect(slugify(" " + "c".repeat(45))).toBe("c".repeat(40));
  });
});

/** The [SURFACE_i] blocks as { header, lines }. */
function blocks(text: string) {
  return text.trimEnd().split("\n\n").filter((b) => b.startsWith("[SURFACE_")).map((b) => {
    const [header, ...lines] = b.split("\n");
    return { header, lines, get: (k: string) => lines.find((l) => l.startsWith(k + "="))?.slice(k.length + 1) };
  });
}

describe("surfacesIni", () => {
  const KEYS = ["KEY", "FRICTION", "DAMPING", "WAV", "WAV_PITCH", "FF_EFFECT", "DIRT_ADDITIVE", "IS_VALID_TRACK", "BLACK_FLAG_TIME",
    "SIN_HEIGHT", "SIN_LENGTH", "IS_PITLANE", "VIBRATION_GAIN", "VIBRATION_LENGTH"];
  const TABLE = [
    ["ROAD", "0.99", "0", "", "0", "NULL", "0", "1", "0", "0", "0", "0", "0", "0"],
    ["STREET", "0.99", "0", "", "0", "NULL", "0", "0", "0", "0", "0", "0", "0", "0"],
    ["GRASS", "0.6", "0.1", "grass.wav", "0", "NULL", "1", "0", "0", "0.03", "0.5", "0", "0.2", "0.4"],
    ["KERB", "0.92", "0", "", "0", "NULL", "0", "1", "0", "0", "0", "0", "0.3", "0.2"],
    ["WALL", "0.3", "0", "", "0", "NULL", "0", "0", "0", "0", "0", "0", "0", "0"],
  ];

  it("writes the five surfaces with the table's keys and values", () => {
    const b = blocks(surfacesIni());
    expect(b.map((x) => x.header)).toEqual([0, 1, 2, 3, 4].map((i) => `[SURFACE_${i}]`));
    b.forEach((x, i) => expect(x.lines).toEqual(KEYS.map((k, j) => `${k}=${TABLE[i][j]}`)));
  });

  it("uses \\n line endings, one blank line between blocks and nothing after the last", () => {
    const t = surfacesIni();
    expect(t).not.toContain("\r");
    expect(t).toMatch(/VIBRATION_LENGTH=0\n\n\[SURFACE_1\]/);
    expect(t.endsWith("VIBRATION_LENGTH=0\n")).toBe(true);
    expect(t).not.toMatch(/\n\n\n/);
    expect(t).not.toContain("_SCRIPTING_PHYSICS");
    expect(t).not.toContain("WEATHER_FX");
  });

  it("turns on extended physics and scripting for traffic", () => {
    const t = surfacesIni(true);
    const b = blocks(t);
    expect(b[0].get("WAV_PITCH")).toBe("extended-0");
    for (const x of b.slice(1)) expect(x.get("WAV_PITCH")).toBe("0");
    expect(t).toContain("\n[_SCRIPTING_PHYSICS]\nALLOW_TOOLS=1\nALLOW_TRACK_SCRIPTS=1\nALLOW_NEW_MODE_SCRIPTS=1\n");
  });

  it("makes streets valid only when asked", () => {
    expect(blocks(surfacesIni(false, true))[1].get("IS_VALID_TRACK")).toBe("1");
    expect(blocks(surfacesIni(false, false))[1].get("IS_VALID_TRACK")).toBe("0");
    // Only STREET changes.
    const a = blocks(surfacesIni(false, false)), b = blocks(surfacesIni(false, true));
    expect(a.filter((x, i) => x.lines.join() !== b[i].lines.join()).map((x) => x.get("KEY"))).toEqual(["STREET"]);
  });

  it("adds the gravel surfaces", () => {
    const b = blocks(surfacesIni(false, false, undefined, true));
    expect(b.map((x) => x.get("KEY"))).toEqual(["ROAD", "STREET", "GRASS", "KERB", "WALL", "UNSEALED", "UNPAVED"]);
    expect(b[5].header).toBe("[SURFACE_5]");
    expect(b[5].lines).toContain("_EXT_SURFACE_TYPE=GRAVEL");
    expect(b[5].lines.at(-1)).toBe("_EXT_PERLIN_PERSISTENCE=0.5");
    expect(b[6].get("IS_VALID_TRACK")).toBe("0");
    expect(blocks(surfacesIni(false, true, undefined, true))[6].get("IS_VALID_TRACK")).toBe("1");
    expect(surfacesIni()).not.toContain("UNSEALED");
  });

  it("gives WeatherFX the track's position and timezone", () => {
    expect(surfacesIni(false, false, PERTH).endsWith("\n[WEATHER_FX]\nLATITUDE=-31.95000\nLONGITUDE=115.86000\nTIMEZONE_ID=Australia/Perth\n")).toBe(true);
    const away = surfacesIni(false, false, [10, 50]);
    expect(away.endsWith("\n[WEATHER_FX]\nLATITUDE=50.00000\nLONGITUDE=10.00000\n")).toBe(true);
    expect(away).not.toContain("TIMEZONE_ID");
  });

  it("puts scripting before WeatherFX", () => {
    const t = surfacesIni(true, false, PERTH);
    expect(t.indexOf("[_SCRIPTING_PHYSICS]")).toBeGreaterThan(0);
    expect(t.indexOf("[_SCRIPTING_PHYSICS]")).toBeLessThan(t.indexOf("[WEATHER_FX]"));
  });
});

describe("timezone (through WEATHER_FX)", () => {
  const zone = (lng: number, lat: number) => /TIMEZONE_ID=(.*)\n/.exec(surfacesIni(false, false, [lng, lat]))?.[1];
  it("finds Australian zones by rough state borders", () => {
    expect(zone(115.86, -31.95)).toBe("Australia/Perth");
    expect(zone(115.35, -33.65)).toBe("Australia/Perth"); // the south-west
    expect(zone(130.84, -12.46)).toBe("Australia/Darwin");
    expect(zone(133.88, -23.7)).toBe("Australia/Darwin");
    expect(zone(138.6, -34.93)).toBe("Australia/Adelaide");
    expect(zone(153.03, -27.47)).toBe("Australia/Brisbane");
    expect(zone(147.33, -42.88)).toBe("Australia/Hobart");
    expect(zone(144.96, -37.81)).toBe("Australia/Melbourne");
    expect(zone(151.21, -33.87)).toBe("Australia/Sydney");
    expect(zone(-0.13, 51.5)).toBeUndefined();
  });
  it("uses strict comparisons at the borders", () => {
    expect(zone(129, -20)).toBe("Australia/Darwin"); // lng 129 is not < 129
    expect(zone(138, -20)).toBe("Australia/Adelaide"); // not < 138, but < 141
    expect(zone(141, -32)).toBe("Australia/Sydney"); // not < 141
    expect(zone(135, -26)).toBe("Australia/Adelaide"); // lat -26 is not > -26
    expect(zone(150, -29)).toBe("Australia/Sydney"); // not > -29
    expect(zone(146, -39.2)).toBe("Australia/Melbourne"); // not < -39.2
    expect(zone(145, -34)).toBe("Australia/Sydney"); // not < -34
    expect(zone(112, -30)).toBe("Australia/Perth"); // inside the box at its edge
    expect(zone(111.99, -30)).toBeUndefined();
  });
});

describe("uiTrackJson", () => {
  const meta = { name: "Perth Loop" };
  const base = { length: 2345.6, width: 7.4, pitboxes: 12, centre: PERTH };

  it("writes the fields in order with strings for numbers", () => {
    const text = uiTrackJson(meta, { ...base, closed: true });
    const j = JSON.parse(text);
    expect(Object.keys(j)).toEqual(["name", "description", "tags", "geotags", "country", "city", "length", "width", "pitboxes", "run", "author", "version"]);
    expect(j.length).toBe("2346");
    expect(j.width).toBe("7");
    expect(j.pitboxes).toBe("12");
    expect(j.geotags).toEqual(["31.95000 S", "115.86000 E"]);
    expect(j.tags).toEqual(["real road", "circuit", "street", "osm"]);
    expect(j.run).toBe("clockwise");
    expect(j.description).toBe("Perth Loop, built from the real road with OpenStreetMap and open elevation data.");
    expect(j.author).toBe("AC Track Builder");
    expect(j.country).toBe("");
    expect(j.version).toBe("1.0");
    const open = JSON.parse(uiTrackJson(meta, { ...base, closed: false }));
    expect(open.tags[1]).toBe("point to point");
    expect(open.run).toBe("A to B");
  });

  it("tags traffic-ready tracks only when traffic is on", () => {
    expect(TRAFFIC_READY_TAG).toBe("traffic-planner-ready");
    for (const traffic of [false, undefined]) {
      const t = JSON.parse(uiTrackJson(meta, { ...base, closed: true, traffic })).tags;
      expect(t).not.toContain(TRAFFIC_READY_TAG);
      expect(t).toContain("street");
    }
    expect(JSON.parse(uiTrackJson(meta, { ...base, closed: true, traffic: true })).tags.at(-1)).toBe(TRAFFIC_READY_TAG);
  });

  it("is pretty-printed with 2 spaces and ends with a newline", () => {
    const text = uiTrackJson(meta, { ...base, closed: true });
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "name": "Perth Loop",\n');
  });

  it("writes the equator and prime meridian as N and E", () => {
    expect(JSON.parse(uiTrackJson(meta, { ...base, centre: [0, 0], closed: true })).geotags).toEqual(["0.00000 N", "0.00000 E"]);
  });
});

/** The ini's numbers, and a world-to-pixel function through its transform. */
function parseMapIni(ini: string) {
  const v = Object.fromEntries(ini.trim().split("\n").slice(1).map((l) => l.split("=")).map(([k, x]) => [k, Number(x)]));
  return { v, px: (x: number, z: number) => [(x + v.X_OFFSET) / v.SCALE_FACTOR, (z + v.Z_OFFSET) / v.SCALE_FACTOR] };
}
function pixel(png: Uint8Array, x: number, y: number) {
  const d = decodeOwnPng(png);
  const i = (Math.floor(y) * d.width + Math.floor(x)) * 4;
  return [...d.rgba.slice(i, i + 4)];
}

describe("trackMap", () => {
  const outline: [number, number][] = [[0, 0], [1000, 0], [1000, 500], [0, 500], [0, 0]];

  it("maps a 1 km outline at 1 m a pixel inside a 20 px margin", () => {
    const m = trackMap(outline);
    const { v, px } = parseMapIni(m.ini);
    expect(m.ini.startsWith("[PARAMETERS]\n")).toBe(true);
    expect(m.ini).toContain("SCALE_FACTOR=1.000000\n");
    expect(v.WIDTH).toBe(1040);
    expect(v.HEIGHT).toBe(540);
    expect(v.MARGIN).toBe(20);
    expect(m.ini.endsWith("DRAWING_SIZE=10\n")).toBe(true);
    expect(px(0, 0)).toEqual([20, 20]);
    const d = decodeOwnPng(m.png);
    expect([d.width, d.height]).toEqual([1040, 540]);
  });

  it("scales a 10 km outline down to fit 2048 px", () => {
    const m = trackMap([[0, 0], [10000, 0], [10000, 3000]]);
    expect(m.ini).toContain(`SCALE_FACTOR=${(10000 / 2008).toFixed(6)}\n`);
    expect(parseMapIni(m.ini).v.WIDTH).toBeLessThanOrEqual(2048);
  });

  it("draws the route in opaque white on transparent", () => {
    const m = trackMap(outline);
    const { px } = parseMapIni(m.ini);
    const [x, y] = px(500, 0);
    expect(pixel(m.png, x, y)).toEqual([255, 255, 255, 255]);
    expect(pixel(m.png, 0, 0)[3]).toBe(0);
  });

  it("refuses an empty outline", () => {
    expect(() => trackMap([])).toThrow(/no points/);
    expect(() => outlinePng([])).toThrow(/no points/);
  });
});

describe("streetMap", () => {
  const route: [number, number][] = [[0, 0], [400, 0], [400, 300]];
  const streets = [{ pts: [[-100, 150], [500, 150]] as [number, number][], width: 8 }, { pts: [[200, -50], [200, 350]] as [number, number][], width: 6 }];

  it("frames streets and route together in a 40 px margin", () => {
    const m = streetMap(streets, route);
    const { v, px } = parseMapIni(m.ini);
    expect(v.MARGIN).toBe(40);
    expect(m.ini).not.toContain("DRAWING_SIZE");
    expect(px(-100, -50)).toEqual([40, 40]);
    const [fx, fz] = px(500, 350);
    expect(fx).toBeLessThanOrEqual(v.WIDTH);
    expect(fz).toBeLessThanOrEqual(v.HEIGHT);
    const d = decodeOwnPng(m.png);
    expect([d.width, d.height]).toEqual([v.WIDTH, v.HEIGHT]);
  });

  it("never goes finer than 0.75 m a pixel; route yellow, streets grey", () => {
    const m = streetMap(streets, route);
    const { v, px } = parseMapIni(m.ini);
    expect(v.SCALE_FACTOR).toBe(0.75);
    const [rx, rz] = px(100, 0);
    expect(pixel(m.png, rx, rz)).toEqual([245, 196, 66, 255]);
    const [sx, sz] = px(-50, 150);
    expect(pixel(m.png, sx, sz)).toEqual([205, 208, 214, 255]);
  });

  it("draws just the route without streets", () => {
    const m = streetMap([], route);
    const { px } = parseMapIni(m.ini);
    expect(px(0, 0)).toEqual([40, 40]);
  });
});

describe("outline and preview", () => {
  it("draws the outline white on transparent, centred", () => {
    // A north-south line: 464 px tall (24 px margins), centred on x = 256.
    const png = outlinePng([[0, 0], [0, 900]]);
    const d = decodeOwnPng(png);
    expect([d.width, d.height]).toEqual([512, 512]);
    expect(pixel(png, 0, 0)[3]).toBe(0);
    expect(pixel(png, 511, 511)[3]).toBe(0);
    expect(pixel(png, 256, 256)).toEqual([255, 255, 255, 255]);
    expect(pixel(png, 255, 100)).toEqual([255, 255, 255, 255]);
    expect(pixel(png, 240, 256)[3]).toBe(0);
    expect(pixel(png, 272, 256)[3]).toBe(0);
    expect(pixel(png, 256, 10)[3]).toBe(0); // above the margin (line ends at y 24, 5 px cap)
  });

  it("draws the preview with start and finish dots", () => {
    const pts: [number, number][] = [[0, 0], [1000, 0], [1000, 400]];
    const open = previewPng(pts, false), closed = previewPng(pts, true);
    const d = decodeOwnPng(open);
    expect([d.width, d.height]).toEqual([1024, 576]);
    expect(pixel(open, 0, 0)).toEqual([24, 26, 32, 255]);
    // Fit: s = min(928 / 1000, 480 / 400) = 0.928; ox = 48, oz = (576 - 371.2) / 2.
    const oz = (576 - 400 * 0.928) / 2;
    expect(pixel(open, 48, oz)).toEqual([80, 220, 120, 255]);
    expect(pixel(open, 48 + 928 - 1, oz + 371.2 - 1)).toEqual([235, 80, 80, 255]);
    expect(pixel(closed, 48 + 928 - 1, oz + 371.2 - 1)).not.toEqual([235, 80, 80, 255]);
  });
});

describe("readme", () => {
  const head = [
    "Perth Loop", "",
    "Install: copy this folder into assettocorsa/content/tracks/ (or drag the zip onto Content Manager).", "",
    "Data sources:",
    "- Road network (c) OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright",
    "- Routing by OSRM (project-osrm.org) on OpenStreetMap data.",
  ];
  const tail = ["", "Assetto Corsa is a trademark of Kunos Simulazioni. This track is not affiliated with or endorsed by Kunos.", ""];
  const aws = "- Elevation: Terrain Tiles on AWS Open Data (Mapzen/Tilezen), from SRTM, USGS 3DEP, GMTED and national datasets.";

  it("credits imagery when there is some", () => {
    expect(readme({ name: "Perth Loop" }, "Landgate")).toBe(
      [...head, aws, "- Aerial imagery: Landgate. For personal use only; do not redistribute this track.", ...tail].join("\n"));
  });

  it("says the terrain is procedural without imagery", () => {
    const t = readme({ name: "Perth Loop" }, null);
    expect(t).toBe([...head, aws, "- Terrain textures are procedural.", ...tail].join("\n"));
    expect(t.endsWith("Kunos.\n")).toBe(true);
  });

  it("credits the elevation model used, and Mapillary when its data went in", () => {
    const ga = "Elevation: Digital Elevation Model of Australia derived from LiDAR 5 m grid (c) Commonwealth of Australia (Geoscience Australia), CC BY 4.0";
    expect(readme({ name: "Perth Loop" }, null, { elevation: ga })).toBe(
      [...head, `- ${ga}`, "- Terrain textures are procedural.", ...tail].join("\n"));
    expect(readme({ name: "Perth Loop" }, null, { elevation: "" })).toContain(`- ${DEFAULT_ELEVATION_CREDIT}\n`);
    const m = readme({ name: "Perth Loop" }, "Landgate", { mapillary: true });
    expect(m).toContain(`personal use only; do not redistribute this track.\n- ${MAPILLARY_CREDIT}\n\n`);
    expect(MAPILLARY_CREDIT).toContain("CC BY-SA");
    expect(readme({ name: "Perth Loop" }, null)).not.toContain("Mapillary");
  });
});
