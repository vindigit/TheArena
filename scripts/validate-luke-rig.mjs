#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { accessor, parseGlb, validateLukeAsset } from './luke-rig-tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function checkLukeRig() {
  const contract = JSON.parse(await readFile(path.join(root, 'docs/rig/luke-rig-contract.json'), 'utf8'));
  const data = await readFile(path.join(root, contract.asset.path));
  const metrics = await validateLukeAsset(data, contract);
  const { doc, binary } = parseGlb(data), image = doc.images[0], view = doc.bufferViews[image.bufferView];
  const texture = await sharp(binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)).metadata();
  if (texture.width !== 512 || texture.height !== 512 || texture.hasAlpha) throw new Error('Canonical Luke atlas must be opaque 512×512');
  const inverse = accessor(doc, binary, doc.skins[0].inverseBindMatrices);
  if (inverse.length !== contract.bones.length || inverse.some((row, i) =>
    row.some((v, k) => Math.abs(v - contract.bones[i].inverseBindMatrix[k]) > 1e-6))) {
    throw new Error('JSON rig contract inverse bind matrices differ');
  }
  console.log('Luke rig valid: ' + JSON.stringify({ ...metrics, texture: [texture.width, texture.height] }));
  return metrics;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkLukeRig().catch(error => { console.error(error.message); process.exitCode = 1; });
}
