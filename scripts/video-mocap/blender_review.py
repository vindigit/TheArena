"""Blender pass: import the animated Luke GLB, clean the curves, render review
stills/turnarounds, and export import-ready GLB + FBX.

blender -b -P blender_review.py -- IN.glb OUT_DIR [--engine CYCLES|BLENDER_WORKBENCH|BLENDER_EEVEE_NEXT]
Outputs: OUT_DIR/<clip>_<view>/####.png frames, OUT_DIR/luke-video-clips.blender.glb,
OUT_DIR/luke-video-clips.fbx and OUT_DIR/blender-report.json.
"""
import bpy, sys, os, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
engine = argv[argv.index('--engine') + 1] if '--engine' in argv else 'BLENDER_WORKBENCH'
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene; scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in scene.objects if o.type == 'MESH')
actions = sorted(bpy.data.actions, key=lambda a: a.name)

# Curve cleanup in Blender: keep quaternion keys continuous and remove
# redundant keys that sit on the straight line between their neighbours.
report = {'actions': {}}
for act in actions:
    removed = 0
    for fc in act.fcurves:
        for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
        pts = fc.keyframe_points
        i = 1
        while i < len(pts) - 1:
            a, b, c = pts[i - 1].co, pts[i].co, pts[i + 1].co
            lerp = a[1] + (c[1] - a[1]) * (b[0] - a[0]) / max(1e-9, c[0] - a[0])
            if abs(lerp - b[1]) < 1e-5: pts.remove(pts[i]); removed += 1
            else: i += 1
        fc.update()
    report['actions'][act.name] = {'frameRange': list(act.frame_range), 'fcurves': len(act.fcurves), 'redundantKeysRemoved': removed}

# Review stage: floor, three-point light, camera targets.
bpy.ops.mesh.primitive_plane_add(size=8); floor = bpy.context.object
mat = bpy.data.materials.new('floor'); mat.diffuse_color = (0.55, 0.42, 0.26, 1); floor.data.materials.append(mat)
if engine == 'CYCLES':
    mat.use_nodes = True; mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.42, 0.26, 1)
for loc, energy in (((3, -4, 5), 900), ((-4, -2, 3), 300), ((0, 5, 4), 500)):
    bpy.ops.object.light_add(type='AREA', location=loc); l = bpy.context.object; l.data.energy = energy; l.data.size = 3
    l.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
world = bpy.data.worlds.new('w'); scene.world = world; world.color = (0.08, 0.09, 0.12)
scene.render.engine = engine
if engine == 'CYCLES':
    scene.cycles.samples = 24; scene.cycles.use_denoising = True; scene.cycles.device = 'CPU'
    world.use_nodes = True; world.node_tree.nodes['Background'].inputs[0].default_value = (0.08, 0.09, 0.12, 1)
elif engine == 'BLENDER_WORKBENCH':
    scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_shadows = True; scene.display.shading.show_cavity = True
scene.render.resolution_x, scene.render.resolution_y = 600, 800
scene.render.image_settings.file_format = 'PNG'
bpy.ops.object.camera_add(); cam = bpy.context.object; scene.camera = cam; cam.data.lens = 50
target = bpy.data.objects.new('target', None); scene.collection.objects.link(target); target.location = (0, 0, 1.25)
c = cam.constraints.new('TRACK_TO'); c.target = target; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'
# Luke faces game -Z, which the glTF importer maps to Blender +Y.
views = {'front': (0, 5.6, 1.4), 'side': (5.6, 0, 1.4), 'three_quarter': (3.9, 3.9, 1.7)}
# Preview-only lift: a parent empty carries sole grounding plus the game's
# jump arc so renders read like gameplay. The exported actions stay in place.
lift = bpy.data.objects.new('preview_lift', None); scene.collection.objects.link(lift); arm.parent = lift
def jump_y(name, t):
    if name == 'shoot': return .3048 * (1 - (1 - t / .2) ** 2) if t <= .2 else (.3048 * (1 - ((t - .2) / .2) ** 2) if t < .4 else 0)
    if name == 'layup': return math.sin(math.pi * min(1, t / .84)) * .64
    return 0
foot_groups = [mesh.vertex_groups[n].index for n in ('left_foot', 'right_foot') if n in mesh.vertex_groups]
foot_verts = [v.index for v in mesh.data.vertices if any(g.group in foot_groups and g.weight > .5 for g in v.groups)]
arm.animation_data_create()
for act in actions:
    arm.animation_data.action = act
    if hasattr(arm.animation_data, 'action_slot') and act.slots: arm.animation_data.action_slot = act.slots[0]
    f0, f1 = int(act.frame_range[0]), int(round(act.frame_range[1]))
    scene.frame_start, scene.frame_end = f0, f1
    lift.animation_data_clear(); lift.location = (0, 0, 0)
    lows = []
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get()); me = ev.to_mesh()
        lows.append(min((ev.matrix_world @ me.vertices[i].co).z for i in foot_verts)); ev.to_mesh_clear()
    report['actions'][act.name]['lowestSoleZ'] = [round(v, 4) for v in lows]
    for k, f in enumerate(range(f0, f1 + 1)):
        lift.location.z = -lows[k] + jump_y(act.name, (f - f0) / scene.render.fps); lift.keyframe_insert('location', index=2, frame=f)
    for view, loc in views.items():
        cam.location = loc
        scene.render.filepath = os.path.join(out, f'{act.name}_{view}', '')
        bpy.ops.render.render(animation=True)
json.dump(report, open(os.path.join(out, 'blender-report.json'), 'w'), indent=1)
arm.animation_data.action = None
mw = arm.matrix_world.copy(); arm.parent = None; arm.matrix_world = mw; arm.location = (0, 0, 0)
bpy.data.objects.remove(lift); bpy.data.objects.remove(floor); [bpy.data.objects.remove(o) for o in list(scene.objects) if o.type in ('LIGHT', 'CAMERA', 'EMPTY')]
for act in actions: act.use_fake_user = True
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'luke-video-clips.blender.glb'), export_format='GLB',
                          export_animation_mode='ACTIONS', export_force_sampling=True)
bpy.ops.export_scene.fbx(filepath=os.path.join(out, 'luke-video-clips.fbx'), bake_anim=True, bake_anim_use_all_actions=True,
                         bake_anim_use_nla_strips=False, add_leaf_bones=False, path_mode='COPY', embed_textures=True)
print('BLENDER_REVIEW_DONE', json.dumps({k: v['frameRange'] for k, v in report['actions'].items()}))
