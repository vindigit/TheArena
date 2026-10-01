"""Render the five local deformation proof poses from an editable v2 blend."""
from pathlib import Path
import argparse
import sys

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
parser.add_argument("--label", required=True)
options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
scene = bpy.context.scene
rig = next(obj for obj in scene.objects if obj.type == "ARMATURE")
if len(rig.data.bones) != 22 or rig.animation_data is None:
    raise RuntimeError("Expected editable 22-bone proof source")

camera_data = bpy.data.cameras.new("ProofCamera")
camera = bpy.data.objects.new("ProofCamera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = (3.45, 5.4, 2.55)
camera.rotation_euler = ((Vector((0, 0, 1.08)) - camera.location).to_track_quat("-Z", "Y")).to_euler()
camera.data.lens = 56
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "WORLD"
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
out = Path(options.out).resolve()
out.mkdir(parents=True, exist_ok=True)
for frame, name in [(10, "arms-up"), (20, "deep-squat"), (30, "back-arch"), (40, "torso-twist"), (50, "toes-down")]:
    scene.frame_set(frame)
    if frame == 50:
        camera.location = (4.25, 0.15, 1.45)
        camera.rotation_euler = ((Vector((0, 0, 0.95)) - camera.location).to_track_quat("-Z", "Y")).to_euler()
    else:
        camera.location = (3.45, 5.4, 2.55)
        camera.rotation_euler = ((Vector((0, 0, 1.08)) - camera.location).to_track_quat("-Z", "Y")).to_euler()
    scene.render.filepath = str(out / f"{options.label}-{name}.png")
    bpy.ops.render.render(write_still=True)
print(f"Rendered proof poses to {out}")
