// Gameplay orchestration. Owns movement, possession, shots, scoring and ball physics;
// rendering modules only draw what this file decides.
import * as THREE from 'three';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d22);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.2));

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 3, 8);
camera.lookAt(0, 1, 0);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(28, 15),
  new THREE.MeshLambertMaterial({ color: 0x9a6b3c }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => renderer.render(scene, camera));
