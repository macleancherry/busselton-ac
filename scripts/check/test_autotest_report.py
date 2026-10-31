"""Tests for autotest_report.py, on the runs in test/fixtures/autotest (a 100 m circle, a roundabout at (100, 0)).

    python3 -I scripts/check/test_autotest_report.py

(test/autotestReport.test.ts runs this under vitest when Python has numpy and Pillow.)
"""

import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "..", "test", "fixtures", "autotest")
spec = importlib.util.spec_from_file_location("autotest_report", os.path.join(HERE, "autotest_report.py"))
rep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rep)

DARK_SHOTS = {9, 10, 11}  # the 9th to 11th screenshots (lap 40 to 50 %) are dark


def png(level):
    """A screenshot: sky at the top, the road ahead at `level` grey."""
    img = Image.new("L", (160, 90), 200)
    img.paste(level, (0, 36, 160, 90))
    b = io.BytesIO()
    img.convert("RGB").save(b, "PNG")
    return b.getvalue()


def night_folder(tmp):
    d = os.path.join(tmp, "night_cars")
    shutil.copytree(os.path.join(FIX, "night_cars"), d)
    os.makedirs(os.path.join(d, "screens"))
    for k in range(1, 21):
        with open(os.path.join(d, "screens", f"Screenshot_{k}.png"), "wb") as f:
            f.write(png(8 if k in DARK_SHOTS else 70))
    return d


def rain_folder(tmp, rain_kv):
    """The single run as a -Rain run: run.json, CSP's rain in the env line, and two hollows in
    ext_config.ini, one on the 100 m circle next to the lap5 shot and one far off it."""
    d = os.path.join(tmp, "rain")
    shutil.copytree(os.path.join(FIX, "single"), d)
    p = os.path.join(d, "btest.csv")
    with open(p) as f:
        text = f.read()
    with open(p, "w") as f:
        f.write(text.replace("headlights=false", "headlights=false;" + rain_kv))
    with open(os.path.join(d, "run.json"), "w") as f:
        json.dump({"slug": "t", "layout": "", "night": False, "time": "", "cars": 0, "weather": "sol_heavy_rain", "rain": True}, f)
    with open(os.path.join(d, "ext_config.ini"), "w") as f:
        f.write("[RAIN_FX]\nRELIEF_MATERIALS = road_?\n; Hollows where water should stand in the rain (rainHollows.ts): 2.\n"
                "; hollow 1: 93.00, -0.05, 38.00  8 cm, 614 m2, 28 m across\n"
                "; hollow 2: 400.00, 0.00, 400.00  3 cm, 20 m2, 5 m across\n")
    return d


def run(*args):
    p = subprocess.run([sys.executable, "-I", os.path.join(HERE, "autotest_report.py"), *args],
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


class Parsing(unittest.TestCase):
    def test_note(self):
        self.assertEqual(rep.parse_note("car=2;with=0"), {"car": "2", "with": "0"})
        self.assertEqual(rep.parse_note("autopilot"), {})

    def test_rows_car(self):
        rows = rep.read_csv(os.path.join(FIX, "night_cars"))
        self.assertTrue(all(r["car"] == 0 for r in rows if r["kind"] == "pos"))
        self.assertEqual({r["car"] for r in rows if r["kind"] == "cpos"}, {1, 2, 3})

    def test_run_info(self):
        self.assertEqual(rep.run_info(os.path.join(FIX, "night_cars")), {"night": True, "time": "22:00", "cars": 3, "rain": False})
        self.assertEqual(rep.run_info(os.path.join(FIX, "single")), {"night": False, "time": "13:00", "cars": 0, "rain": False})

    def test_run_info_from_race_ini(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = night_folder(tmp)
            os.remove(os.path.join(d, "run.json"))
            self.assertEqual(rep.run_info(d), {"night": True, "time": "22:00", "cars": 3, "rain": False})

    def test_hours(self):
        self.assertAlmostEqual(rep.hours_of_angle(144), 22)
        self.assertAlmostEqual(rep.hours_of_angle(-80), 8)
        self.assertTrue(rep.is_night_hour(22) and rep.is_night_hour(2) and not rep.is_night_hour(18))

    def test_env_hours(self):
        self.assertEqual(rep.env_hours(rep.read_csv(os.path.join(FIX, "night_cars"))), 22)
        self.assertEqual(rep.env_hours([]), None)


class Cars(unittest.TestCase):
    def setUp(self):
        self.rows = rep.read_csv(os.path.join(FIX, "night_cars"))
        with open(os.path.join(FIX, "surface.json")) as f:
            self.rbs = rep.roundabouts(json.load(f))

    def test_roundabouts(self):
        self.assertEqual(len(self.rbs), 1)
        x, z, r = self.rbs[0]
        self.assertAlmostEqual(x, 100, delta=0.5)
        self.assertAlmostEqual(z, 0, delta=0.5)
        self.assertAlmostEqual(r, 15, delta=0.5)

    def test_roundabouts_network_core(self):
        # A networkCore build has no 1ROAD_RB meshes; dump_surface.ts lists the rings instead.
        rbs = rep.roundabouts({"meshes": [{"name": "1ROAD_J000", "p": [0, 0, 0]}], "roundabouts": [{"x": 5, "z": -7, "r": 12}]})
        self.assertEqual(rbs, [(5.0, -7.0, 12.0)])

    def test_contacts_dedup(self):
        pairs = [p for _, p in rep.contacts(self.rows)]
        # Both cars log each touch (one event); 1-2 again at 64 s is a new touch (4 s after the last).
        self.assertEqual(pairs, [(0, 1), (1, 2), (2, 3), (1, 2)])

    def test_pileup_at_roundabout(self):
        inc = rep.incidents(self.rows, self.rbs)
        piles = [i for i in inc if i["pileup"]]
        self.assertEqual(len(piles), 1)
        self.assertEqual(piles[0]["cars"], [1, 2, 3])
        self.assertEqual(piles[0]["roundabout"], 0)
        other = [i for i in inc if not i["pileup"]]
        self.assertEqual([i["cars"] for i in other], [[0, 1]])
        self.assertIsNone(other[0]["roundabout"])

    def test_no_roundabouts(self):
        inc = rep.incidents(self.rows, [])
        self.assertTrue(all(i["roundabout"] is None for i in inc))

    def test_car_table(self):
        t = {c["car"]: c for c in rep.car_table(self.rows)}
        self.assertEqual(sorted(t), [0, 1, 2, 3])
        self.assertEqual(t[0]["end"], "lap")
        self.assertEqual(t[1]["end"], "lap")
        self.assertEqual(t[2]["end"], "not done")
        self.assertEqual(len(t[3]["off"]), 1)
        self.assertEqual(len(t[2]["stuck"]), 1)
        self.assertEqual(len(t[2]["contacts"]), 3)

    def test_single_car_table(self):
        t = rep.car_table(rep.read_csv(os.path.join(FIX, "single")))
        self.assertEqual([c["car"] for c in t], [0])


class Night(unittest.TestCase):
    def test_pair_by_time_and_dark(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = night_folder(tmp)
            rows = rep.read_csv(d)
            shots = [r for r in rows if r["kind"] == "shot"]
            screens = rep.read_screens(d)
            self.assertEqual([n for n, _, _ in screens][:3], ["Screenshot_1.png", "Screenshot_2.png", "Screenshot_3.png"])
            pairs = rep.pair_shots(shots, screens, rep.read_presses(d))
            self.assertEqual(len(pairs), 20)
            self.assertTrue(all(row["note"] == f"lap{(int(name[11:-4]) - 1) * 5}" for row, name, _ in pairs))
            runs, med = rep.dark_stretches([(row, rep.road_brightness(img)) for row, _, img in pairs])
            self.assertEqual(len(runs), 1)
            self.assertEqual([r["note"] for r, _ in runs[0]], ["lap40", "lap45", "lap50"])
            self.assertAlmostEqual(med, 70, delta=1)

    def test_pair_skips_missing_screenshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = night_folder(tmp)
            os.remove(os.path.join(d, "screens", "Screenshot_5.png"))
            rows = rep.read_csv(d)
            shots = [r for r in rows if r["kind"] == "shot"]
            pairs = rep.pair_shots(shots, rep.read_screens(d), rep.read_presses(d))
            self.assertEqual(len(pairs), 19)
            # By time, the 6th screenshot still goes with the 6th shot line.
            self.assertEqual([row["note"] for row, name, _ in pairs if name == "Screenshot_6.png"], ["lap25"])

    def test_pair_in_order_without_times(self):
        shots = [{"note": "lap0"}, {"note": "lap5"}]
        screens = [("a.png", b"", None), ("b.png", b"", None), ("c.png", b"", None)]
        self.assertEqual([(s["note"], n) for s, n, _ in rep.pair_shots(shots, screens, {})], [("lap0", "a.png"), ("lap5", "b.png")])

    def test_all_dark(self):
        runs, _ = rep.dark_stretches([({"n": k}, 5.0) for k in range(4)])
        self.assertEqual(len(runs), 1)
        self.assertEqual(len(runs[0]), 4)

    def test_relative_dark(self):
        # Bright night (median 120): 50 is under half of it, so dark even though it's over DARK.
        runs, _ = rep.dark_stretches([({"n": k}, v) for k, v in enumerate([120, 120, 50, 120, 125])])
        self.assertEqual([[r["n"] for r, _ in run] for run in runs], [[2]])


class EndToEnd(unittest.TestCase):
    def test_single_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = os.path.join(tmp, "single")
            shutil.copytree(os.path.join(FIX, "single"), d)
            code, out = run(d, os.path.join(FIX, "surface.json"))
            self.assertEqual(code, 0, out)
            self.assertIn("finish: lap at 64 s", out)
            self.assertIn("offroad", out)
            self.assertNotIn("night run", out)
            self.assertNotIn("cars:", out)
            self.assertTrue(os.path.exists(d + ".autotest.png"))

    def test_night_cars_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = night_folder(tmp)
            z = d + ".zip"
            with zipfile.ZipFile(z, "w") as zf:
                for root, _, files in os.walk(d):
                    for f in files:
                        p = os.path.join(root, f)
                        zf.write(p, os.path.relpath(p, d))
            code, out = run(z, os.path.join(FIX, "surface.json"))
            self.assertEqual(code, 0, out)
            self.assertIn("night run (asked for 22:00)", out)
            self.assertIn("game time 22:00", out)
            self.assertIn("lap40, lap45, lap50", out)
            self.assertIn("cars: 4", out)
            self.assertIn("pile-ups (3 or more cars): 1, at roundabouts: 1", out)
            self.assertIn("PILE-UP", out)
            self.assertTrue(os.path.exists(d + ".autotest.png"))

    def test_night_not_dark_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = night_folder(tmp)
            p = os.path.join(d, "btest.csv")
            with open(p) as f:
                text = f.read()
            with open(p, "w") as f:
                f.write(text.replace("time=22:00;", "time=18:00;"))
            code, out = run(d, os.path.join(FIX, "surface.json"))
            self.assertEqual(code, 0, out)
            self.assertIn("WARNING: the game ran at 18:00", out)

    def test_rain_hollows(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = rain_folder(tmp, "rain=0.80;wet=0.60;water=0.20")
            code, out = run(d, os.path.join(FIX, "surface.json"))
            self.assertEqual(code, 0, out)
            self.assertIn("rain run: intensity 0.80, wetness 0.60, standing water 0.20", out)
            self.assertIn("hollows in the build: 2; passed within 15 m: 1", out)
            self.assertIn("hollow   1: 8 cm, 614 m2", out)
            self.assertIn("nearest shot lap5", out)

    def test_rain_dry_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = rain_folder(tmp, "rain=0.00;wet=0.00;water=0.00")
            code, out = run(d, os.path.join(FIX, "surface.json"))
            self.assertEqual(code, 0, out)
            self.assertIn("WARNING: rain intensity 0.00, it didn't rain", out)

    def test_night_no_screens(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = os.path.join(tmp, "n")
            shutil.copytree(os.path.join(FIX, "night_cars"), d)
            code, out = run(d, os.path.join(FIX, "surface.json"))
            self.assertEqual(code, 0, out)
            self.assertIn("no screenshots (20 shot lines)", out)


if __name__ == "__main__":
    unittest.main()
