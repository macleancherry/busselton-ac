import { describe, expect, it } from "vitest";
import { surfacesIni, TRAFFIC_READY_TAG, uiTrackJson } from "../src/core/acFiles";

// CSP's Traffic mode (acc-lua-internal included-new-modes/traffic/manifest.ini) lists only tracks
// tagged "traffic-planner-ready" (ALLOWED_TRACKS=#traffic-planner-ready), and its physics need
// ALLOW_NEW_MODE_SCRIPTS=1 in [_SCRIPTING_PHYSICS] (included-tools/traffic/tool.lua's error hint).
describe("CSP Traffic mode readiness", () => {
  const ui = (traffic?: boolean) => JSON.parse(uiTrackJson({ name: "Test" }, { length: 1000, width: 7, pitboxes: 4, closed: true, centre: [115.3, -33.6], traffic }));

  it("tags ui_track.json traffic-planner-ready only when the build has traffic", () => {
    expect(TRAFFIC_READY_TAG).toBe("traffic-planner-ready");
    expect(ui(true).tags).toContain("traffic-planner-ready");
    expect(ui(true).tags).toContain("street");
    expect(ui(false).tags).not.toContain("traffic-planner-ready");
    expect(ui().tags).not.toContain("traffic-planner-ready");
  });

  it("allows new-mode scripts in surfaces.ini with traffic, alongside tools and track scripts", () => {
    const on = surfacesIni(true);
    expect(on).toMatch(/\[_SCRIPTING_PHYSICS\]\nALLOW_TOOLS=1\nALLOW_TRACK_SCRIPTS=1\nALLOW_NEW_MODE_SCRIPTS=1\n/);
    expect(on).toContain("WAV_PITCH=extended-0");
    const off = surfacesIni(false);
    expect(off).not.toContain("_SCRIPTING_PHYSICS");
    expect(off).not.toContain("ALLOW_NEW_MODE_SCRIPTS");
  });

  it("allows only track scripts (the automatic test) without traffic", () => {
    const t = surfacesIni(false, false, undefined, false, true);
    expect(t).toContain("WAV_PITCH=extended-0");
    expect(t).toMatch(/\n\[_SCRIPTING_PHYSICS\]\nALLOW_TRACK_SCRIPTS=1\n/);
    expect(t).not.toContain("ALLOW_TOOLS");
    expect(t).not.toContain("ALLOW_NEW_MODE_SCRIPTS");
    // With traffic too, one section, the full one.
    const both = surfacesIni(true, false, undefined, false, true);
    expect(both.match(/_SCRIPTING_PHYSICS/g)).toHaveLength(1);
    expect(both).toContain("ALLOW_NEW_MODE_SCRIPTS=1");
  });
});
