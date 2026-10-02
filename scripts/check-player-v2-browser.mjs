import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:5177';
if (!endpoint?.startsWith('ws://127.0.0.1:')) throw new Error('Pass owned local CDP URL');
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let id = 0;
const pending = new Map(), requests = [], errors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  else if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
  else if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    errors.push(details.exception?.description || details.text);
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const messageId = ++id; pending.set(messageId, { resolve, reject }); socket.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) })); });
const targets = await send('Target.getTargets');
const target = targets.targetInfos.find(item => item.type === 'page');
const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
const call = (method, params = {}) => send(method, params, sessionId);
await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
    throw new Error(`Browser evaluation failed: ${detail}`);
  }
  return response.result.value;
};
async function verify(path, expectedFile, label) {
  requests.length = 0; errors.length = 0;
  await call('Page.navigate', { url: base + path });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await evaluate(`document.querySelector('#startButton')?.disabled===false || document.querySelector('#startButton')?.classList.contains('has-load-error')`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const state = await evaluate(`({disabled:document.querySelector('#startButton').disabled,error:document.querySelector('#startButton').classList.contains('has-load-error'),label:document.querySelector('#actionLabel').textContent,canvas:[document.querySelector('#game').width,document.querySelector('#game').height]})`);
  if (state.error || state.disabled) console.error(JSON.stringify({ label, state, errors, requests }, null, 2));
  assert.equal(state.disabled, false, `${label} did not become playable`);
  assert.equal(state.error, false, `${label} entered fallback`);
  assert.ok(requests.some(url => url.endsWith('/' + expectedFile)), `${label} did not request ${expectedFile}`);
  await evaluate(`document.querySelector('#startButton').click()`);
  for (let repeat = 0; repeat < 3; repeat++) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
    await new Promise(resolve => setTimeout(resolve, 180));
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ' });
    await new Promise(resolve => setTimeout(resolve, 220));
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ' });
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const relevantErrors = errors.filter(error => !error.includes('not valid for pointer lock'));
  assert.deepEqual(relevantErrors, [], `${label} browser exceptions`);
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  await mkdir('docs/evidence', { recursive: true });
  await writeFile(`docs/evidence/player-v2-${label}.png`, Buffer.from(shot.data, 'base64'));
  return { label, requested: expectedFile, state };
}
try {
  const result = [
    await verify('/', 'fictional-player-v2.glb', 'fictional'),
    await verify('/?player=luke', 'luke-player-preview.glb', 'luke'),
  ];
  console.log(JSON.stringify({ pass: true, result }));
} finally { socket.close(); }
