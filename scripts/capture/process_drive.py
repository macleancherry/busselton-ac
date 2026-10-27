"""Turn a drive (video + GPX) into geotagged frames for Mapillary and for Claude to review.

    pip install mapillary_tools
    mapillary_tools authenticate --user_name YOUR_MAPILLARY_NAME      # once

    # Phone video + a GPX track from a logger app:
    python3 -I scripts/capture/process_drive.py drives/2026-11-01 --gpx drives/2026-11-01/track.gpx

    # GoPro with GPS on: no GPX needed.
    python3 -I scripts/capture/process_drive.py drives/2026-11-01

    # When happy with the frames, upload them:
    python3 -I scripts/capture/process_drive.py drives/2026-11-01 --gpx ... --upload

Options:
  --start "2026-11-01 09:14:05"  when the video started, local time, if the phone's video
                                 timestamp is wrong (frames end up in the wrong place on the map)
  --offset 2.5                   nudge every frame's time by this many seconds against the GPX
  --every 3                      metres between sampled frames (default 3)
  --review 25                    metres between frames copied to review/ for Claude (default 25)

Writes, next to the videos:
  mapillary_sampled_video_frames/   frames with GPS in their EXIF (what gets uploaded)
  review/                           every ~25 m, plus review/index.csv (frame, lat, lng, heading)
  frames.geojson                    every sampled frame, to check on a map
"""

import argparse
import csv
import json
import math
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

PERTH = timezone(timedelta(hours=8))


def run(cmd):
    print("$", " ".join(cmd), flush=True)
    r = subprocess.run(cmd)
    if r.returncode:
        sys.exit(f"command failed ({r.returncode})")


def video_start(folder):
    """The recording start from the video's own metadata (ffprobe), which mapillary_tools
    doesn't read for phone videos. One video per folder."""
    vids = [f for f in sorted(os.listdir(folder)) if f.lower().endswith((".mp4", ".mov"))]
    if len(vids) != 1 or not shutil.which("ffprobe"):
        return None
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags=creation_time",
                        "-of", "default=nw=1:nk=1", os.path.join(folder, vids[0])], capture_output=True, text=True)
    t = r.stdout.strip()
    try:
        return datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def dist(a, b):
    k = math.cos(math.radians(a[0])) * 111320
    return math.hypot((a[1] - b[1]) * k, (a[0] - b[0]) * 111320)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", help="folder holding the drive's video file(s)")
    ap.add_argument("--gpx", help="GPX track recorded during the drive")
    ap.add_argument("--start", help='video start, local Perth time "YYYY-MM-DD HH:MM:SS"')
    ap.add_argument("--offset", type=float, default=0.0, help="seconds to add to frame times against the GPX")
    ap.add_argument("--every", type=float, default=3.0, help="metres between sampled frames")
    ap.add_argument("--review", type=float, default=25.0, help="metres between review frames for Claude")
    ap.add_argument("--upload", action="store_true", help="upload the processed frames to Mapillary")
    args = ap.parse_args()

    folder = os.path.abspath(args.folder)
    frames = os.path.join(folder, "mapillary_sampled_video_frames")
    tool = shutil.which("mapillary_tools") or sys.exit("mapillary_tools not found: pip install mapillary_tools")

    cmd = [tool, "video_process", folder, frames, "--rerun"]
    if args.gpx:
        # Sampling by distance needs GPS inside the video; with a separate GPX, sample by time
        # (every 0.25 s, about 3 m at 45 km/h) and let duplicate_distance thin out the stops.
        cmd += ["--video_sample_distance", "-1", "--video_sample_interval", "0.25",
                "--duplicate_distance", str(args.every),
                "--geotag_source", "gpx", "--geotag_source_path", os.path.abspath(args.gpx)]
    else:
        cmd += ["--video_sample_distance", str(args.every)]
    start = None
    if args.start:
        start = datetime.strptime(args.start, "%Y-%m-%d %H:%M:%S").replace(tzinfo=PERTH).astimezone(timezone.utc)
    elif args.gpx:
        start = video_start(folder)
    if start:
        print(f"video start {start.astimezone(PERTH):%Y-%m-%d %H:%M:%S} Perth time")
        cmd += ["--video_start_time", start.strftime("%Y_%m_%d_%H_%M_%S_000")]
    if args.offset:
        cmd += ["--interpolation_offset_time", str(args.offset)]
    run(cmd)

    # mapillary_tools writes its results next to the frames.
    desc_path = os.path.join(frames, "mapillary_image_description.json")
    if not os.path.exists(desc_path):
        sys.exit(f"no {desc_path}: processing failed, see the output above")
    descs = [d for d in json.load(open(desc_path)) if "MAPLatitude" in d]
    descs.sort(key=lambda d: (d.get("filename", ""), d.get("MAPCaptureTime", "")))
    if not descs:
        sys.exit("no frames were geotagged: check the GPX covers the video's time, or pass --start / --offset")

    # Map check.
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [d["MAPLongitude"], d["MAPLatitude"]]},
              "properties": {"file": os.path.basename(d["filename"]), "time": d.get("MAPCaptureTime"),
                             "heading": d.get("MAPCompassHeading", {}).get("TrueHeading")}} for d in descs]
    json.dump({"type": "FeatureCollection", "features": feats}, open(os.path.join(folder, "frames.geojson"), "w"))

    # Review set for Claude: one frame every ~25 m.
    review = os.path.join(folder, "review")
    os.makedirs(review, exist_ok=True)
    last = None
    picked = []
    for d in descs:
        p = (d["MAPLatitude"], d["MAPLongitude"])
        if last is None or dist(p, last) >= args.review:
            src = d["filename"] if os.path.isabs(d["filename"]) else os.path.join(frames, d["filename"])
            name = f"{len(picked):04d}.jpg"
            shutil.copy2(src, os.path.join(review, name))
            picked.append((name, *p, d.get("MAPCompassHeading", {}).get("TrueHeading", "")))
            last = p
    with open(os.path.join(review, "index.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["frame", "lat", "lng", "heading"])
        w.writerows(picked)
    span = sum(dist((descs[i]["MAPLatitude"], descs[i]["MAPLongitude"]),
                    (descs[i + 1]["MAPLatitude"], descs[i + 1]["MAPLongitude"])) for i in range(len(descs) - 1))
    print(f"{len(descs)} geotagged frames over {span / 1000:.1f} km; {len(picked)} review frames in {review}")

    if args.upload:
        run([tool, "upload", frames])
        print("Uploaded. Mapillary takes a day or two to detect signs; then rebuild with your Mapillary token set.")
    else:
        print("Not uploaded. Check frames.geojson on a map (e.g. geojson.io), then rerun with --upload.")


if __name__ == "__main__":
    main()
