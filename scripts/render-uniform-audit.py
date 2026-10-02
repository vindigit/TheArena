"""Render close front/back uniform checks from the editable Luke blend."""
from pathlib import Path
import argparse
import sys

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
scene = bpy.context.scene
rig = next(obj for obj in scene.objects if obj.type == "ARMATURE")
if len(rig.data.bones) != 22:
    raise RuntimeError("Expected exact 22-bone Luke rig")
camera_data = bpy.data.cameras.new("UniformAuditCamera")
camera = bpy.data.objects.new("UniformAuditCamera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.lens = 68
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.render.resolution_x = 720
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
out = Path(options.out).resolve()
out.mkdir(parents=True, exist_ok=True)
for frame, pose in ((1, "rest"), (10, "arms-up"), (20, "squat"), (40, "twist")):
    scene.frame_set(frame)
    for side, location in (("front", (0, -4.15, 1.18)), ("back", (0, 4.15, 1.18))):
        camera.location = location
        camera.rotation_euler = ((Vector((0, 0, 1.16)) - camera.location).to_track_quat("-Z", "Y")).to_euler()
        scene.render.filepath = str(out / f"luke-uniform-{pose}-{side}.png")
        bpy.ops.render.render(write_still=True)
print(f"Rendered uniform audit to {out}")
