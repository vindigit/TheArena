// Ignored harness around the actual game; no debug hooks ship in production.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('.tmp/player',{recursive:true});
const source=(await readFile('src/main.js','utf8')).replace("import './styles.css';","import '../../src/styles.css';").replaceAll("from './","from '../../src/");
await writeFile('.tmp/player/game.js',source+'\n'+await readFile('dev/game-check-hooks.js','utf8'));
await writeFile('.tmp/player/game.html',(await readFile('index.html','utf8')).replace('src="/src/main.js"','src="/.tmp/player/game.js"'));
console.log('Dev-only actual game harness: /.tmp/player/game.html; window.arenaPlayerCheck');
