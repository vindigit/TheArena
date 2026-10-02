"""Inspect and render the user-supplied uniform GLB without modifying it."""
from pathlib import Path
import argparse
import json
import sys

import bpy
import bmesh
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--out", required=True)
options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(Path(options.input).resolve()))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"Expected one source mesh, found {[obj.name for obj in meshes]}")
mesh = meshes[0]
mesh.data.calc_loop_triangles()
corners = [mesh.matrix_world @ Vector(corner) for corner in mesh.bound_box]
minimum = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
maximum = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
bm = bmesh.new()
bm.from_mesh(mesh.data)
remaining = set(bm.verts)
components = []
while remaining:
    seed = remaining.pop()
    stack, found = [seed], {seed}
    while stack:
        vertex = stack.pop()
        for edge in vertex.link_edges:
            neighbor = edge.other_vert(vertex)
            if neighbor in remaining:
                remaining.remove(neighbor)
                found.add(neighbor)
                stack.append(neighbor)
    points = [mesh.matrix_world @ vertex.co for vertex in found]
    components.append({
        "vertices": len(found),
        "min": [min(point[i] for point in points) for i in range(3)],
        "max": [max(point[i] for point in points) for i in range(3)],
    })
bm.free()

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.render.resolution_x = 720
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
camera_data = bpy.data.cameras.new("InspectionCamera")
camera = bpy.data.objects.new("InspectionCamera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
center = (minimum + maximum) * 0.5
size = max((maximum - minimum))
camera.data.lens = 55
out = Path(options.out).resolve()
out.mkdir(parents=True, exist_ok=True)
source_images = list({node.image for material in mesh.data.materials if material and material.use_nodes
                      for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image})
if len(source_images) == 1:
    source_images[0].save_render(str(out / "uniform-source-atlas.png"))
for name, direction in (("front", Vector((0, -1, 0))), ("back", Vector((0, 1, 0))),
                        ("left", Vector((-1, 0, 0))), ("right", Vector((1, 0, 0)))):
    camera.location = center + direction * size * 2.25 + Vector((0, 0, size * 0.06))
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(out / f"uniform-source-{name}.png")
    bpy.ops.render.render(write_still=True)

print(json.dumps({
    "vertices": len(mesh.data.vertices),
    "triangles": len(mesh.data.loop_triangles),
    "materials": [material.name for material in mesh.data.materials],
    "boundsMin": list(minimum), "boundsMax": list(maximum),
    "dimensions": list(maximum - minimum),
    "connectedComponents": sorted(components, key=lambda item: item["vertices"], reverse=True),
    "objects": [obj.name for obj in bpy.context.scene.objects],
}))
