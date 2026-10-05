import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file));
const hash = data => createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(read('art/player-rebuild/cloud-transfer-manifest.json'));
const audit = JSON.parse(read('art/player-rebuild/motion-audit.json'));
const sourceHash = '26d97a1a31ac65445f06ac0595f08ae3f02174d9aea2ee6225cfffaa6041ada9';
if (manifest.sourceHash !== sourceHash || hash(read('art/player-rebuild/selected-player-source.glb')) !== sourceHash)
  throw new Error('Supplied character source hash mismatch');
const seen = new Set();
for (const entry of manifest.files) {
  if (!/^art\/(player-rebuild|source\/player-rebuild)\//.test(entry.file) || entry.file.split('/').includes('..') || entry.file.includes('\\') || seen.has(entry.file))
    throw new Error('Invalid or duplicate transfer path: ' + entry.file);
  seen.add(entry.file);
  const bytes = read(entry.file);
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256)
    throw new Error('Transfer mismatch: ' + entry.file);
}
if (audit.clips.length !== 976 || manifest.canonicalMotionCount !== 976)
  throw new Error('Incomplete canonical motion inventory');
for (const clip of audit.clips) {
  const expected = '/art/player-rebuild/source-motion/' + path.basename(clip.sourceFile);
  const metadata = '/art/player-rebuild/source-motion/' + path.basename(clip.metadataFile);
  if (clip.url !== expected || clip.metadataUrl !== metadata)
    throw new Error('Unexpected source URL: ' + clip.id);
  if (!seen.has(expected.slice(1)) || !seen.has(metadata.slice(1)) || hash(read(expected.slice(1))) !== clip.glbHash || hash(read(metadata.slice(1))) !== clip.metadataHash)
    throw new Error('Audited motion/metadata mismatch: ' + clip.id);
}
console.log(`Transfer verified: ${seen.size} art/source files, 976 canonical clips and 976 metadata files; original character unchanged.`);
