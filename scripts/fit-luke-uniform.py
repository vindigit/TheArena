"""Bake the supplied kit onto Luke's unchanged fused clothing geometry."""
from pathlib import Path
import argparse
import bmesh
import json
import sys

import bpy

parser = argparse.ArgumentParser()
parser.add_argument("--blend", required=True)
parser.add_argument("--uniform", required=True)
parser.add_argument("--uniform-render", required=True)
parser.add_argument("--out-blend", required=True)
parser.add_argument("--out-glb", required=True)
options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
blend_path = Path(options.blend).resolve()
uniform_path = Path(options.uniform).resolve()
uniform_render_path = Path(options.uniform_render).resolve()
out_blend = Path(options.out_blend).resolve()
out_glb = Path(options.out_glb).resolve()

bpy.ops.wm.open_mainfile(filepath=str(blend_path))
mesh = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
rig = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
if len(rig.data.bones) != 22 or len(mesh.data.materials) != 1:
    raise RuntimeError("Expected Luke's exact 22-bone, one-material editable source")
original_material = mesh.data.materials[0]
original_images = list({node.image for node in original_material.node_tree.nodes
                        if node.type == "TEX_IMAGE" and node.image})
if len(original_images) != 1 or not mesh.data.uv_layers.active:
    raise RuntimeError("Expected Luke's single source atlas and UV map")
original_image = original_images[0]
original_pixels = list(original_image.pixels)
original_width, original_height = original_image.size
original_uv = mesh.data.uv_layers.active.data

def original_face_color(poly):
    colors = []
    for loop_index in poly.loop_indices:
        uv = original_uv[loop_index].uv
        x = min(original_width - 1, max(0, int((uv.x % 1.0) * original_width)))
        y = min(original_height - 1, max(0, int((uv.y % 1.0) * original_height)))
        offset = (y * original_width + x) * 4
        colors.append(original_pixels[offset:offset + 3])
    return tuple(sum(color[channel] for color in colors) / len(colors) for channel in range(3))

def dominant_bone(obj, poly):
    excluded = {"Neck", "Head", "LeftArm", "LeftForeArm", "LeftHand",
                "RightArm", "RightForeArm", "RightHand", "LeftLeg", "RightLeg",
                "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"}
    scores = {}
    for vertex_index in poly.vertices:
        for item in obj.data.vertices[vertex_index].groups:
            name = obj.vertex_groups[item.group].name
            scores[name] = scores.get(name, 0.0) + item.weight
    return max(scores, key=scores.get) if scores else None

def dominant_excluded(obj, poly):
    excluded = {"Neck", "Head", "LeftArm", "LeftForeArm", "LeftHand",
                "RightArm", "RightForeArm", "RightHand", "LeftLeg", "RightLeg",
                "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"}
    return dominant_bone(obj, poly) in excluded

def is_garment(obj, poly):
    center = obj.matrix_world @ poly.center
    torso = 1.04 <= center.z <= 1.72 and abs(center.x) <= 0.36
    shorts = 0.66 <= center.z < 1.08 and abs(center.x) <= 0.43
    red, green, blue = original_face_color(poly)
    skin_like = (red > 0.16 and red > green * 1.18 and
                 green > blue * 1.15 and red > blue * 1.45)
    force_old_chest_mark = center.y > 0.02 and abs(center.x) < 0.34 and 1.20 < center.z < 1.53
    force_old_shorts_mark = (center.y > 0.02 and abs(center.x) < 0.34 and
                             0.72 < center.z < 1.02 and not skin_like)
    force_garment_yoke = (abs(center.x) < 0.36 and 1.50 < center.z < 1.79 and
                          max(red, green, blue) < 0.40 and not skin_like and
                          dominant_bone(obj, poly) == "Spine2")
    # Luke's original vest yoke is a separate dark texture region. Its pixels are
    # not consistently below the color threshold, but its faces are unambiguously
    # torso-weighted. Include the complete Spine2-weighted yoke while leaving the
    # Neck/Head/Arm-weighted skin untouched.
    force_spine_yoke = (dominant_bone(obj, poly) == "Spine2" and
                        abs(center.x) < 0.36 and 1.45 < center.z < 1.75)
    return (force_old_chest_mark or force_old_shorts_mark or force_garment_yoke or
            force_spine_yoke or
            ((torso or shorts) and not dominant_excluded(obj, poly) and not skin_like))

before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(uniform_path))
imported = [obj for obj in bpy.context.scene.objects if obj not in before]
source = next((obj for obj in imported if obj.type == "MESH"), None)
if source is None or len(source.data.materials) != 1 or not source.data.uv_layers.active:
    raise RuntimeError("Supplied uniform must contain one textured mesh")

receiver = mesh.copy()
receiver.data = mesh.data.copy()
receiver.name = "LukeExistingGarmentBakeReceiver"
bpy.context.collection.objects.link(receiver)
receiver.parent = None
receiver.animation_data_clear()
receiver.modifiers.clear()
bm = bmesh.new()
bm.from_mesh(receiver.data)
bm.faces.ensure_lookup_table()
source_polygons = list(mesh.data.polygons)
remove = []
for face in bm.faces:
    center = face.calc_center_median()
    forced_mark = (center.y > 0.02 and abs(center.x) < 0.35 and
                   (1.16 < center.z < 1.58 or 0.68 < center.z < 1.08))
    if not forced_mark and not is_garment(mesh, source_polygons[face.index]):
        remove.append(face)
bmesh.ops.delete(bm, geom=remove, context="FACES")
bm.to_mesh(receiver.data)
bm.free()
garment_polygons = len(receiver.data.polygons)
if garment_polygons < 1000:
    raise RuntimeError(f"Garment face selection unexpectedly small: {garment_polygons}")

target_image = original_image.copy()
target_image.name = "LukeReplacementUniform"
target_image.scale(1024, 1024)
bake_material = bpy.data.materials.new("LukeReplacementUniformBakeTarget")
bake_material.use_nodes = True
nodes = bake_material.node_tree.nodes
nodes.clear()
output = nodes.new("ShaderNodeOutputMaterial")
emission = nodes.new("ShaderNodeEmission")
uniform_render = bpy.data.images.load(str(uniform_render_path), check_existing=False)
uniform_render.colorspace_settings.name = "sRGB"
uniform_tex = nodes.new("ShaderNodeTexImage")
uniform_tex.image = uniform_render
uniform_tex.interpolation = "Linear"
projection = receiver.data.uv_layers.get("UniformRenderProjection") or receiver.data.uv_layers.new(
    name="UniformRenderProjection")
for poly in receiver.data.polygons:
    front = poly.center.y > 0
    u_min, u_max = (0.155, 0.455) if front else (0.545, 0.845)
    for loop_index in poly.loop_indices:
        vertex = receiver.data.vertices[receiver.data.loops[loop_index].vertex_index].co
        if poly.center.z > 1.45:
            # The supplied kit is sleeveless while Luke's source clothing is fused
            # into a short-sleeve/yoke silhouette. Its corresponding projection is
            # empty background, so sample a clean green fabric area from the same
            # supplied front/back panel for this irreducibly different geometry.
            # A tiny spread avoids a visibly single-color patch without importing
            # logos or background into the yoke.
            u = (0.345 if front else 0.700) + vertex.x * 0.025
            v = 0.585 + (vertex.z - 1.45) * 0.025
        else:
            horizontal = max(0.0, min(1.0, (vertex.x + 0.36) / 0.72))
            u = u_max - horizontal * (u_max - u_min)
            v = 0.185 + max(0.0, min(1.0, (vertex.z - 0.66) / 1.06)) * 0.735
        projection.data[loop_index].uv = (u, v)
uv_node = nodes.new("ShaderNodeUVMap")
uv_node.uv_map = projection.name
target_node = nodes.new("ShaderNodeTexImage")
target_node.image = target_image
bake_material.node_tree.links.new(uv_node.outputs["UV"], uniform_tex.inputs["Vector"])
bake_material.node_tree.links.new(uniform_tex.outputs["Color"], emission.inputs["Color"])
bake_material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
nodes.active = target_node
receiver.data.materials.clear()
receiver.data.materials.append(bake_material)

source.hide_render = True
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 1
scene.render.bake.use_selected_to_active = False
scene.render.bake.use_clear = False
scene.render.bake.margin = 4
bpy.ops.object.select_all(action="DESELECT")
receiver.select_set(True)
bpy.context.view_layer.objects.active = receiver
bpy.ops.object.bake(type="EMIT")

atlas_path = out_blend.with_name("luke-player-v2-uniform-atlas.jpg")
target_image.filepath_raw = str(atlas_path)
target_image.file_format = "JPEG"
target_image.save()
baked_image = bpy.data.images.load(str(atlas_path), check_existing=False)
baked_image.name = "LukeReplacementUniformAtlas"
baked_image.pack()
final_material = bpy.data.materials.new("LukeReplacementUniform")
final_material.use_nodes = True
principled = final_material.node_tree.nodes.get("Principled BSDF")
final_tex = final_material.node_tree.nodes.new("ShaderNodeTexImage")
final_tex.image = baked_image
final_tex.interpolation = "Closest"
final_material.node_tree.links.new(final_tex.outputs["Color"], principled.inputs["Base Color"])
principled.inputs["Roughness"].default_value = 0.72
mesh.data.materials.clear()
mesh.data.materials.append(final_material)
for poly in mesh.data.polygons:
    poly.material_index = 0

for obj in [receiver, *imported]:
    if obj and obj.name in bpy.data.objects:
        bpy.data.objects.remove(obj, do_unlink=True)
rig["uniform_source_sha256"] = "6e2eebe0d508f4c9e943e8b9aca2b3ee9246d360cc83e71a6d9222f3c0a12d96"
rig["uniform_transfer"] = "front/back projection from inspected source render onto unchanged fused Luke garment geometry"
rig["source_appearance_preserved"] = True
out_blend.parent.mkdir(parents=True, exist_ok=True)
out_glb.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out_blend))

for bone in rig.pose.bones:
    bone.location = (0, 0, 0)
    bone.rotation_mode = "XYZ"
    bone.rotation_euler = (0, 0, 0)
    bone.scale = (1, 1, 1)
scene.frame_set(1)
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format="GLB", use_selection=True,
                          export_yup=True, export_animations=False, export_extras=True,
                          export_image_format="AUTO")
print(json.dumps({"source": str(uniform_path), "garmentPolygons": garment_polygons,
                  "totalPolygons": len(mesh.data.polygons), "vertices": len(mesh.data.vertices),
                  "bones": len(rig.data.bones), "blend": str(out_blend), "glb": str(out_glb)}))
