#!/usr/bin/env node
// Record the selected assembly outputs, without inventing original-game semantics
// or a redistribution license for the user-supplied recovery package.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRecoveredGlb } from './recovered-player-tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'public/assets/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const provenance = JSON.parse(await readFile(path.join(root, 'public/assets/models/player/nba2k9/provenance.json'), 'utf8'));
const license = {
  name: 'Recovered proprietary NBA 2K9 game assets; original ownership unchanged',
  url: null, commercialUse: null, attribution: null,
  evidence: 'The project owner supplied the recovered study package and explicitly requested its integration into the public deployed game. The recovery package provides source identity and technical evidence, but does not establish a redistribution or commercial-use license. Publication authorization is recorded separately from license evidence.',
};
const records = [];
const entries = [
  ...provenance.players.map(player => ({ ...player, category: 'model', manifestId: `nba2k9-${player.id}-v1` })),
  { ...provenance.animationBundle, category: 'animation', manifestId: 'nba2k9-motions-v1', sources: provenance.motions },
];
for (const entry of entries) {
  const data = await readFile(path.join(root, 'public', entry.url));
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (entry.sha256 !== sha256 || entry.bytes !== data.length) throw new Error(`${entry.manifestId}: output differs from assembly provenance`);
  const metrics = validateRecoveredGlb(data, { animationOnly: entry.category === 'animation' });
  records.push({
    id: entry.manifestId, category: entry.category, status: 'accepted',
    source: {
      type: 'third-party', prompt: null, modelId: 'NBA 2K9 PS2 recovered study', modelVersion: null,
      settings: { provenance: 'assets/models/player/nba2k9/provenance.json', nativeUnitsRetained: true,
        sources: entry.sources, textures: entry.textures || [], originalActorUniformPairingVerified: false,
        originalMotionActionSemanticsVerified: false },
      seed: null, scenarioAssetId: null, scenarioJobId: null, generatedAt: null,
      referenceAssetIds: (entry.sources || []).map(source => source.id || source.file),
      optimizationSteps: entry.category === 'model' ? [
        'Assembled a compatible recovered body and head using shared canonical bone names and preserved source skin weights, rest translations and inverse bind matrices.',
        'Excluded optional outfit/accessory alternatives, embedded the selected recovered PNG textures by material role, and preserved original UVs.',
        'Applied physical scale and floor offset only through the runtime roster; source native coordinates remain unchanged.',
      ] : [
        'Bundled selected recovered canonical 26-bone clips into one embedded GLB with stable runtime names.',
        'Preserved recovered key times and quaternions; gameplay chooses adapted segments while retaining authority over root movement and ball physics.',
      ],
      outputNotes: 'User-directed public integration. Source geometry and motion are recovered proprietary material. Original actor/uniform pairing and original action labels remain unverified. Source fingerprints and conversion details are retained in the accompanying provenance JSON.',
    },
    license: { ...license },
    runtime: [{ path: entry.url, format: 'glb', bytes: data.length, maxBytes: 12_000_000, sha256,
      ...(entry.category === 'model' ? { triangles: metrics.triangles } : { durationSeconds: metrics.durationSeconds }) }],
    validation: {
      checks: { sourceFingerprint: 'pass', embeddedResources: 'pass', canonicalBoneFamily: 'pass',
        finiteRuntimeData: 'pass', ...(entry.category === 'model' ? {
          completeBodyHeadAssembly: 'pass', normalizedSkinWeights: 'pass', inverseBindAgreement: 'pass',
        } : { orderedKeyTimes: 'pass', normalizedQuaternions: 'pass', canonicalAnimationTargets: 'pass' }) },
      measured: { ...metrics, runtimeBytes: data.length },
      notes: 'Independent binary checks validate the shipped output rather than the assembly recipe. These measurements establish structural integrity, not exact original-game pose fidelity, motion semantics, complete gameplay animation coverage or physical-device visual approval. Desktop/touch gameplay evidence is documented with the player integration.',
    },
    integration: {
      module: 'src/nba2k9-player.js',
      fallback: 'Default recovered player registry loads a complete body/head model and shared motion bundle. Loading and failure are explicit; character switching and reset preserve the selected roster member. Procedural basketball poses supplement recovered motion where action semantics remain unverified.',
    },
  });
}
manifest.assets = manifest.assets.filter(asset => !asset.id.startsWith('nba2k9-'));
const luke = manifest.assets.find(asset => asset.id === 'luke-player-v1');
if (luke) {
  luke.source.outputNotes = 'Historical user-supplied Luke asset retained with its canonical rig and original evidence. The recovered NBA 2K9 roster supersedes Luke as the default runtime player; this record does not assert current appearance or branding rights.';
  luke.validation.checks.onlyRuntimePlayer = 'not-applicable';
  luke.integration.fallback = 'Historical Luke renderer and rig remain available for maintenance evidence. The default game imports the recovered player registry; Luke is no longer the only published player model or the default character.';
}
manifest.assets.push(...records);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Recorded ${records.length} recovered runtime assets with source fingerprints and unknown license status.`);
