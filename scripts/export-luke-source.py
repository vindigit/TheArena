"""Export Luke's maintained source to ignored review staging, never production.

    blender --background art/source/player/luke-player-v1.blend \
      --python scripts/export-luke-source.py

Run npm run rig:check against production after any deliberate asset revision;
review a staged export before updating the pinned contract and runtime file.
"""
import bpy
import json
import struct
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
scene = bpy.data.scenes.get('Luke_Candidate')
if scene is None:
    raise RuntimeError('Open the maintained Luke source with Luke_Candidate scene')
bpy.context.window.scene = scene
# Scene-level add-on metadata is not part of the rig contract and can contain
# private service settings. Export only the required rig/mesh custom extras.
for key in list(scene.keys()):
    del scene[key]
mesh, rig = scene.objects.get('luke_mesh'), scene.objects.get('luke_player_rig')
if mesh is None or rig is None or mesh.type != 'MESH' or rig.type != 'ARMATURE':
    raise RuntimeError('Maintained Luke mesh/rig missing')
if len(rig.data.bones) != 17 or mesh.parent != rig:
    raise RuntimeError('Luke skeleton relationship differs')
for obj in bpy.context.selected_objects:
    obj.select_set(False)
mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
for bone in rig.pose.bones:
    bone.location = (0, 0, 0)
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = (1, 0, 0, 0)
    bone.scale = (1, 1, 1)
bpy.context.view_layer.update()
out = REPO / '.tmp' / 'luke' / 'luke-maintained-source-export.glb'
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
                          export_yup=True, export_animations=False, export_extras=False,
                          export_image_format='JPEG', export_jpeg_quality=90)
# Some installed add-ons repopulate scene settings from update/save handlers.
# Export no arbitrary extras; append only verified source rig/mesh metadata.
if rig.get('game_axes_corrected') is not True or mesh.get('hip_repaired') is not True or mesh.get('hip_repair_vertex_count') != 82:
    raise RuntimeError('Required Luke source rig/mesh metadata differs')
data = out.read_bytes()
json_size = struct.unpack_from('<I', data, 12)[0]
document = json.loads(data[20:20 + json_size])
binary = data[28 + json_size:]
for i, node in enumerate(document['nodes']):
    updated = {}
    for key, value in node.items():
        if key == 'mesh' and node.get('name') == 'luke_mesh':
            updated['extras'] = {'hip_repaired': True, 'hip_repair_vertex_count': 82}
        if key == 'name' and value == 'luke_player_rig':
            updated['extras'] = {'game_axes_corrected': True}
        updated[key] = value
    document['nodes'][i] = updated
payload = json.dumps(document, separators=(',', ':'), ensure_ascii=False).encode('utf8')
payload += b' ' * ((-len(payload)) % 4)
header = struct.pack('<4sII', b'glTF', 2, 28 + len(payload) + len(binary))
out.write_bytes(header + struct.pack('<I4s', len(payload), b'JSON') + payload +
                struct.pack('<I4s', len(binary), b'BIN\0') + binary)
print('Staged Luke export: ' + str(out))
