"""Merge video-derived clips into Luke's runtime sample pack.

usage: python3 export_runtime.py OUT_DIR BLENDER_DIR
Reads OUT_DIR/luke-video-clips.json (build_clips.py) and BLENDER_DIR/blender-report.json
(sole heights measured on Luke's skinned shoes in Blender) and rewrites the
listed clips in art/animation/polished-samples.json. Other clips are untouched.

Per sample it writes rotations (glTF-local, every bone), visualGroundingY (the
lift that puts the lowest shoe vertex on the gameplay root), ballLocal (ball
centre on the right palm, gameplay-root local) and handShapeState.
"""
import json, os, sys
import numpy as np
from scipy.spatial.transform import Rotation as R

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..')
PACK = os.path.join(ROOT, 'art', 'animation', 'polished-samples.json')
CONTRACT = os.path.join(ROOT, 'docs', 'rig', 'luke-rig-contract.json')
# src/player-pose.js LUKE_PHYSICAL_PALMS (hand bind-local; bind frames are world-aligned).
PALM = {'right': {'offset': [.085, -.010420431611832814, 0], 'normal': [.06328680701153797, -.95874679214998, .27712699002516405]}}
BALL_RADIUS = .12
RELEASE = {'shoot': .2, 'layup': .4956}

def fk(rot):
    bones = json.load(open(CONTRACT))['bones']; W = {}
    for b in bones:
        p = b['parent']; t = np.array(b['translation'])
        if p in W:
            pr, pp = W[p]; W[b['name']] = (pr * R.from_quat(rot[b['name']]), pp + pr.apply(t))
        else: W[b['name']] = (R.from_quat(rot[b['name']]), t)
    return W

def main(out, blender):
    clips = json.load(open(os.path.join(out, 'luke-video-clips.json')))['clips']
    report = json.load(open(os.path.join(blender, 'blender-report.json')))['actions']
    pack = json.load(open(PACK))
    for name, clip in clips.items():
        lows = report[name]['lowestSoleZ']; samples = []
        for s in clip['samples']:
            low = float(np.interp(s['time'] * 30, np.arange(len(lows)), lows))
            ground = round(-low + .002, 5)
            W = fk(s['rotations']); hr, hp = W['right_hand']
            palm = hp + hr.apply(PALM['right']['offset']); normal = hr.apply(PALM['right']['normal'])
            ball = palm + normal * BALL_RADIUS + np.array([0, ground, 0])
            released = name in RELEASE and s['time'] >= RELEASE[name] - 1e-6
            samples.append({'time': s['time'], 'rotations': s['rotations'], 'visualGroundingY': ground,
                            'ballLocal': [round(float(v), 5) for v in ball],
                            'handShapeState': 'spread' if released else 'cupped'})
        pack['clips'][name] = {'duration': clip['duration'], 'loop': False, 'source': f"video:{clip['source']}", 'samples': samples}
    json.dump(pack, open(PACK, 'w'), separators=(',', ':'))
    print('updated', list(clips), 'in', os.path.relpath(PACK, ROOT), os.path.getsize(PACK), 'bytes')

if __name__ == '__main__': main(*sys.argv[1:3])
