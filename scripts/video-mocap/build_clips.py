"""Time-warp retargeted frames into game clips and write an animated Luke GLB.

usage: python3 build_clips.py MOCAP_DIR OUT_DIR
Reads MOCAP_DIR/<source>.luke.json (retarget_luke.py output) and clips.json.
Writes OUT_DIR/luke-video-clips.json (glTF-local quaternions per sample) and
OUT_DIR/luke-video-clips.glb (Luke's canonical GLB + one animation per clip)
for Blender import, inspection and export.
"""
import json, os, struct, sys
import numpy as np
from scipy.spatial.transform import Rotation as R, Slerp

HERE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(HERE, '..', '..', 'public', 'assets', 'models', 'player', 'luke-player-v1.glb')

def warp(points, t):
    src = [p[0] for p in points]; dst = [p[1] for p in points]
    return float(np.interp(t, dst, src))

def sample(frames, bones, f):
    i = int(np.clip(np.floor(f), 0, len(frames) - 2)); a = f - i
    out = {}
    for b in bones:
        q = R.from_quat([frames[i][b], frames[i + 1][b]])
        out[b] = Slerp([0, 1], q)([np.clip(a, 0, 1)]).as_quat()[0]
    return out

def read_glb(path):
    data = open(path, 'rb').read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + jlen]); blen = struct.unpack_from('<I', data, 20 + jlen)[0]
    return gltf, bytearray(data[28 + jlen:28 + jlen + blen])

def write_glb(path, gltf, binary):
    while len(binary) % 4: binary.append(0)
    gltf['buffers'][0]['byteLength'] = len(binary)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(binary)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binary), 0x004E4942)); f.write(binary)

def main(mocap, out):
    cfg = json.load(open(os.path.join(HERE, 'clips.json'))); fps = cfg['fps']
    src = {n: json.load(open(os.path.join(mocap, n + '.luke.json'))) for n in cfg['sources']}
    clips = {}
    for name, c in cfg['clips'].items():
        s = src[c['source']]; bones = s['bones']; n = int(round(c['duration'] * fps)) + 1
        samples = []
        for k in range(n):
            t = c['duration'] * k / (n - 1)
            q = sample(s['frames'], bones, warp(c['warp'], t))
            samples.append({'time': round(t, 6), 'sourceFrame': round(warp(c['warp'], t), 3),
                            'rotations': {b: [round(float(v), 7) for v in q[b]] for b in bones}})
        for b in bones:  # sign continuity after resampling
            for k in range(1, n):
                if np.dot(samples[k]['rotations'][b], samples[k - 1]['rotations'][b]) < 0:
                    samples[k]['rotations'][b] = [-v for v in samples[k]['rotations'][b]]
        clips[name] = {'duration': c['duration'], 'loop': False, 'source': c['source'], 'samples': samples}
    os.makedirs(out, exist_ok=True)
    json.dump({'fps': fps, 'clips': clips}, open(os.path.join(out, 'luke-video-clips.json'), 'w'))
    gltf, binary = read_glb(GLB)
    node_index = {nd.get('name'): i for i, nd in enumerate(gltf['nodes'])}
    gltf['animations'] = []
    def add_accessor(arr, typ):
        off = len(binary); binary.extend(np.asarray(arr, np.float32).tobytes())
        while len(binary) % 4: binary.append(0)
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.size * 4})
        acc = {'bufferView': len(gltf['bufferViews']) - 1, 'componentType': 5126, 'count': len(arr), 'type': typ}
        if typ == 'SCALAR': acc.update(min=[float(arr.min())], max=[float(arr.max())])
        gltf['accessors'].append(acc); return len(gltf['accessors']) - 1
    for name, clip in clips.items():
        times = np.array([s['time'] for s in clip['samples']], np.float32); ti = add_accessor(times, 'SCALAR')
        anim = {'name': name, 'samplers': [], 'channels': []}
        for b in clip['samples'][0]['rotations']:
            if b == 'root': continue
            qi = add_accessor(np.array([s['rotations'][b] for s in clip['samples']], np.float32), 'VEC4')
            anim['samplers'].append({'input': ti, 'output': qi, 'interpolation': 'LINEAR'})
            anim['channels'].append({'sampler': len(anim['samplers']) - 1, 'target': {'node': node_index[b], 'path': 'rotation'}})
        gltf['animations'].append(anim)
    write_glb(os.path.join(out, 'luke-video-clips.glb'), gltf, binary)
    print('clips:', {k: len(v['samples']) for k, v in clips.items()})

if __name__ == '__main__': main(*sys.argv[1:3])
