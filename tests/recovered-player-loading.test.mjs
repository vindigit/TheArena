import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createPlayer } from '../src/nba2k9-player.js';
import { fixtureFetch, parseRecoveredScene, buildRecoveredGameVM } from '../scripts/recovered-game-harness.mjs';

for (const characterId of ['classic-one', 'classic-two']) {
  test(`${characterId} loads its complete assembly and recovered clips without Luke requests`, async () => {
    const requests = [], player = createPlayer(THREE, { ...(characterId === 'classic-one' ? {} : { characterId }),
      fetchAsset: fixtureFetch(requests), parseModel: parseRecoveredScene });
    assert.equal(await player.group.userData.assetReady, 'ready');
    assert.equal(player.group.userData.characterId, characterId);
    assert.equal(player.group.userData.playerAsset.bones, 33);
    assert.equal(player.group.userData.playerAsset.triangles, 4676);
    assert.equal(player.group.userData.animationStatus, 'ready');
    assert.equal(requests.length, 2);
    assert.ok(requests.every(url => url.includes('/nba2k9/')));
    assert.ok(requests.every(url => !url.includes('luke')));
    player.update(1 / 60, { action: 'move', speed: 3.38, ballMode: 'dribble', dribblePhase: .2 });
    assert.ok(player.getRightHandWorldPosition().toArray().every(Number.isFinite));
    assert.ok(player.getHeldBallWorldPosition().toArray().every(Number.isFinite));
  });
}

test('a delayed obsolete load cannot replace a newly selected player', async () => {
  const requests = [], normalFetch = fixtureFetch(requests);
  let resolveFirst;
  const firstGate = new Promise(resolve => { resolveFirst = resolve; });
  const parsed = [];
  const player = createPlayer(THREE, {
    fetchAsset: async url => {
      if (url.includes('player-one.glb')) await firstGate;
      return normalFetch(url);
    },
    parseModel: async data => { const scene = await parseRecoveredScene(data); parsed.push(scene); return scene; },
  });
  const obsolete = player.group.userData.assetReady;
  assert.equal(await player.setCharacter('classic-two'), 'ready');
  const active = player.group.userData.playerAsset;
  resolveFirst();
  assert.equal(await obsolete, 'superseded');
  assert.equal(player.group.userData.characterId, 'classic-two');
  assert.strictEqual(player.group.userData.playerAsset, active);
  assert.equal(requests.filter(url => url.includes('motions.glb')).length, 1, 'Shared animation request is reused');
  const scenesAttached = parsed.filter(gltf => gltf.scene.parent === player.group);
  assert.equal(scenesAttached.length, 1, 'Only the selected complete scene remains attached');
});

test('model or motion failures leave play blocked and never request a fallback Luke', async () => {
  const error = console.error;
  console.error = () => {};
  try {
    for (const missing of ['player-one.glb', 'motions.glb']) {
      const requests = [], normalFetch = fixtureFetch(requests);
      const player = createPlayer(THREE, { parseModel: parseRecoveredScene,
        fetchAsset: async url => url.includes(missing) ? (requests.push(url), { ok: false, status: 404 }) : normalFetch(url) });
      assert.equal(await player.group.userData.assetReady, 'error');
      assert.equal(player.group.userData.assetStatus, 'error');
      assert.equal(player.group.userData.animationStatus, 'error');
      assert.ok(player.group.userData.assetError);
      assert.ok(requests.every(url => !url.includes('luke')));
      const { api, audioCalls } = await buildRecoveredGameVM(player);
      api.unlockAndStart();
      assert.equal(api.game.started, false, 'Failed loading cannot start the match');
      assert.equal(audioCalls.filter(call => call.event === 'unlock').length, 0);
    }
  } finally { console.error = error; }
});
