// Rejected playback is archived, not selectable through a status flag.
// A future review must explicitly use the neutral rig, volume-preserving skin
// and validated retargeted clips before restoring a renderer here.
document.querySelector('header strong').textContent = 'Player rebuild · preview suspended';
document.querySelector('header p').textContent = 'The moving candidate was rejected. Motion clips are disconnected while the neutral skeleton, leg volume, arm clearance and uniform fit are rebuilt.';
document.querySelectorAll('button,input,select').forEach(element => element.disabled = true);
document.getElementById('status').textContent = 'No player renderer or motion playback is running.';
document.getElementById('details').textContent = 'Character remains outside the playable game. Structural review comes first.';
document.body.dataset.previewState = 'suspended';
window.playerRebuild = {suspended:true};
