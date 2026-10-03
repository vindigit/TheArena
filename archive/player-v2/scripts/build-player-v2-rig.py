"""Rebuild an existing 17-bone player GLB onto the staged exact 22-bone rig.

Run in Blender background mode with arguments after ``--``. The input GLB is
never modified; the editable .blend and no-animation GLB are separate outputs.
"""
from pathlib import Path
import argparse
import json
import math
import sys

import bpy
from mathutils import Matrix, Vector


BONES = [
    ("Hips", None, (0, 0, 1.06), (0, 0, 1.14)),
    ("Spine", "Hips", (0, -0.002, 1.14), (0, -0.006, 1.28)),
    ("Spine1", "Spine", (0, -0.006, 1.28), (0, -0.011, 1.43)),
    ("Spine2", "Spine1", (0, -0.011, 1.43), (0, -0.006, 1.70)),
    ("Neck", "Spine2", (0, -0.005, 1.75), (0, 0.005, 1.81)),
    ("Head", "Neck", (0, 0.005, 1.81), (0, 0.005, 2.03)),
    ("LeftShoulder", "Spine2", (-0.08, -0.035, 1.57), (-0.24, -0.05, 1.635)),
    ("LeftArm", "LeftShoulder", (-0.24, -0.05, 1.635), (-0.55, -0.06, 1.625)),
    ("LeftForeArm", "LeftArm", (-0.55, -0.06, 1.625), (-0.885, -0.005, 1.605)),
    ("LeftHand", "LeftForeArm", (-0.885, -0.005, 1.605), (-1.035, 0.0, 1.60)),
    ("RightShoulder", "Spine2", (0.08, -0.035, 1.57), (0.24, -0.05, 1.635)),
    ("RightArm", "RightShoulder", (0.24, -0.05, 1.635), (0.55, -0.06, 1.625)),
    ("RightForeArm", "RightArm", (0.55, -0.06, 1.625), (0.885, -0.005, 1.605)),
    ("RightHand", "RightForeArm", (0.885, -0.005, 1.605), (1.035, 0.0, 1.60)),
    ("LeftUpLeg", "Hips", (-0.15, 0, 1.04), (-0.195, -0.015, 0.61)),
    ("LeftLeg", "LeftUpLeg", (-0.195, -0.015, 0.61), (-0.245, -0.045, 0.17)),
    ("LeftFoot", "LeftLeg", (-0.245, -0.045, 0.17), (-0.245, 0.11, 0.07)),
    ("LeftToeBase", "LeftFoot", (-0.245, 0.11, 0.07), (-0.245, 0.225, 0.065)),
    ("RightUpLeg", "Hips", (0.15, 0, 1.04), (0.195, -0.015, 0.61)),
    ("RightLeg", "RightUpLeg", (0.195, -0.015, 0.61), (0.245, -0.045, 0.17)),
    ("RightFoot", "RightLeg", (0.245, -0.045, 0.17), (0.245, 0.11, 0.07)),
    ("RightToeBase", "RightFoot", (0.245, 0.11, 0.07), (0.245, 0.225, 0.065)),
]
SOURCE_DIRECT = {
    "neck": "Neck", "head": "Head",
    "left_forearm": "LeftForeArm", "left_hand": "LeftHand",
    "right_forearm": "RightForeArm", "right_hand": "RightHand",
    "left_shin": "LeftLeg", "right_shin": "RightLeg",
}


def args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--blend", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--character", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


def clear_scene():
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.armatures, bpy.data.meshes, bpy.data.actions):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def source_weights(mesh):
    result = []
    for vertex in mesh.data.vertices:
        result.append({mesh.vertex_groups[g.group].name: g.weight for g in vertex.groups})
    return result


def distribution(name, weight, co):
    if name in ("root", "pelvis"):
        return {"Hips": weight}
    if name == "chest":
        z = co.z
        if z <= 1.23:
            return {"Spine": weight}
        if z < 1.36:
            t = (z - 1.23) / 0.13
            return {"Spine": weight * (1 - t), "Spine1": weight * t}
        if z < 1.52:
            t = (z - 1.36) / 0.16
            return {"Spine1": weight * (1 - t), "Spine2": weight * t}
        if abs(co.x) > 0.12 and z > 1.48:
            shoulder = max(0.0, min(0.58, (abs(co.x) - 0.12) / 0.22 * 0.58))
            side = "LeftShoulder" if co.x < 0 else "RightShoulder"
            return {"Spine2": weight * (1 - shoulder), side: weight * shoulder}
        return {"Spine2": weight}
    if name in ("left_upper_arm", "right_upper_arm"):
        side = "Left" if name.startswith("left") else "Right"
        shoulder_distance = max(0.0, abs(co.x) - 0.19)
        shoulder = max(0.0, min(0.72, 0.72 * (1 - shoulder_distance / 0.25)))
        return {side + "Shoulder": weight * shoulder, side + "Arm": weight * (1 - shoulder)}
    if name in ("left_thigh", "right_thigh"):
        side = "Left" if name.startswith("left") else "Right"
        # Keep the upper baggy-short volume with the pelvis while letting the
        # lower thigh follow the leg into a deep squat.
        hips = max(0.0, min(0.62, (co.z - 0.80) / 0.25 * 0.62))
        return {"Hips": weight * hips, side + "UpLeg": weight * (1 - hips)}
    if name in ("left_foot", "right_foot"):
        side = "Left" if name.startswith("left") else "Right"
        # A broad overlap band avoids a single rigid shoe hinge.
        toe = max(0.0, min(0.78, (co.y + 0.015) / 0.22))
        return {side + "ToeBase": weight * toe, side + "Foot": weight * (1 - toe)}
    target = SOURCE_DIRECT.get(name)
    return {target: weight} if target else {}


def create_rig(mesh, weights, character):
    old_rig = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    for modifier in list(mesh.modifiers):
        if modifier.type == "ARMATURE":
            mesh.modifiers.remove(modifier)
    mesh.parent = None
    if old_rig:
        bpy.data.objects.remove(old_rig, do_unlink=True)
    armature = bpy.data.armatures.new(character + "_Rig")
    rig = bpy.data.objects.new(character + "_Rig", armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head, tail in BONES:
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        bone.parent = armature.edit_bones.get(parent) if parent else None
        bone.use_connect = False
        bone.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    for group in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(group)
    groups = {name: mesh.vertex_groups.new(name=name) for name, *_ in BONES}
    for vertex, original in zip(mesh.data.vertices, weights):
        assigned = {}
        for source, weight in original.items():
            for target, amount in distribution(source, weight, vertex.co).items():
                assigned[target] = assigned.get(target, 0) + amount
        total = sum(assigned.values())
        if total <= 1e-8:
            raise RuntimeError(f"Unweighted vertex {vertex.index}; source groups {original}")
        for target, amount in assigned.items():
            if amount > 1e-7:
                groups[target].add([vertex.index], amount / total, "REPLACE")
    mesh.parent = rig
    modifier = mesh.modifiers.new("PlayerV2 Skin", "ARMATURE")
    modifier.object = rig
    rig.show_in_front = True
    return rig


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)


def proof_action(rig):
    action = bpy.data.actions.new("RigProofPoses")
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    poses = {
        1: {},
        10: {},
        20: {"Hips": (0, 0, 0), "LeftUpLeg": (math.radians(-62), 0, math.radians(-8)),
             "RightUpLeg": (math.radians(-62), 0, math.radians(8)), "LeftLeg": (math.radians(105), 0, 0),
             "RightLeg": (math.radians(105), 0, 0), "LeftFoot": (math.radians(-42), 0, 0),
             "RightFoot": (math.radians(-42), 0, 0)},
        30: {"Spine": (math.radians(10), 0, 0), "Spine1": (math.radians(12), 0, 0),
             "Spine2": (math.radians(14), 0, 0)},
        40: {"Spine": (0, math.radians(10), 0), "Spine1": (0, math.radians(18), 0),
             "Spine2": (0, math.radians(22), 0)},
        50: {"LeftToeBase": (math.radians(-38), 0, 0), "RightToeBase": (math.radians(-38), 0, 0)},
    }
    for frame, rotations in poses.items():
        reset_pose(rig)
        if frame == 20:
            rig.pose.bones["Hips"].location.z = -0.34
        for name, rotation in rotations.items():
            rig.pose.bones[name].rotation_euler = rotation
        if frame == 10:
            for name, angle in (("LeftShoulder", math.radians(88)), ("RightShoulder", math.radians(-88))):
                pose_bone = rig.pose.bones[name]
                pivot = pose_bone.bone.head_local
                pose_bone.matrix = (Matrix.Translation(pivot) @ Matrix.Rotation(angle, 4, "Y") @
                                    Matrix.Translation(-pivot) @ pose_bone.bone.matrix_local)
        for bone in rig.pose.bones:
            bone.keyframe_insert("location", frame=frame, group=bone.name)
            bone.keyframe_insert("rotation_euler", frame=frame, group=bone.name)
            bone.keyframe_insert("scale", frame=frame, group=bone.name)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 50
    bpy.context.scene.frame_set(1)


def save_and_export(mesh, rig, blend_path, glb_path, character):
    scene = bpy.context.scene
    scene.name = character + "_V2"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    mesh.name = character + "_Mesh"
    rig["rig_contract"] = "game-humanoid-v2"
    rig["source_appearance_preserved"] = True
    rig["game_axes_corrected"] = True
    for image in bpy.data.images:
        if image.source != "VIEWER":
            try:
                image.pack()
            except RuntimeError:
                pass
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    reset_pose(rig)
    scene.frame_set(1)
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", use_selection=True,
                              export_yup=True, export_animations=False, export_extras=True,
                              export_image_format="AUTO")
    print(json.dumps({"blend": str(blend_path), "glb": str(glb_path), "bones": len(rig.data.bones),
                      "vertices": len(mesh.data.vertices), "triangles": len(mesh.data.loop_triangles)}))


options = args()
clear_scene()
bpy.ops.import_scene.gltf(filepath=str(Path(options.input).resolve()))
all_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
meshes = [obj for obj in all_meshes if len(obj.vertex_groups) >= 17 and
          any(modifier.type == "ARMATURE" for modifier in obj.modifiers)]
if len(meshes) != 1:
    raise RuntimeError(f"Expected one skinned source mesh, found {len(meshes)} from {[obj.name for obj in all_meshes]}")
mesh = meshes[0]
for unused in [obj for obj in all_meshes if obj != mesh]:
    bpy.data.objects.remove(unused, do_unlink=True)
mesh.data.calc_loop_triangles()
weights = source_weights(mesh)
rig = create_rig(mesh, weights, options.character)
proof_action(rig)
save_and_export(mesh, rig, Path(options.blend).resolve(), Path(options.glb).resolve(), options.character)
