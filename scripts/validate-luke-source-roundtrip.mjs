// Validate a maintained-source export against the canonical character without
// treating generator metadata/JSON formatting as a new accepted runtime asset.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { parseGlb, validateLukeAsset } from './luke-rig-tools.mjs';

const contract = JSON.parse(await readFile('docs/rig/luke-rig-contract.json', 'utf8'));
const canonical = await readFile(contract.asset.path);
const staged = await readFile('.tmp/luke/luke-maintained-source-export.glb');
const a = parseGlb(canonical), b = parseGlb(staged);
assert.ok(a.binary.equals(b.binary), 'Maintained source geometry/skin/texture bytes must equal canonical BIN');
const stagedDocument = structuredClone(b.doc);
stagedDocument.asset.generator = a.doc.asset.generator;
assert.ok(isDeepStrictEqual(stagedDocument, a.doc), 'Source export must match the canonical structure and safe rig metadata');
const sha256 = createHash('sha256').update(staged).digest('hex');
const stagedContract = { ...contract, asset: { ...contract.asset, sha256 } };
await validateLukeAsset(staged, stagedContract);
console.log(JSON.stringify({ sourceRoundTrip: 'pass', stagedBytes: staged.length, stagedSha256: sha256,
  canonicalSha256: contract.asset.sha256, byteIdenticalToCanonical: canonical.equals(staged),
  exactEmbeddedGeometrySkinTexture: true, exactLocalRestAndInverseBinds: true,
  safeRigMetadataOnly: true, canonicalRuntimeUnmodified: true }, null, 2));
