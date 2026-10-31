"""Tests for make_wa_overviews.py: Terrarium round trip and the block means.

    python3 -I scripts/dem/test_make_wa_overviews.py

(test/waOverviews.test.ts runs this under vitest when Python has numpy and Pillow.)
"""

import importlib.util
import os
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("make_wa_overviews", os.path.join(HERE, "make_wa_overviews.py"))
ov = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ov)

STEP = 1 / 256  # Terrarium's precision


class RoundTrip(unittest.TestCase):
    def test_within_half_a_step(self):
        rng = np.random.default_rng(1)
        h = rng.uniform(-50, 300, (256, 256))
        # Values on and just under the G and B wrap points, where a carry is needed.
        h[0, :6] = [0, -0.001, 255.999, 256 - STEP / 4, -32768 + 1, 127.5]
        back = ov.decode(ov.encode(h))
        self.assertLessEqual(np.abs(back - h).max(), STEP / 2 + 1e-9)

    def test_encoded_values_are_exact(self):
        h = np.round(np.random.default_rng(2).uniform(-20, 200, (256, 256)) * 256) / 256
        np.testing.assert_array_equal(ov.decode(ov.encode(h)), h)
        np.testing.assert_array_equal(ov.encode(ov.decode(ov.encode(h))), ov.encode(h))

    def test_no_data(self):
        h = np.full((256, 256), 5.0)
        h[3, 4] = np.nan
        rgba = ov.encode(h)
        self.assertEqual(rgba[3, 4, 3], 0)
        self.assertEqual(rgba[0, 0, 3], 255)
        back = ov.decode(rgba)
        self.assertTrue(np.isnan(back[3, 4]))
        self.assertEqual(np.isnan(back).sum(), 1)


class Overview(unittest.TestCase):
    def test_block_means_ignore_no_data(self):
        k = 2
        a = np.full((256, 256), 10.0)
        a[0, 0] = np.nan  # block (0, 0) of child (0, 0): mean of three 10s
        a[2:4, 2:4] = np.nan  # block (1, 1): no data at all
        b = np.arange(256 * 256, dtype=np.float64).reshape(256, 256) / 100
        h = ov.overview({(0, 0): a, (1, 1): b}, k)
        self.assertEqual(h[0, 0], 10.0)
        self.assertTrue(np.isnan(h[1, 1]))
        self.assertEqual(h[5, 7], 10.0)
        # Child (1, 1) lands in the bottom-right quarter; child (1, 0) is absent: no data.
        self.assertAlmostEqual(h[128 + 3, 128 + 9], b[6:8, 18:20].mean())
        self.assertTrue(np.isnan(h[0:128, 128:]).all())
        self.assertTrue(np.isnan(h[128:, 0:128]).all())

    def test_heights_not_bytes(self):
        # 255.9 and 256.1 straddle a G wrap: byte means would give about 128 m, height means 256.
        k = 2
        h = np.full((256, 256), 255.9)
        h[:, 1::2] = 256.1
        q = ov.decode(ov.encode(h))
        out = ov.decode(ov.encode(ov.overview({(0, 0): q}, k)))
        self.assertLess(np.abs(out[:128, :128] - 256).max(), STEP)

    def test_coarse_zoom(self):
        k = 32
        kids = {(dx, dy): np.full((256, 256), float(dx + 32 * dy)) for dx in range(32) for dy in range(32)}
        h = ov.overview(kids, k)
        self.assertEqual(h[0, 0], 0)
        self.assertEqual(h[255, 255], 32 * 31 + 31)
        self.assertEqual(h[8 * 3, 8 * 5], 5 + 32 * 3)


if __name__ == "__main__":
    unittest.main()
