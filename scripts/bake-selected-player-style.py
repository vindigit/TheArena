"""Blender authoring/baking only. Execute through the Blender MCP bridge.
MODE='bake' rebuilds its own R4 scene; MODE='render' records REVIEW_POSES.
Recovery inputs and other Blender scenes are never edited.
"""
import bpy, bmesh, math, json, struct
from pathlib import Path
from mathutils import Vector, Quaternion

BASE = Path(globals().get('PROJECT_ROOT', Path.cwd())).resolve()
if not (BASE / 'PROJECT.md').is_file():
    raise RuntimeError('Run Blender from the repository root or set PROJECT_ROOT')
SCENE = 'TheArena-Selected-PS2-Style-R4'

def author_and_bake():
    previous = bpy.data.scenes['TheArena-Neutral-Structural-Rig']
    scene = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
    for obj in list(scene.objects):
        if len(obj.users_scene) != 1:
            raise RuntimeError('Refusing to edit shared scene objects')
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.window.scene = scene
    scene.world = previous.world.copy()
    bpy.ops.import_scene.gltf(filepath=str(BASE / 'art/player-rebuild/selected-player-style-authoring.glb'))
    mesh = next(o for o in scene.objects if o.type == 'MESH')
    armature = next(o for o in scene.objects if o.type == 'ARMATURE')
    mesh.name = 'Selected-R4-Mesh'; armature.name = 'Selected-R4-Anatomical-26'
    mesh['revision'] = 4; armature['motionConnected'] = False
    for modifier in mesh.modifiers:
        if modifier.type == 'ARMATURE': modifier.use_deform_preserve_volume = True
    armature.show_in_front = True
    source_image = bpy.data.images.load(str(BASE / 'art/player-rebuild/selected-player-source-diffuse.jpg'), check_existing=True)
    source_image.name = 'Selected-source-diffuse-2048'
    source_image.use_fake_user = True
    shell = mesh.data.attributes.new('ShortsShell', type='FLOAT', domain='POINT')
    style=json.loads((BASE/'art/player-rebuild/selected-player-style.json').read_text())
    origins=style['authoringVertexOrigins']
    assert len(mesh.data.vertices) == len(origins)
    data=(BASE/'art/player-rebuild/selected-player-style-authoring.glb').read_bytes()
    json_length=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+json_length])
    accessor=doc['accessors'][doc['meshes'][0]['primitives'][0]['attributes']['POSITION']]
    view=doc['bufferViews'][accessor['bufferView']];position_offset=20+json_length+8+view['byteOffset']
    for i,vertex in enumerate(mesh.data.vertices):
        p=struct.unpack_from('<3f',data,position_offset+origins[i]*12)
        assert (vertex.co-Vector((p[0],-p[2],p[1]))).length<1e-6,'Authoring vertex map differs from GLB'
    for i, value in enumerate(shell.data): value.value = float(origins[i] >= 4211)
    assert len(mesh.data.uv_layers) == 2
    mesh.data.uv_layers.active_index = 0
    mesh.data.uv_layers[0].active_render = True
    source_uv_name = mesh.data.uv_layers[1].name
    for o in scene.objects:o.select_set(False)
    # Weld only a temporary UV helper. Keep the weighted authoring mesh and its
    # source UV seams intact; use the helper's coherent surface for packing.
    helper=bpy.data.objects.new('R4-UV-packing-helper',mesh.data.copy());scene.collection.objects.link(helper)
    original_corner=helper.data.attributes.new('ReviewCorner',type='INT',domain='CORNER')
    for i,value in enumerate(original_corner.data):value.value=i
    bm=bmesh.new();bm.from_mesh(helper.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
    bm.to_mesh(helper.data);bm.free()
    helper.select_set(True);bpy.context.view_layer.objects.active=helper
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(75),island_margin=.010,area_weight=.75,scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    def position_key(p):return tuple(round(v,6) for v in p)
    def face_key(data,polygon):return tuple(sorted(position_key(data.vertices[i].co) for i in polygon.vertices))
    face_uvs={face_key(helper.data,p):{position_key(helper.data.vertices[helper.data.loops[i].vertex_index].co):helper.data.uv_layers[0].data[i].uv.copy() for i in p.loop_indices} for p in helper.data.polygons}
    # Fourteen coincident source triangles share the matching helper face's UVs;
    # no faces are removed from the weighted character itself.
    for polygon in mesh.data.polygons:
        matching=face_uvs.get(face_key(mesh.data,polygon))
        if matching is None:raise RuntimeError('UV helper lost a source surface')
        for i in polygon.loop_indices:
            vertex=mesh.data.vertices[mesh.data.loops[i].vertex_index]
            mesh.data.uv_layers[0].data[i].uv=matching[position_key(vertex.co)]
    helper_data=helper.data;bpy.data.objects.remove(helper,do_unlink=True);bpy.data.meshes.remove(helper_data)
    corners=[[origins[loop.vertex_index],float(mesh.data.uv_layers[0].data[loop.index].uv.x),1-float(mesh.data.uv_layers[0].data[loop.index].uv.y)] for loop in mesh.data.loops]
    (BASE/'art/player-rebuild/selected-player-style-uv.json').write_text(json.dumps({'geometryHash':style['geometryHash'],'corners':corners}))
    # Sample a real, untattooed upper-arm texel through an image node so the
    # exact source color space is respected for newly exposed armhole skin.
    pixels = list(source_image.pixels)
    w, h = source_image.size
    candidates = []
    for loop in mesh.data.loops:
        p = mesh.data.vertices[loop.vertex_index].co
        if .20 < abs(p.x) < .28 and .75 < p.z < .80:
            uv = mesh.data.uv_layers[1].data[loop.index].uv
            offset = 4 * (min(h-1,max(0,int(uv.y*h))) * w + min(w-1,max(0,int(uv.x*w))))
            color = pixels[offset:offset+3]
            if color[0] > color[2] * 1.3 and .30 < color[0] < .72:
                candidates.append((uv.copy(), color))
    candidates.sort(key=lambda item:sum(item[1]))
    if not candidates: raise RuntimeError('No source skin texel found')
    skin_uv, skin_rgb = candidates[len(candidates)//2]
    mat = bpy.data.materials.new('Selected-R4-Editable-Bake-Shader')
    mat.use_nodes = True; mat.use_fake_user = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links; nodes.clear()
    def node(kind): return nodes.new(kind)
    def plug(value, socket):
        if hasattr(value, 'node'): links.new(value, socket)
        else: socket.default_value = value
    def math_node(operation, a, b=None):
        n = node('ShaderNodeMath'); n.operation = operation
        plug(a,n.inputs[0])
        if b is not None: plug(b,n.inputs[1])
        return n.outputs[0]
    def smooth(a,b,value):
        n=node('ShaderNodeMapRange'); n.interpolation_type='SMOOTHSTEP'; n.clamp=True
        plug(value,n.inputs['Value']);plug(a,n.inputs['From Min']);plug(b,n.inputs['From Max'])
        return n.outputs['Result']
    def gaussian(value,center,width):
        delta=math_node('DIVIDE',math_node('SUBTRACT',value,center),width)
        return math_node('EXPONENT',math_node('MULTIPLY',math_node('MULTIPLY',delta,delta),-1))
    def mix(a,b,factor,blend='MIX'):
        n=node('ShaderNodeMixRGB'); n.blend_type=blend;plug(factor,n.inputs[0]);plug(a,n.inputs[1]);plug(b,n.inputs[2]);return n.outputs[0]
    def multiply(a,b): return math_node('MULTIPLY',a,b)
    geometry=node('ShaderNodeNewGeometry'); xyz=node('ShaderNodeSeparateXYZ');links.new(geometry.outputs['Position'],xyz.inputs[0])
    x,y,z=xyz.outputs; ax=math_node('ABSOLUTE',x)
    uv=node('ShaderNodeUVMap');uv.uv_map=source_uv_name
    texture=node('ShaderNodeTexImage');texture.image=source_image;links.new(uv.outputs['UV'],texture.inputs['Vector'])
    skin=node('ShaderNodeTexImage');skin.image=source_image
    skin_coordinate=node('ShaderNodeCombineXYZ');skin_coordinate.inputs['X'].default_value=skin_uv.x;skin_coordinate.inputs['Y'].default_value=skin_uv.y
    links.new(skin_coordinate.outputs[0],skin.inputs['Vector'])
    threshold=math_node('SUBTRACT',.115,multiply(.028,smooth(.70,.80,z)))
    opening=multiply(smooth(.690,.710,z),math_node('SUBTRACT',1,smooth(.818,.832,z)))
    opening=multiply(opening,math_node('SUBTRACT',1,smooth(.17,.19,ax)))
    cut=multiply(opening,smooth(math_node('SUBTRACT',threshold,.0015),math_node('ADD',threshold,.0015),ax))
    color=mix(texture.outputs['Color'],skin.outputs['Color'],cut)
    trim=multiply(opening,gaussian(ax,threshold,.0025))
    color=mix(color,(.020,.055,.16,1),multiply(trim,.80))
    shell_node=node('ShaderNodeAttribute');shell_node.attribute_name='ShortsShell';shell_factor=shell_node.outputs['Fac']
    hem=.25745 - .1016/(2/.998291015625)
    cloth=(.82,.85,.89,1)
    cloth=mix(cloth,(.018,.045,.14,1),math_node('LESS_THAN',z,hem+.015))
    cloth=mix(cloth,(.46,.018,.022,1),math_node('LESS_THAN',z,hem+.006))
    color=mix(color,cloth,shell_factor)
    # Restrained muscle shadows and collarbone highlight, baked in object space.
    biceps=multiply(gaussian(ax,.225,.047),gaussian(z,.777,.030))
    triceps=multiply(gaussian(ax,.205,.052),gaussian(z,.755,.025))
    collar=multiply(gaussian(ax,.100,.035),gaussian(z,.809,.007))
    muscle=math_node('ADD',math_node('SUBTRACT',1,multiply(biceps,.12)),math_node('SUBTRACT',multiply(collar,.10),multiply(triceps,.08)))
    color=mix(color,muscle,1,'MULTIPLY')
    # Vertical/diagonal fabric folds: texture only after emission baking.
    noise=node('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=22;noise.inputs['Detail'].default_value=2
    links.new(geometry.outputs['Position'],noise.inputs['Vector'])
    wave=math_node('SINE',math_node('ADD',math_node('ADD',multiply(ax,190),multiply(z,15)),multiply(noise.outputs['Fac'],2.2)))
    folds=math_node('POWER',math_node('ABSOLUTE',wave),6)
    jersey=multiply(smooth(.540,.570,z),math_node('SUBTRACT',1,smooth(.775,.805,z)))
    fabric=math_node('MAXIMUM',shell_factor,multiply(jersey,math_node('SUBTRACT',1,cut)))
    crease=math_node('SUBTRACT',1,multiply(multiply(folds,math_node('ADD',.14,multiply(shell_factor,.10))),fabric))
    color=mix(color,crease,1,'MULTIPLY')
    ao=node('ShaderNodeAmbientOcclusion');ao.samples=16;ao.inputs['Distance'].default_value=.035
    ambient=math_node('ADD',.85,multiply(ao.outputs['AO'],.15));color=mix(color,ambient,1,'MULTIPLY')
    emission=node('ShaderNodeEmission');links.new(color,emission.inputs['Color']);output=node('ShaderNodeOutputMaterial');links.new(emission.outputs[0],output.inputs['Surface'])
    image=bpy.data.images.new('Selected-R4-PS2-Diffuse-512',width=512,height=512,alpha=False)
    image.colorspace_settings.name='sRGB';image.use_fake_user=True
    target=node('ShaderNodeTexImage');target.image=image;nodes.active=target;target.select=True
    mesh.data.materials.clear();mesh.data.materials.append(mat)
    for o in scene.objects:o.select_set(False)
    mesh.select_set(True);bpy.context.view_layer.objects.active=mesh
    # Bake with the armature neutral; no actions or clip data are attached.
    scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16
    scene.render.bake.margin=1;scene.render.bake.use_clear=True
    bpy.ops.object.bake(type='EMIT',uv_layer=mesh.data.uv_layers[0].name)
    image.filepath_raw=str(BASE/'art/player-rebuild/selected-player-ps2-diffuse.png');image.file_format='PNG';image.save();image.pack()
    final=bpy.data.materials.new('Selected-R4-One-Diffuse-Material');final.use_nodes=True
    principled=final.node_tree.nodes.get('Principled BSDF');principled.inputs['Roughness'].default_value=.90
    final_texture=final.node_tree.nodes.new('ShaderNodeTexImage');final_texture.image=image
    final.node_tree.links.new(final_texture.outputs['Color'],principled.inputs['Base Color'])
    mesh.data.materials[0]=final
    scene.render.engine='BLENDER_EEVEE'
    scene.render.resolution_x=600;scene.render.resolution_y=700;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform=previous.view_settings.view_transform
    scene.view_settings.look=previous.view_settings.look
    for obj in previous.objects:
        if obj.type=='LIGHT':
            clone=obj.copy();clone.data=obj.data.copy();clone.name='R4-'+obj.name;scene.collection.objects.link(clone)
    cam_data=bpy.data.cameras.new('R4-review-camera');cam=bpy.data.objects.new('R4-review-camera',cam_data);scene.collection.objects.link(cam);scene.camera=cam
    cam.data.type='ORTHO';cam.data.ortho_scale=1.32
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'art/source/player-rebuild/selected-ps2-style-r4.blend'),copy=True)
    return {'scene':scene.name,'vertices':len(mesh.data.vertices),'triangles':len(mesh.data.polygons),'diffuse_size':list(image.size),'skin_texel_rgb':skin_rgb,'skin_texel_uv':list(skin_uv),'normal_map':False,'motionConnected':False}

def render_pose(name):
    scene=bpy.data.scenes[SCENE];bpy.context.window.scene=scene
    armature=bpy.data.objects['Selected-R4-Anatomical-26']
    for bone in armature.pose.bones:bone.rotation_mode='QUATERNION';bone.rotation_quaternion=Quaternion()
    def rotate(name,axis,degrees):
        bone=armature.pose.bones[name];rest=bone.bone.matrix_local.to_quaternion()
        bone.rotation_quaternion=rest.inverted() @ Quaternion(axis,math.radians(degrees)) @ rest
    if name=='relaxed-arms':
        for side,sign in [('l',1),('r',-1)]:
            rotate(side+'humerus',(0,1,0),55*sign);rotate(side+'elbow',(0,1,0),-20*sign)
    if name.startswith('knee-'):rotate('ltibia',(1,0,0),float(name.split('-')[1]))
    cam=scene.camera;cam.location=(2.8,-.18,.50) if name=='neutral-side' else (0,-2.8,.50)
    if name.startswith('knee-'):cam.location=(2.2,-1.8,.50)
    cam.rotation_euler=(Vector((0,0,.50))-cam.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()
    destination=BASE/'art/player-rebuild/review'/f'{name}.png'
    scene.render.filepath=str(destination);bpy.ops.render.render(write_still=True)
    for bone in armature.pose.bones:bone.rotation_quaternion=Quaternion()
    return str(destination)

if globals().get('MODE','bake')=='bake':
    result=author_and_bake()
else:
    result={'renders':[render_pose(name) for name in REVIEW_POSES]}
