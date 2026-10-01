"""Independently authored Blender bake for TheArena's first dribble experiment.

Run after downloading the three pinned, hash-checked FBXs to .tmp/hybrid:
    blender --background --python scripts/retarget-dribble.py
The file may also be executed through the Blender MCP bridge. Source downloads
and the editable Blender review stay ignored; only a rotation-only GLB is public.
No RancidMilk conversion/add-on code is used.
"""
import bpy
import hashlib
import json
import math
import struct
from pathlib import Path
from mathutils import Quaternion, Vector

REPO = Path(__file__).resolve().parent.parent
WORK = REPO / '.tmp' / 'hybrid'
OUT = REPO / 'public' / 'assets' / 'models' / 'player' / 'forward-dribble-v1.glb'
REVISION = 'd18e9d3d14c08318eaa6c0602a6ead7fac40e58c'
HASHES = {
    '06_02': '13db9d5409a19621b8fa4ab60826f1a9c9bcda1104871986afcb8c86d4278380',
    '06_03': 'b484069d167e4050ebee1656fd11d8a3b569e98ef8c0c315c43cfb050c89d43d',
    '06_08': '093c9cf7304ef32515fcc0525085c8a62ce3626ea5a652b26632d9fe4ab6bf7d',
}
LABELS = {'06_02': 'basketball - forward dribble',
          '06_03': 'basketball - forward dribble',
          '06_08': 'basketball - sideways dribble'}
SOURCE = {
    'pelvis': 'hip', 'chest': 'chest', 'neck': 'neck', 'head': 'head',
    **{f'{side}_{target}': f'{prefix}{source}'
       for side, prefix in [('left', 'l'), ('right', 'r')]
       for target, source in [('upper_arm', 'Shldr'), ('forearm', 'ForeArm'),
                              ('hand', 'Hand'), ('thigh', 'Thigh'),
                              ('shin', 'Shin'), ('foot', 'Foot')]},
}
FPS = 30
START, END = 110, 140  # Blender import adds frame 1 to source time zero.
ALIGN = Quaternion(Vector((0, 0, 1)), math.pi)  # Source faces -Y; game faces +Y.
TO_GLTF = Quaternion(Vector((1, 0, 0)), -math.pi / 2)


def read_glb(path):
    data = path.read_bytes()
    return json.loads(data[20:20 + struct.unpack_from('<I', data, 12)[0]])


def import_objects(operator, **kwargs):
    before = set(bpy.data.objects)
    operator(**kwargs)
    return list(set(bpy.data.objects) - before)


def prepare_scene():
    scene = bpy.data.scenes.get('Hybrid_Dribble_Experiment')
    if scene is None:
        scene = bpy.data.scenes.new('Hybrid_Dribble_Experiment')
    bpy.context.window.scene = scene
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 0, END - START
    target = bpy.data.objects.get('Hybrid_Target_Player')
    if target is None:
        objects = import_objects(bpy.ops.import_scene.gltf,
                                 filepath=str(REPO / 'public/assets/models/player/fictional-player-v2.glb'))
        target = next(o for o in objects if o.type == 'ARMATURE')
        target.name = 'Hybrid_Target_Player'
        next(o for o in objects if o.type == 'MESH').name = 'Hybrid_Target_Mesh'
    sources = {}
    for clip, expected in HASHES.items():
        path = WORK / (clip + '.fbx')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Pinned source hash mismatch: ' + clip)
        arm = bpy.data.objects.get('Hybrid_Source_' + clip)
        if arm is None:
            objects = import_objects(bpy.ops.import_scene.fbx, filepath=str(path), use_anim=True)
            arm = next(o for o in objects if o.type == 'ARMATURE')
            arm.name = 'Hybrid_Source_' + clip
        # The mirror's container-scale/unit combination imports 100x too large.
        arm.scale = (.01, .01, .01)
        arm.hide_render = True
        sources[clip] = arm
    return scene, target, sources


def collect_sources(scene, sources):
    samples = {}
    wanted = set(SOURCE.values()) | {'abdomen'}
    positions = wanted | {'lFoot', 'rFoot', 'lShin', 'rShin', 'lThigh', 'rThigh'}
    for clip, obj in sources.items():
        rows = []
        for frame in range(1, int(obj.animation_data.action.frame_range[1]) + 1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            object_rotation = obj.matrix_world.to_quaternion().normalized()
            rows.append({
                'frame': frame,
                'joints': {n: list(obj.matrix_world @ obj.pose.bones[n].head) for n in positions},
                'deltas': {n: list((object_rotation @ obj.pose.bones[n].matrix.to_quaternion() @
                                   obj.data.bones[n].matrix_local.to_quaternion().inverted() @
                                   object_rotation.inverted()).normalized())
                           for n in wanted},
            })
        samples[clip] = {'fps': FPS, 'frames': rows}
    (WORK / 'source-samples.json').write_text(json.dumps(samples, separators=(',', ':')))
    return samples


def angular_gap(a, b):
    return 2 * math.acos(min(1, abs(sum(x * y for x, y in zip(a, b)))))


def evaluate_candidates(samples):
    candidates = []
    for clip, data in samples.items():
        frames = data['frames']
        best = None
        for start in range(75 if clip == '06_02' else 50, len(frames) - 28):
            for length in range(27, 36):
                if start + length >= len(frames):
                    continue
                a, b = frames[start], frames[start + length]
                displacement = Vector(b['joints']['hip']) - Vector(a['joints']['hip'])
                distance = math.hypot(displacement.x, displacement.y)
                if distance < .7:
                    continue
                errors, weighted = [], 0
                for name in SOURCE.values():
                    error = angular_gap(a['deltas'][name], b['deltas'][name])
                    weight = 3 if any(part in name for part in ['Thigh', 'Shin', 'Foot']) else 2 if name in ['hip', 'chest'] else 1
                    weighted += error * error * weight
                    errors.append(error)
                hand_gap = abs(a['joints']['rHand'][2] - b['joints']['rHand'][2])
                score = math.sqrt(weighted / 28 + hand_gap * hand_gap * 5)
                candidate = {'clip': clip, 'description': LABELS[clip], 'startFrame': start + 1,
                             'endFrame': start + length + 1, 'duration': length / FPS,
                             'scoreDegrees': math.degrees(score), 'maxRawSeamDegrees': math.degrees(max(errors)),
                             'sourceStrideDistance': distance, 'handHeightSeamMeters': hand_gap}
                if best is None or candidate['scoreDegrees'] < best['scoreDegrees']:
                    best = candidate
        candidates.append(best)
    return candidates


def derive_markers(frames):
    selected = frames[START - 1:END]
    displacement = Vector(selected[-1]['joints']['hip']) - Vector(selected[0]['joints']['hip'])
    contacts = []
    def hand_height(frame):
        i = frame - 1
        return sum(frames[j]['joints']['rHand'][2] for j in range(i - 2, i + 3)) / 5
    for frame in range(START + 1, END):
        h = hand_height(frame)
        if h > hand_height(frame - 1) and h >= hand_height(frame + 1):
            if not contacts or (frame - START) / (END - START) - contacts[-1] > .2:
                contacts.append((frame - START) / (END - START))
    plants = {}
    for side, joint in [('left', 'lFoot'), ('right', 'rFoot')]:
        minimum = min(f['joints'][joint][2] for f in selected)
        flags = []
        for frame in range(START, END + 1):
            i = frame - 1
            p = frames[i]['joints'][joint]
            before, after = frames[i - 2]['joints'][joint], frames[i + 2]['joints'][joint]
            speed = math.hypot(after[0] - before[0], after[1] - before[1]) * FPS / 4
            flags.append(p[2] <= minimum + .04 and speed < .45)
        intervals, first = [], None
        for i, planted in enumerate(flags + [False]):
            if planted and first is None:
                first = i
            if not planted and first is not None:
                if i - first >= 2:
                    intervals.append([first / (END - START), (i - 1) / (END - START)])
                first = None
        plants[side] = intervals
    return {'version': 1, 'strideDistance': math.hypot(displacement.x, displacement.y),
            'contacts': contacts, 'plants': plants}


def retarget_quaternions(frames, source_json):
    joints = source_json['skins'][0]['joints']
    nodes = source_json['nodes']
    names = [nodes[i]['name'] for i in joints]
    parent = {nodes[child]['name']: node['name'] for node in nodes
              for child in node.get('children', []) if child in joints and node.get('name') in names}
    tracks = {name: [] for name in names if name != 'root'}
    for row in frames[START - 1:END]:
        global_delta = {'root': Quaternion()}
        for name, source in SOURCE.items():
            q = Quaternion(row['deltas'][source])
            global_delta[name] = ALIGN @ q @ ALIGN.inverted()
        # Direct global delta of source chest combines its abdomen/chest chain.
        for name in tracks:
            q = global_delta[parent[name]].inverted() @ global_delta[name]
            q = (TO_GLTF @ q @ TO_GLTF.inverted()).normalized()
            if tracks[name] and tracks[name][-1].dot(q) < 0:
                q.negate()
            tracks[name].append(q)
    maximum_correction = 0
    count = END - START
    for name, values in tracks.items():
        correction = values[-1].inverted() @ values[0]
        maximum_correction = max(maximum_correction, angular_gap(values[0], values[-1]))
        corrected = []
        for i, q in enumerate(values[:-1]):
            p = i / count
            smooth = p * p * (3 - 2 * p)
            corrected.append((q @ Quaternion().slerp(correction, smooth)).normalized())
        # Circular three-tap quaternion filtering suppresses capture noise and
        # joins velocity across the loop; duplicate the first pose at time 1.
        filtered = []
        for i, q in enumerate(corrected):
            neighbors = corrected[i - 1].slerp(corrected[(i + 1) % count], .5)
            filtered.append(q.slerp(neighbors, .5).normalized())
        tracks[name] = filtered + [filtered[0].copy()]
    return names, tracks, math.degrees(maximum_correction)


def write_animation(source_json, names, tracks, markers):
    old_nodes = source_json['nodes']
    old_joints = source_json['skins'][0]['joints']
    index = {old: new for new, old in enumerate(old_joints)}
    nodes = []
    for old in old_joints:
        node = old_nodes[old]
        exported = {'name': node['name']}
        for key in ['translation', 'rotation', 'scale']:
            if key in node:
                exported[key] = node[key]
        children = [index[c] for c in node.get('children', []) if c in index]
        if children:
            exported['children'] = children
        nodes.append(exported)
    binary, views, accessors = bytearray(), [], []
    def accessor(values, kind, count, bounds=None):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(struct.pack('<' + 'f' * len(values), *values))
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(binary) - offset})
        entry = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': count, 'type': kind}
        if bounds:
            entry.update({'min': [bounds[0]], 'max': [bounds[1]]})
        accessors.append(entry)
        return len(accessors) - 1
    count = END - START + 1
    times = accessor([i / FPS for i in range(count)], 'SCALAR', count, (0, (count - 1) / FPS))
    samplers, channels = [], []
    for name, values in tracks.items():
        output = accessor([component for q in values for component in [q.x, q.y, q.z, q.w]], 'VEC4', count)
        samplers.append({'input': times, 'output': output, 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': names.index(name), 'path': 'rotation'}})
    document = {'asset': {'version': '2.0', 'generator': 'TheArena independent Blender retarget'},
                'scene': 0, 'scenes': [{'name': 'ForwardDribble', 'nodes': [names.index('root')]}],
                'nodes': nodes, 'buffers': [{'byteLength': len(binary)}], 'bufferViews': views,
                'accessors': accessors, 'animations': [{'name': 'forward-dribble', 'samplers': samplers,
                                                       'channels': channels, 'extras': markers}]}
    payload = json.dumps(document, separators=(',', ':')).encode('utf8')
    payload += b' ' * ((-len(payload)) % 4)
    binary += bytes((-len(binary)) % 4)
    data = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(payload) + 8 + len(binary))
    data += struct.pack('<I4s', len(payload), b'JSON') + payload
    data += struct.pack('<I4s', len(binary), b'BIN\x00') + binary
    OUT.write_bytes(data)
    if len(data) > 65536:
        raise RuntimeError('Animation exceeds 64 KB budget')
    return {'path': str(OUT.relative_to(REPO)), 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(), 'nodes': len(nodes),
            'channels': len(channels), 'samples': count, 'duration': (count - 1) / FPS,
            'firstLastSeamDegrees': 0, 'metadata': markers}


def bake_target(scene, target, tracks):
    previous = target.animation_data.action if target.animation_data else None
    target.animation_data_clear()
    if previous is not None and previous.users == 0:
        bpy.data.actions.remove(previous)
    # Blender's imported bone orientation differs from the glTF joint frame.
    # Build pose matrices in Blender world space from the exact exported locals.
    for frame in range(END - START + 1):
        scene.frame_set(frame)
        delta, desired = {}, {}
        for bone in target.data.bones:
            name = bone.name
            local = Quaternion() if name == 'root' else TO_GLTF.inverted() @ tracks[name][frame] @ TO_GLTF
            delta[name] = delta[bone.parent.name] @ local if bone.parent else local
            rest = bone.matrix_local.to_quaternion()
            desired[name] = delta[name] @ rest
            if bone.parent:
                rest_local = bone.parent.matrix_local.to_quaternion().inverted() @ rest
                pose_local = desired[bone.parent.name].inverted() @ desired[name]
                basis = rest_local.inverted() @ pose_local
            else:
                basis = rest.inverted() @ desired[name]
            pose = target.pose.bones[name]
            pose.rotation_mode = 'QUATERNION'
            pose.location = (0, 0, 0)
            pose.scale = (1, 1, 1)
            pose.rotation_quaternion = basis.normalized()
            pose.keyframe_insert('rotation_quaternion', frame=frame, group=name)
        bpy.context.view_layer.update()
    target.animation_data.action.name = 'forward-dribble'
    # Defaults can otherwise create Bezier overshoot in the editable review.
    for layer in target.animation_data.action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for point in curve.keyframe_points:
                        point.interpolation = 'LINEAR'


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    scene, target, sources = prepare_scene()
    source_json = read_glb(REPO / 'public/assets/models/player/fictional-player-v2.glb')
    samples = collect_sources(scene, sources)
    evaluations = evaluate_candidates(samples)
    markers = derive_markers(samples['06_02']['frames'])
    names, tracks, raw_gap = retarget_quaternions(samples['06_02']['frames'], source_json)
    asset = write_animation(source_json, names, tracks, markers)
    bake_target(scene, target, tracks)
    scene.frame_set(15)
    bpy.context.view_layer.update()
    report = {'blenderVersion': bpy.app.version_string, 'revision': REVISION,
              'sources': [{'clip': c, 'description': LABELS[c], 'sha256': HASHES[c],
                           'url': f'https://huggingface.co/datasets/gbionics/cmu-fbx/resolve/{REVISION}/animations/{c}.fbx'}
                          for c in HASHES],
              'evaluations': evaluations, 'selected': {'clip': '06_02', 'startBlenderFrame': START,
                           'endBlenderFrame': END, 'sourceStartSeconds': (START - 1) / FPS,
                           'sourceEndSeconds': (END - 1) / FPS,
                           'reason': 'Lowest settled-forward seam score; one full alternating gait and one dribble apex.',
                           'maxRawLocalSeamDegrees': raw_gap},
              'processing': ['FBX scale corrected by 0.01 after import', '180-degree source facing alignment',
                             'global rest-relative quaternion retarget; abdomen/chest chain folded into chest',
                             'exact shipped-v2 bind translations; root fixed; rotation-only channels',
                             'distributed endpoint drift correction; circular three-tap quaternion filter',
                             '30 Hz LINEAR quaternion samples with identical first/last pose'],
              'markerDerivation': {'contacts': 'Five-frame smoothed right wrist height maxima before root removal',
                                  'plants': 'Ankle <= cycle minimum +0.04m and centered planar speed <0.45m/s'},
              'asset': asset,
              'licenseEvidence': json.loads((WORK / 'license-evidence.json').read_text())
                                 if (WORK / 'license-evidence.json').exists() else None,
              'visualReview': json.loads((WORK / 'visual-review.json').read_text())
                              if (WORK / 'visual-review.json').exists() else None,
              'limitations': ['Old capture contains wrist/toe noise; fingers and helper channels omitted',
                              'One forward cycle cannot depict lateral shuffles or pivots faithfully',
                              'Source gait and dribble rhythms differ; runtime must independently phase arms',
                              'Fixed translations remove pelvis bob; runtime adds presentation bob and planted-foot correction',
                              'Contact/plant markers are kinematic estimates; no captured basketball trajectory']}
    (WORK / 'asset-report.json').write_text(json.dumps(report, indent=2) + '\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'retargeted-dribble.blend'), copy=True)
    return report


if __name__ == '__main__':
    result = main()
