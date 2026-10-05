import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The supplied athlete is an immutable input; every rig is rebuilt from it.
test('supplied athlete is unchanged', () => {
  const bytes = readFileSync(new URL('../art/input/selected-player-source.glb', import.meta.url));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '26d97a1a31ac65445f06ac0595f08ae3f02174d9aea2ee6225cfffaa6041ada9',
  );
});
