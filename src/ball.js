import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Presentation scale only; collision and gameplay radius stay in main.js.
const BALL_RADIUS = 0.12;
const MODEL_URL = import.meta.env.BASE_URL + 'assets/models/ball/basketball-v1.glb';

/** A stable, centered root that main.js can move and rotate throughout loading. */
export function createBasketball({ modelUrl = MODEL_URL } = {}) {
  const group = createProceduralBasketball();
  const fallbackMeshes = group.children.filter(child => child !== group.userData.shadow);
  group.userData.assetStatus = 'loading';
  group.userData.assetReady = new GLTFLoader().loadAsync(modelUrl).then(gltf => {
    const visual = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(visual);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    if (center.length() > 0.000001 || size.toArray().some(value => Math.abs(value - 0.24) > 0.000001)) {
      throw new Error('Basketball asset must be centered and 0.24 meters across.');
    }
    visual.name = 'basketball asset visual';
    visual.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    group.add(visual);
    // Replace only the visual after decoding and checking its scale. The same
    // root and contact-shadow object survive the swap, even during a shot.
    const geometries = new Set();
    const materials = new Set();
    for (const child of fallbackMeshes) {
      group.remove(child);
      geometries.add(child.geometry);
      materials.add(child.material);
    }
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    group.userData.assetStatus = 'ready';
    return 'ready';
  }).catch(error => {
    group.userData.assetStatus = 'fallback';
    console.warn('Basketball asset unavailable; using procedural ball.', error);
    return 'fallback';
  });
  return group;
}

function createProceduralBasketball() {
  const ballGroup = new THREE.Group();
  ballGroup.name = 'game basketball';

  const leather = new THREE.MeshStandardMaterial({
    color: 0xb95826,
    roughness: 0.66,
    metalness: 0.02,
  });
  const seam = new THREE.MeshBasicMaterial({ color: 0x1c1010 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 12, 8), leather);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  ballGroup.add(sphere);

  const seamTorus = (rotation) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(BALL_RADIUS * 1.008, BALL_RADIUS * 0.017, 4, 18),
      seam,
    );
    ring.rotation.copy(rotation);
    ballGroup.add(ring);
  };
  seamTorus(new THREE.Euler(Math.PI / 2, 0, 0));
  seamTorus(new THREE.Euler(0, Math.PI / 2, 0));

  const diagonal = new THREE.Mesh(
    new THREE.TorusGeometry(BALL_RADIUS * 0.72, BALL_RADIUS * 0.014, 4, 14, Math.PI),
    seam,
  );
  diagonal.rotation.set(0.6, 0.78, 0.36);
  ballGroup.add(diagonal);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(BALL_RADIUS * 1.4, 10),
    new THREE.MeshBasicMaterial({
      color: 0x05060a,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  );
  shadow.name = 'ball contact shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -BALL_RADIUS + 0.006;
  ballGroup.add(shadow);
  ballGroup.userData.shadow = shadow;
  return ballGroup;
}
