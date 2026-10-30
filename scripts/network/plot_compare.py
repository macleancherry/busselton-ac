"""Plots scripts/network/compare.ts output: the built track's drivable surface against the network
prototype's, as height (relative to the junction's median), overlaps (two or more drivable surfaces
at different heights) and lips (top-surface steps over 3 cm in 0.25 m).

    python3 -I scripts/network/plot_compare.py <compare out dir> <name> [<name> ...] --out <png>
"""
import json
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def grid(values, n):
    return np.array([np.nan if v is None else v for v in values], dtype=float).reshape(n, n)


def main():
    args = sys.argv[1:]
    out = args[args.index("--out") + 1]
    names = [a for i, a in enumerate(args[1:], 1) if a != "--out" and args[i - 1] != "--out"]
    d = args[0]
    fig, axes = plt.subplots(len(names), 4, figsize=(20, 5 * len(names)), squeeze=False)
    for row, name in zip(axes, names):
        j = json.load(open(f"{d}/{name}.json"))
        R, cell = j["R"], j["cell"]
        n = round(2 * R / cell)
        ext = [-R, R, -R, R]
        cur, pro = grid(j["gridsCurrent"]["top"], n), grid(j["gridsProto"]["top"], n)
        for ax, g, label in ((row[0], cur, "current base: height"), (row[1], pro, "network prototype: height")):
            im = ax.imshow(g - np.nanmedian(g), origin="lower", extent=ext, cmap="RdBu_r", vmin=-0.15, vmax=0.15)
            ax.set_title(f"{name}: {label} (m, vs its median)", fontsize=9)
            plt.colorbar(im, ax=ax, fraction=0.046)
        for ring in j["polygon"]:
            r = np.array(ring + [ring[0]]) - np.array(j["centre"])
            row[1].plot(r[:, 0], r[:, 1], color="k", lw=0.6)
        for ax, key, label in ((row[2], "gridsCurrent", "current"), (row[3], "gridsProto", "prototype")):
            spread = np.array(j[key]["spread"]).reshape(n, n)
            lip = np.array(j[key]["lip"]).reshape(n, n)
            top = grid(j[key]["top"], n)
            ax.imshow(~np.isnan(top), origin="lower", extent=ext, cmap="Greys", vmin=0, vmax=3, alpha=0.6)
            ys, xs = np.nonzero(spread > 0.01)
            ax.scatter(xs * cell - R, ys * cell - R, s=1, c="tab:orange", label="overlap > 1 cm")
            ys, xs = np.nonzero(lip > 0)
            ax.scatter(xs * cell - R, ys * cell - R, s=1, c="tab:red", label="lip > 3 cm")
            s = j["current" if key == "gridsCurrent" else "proto"]
            ax.set_title(f"{label}: overlap {s['overlapM2']} m² (max {s['maxOverlapSpreadM']} m), lips {s['lipM2']} m² (max {s['maxLipM']} m)", fontsize=8)
            ax.set_xlim(-R, R)
            ax.set_ylim(-R, R)
            ax.legend(loc="lower right", fontsize=7, markerscale=6)
        for ax in row:
            ax.set_aspect("equal")
            ax.add_patch(plt.Circle((0, 0), R, fill=False, ls=":", color="grey"))
    plt.tight_layout()
    plt.savefig(out, dpi=90)


if __name__ == "__main__":
    main()
