#!/usr/bin/env bash
# Full video -> Luke pipeline. Usage: run_all.sh UPLOAD_DIR WORK_DIR
# Needs: ffmpeg, python3 (mediapipe, opencv, scipy), Blender 4.5 at $BLENDER.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; UP="$1"; WORK="$2"; BLENDER="${BLENDER:-blender}"
mkdir -p "$WORK/mocap" "$WORK/out"
for name in $(python3 -c "import json;print(' '.join(json.load(open('$HERE/clips.json'))['sources']))"); do
  read -r video start end plan < <(python3 -c "import json;s=json.load(open('$HERE/clips.json'))['sources']['$name'];print(s['video'],s['start'],s['end'],json.dumps(s.get('handPlan',{}),separators=(',',':')))")
  [ -f "$WORK/mocap/$name.pose.json" ] || python3 "$HERE/extract_pose.py" "$UP/$video" --start "$start" --end "$end" --name "$name" --out "$WORK/mocap"
  python3 "$HERE/retarget_luke.py" "$WORK/mocap/$name.pose.json" "$WORK/mocap/$name.luke.json" --hand-plan "$plan"
done
python3 "$HERE/build_clips.py" "$WORK/mocap" "$WORK/out"
rm -rf "$WORK/blender"
"$BLENDER" -b -P "$HERE/blender_review.py" -- "$WORK/out/luke-video-clips.glb" "$WORK/blender" --engine BLENDER_WORKBENCH 2>&1 | grep -E "BLENDER_REVIEW_DONE|Error|Traceback"
python3 "$HERE/export_runtime.py" "$WORK/out" "$WORK/blender"
