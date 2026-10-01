#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { accessor, parseGlb } from './luke-rig-tools.mjs';
import { validateStagedPlayerRigContract } from '../src/player.js';

const files = process.argv.slice(2);
if (!files.length) throw new Error('Pass one or more staged v2 GLBs');
for (const filename of files) {
  const data = await readFile(filename);
  const { doc, binary } = parseGlb(data);
  if ((doc.animations?.length || 0) !== 0) throw new Error(`${filename}: embedded animation clips are forbidden`);
  if (doc.meshes?.length !== 1 || doc.skins?.length !== 1) throw new Error(`${filename}: expected one mesh and one skin`);
  if (doc.materials?.length !== 1 || doc.images?.length !== 1) throw new Error(`${filename}: expected one material and one embedded image`);
  const primitive = doc.meshes[0].primitives[0];
  const position = doc.accessors[primitive.attributes.POSITION];
  const index = primitive.indices === undefined ? null : doc.accessors[primitive.indices];
  const triangles = (index?.count || position.count) / 3;
  const height = position.max[1] - position.min[1];
  const boneNames = doc.skins[0].joints.map(index => doc.nodes[index].name);
  const weights = accessor(doc, binary, primitive.attributes.WEIGHTS_0);
  let maxWeightError = 0, maxInfluences = 0;
  for (const row of weights) {
    maxWeightError = Math.max(maxWeightError, Math.abs(row.reduce((sum, value) => sum + value, 0) - 1));
    maxInfluences = Math.max(maxInfluences, row.filter(value => value > 1e-7).length);
  }
  if (maxWeightError > 1e-5 || maxInfluences > 4) throw new Error(`${filename}: skin weights are not normalized portable four-influence weights`);
  const result = validateStagedPlayerRigContract({ boneNames, bytes: data.length, triangles, height,
    meshCount: doc.meshes.length, skinCount: doc.skins.length });
  console.log(JSON.stringify({ file: path.normalize(filename), bytes: data.length, triangles,
    vertices: position.count, height, bones: result.bones.length, animations: 0, maxInfluences, maxWeightError }));
}
