#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRecoveredGlb, validateRecoveredRoster } from './recovered-player-tools.mjs';
import { parseGlb } from './luke-rig-tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function checkRecoveredPlayers(manifest) {
  manifest ||= JSON.parse(await readFile(path.join(root, 'public/assets/manifest.json'), 'utf8'));
  const recovered = manifest.assets.filter(asset => asset.id.startsWith('nba2k9-'));
  if (!recovered.length) throw new Error('No recovered player assets registered');
  const results = [];
  for (const asset of recovered) {
    for (const entry of asset.runtime.filter(entry => entry.format === 'glb')) {
      const data = await readFile(path.join(root, 'public', entry.path));
      const metrics = validateRecoveredGlb(data, { animationOnly: asset.category === 'animation' });
      if (entry.triangles !== undefined && entry.triangles !== metrics.triangles) {
        throw new Error(`${asset.id}: triangle count differs from manifest`);
      }
      console.log(`Recovered asset valid: ${asset.id} ` + JSON.stringify(metrics));
      results.push({ id: asset.id, ...metrics });
    }
  }
  const roster = JSON.parse(await readFile(path.join(root, 'src/nba2k9-roster.json'), 'utf8'));
  const registered = new Set(recovered.flatMap(asset => asset.runtime.map(entry => entry.path)));
  for (const url of [...roster.players.map(player => player.url), roster.animations.url]) {
    if (!registered.has(url)) throw new Error(`Recovered roster references unregistered asset: ${url}`);
  }
  const animation = parseGlb(await readFile(path.join(root, 'public', roster.animations.url)));
  console.log('Recovered roster valid: ' + JSON.stringify(validateRecoveredRoster(roster, animation.doc, animation.binary)));
  return results;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkRecoveredPlayers().catch(error => { console.error(error.message); process.exitCode = 1; });
}
