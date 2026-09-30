import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A compact PS2-style basketball arena with an authored shell and fallback.
 *
 * Coordinates use X for court width, Y for height, and Z for court length.
 * The playable half court faces the basket at negative Z.  Keep `group` at
 * the world origin to use the positions in the returned `hoop` object as
 * world-space gameplay coordinates.
 */
export function createArena(THREE) {
  if (!THREE) {
    throw new Error("createArena requires the Three.js namespace.");
  }

  const group = new THREE.Group();
  group.name = "PS2 Basketball Arena";
  const shellFallback = new THREE.Group();
  shellFallback.name = 'procedural arena shell fallback';
  group.add(shellFallback);
  let environmentParent = group;

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const court = {
    width: 15.2,
    depth: 14,
    halfWidth: 7.6,
    baselineZ: -7,
    halfCourtZ: 7,
    floorY: 0,
    keyWidth: 4.9,
    keyLength: 5.8,
    bounds: { minX: -7.6, maxX: 7.6, minZ: -7, maxZ: 7 },
  };

  // These values are deliberately exposed so shot and collision code does
  // not need to infer dimensions from the decorative meshes.
  const hoop = {
    rimCenter: V(0, 3.05, -5.82),
    target: V(0, 3.05, -5.82),
    rimRadius: 0.23,
    rimDiameter: 0.46,
    rimHeight: 3.05,
    rimNormal: V(0, 1, 0),
    rimPlaneNormal: V(0, 1, 0),
    approachDirection: V(0, 0, 1),
    backboardNormal: V(0, 0, 1),
    backboardCenter: V(0, 3.56, -6.25),
    backboardWidth: 1.83,
    backboardHeight: 1.07,
    backboardThickness: 0.08,
    backboardBottom: 3.025,
    backboardFrontZ: -6.21,
    ballRadius: 0.12,
  };

  const materials = {
    concrete: new THREE.MeshStandardMaterial({ color: 0x151824, roughness: 0.94, metalness: 0.05 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x28233e, roughness: 0.74, metalness: 0.2 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x171827, roughness: 0.42, metalness: 0.78 }),
    paintedMetal: new THREE.MeshStandardMaterial({ color: 0x342654, roughness: 0.48, metalness: 0.48 }),
    courtEdge: new THREE.MeshStandardMaterial({ color: 0x57341f, roughness: 0.6, metalness: 0.05 }),
    line: new THREE.MeshStandardMaterial({ color: 0xf0d9a8, roughness: 0.46, metalness: 0.08 }),
    paint: new THREE.MeshStandardMaterial({ color: 0x2b2157, roughness: 0.52, metalness: 0.05 }),
    paintAccent: new THREE.MeshStandardMaterial({ color: 0x5a3d9a, roughness: 0.48, metalness: 0.1 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xd65b27, roughness: 0.36, metalness: 0.5 }),
    net: new THREE.LineBasicMaterial({ color: 0xded9c4, transparent: true, opacity: 0.9 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x9fc9dc,
      roughness: 0.18,
      metalness: 0.2,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
    }),
    white: new THREE.MeshStandardMaterial({ color: 0xf4eee1, roughness: 0.4, metalness: 0.1 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x252143, roughness: 0.82, metalness: 0.06 }),
    screen: new THREE.MeshStandardMaterial({
      color: 0x26144a,
      emissive: 0x180733,
      emissiveIntensity: 1.8,
      roughness: 0.35,
    }),
    clock: new THREE.MeshStandardMaterial({
      color: 0x4c0d0d,
      emissive: 0x8f1010,
      emissiveIntensity: 2.5,
      roughness: 0.3,
    }),
    light: new THREE.MeshStandardMaterial({
      color: 0xfff1bf,
      emissive: 0xffd77a,
      emissiveIntensity: 3.2,
      roughness: 0.3,
    }),
  };

  // The shell GLB shares these three materials across the foundation, walls,
  // upper wall, and ceiling. Keep its authored colors until the map is ready.
  const shellConcreteTints = {
    foundation: 0xbac4d4,
    wall: 0x9baac2,
    wallShade: 0x8998af,
  };
  const shellConcreteMaterials = new Set();
  let concreteTexture = null;
  const applyConcreteMaterial = (material, tint) => {
    material.map = concreteTexture;
    material.color.setHex(tint);
    material.needsUpdate = true;
  };
  const shellMetalMaterials = new Set();
  let metalTexture = null;
  const applyShellMetalMaterial = (material) => {
    material.map = metalTexture;
    material.color.setHex(0xffffff);
    material.needsUpdate = true;
  };
  const shellSeatingSurfaces = [];
  let seatingTexture = null;
  let seatingPlatformMap = null;
  let seatingRiserMap = null;
  const applySeatingMaterial = (material, map, tint) => {
    material.map = map;
    material.color.setHex(tint);
    material.needsUpdate = true;
  };
  const applyShellSeatingSurface = (mesh, kind) => {
    const material = mesh.material.clone();
    applySeatingMaterial(material, kind === 'platform' ? seatingPlatformMap : seatingRiserMap,
      kind === 'platform' ? 0xffffff : 0xc8c7dc);
    mesh.material = material;
  };

  const boardMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x92562e, roughness: 0.5, metalness: 0.04 }),
    new THREE.MeshStandardMaterial({ color: 0xa96737, roughness: 0.48, metalness: 0.04 }),
    new THREE.MeshStandardMaterial({ color: 0x7e4829, roughness: 0.56, metalness: 0.03 }),
  ];

  function addBox(width, height, depth, material, position, name, parent = environmentParent) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.copy(position);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function addCylinderBetween(start, end, radius, material, name, parent = group, radialSegments = 8) {
    const direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments),
      material,
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), direction.normalize());
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function addArc(center, radius, startAngle, endAngle, thickness, material, name) {
    const points = [];
    const segments = Math.max(12, Math.ceil((Math.abs(endAngle - startAngle) / Math.PI) * 36));
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const angle = THREE.MathUtils.lerp(startAngle, endAngle, t);
      points.push(V(
        center.x + Math.cos(angle) * radius,
        center.y,
        center.z + Math.sin(angle) * radius,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segments, thickness, 6, false),
      material,
    );
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function addLineBox(width, depth, x, z, name) {
    return addBox(width, 0.026, depth, materials.line, V(x, 0.102, z), name);
  }

  // Floor, parquet strips, and painted half-court surface.
  addBox(23, 0.38, 23, materials.concrete, V(0, -0.21, 0), "arena foundation", shellFallback);
  addBox(court.width + 0.5, 0.075, court.depth + 0.5, materials.courtEdge, V(0, 0, 0), "court edge");

  const plankWidth = court.width / 16;
  for (let i = 0; i < 16; i += 1) {
    const x = -court.halfWidth + plankWidth * (i + 0.5);
    const plank = addBox(
      plankWidth - 0.012,
      0.021,
      court.depth - 0.16,
      boardMaterials[i % boardMaterials.length],
      V(x, 0.054, 0),
      `parquet plank ${i + 1}`,
    );

    // Each strip samples a different part of the shared texture. This keeps
    // knots and grain from lining up across all sixteen procedural planks.
    const uv = plank.geometry.getAttribute('uv');
    const offsetU = (i * 0.37) % 1;
    const offsetV = (i * 0.19) % 1;
    for (let vertex = 0; vertex < uv.count; vertex += 1) {
      uv.setXY(vertex, uv.getX(vertex) * 0.64 + offsetU, uv.getY(vertex) + offsetV);
    }
    uv.needsUpdate = true;
  }

  // Keep the procedural colors visible while loading, and on any load error.
  // Court markings and all gameplay coordinates remain independent of this map.
  group.userData.courtWoodStatus = 'loading';
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}assets/textures/court/wood-v1.webp`,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 2;
      const plankTints = [0xffffff, 0xf2e3cf, 0xe8d0b3];
      boardMaterials.forEach((material, index) => {
        material.map = texture;
        material.color.setHex(plankTints[index]);
        material.roughness = 0.72;
        material.needsUpdate = true;
      });
      group.userData.courtWoodStatus = 'ready';
    },
    undefined,
    () => { group.userData.courtWoodStatus = 'fallback'; },
  );

  // One opaque color map serves the concrete surfaces in either arena shell.
  // Their original flat colors remain the loading and error fallback.
  group.userData.concreteStatus = 'loading';
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}assets/textures/concrete/concrete-v1.webp`,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(4, 4);
      texture.anisotropy = 2;
      concreteTexture = texture;
      applyConcreteMaterial(materials.concrete, 0xaeb8c8);
      for (const material of shellConcreteMaterials) {
        applyConcreteMaterial(material, shellConcreteTints[material.name]);
      }
      group.userData.concreteStatus = 'ready';
    },
    undefined,
    () => { group.userData.concreteStatus = 'fallback'; },
  );

  // One painted-steel color map serves the procedural metal and authored trim.
  // Keep every original flat material until it loads, or if it fails.
  group.userData.metalStatus = 'loading';
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}assets/textures/metal/painted-metal-v1.webp`,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 2;
      metalTexture = texture;
      for (const [material, tint] of [
        [materials.trim, 0xffffff],
        [materials.darkMetal, 0xd3d4e0],
        [materials.paintedMetal, 0xffffff],
      ]) {
        material.map = texture;
        material.color.setHex(tint);
        material.roughness = 0.76;
        material.metalness = 0.28;
        material.needsUpdate = true;
      }
      for (const material of shellMetalMaterials) applyShellMetalMaterial(material);

      // The optional authored hoop uses a 4 x 2 atlas. Remap only its support
      // and arm materials; board, padding, rim, net and markings keep the atlas.
      group.userData.hoopAssetReady?.then((status) => {
        if (status !== 'ready') return;
        const support = basketGroup.getObjectByName('support');
        const arm = basketGroup.getObjectByName('arm');
        if (!support?.isMesh || !arm?.isMesh) return;
        const hoopMap = texture.clone();
        hoopMap.repeat.set(4, 2);
        hoopMap.flipY = false;
        hoopMap.needsUpdate = true;
        const hoopMaterial = support.material.clone();
        hoopMaterial.map = hoopMap;
        hoopMaterial.emissiveMap = null;
        hoopMaterial.color.setHex(0xffffff);
        hoopMaterial.emissive.setHex(0x0a0812);
        hoopMaterial.roughness = 0.76;
        hoopMaterial.metalness = 0.28;
        hoopMaterial.needsUpdate = true;
        support.material = hoopMaterial;
        arm.material = hoopMaterial;
      });
      group.userData.metalStatus = 'ready';
    },
    undefined,
    () => { group.userData.metalStatus = 'fallback'; },
  );

  const keyCenterZ = court.baselineZ + court.keyLength / 2;
  addBox(court.keyWidth, 0.024, court.keyLength, materials.paint, V(0, 0.082, keyCenterZ), "painted key");
  addBox(1.12, 0.026, 0.72, materials.paintAccent, V(0, 0.096, -6.15), "painted key accent");

  // Court boundary and lane markings.
  addLineBox(0.055, court.depth, -court.halfWidth + 0.02, 0, "left sideline");
  addLineBox(0.055, court.depth, court.halfWidth - 0.02, 0, "right sideline");
  addLineBox(court.width, 0.055, 0, court.baselineZ + 0.02, "baseline");
  addLineBox(court.width, 0.055, 0, court.halfCourtZ - 0.02, "half court line");
  addLineBox(0.055, court.keyLength, -court.keyWidth / 2, keyCenterZ, "left lane line");
  addLineBox(0.055, court.keyLength, court.keyWidth / 2, keyCenterZ, "right lane line");
  addLineBox(court.keyWidth, 0.055, 0, court.baselineZ + court.keyLength, "free throw line");

  const freeThrowCenter = V(0, 0.102, court.baselineZ + court.keyLength);
  addArc(freeThrowCenter, 1.8, 0, Math.PI * 2, 0.035, materials.line, "free throw circle");

  // Three-point geometry is centered on the basket, with short corner lines.
  const threeRadius = 6.65;
  const threeStart = -0.18;
  const threeEnd = Math.PI + 0.18;
  addArc(V(0, 0.102, hoop.rimCenter.z), threeRadius, threeStart, threeEnd, 0.04, materials.line, "three point arc");
  const cornerX = Math.cos(threeStart) * threeRadius;
  const cornerZ = hoop.rimCenter.z + Math.sin(threeStart) * threeRadius;
  addLineBox(0.05, Math.abs(cornerZ - court.baselineZ), cornerX, (cornerZ + court.baselineZ) / 2, "right corner three line");
  addLineBox(0.05, Math.abs(cornerZ - court.baselineZ), -cornerX, (cornerZ + court.baselineZ) / 2, "left corner three line");
  addArc(V(0, 0.103, hoop.rimCenter.z), 1.25, 0, Math.PI, 0.032, materials.line, "restricted area arc");
  addArc(V(0, 0.102, court.halfCourtZ), 1.8, Math.PI, Math.PI * 2, 0.032, materials.line, "mid-court semicircle");

  for (const x of [-court.keyWidth / 2, court.keyWidth / 2]) {
    for (const z of [-5.86, -4.62, -3.38, -2.14]) {
      addLineBox(0.23, 0.045, x + (x < 0 ? -0.09 : 0.09), z, "lane hash");
    }
  }

  // The original basket stays visible until the named hoop asset passes
  // validation. Its collision dimensions above never depend on either mesh.
  const basketGroup = new THREE.Group();
  basketGroup.name = "basket assembly";
  group.add(basketGroup);
  const basketFallback = new THREE.Group();
  basketFallback.name = 'procedural basket assembly fallback';
  basketGroup.add(basketFallback);

  const base = addBox(1.65, 0.42, 1.75, materials.paintedMetal, V(0, 0.21, -7.85), "basket base", basketFallback);
  addBox(1.82, 0.28, 0.68, materials.paintAccent, V(0, 0.4, -7.12), "basket base pad", basketFallback);
  addCylinderBetween(V(0, 0.4, -7.82), V(0, 4.72, -7.82), 0.145, materials.darkMetal, "basket stanchion", basketFallback, 10);
  addCylinderBetween(V(0, 4.55, -7.82), V(0, 4.55, -6.4), 0.105, materials.darkMetal, "backboard arm", basketFallback, 8);
  addCylinderBetween(V(0, 4.55, -6.4), V(0, 3.84, -6.29), 0.075, materials.darkMetal, "backboard brace", basketFallback, 8);
  base.userData.isBasketSupport = true;

  const backboard = addBox(
    hoop.backboardWidth,
    hoop.backboardHeight,
    hoop.backboardThickness,
    materials.glass,
    hoop.backboardCenter,
    "backboard",
    basketFallback,
  );
  backboard.castShadow = false;
  backboard.userData.isBackboard = true;

  const boardFrontZ = hoop.backboardCenter.z + hoop.backboardThickness / 2 + 0.013;
  const borderThickness = 0.055;
  const boardTop = hoop.backboardCenter.y + hoop.backboardHeight / 2;
  const boardBottom = hoop.backboardCenter.y - hoop.backboardHeight / 2;
  addBox(hoop.backboardWidth + 0.08, borderThickness, 0.035, materials.white, V(0, boardTop, boardFrontZ), "backboard top border", basketFallback);
  addBox(hoop.backboardWidth + 0.08, borderThickness, 0.035, materials.white, V(0, boardBottom, boardFrontZ), "backboard bottom border", basketFallback);
  addBox(borderThickness, hoop.backboardHeight + 0.08, 0.035, materials.white, V(-hoop.backboardWidth / 2, hoop.backboardCenter.y, boardFrontZ), "backboard left border", basketFallback);
  addBox(borderThickness, hoop.backboardHeight + 0.08, 0.035, materials.white, V(hoop.backboardWidth / 2, hoop.backboardCenter.y, boardFrontZ), "backboard right border", basketFallback);
  addBox(0.62, 0.045, 0.035, materials.white, V(0, 3.32, boardFrontZ), "backboard target top", basketFallback);
  addBox(0.045, 0.44, 0.035, materials.white, V(-0.31, 3.11, boardFrontZ), "backboard target left", basketFallback);
  addBox(0.045, 0.44, 0.035, materials.white, V(0.31, 3.11, boardFrontZ), "backboard target right", basketFallback);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(hoop.rimRadius, 0.026, 7, 24), materials.rim);
  rim.name = "rim";
  rim.rotation.x = Math.PI / 2;
  rim.position.copy(hoop.rimCenter);
  rim.castShadow = true;
  rim.receiveShadow = true;
  rim.userData.isRim = true;
  basketFallback.add(rim);
  addCylinderBetween(V(0, 3.05, boardFrontZ), V(0, 3.05, hoop.rimCenter.z), 0.035, materials.rim, "rim mount", basketFallback, 8);

  const netGroup = new THREE.Group();
  netGroup.name = "net";
  const netVertices = [];
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const nextAngle = angle + 0.21;
    const top = V(
      Math.cos(angle) * (hoop.rimRadius - 0.025),
      hoop.rimHeight - 0.022,
      hoop.rimCenter.z + Math.sin(angle) * (hoop.rimRadius - 0.025),
    );
    const bottom = V(
      Math.cos(nextAngle) * 0.11,
      2.54,
      hoop.rimCenter.z + Math.sin(nextAngle) * 0.11,
    );
    netVertices.push(top.x, top.y, top.z, bottom.x, bottom.y, bottom.z);
  }
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute("position", new THREE.Float32BufferAttribute(netVertices, 3));
  const netLines = new THREE.LineSegments(netGeometry, materials.net);
  netLines.name = "net strings";
  netGroup.add(netLines);

  for (const [radius, y] of [[0.19, 2.88], [0.145, 2.7], [0.105, 2.55]]) {
    const ringPoints = [];
    for (let i = 0; i <= 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      ringPoints.push(V(Math.cos(angle) * radius, y, hoop.rimCenter.z + Math.sin(angle) * radius));
    }
    const ringGeometry = new THREE.BufferGeometry().setFromPoints(ringPoints);
    netGroup.add(new THREE.Line(ringGeometry, materials.net));
  }
  basketGroup.add(netGroup);

  hoop.rim = rim;
  hoop.backboard = backboard;
  hoop.net = netGroup;
  hoop.support = basketGroup;

  // Preserve the same hoop.rim, hoop.backboard, hoop.net and hoop.support
  // object references after loading. Only their presentation geometry changes.
  group.userData.hoopAssetStatus = 'loading';
  group.userData.hoopAssetReady = new GLTFLoader().loadAsync(
    `${import.meta.env.BASE_URL}assets/models/hoop/hoop-assembly-v1.glb`,
  ).then(({ scene: asset, animations }) => {
    const required = ['support', 'padding', 'arm', 'backboard', 'target_markings', 'rim', 'mounts', 'net'];
    const parts = new Map();
    const assetMaterials = new Set();
    let triangles = 0;
    asset.traverse((child) => {
      if (!child.isMesh) return;
      if (parts.has(child.name)) throw new Error(`Duplicate hoop part: ${child.name}`);
      parts.set(child.name, child);
      const geometry = child.geometry;
      triangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
      assetMaterials.add(child.material);
    });
    const boardBounds = new THREE.Box3().setFromObject(parts.get('backboard'));
    const boardSize = boardBounds.getSize(new THREE.Vector3());
    const boardCenter = boardBounds.getCenter(new THREE.Vector3());
    const rimCenter = new THREE.Box3().setFromObject(parts.get('rim')).getCenter(new THREE.Vector3());
    const netBounds = new THREE.Box3().setFromObject(parts.get('net'));
    const close = (actual, expected) => Math.abs(actual - expected) < 0.00001;
    const identity = (object) => object.position.lengthSq() < 1e-12 &&
      Math.abs(object.rotation.x) + Math.abs(object.rotation.y) + Math.abs(object.rotation.z) < 1e-12 &&
      object.scale.distanceToSquared(V(1, 1, 1)) < 1e-12;
    const atlas = parts.get('rim')?.material?.map?.image;
    if (animations.length || parts.size !== required.length || required.some((name) => !parts.has(name)) ||
        triangles > 2000 || assetMaterials.size !== 1 || !atlas || atlas.width !== 256 || atlas.height !== 256 ||
        !identity(asset) || [...parts.values()].some((mesh) => !identity(mesh) || mesh.material.transparent || !mesh.geometry.getAttribute('normal') || !mesh.geometry.getAttribute('uv')) ||
        !close(boardSize.x, hoop.backboardWidth) || !close(boardSize.y, hoop.backboardHeight) || !close(boardSize.z, hoop.backboardThickness) ||
        !close(boardCenter.x, hoop.backboardCenter.x) || !close(boardCenter.y, hoop.backboardCenter.y) || !close(boardCenter.z, hoop.backboardCenter.z) ||
        !close(boardBounds.max.z, hoop.backboardFrontZ) || !close(boardBounds.min.y, hoop.backboardBottom) ||
        rimCenter.distanceTo(hoop.rimCenter) > 0.00001 || netBounds.min.y < 2.5 || netBounds.max.y > hoop.rimHeight + 0.01) {
      throw new Error('Hoop assembly failed scale, topology, atlas, transform or landmark validation.');
    }

    const fallbackNetChildren = [...netGroup.children];
    const originalRimGeometry = rim.geometry;
    const originalBoardGeometry = backboard.geometry;
    rim.geometry = parts.get('rim').geometry;
    rim.material = parts.get('rim').material;
    rim.position.set(0, 0, 0);
    rim.rotation.set(0, 0, 0);
    backboard.geometry = parts.get('backboard').geometry;
    backboard.material = parts.get('backboard').material;
    backboard.position.set(0, 0, 0);
    backboard.castShadow = true;
    basketGroup.add(rim, backboard);
    parts.get('rim').removeFromParent();
    parts.get('backboard').removeFromParent();
    netGroup.add(parts.get('net'));
    for (const child of fallbackNetChildren) {
      netGroup.remove(child);
      child.geometry?.dispose();
    }
    basketGroup.add(asset);
    basketFallback.traverse((child) => child.geometry?.dispose());
    basketFallback.removeFromParent();
    originalRimGeometry.dispose();
    originalBoardGeometry.dispose();
    group.userData.hoopAssetStatus = 'ready';
    group.userData.hoopTriangles = triangles;
    return 'ready';
  }).catch((error) => {
    console.warn('Hoop asset could not load; using procedural basket.', error);
    group.userData.hoopAssetStatus = 'fallback';
    return 'fallback';
  });

  // Keep the original shell visible through loading and any asset error.
  environmentParent = shellFallback;
  // Building shell: deliberately dark, chunky and slightly theatrical.
  addBox(31, 0.42, 31, materials.concrete, V(0, 11.35, 0), "arena ceiling");
  addBox(31, 9.5, 0.32, materials.concrete, V(0, 5.7, 11.5), "far arena wall");
  addBox(31, 9.5, 0.32, materials.concrete, V(0, 5.7, -11.5), "rear arena wall");
  addBox(0.32, 9.5, 23, materials.concrete, V(15.3, 5.7, 0), "right arena wall");
  addBox(0.32, 9.5, 23, materials.concrete, V(-15.3, 5.7, 0), "left arena wall");

  for (const x of [-13.8, -9.2, -4.6, 0, 4.6, 9.2, 13.8]) {
    addBox(0.22, 8.8, 0.3, materials.trim, V(x, 6.45, 11.28), "far wall column");
    addBox(0.22, 8.8, 0.3, materials.trim, V(x, 6.45, -11.28), "rear wall column");
  }
  addBox(30.5, 0.58, 0.34, materials.paintAccent, V(0, 7.8, 11.18), "far wall stripe");
  addBox(30.5, 0.58, 0.34, materials.paintAccent, V(0, 7.8, -11.18), "rear wall stripe");

  // A few oversized LED boards sell the early-2000s arena presentation.
  for (const [x, z, rotY] of [[0, 10.98, 0], [-14.98, 1.2, Math.PI / 2], [14.98, 1.2, -Math.PI / 2]]) {
    const board = addBox(5.6, 1.12, 0.07, materials.screen, V(x, 6.15, z), "arena video board");
    board.rotation.y = rotY;
  }

  // Tiered bleachers on three sides of the court.
  const standMaterial = materials.trim.clone();
  for (const sign of [-1, 1]) {
    for (let tier = 0; tier < 4; tier += 1) {
      const height = 0.62 + tier * 0.58;
      const x = sign * (8.18 + tier * 1.04);
      addBox(1.22, height, 14.9, standMaterial, V(x, height / 2, 0.15), `side bleacher ${sign}-${tier}`);
      addBox(1.05, 0.16, 14.45, materials.seat, V(x, height + 0.06, 0.15), `side seats ${sign}-${tier}`);
    }
  }
  for (let tier = 0; tier < 4; tier += 1) {
    const height = 0.62 + tier * 0.58;
    const z = -8.25 - tier * 1.03;
    addBox(15.3, height, 1.18, standMaterial, V(0, height / 2, z), `rear bleacher ${tier}`);
    addBox(14.75, 0.16, 1.02, materials.seat, V(0, height + 0.06, z), `rear seats ${tier}`);
  }

  // Low-poly crowd: two instanced meshes per colour (body and head) keep this cheap.
  const crowdPalette = [0x7b5ccd, 0xb65b53, 0x3d9a92, 0xd0a447, 0x596cbb];
  const crowd = crowdPalette.map(() => []);
  let crowdSeed = 937;
  const random = () => {
    crowdSeed = (crowdSeed * 16807) % 2147483647;
    return (crowdSeed - 1) / 2147483646;
  };
  const addFan = (x, y, z, yaw) => {
    const colorIndex = Math.floor(random() * crowdPalette.length);
    crowd[colorIndex].push({
      position: V(x + (random() - 0.5) * 0.12, y, z + (random() - 0.5) * 0.1),
      yaw,
      lean: (random() - 0.5) * 0.1,
    });
  };

  for (const sign of [-1, 1]) {
    for (let row = 0; row < 4; row += 1) {
      for (let seat = 0; seat < 20; seat += 1) {
        addFan(sign * (8.18 + row * 1.04), 0.98 + row * 0.58, -6.35 + seat * 0.67, sign < 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  }
  for (let row = 0; row < 4; row += 1) {
    for (let seat = 0; seat < 20; seat += 1) {
      addFan(-6.6 + seat * 0.695, 0.98 + row * 0.58, -8.25 - row * 1.03, 0);
    }
  }

  const bodyGeometry = new THREE.DodecahedronGeometry(0.22, 0);
  const headGeometry = new THREE.IcosahedronGeometry(0.125, 0);
  const skinMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x5d3827, roughness: 0.84 }),
    new THREE.MeshStandardMaterial({ color: 0x9d6446, roughness: 0.84 }),
    new THREE.MeshStandardMaterial({ color: 0xd29a72, roughness: 0.84 }),
    new THREE.MeshStandardMaterial({ color: 0x7b4b38, roughness: 0.84 }),
    new THREE.MeshStandardMaterial({ color: 0xb77959, roughness: 0.84 }),
  ];
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const bodyScale = V(0.92, 1.42, 0.72);
  const headScale = V(1, 1, 1);
  const upAxis = V(0, 1, 0);

  crowd.forEach((fans, colorIndex) => {
    if (!fans.length) return;
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: crowdPalette[colorIndex], roughness: 0.74, metalness: 0.03 });
    const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, fans.length);
    const heads = new THREE.InstancedMesh(headGeometry, skinMaterials[colorIndex], fans.length);
    bodies.name = `crowd bodies ${colorIndex + 1}`;
    heads.name = `crowd heads ${colorIndex + 1}`;
    bodies.castShadow = true;
    heads.castShadow = true;
    fans.forEach((fan, index) => {
      rotation.setFromAxisAngle(upAxis, fan.yaw + fan.lean);
      matrix.compose(fan.position, rotation, bodyScale);
      bodies.setMatrixAt(index, matrix);
      matrix.compose(fan.position.clone().add(V(0, 0.42, 0)), rotation, headScale);
      heads.setMatrixAt(index, matrix);
    });
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    group.add(bodies, heads);
  });

  // Ceiling trusses and warm pools of light over the parquet.
  for (const z of [-5.4, 0, 5.4]) {
    addBox(22, 0.14, 0.18, materials.darkMetal, V(0, 10.65, z), "ceiling truss");
  }
  const lightPositions = [[-5.2, -3.5], [5.2, -3.5], [-5.2, 4.5], [5.2, 4.5]];
  lightPositions.forEach(([x, z], index) => {
    addBox(2.2, 0.08, 0.64, materials.light, V(x, 10.52, z), "overhead light housing");
    const light = new THREE.SpotLight(0xffe8be, 7.5, 23, 0.66, 0.55, 1.45);
    light.name = `arena spotlight ${index + 1}`;
    light.position.set(x, 10.4, z);
    light.target.position.set(x * 0.35, 0, z * 0.28);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    group.add(light, light.target);
  });
  group.add(new THREE.HemisphereLight(0x6f7dca, 0x16101c, 1.15));
  group.add(new THREE.AmbientLight(0x1a1f45, 0.72));

  // A small seven-segment shot clock sits just above the backboard.
  const shotClock = new THREE.Group();
  shotClock.name = "24 second shot clock";
  shotClock.position.set(0, 5.02, -6.52);
  addBox(1.18, 0.88, 0.14, materials.darkMetal, V(0, 0, 0), "shot clock case", shotClock);
  const digitSegments = {
    2: [0, 1, 6, 4, 3],
    4: [5, 6, 1, 2],
  };
  const segmentPositions = [
    [0, 0.26, 0.22, 0.055], [0.18, 0.13, 0.055, 0.22], [0.18, -0.13, 0.055, 0.22],
    [0, -0.26, 0.22, 0.055], [-0.18, -0.13, 0.055, 0.22], [-0.18, 0.13, 0.055, 0.22], [0, 0, 0.22, 0.055],
  ];
  [[-0.28, 2], [0.28, 4]].forEach(([x, digit]) => {
    digitSegments[digit].forEach((segment) => {
      const [sx, sy, width, height] = segmentPositions[segment];
      addBox(width, height, 0.024, materials.clock, V(x + sx, sy, 0.086), "shot clock digit", shotClock);
    });
  });
  shellFallback.add(shotClock);

  // Seat backs and cushions reuse one tiny mesh and one draw call. The crowd
  // remains the established instanced presentation and sits in these rows.
  const seatPan = new THREE.BoxGeometry(0.46, 0.08, 0.43);
  seatPan.translate(0, 0.04, 0.04);
  const seatBack = new THREE.BoxGeometry(0.46, 0.44, 0.09);
  seatBack.translate(0, 0.27, -0.22);
  const seatGeometry = mergeGeometries([seatPan, seatBack]);
  seatPan.dispose();
  seatBack.dispose();
  const seats = new THREE.InstancedMesh(
    seatGeometry,
    new THREE.MeshBasicMaterial({ color: 0x464064 }),
    240,
  );
  seats.name = 'instanced arena seats';
  seats.castShadow = false;
  seats.receiveShadow = false;
  seats.visible = false;
  const seatMatrix = new THREE.Matrix4();
  const seatRotation = new THREE.Quaternion();
  const seatScale = V(1, 1, 1);
  let seatIndex = 0;
  const placeSeat = (x, y, z, yaw) => {
    seatRotation.setFromAxisAngle(V(0, 1, 0), yaw);
    seatMatrix.compose(V(x, y, z), seatRotation, seatScale);
    seats.setMatrixAt(seatIndex, seatMatrix);
    seatIndex += 1;
  };
  for (const sign of [-1, 1]) {
    for (let row = 0; row < 4; row += 1) {
      const y = 0.62 + row * 0.58 + 0.075;
      for (let seat = 0; seat < 20; seat += 1) {
        placeSeat(sign * (8.18 + row * 1.04), y, -6.35 + seat * 0.67, sign < 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  }
  for (let row = 0; row < 4; row += 1) {
    const y = 0.62 + row * 0.58 + 0.075;
    for (let seat = 0; seat < 20; seat += 1) {
      placeSeat(-6.6 + seat * 0.695, y, -8.25 - row * 1.03, 0);
    }
  }
  seats.instanceMatrix.needsUpdate = true;
  seats.computeBoundingSphere();
  group.add(seats);

  // Keep the original seat, riser, and instanced-seat colors until the single
  // seating color map loads. The 240 seats remain one instanced draw call.
  group.userData.seatingStatus = 'loading';
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}assets/textures/seating/seating-v1.webp`,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 2;
      seatingTexture = texture;
      seatingPlatformMap = texture.clone();
      seatingPlatformMap.repeat.set(8, 2);
      seatingPlatformMap.needsUpdate = true;
      seatingRiserMap = texture.clone();
      seatingRiserMap.repeat.set(8, 3);
      seatingRiserMap.needsUpdate = true;
      applySeatingMaterial(materials.seat, seatingPlatformMap, 0xffffff);
      applySeatingMaterial(standMaterial, seatingRiserMap, 0xc8c7dc);
      applySeatingMaterial(seats.material, seatingTexture, 0xffffff);
      for (const [mesh, kind] of shellSeatingSurfaces) applyShellSeatingSurface(mesh, kind);
      group.userData.seatingStatus = 'ready';
    },
    undefined,
    () => { group.userData.seatingStatus = 'fallback'; },
  );

  // The GLB is authored in world-space meters with its scene root at 0,0,0.
  // Reject a bad or partial export before switching off the playable fallback.
  group.userData.arenaShellStatus = 'loading';
  new GLTFLoader().load(
    `${import.meta.env.BASE_URL}assets/models/arena/arena-shell-v1.glb`,
    ({ scene: shell }) => {
      shell.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(shell);
      const size = bounds.getSize(new THREE.Vector3());
      let triangles = 0;
      let videoBoards = 0;
      let clockDigits = 0;
      shell.traverse((child) => {
        if (!child.isMesh) return;
        // GLTFLoader normalizes spaces in node names. Restore the exact name
        // read by the existing presentation pulse in main.js.
        if (child.name === 'arena_video_board') child.name = 'arena video board';
        const geometry = child.geometry;
        triangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
        if (child.name === 'arena video board' && child.material?.emissiveIntensity !== undefined) videoBoards += 1;
        if (child.name === 'shot_clock_digits') clockDigits += 1;
        child.castShadow = false;
        child.receiveShadow = false;
      });
      if (triangles > 10000 || videoBoards !== 1 || clockDigits !== 1 ||
          Math.abs(size.x - 30.7) > 0.5 || Math.abs(size.z - 23.04) > 0.5 ||
          bounds.min.y < -0.5 || bounds.max.y > 11.5) {
        console.warn('Arena shell failed validation', JSON.stringify({ triangles, videoBoards, clockDigits, size: size.toArray(), minY: bounds.min.y, maxY: bounds.max.y }));
        group.userData.arenaShellStatus = 'fallback';
        return;
      }
      shell.traverse((child) => {
        const material = child.isMesh && child.material;
        if (material && Object.hasOwn(shellConcreteTints, material.name)) {
          shellConcreteMaterials.add(material);
          if (concreteTexture) applyConcreteMaterial(material, shellConcreteTints[material.name]);
        } else if (material?.name === 'trim') {
          shellMetalMaterials.add(material);
          if (metalTexture) applyShellMetalMaterial(material);
        }
        if (child.isMesh && (child.name === 'seating_platforms' || child.name === 'tiered_bleachers')) {
          const kind = child.name === 'seating_platforms' ? 'platform' : 'riser';
          shellSeatingSurfaces.push([child, kind]);
          if (seatingTexture) applyShellSeatingSurface(child, kind);
        }
      });
      shell.name = 'authored arena shell';
      group.add(shell);
      seats.visible = true;
      shellFallback.visible = false;
      shellFallback.traverse((child) => child.geometry?.dispose());
      shellFallback.removeFromParent();
      group.userData.arenaShellStatus = 'ready';
      group.userData.arenaShellTriangles = triangles;
    },
    undefined,
    (error) => {
      console.warn('Arena shell could not load; using procedural fallback.', error);
      group.userData.arenaShellStatus = 'fallback';
    },
  );

  group.userData.court = court;
  group.userData.hoop = hoop;
  return { group, hoop, court };
}

export default createArena;
