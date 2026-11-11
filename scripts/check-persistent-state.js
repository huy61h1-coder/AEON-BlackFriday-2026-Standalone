const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeon-persistence-'));
const seed = JSON.parse(fs.readFileSync(path.join(root, '.aeon-store.seed.json'), 'utf8'));
const initial = process.env.AEON_LEGACY_SEED_PATH
  ? JSON.parse(fs.readFileSync(process.env.AEON_LEGACY_SEED_PATH, 'utf8'))
  : structuredClone(seed);
initial['aeon-ui'].storefrontRevision = 'older-release';
initial['aeon-ui'].campaignSchedule = 'SAVED_BEFORE_DEPLOY';
initial['aeon-layout'].storefrontRevision = 'older-release';
initial['aeon-layout'].accentColor = '#123456';
initial['aeon-layout'].productColumns = 3;
fs.writeFileSync(path.join(dataDir, '.aeon-store.json'), JSON.stringify(initial));

const port = 18000 + Math.floor(Math.random() * 4000);
const base = `http://127.0.0.1:${port}`;
let server;

async function start() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {...process.env, HOST:'127.0.0.1', PORT:String(port), AEON_DATA_DIR:dataDir,
      ADMIN_USERNAME:'persistence-check', ADMIN_PASSWORD:'local-test-only',
      AEON_LOCK_STOREFRONT:'true', SUPABASE_URL:'', SUPABASE_ANON_KEY:'',
      SUPABASE_SECRET_KEY:'', SUPABASE_SERVICE_ROLE_KEY:''},
    stdio:'ignore'
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${server.exitCode}`);
    try {
      const response = await fetch(`${base}/api/state`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}

async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await exited;
  server = null;
}

async function run() {
  try {
    await start();
    let response = await fetch(`${base}/api/state`);
    let state = await response.json();
    assert.equal(state['aeon-products'].length, seed['aeon-products'].length);
    assert.equal(state['aeon-ui'].campaignSchedule, 'SAVED_BEFORE_DEPLOY');
    assert.equal(state['aeon-layout'].accentColor, '#123456');
    assert.equal(state['aeon-layout'].productColumns, 3);

    response = await fetch(`${base}/api/admin/login`, {method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'persistence-check', password:'local-test-only'})});
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    response = await fetch(`${base}/api/state`, {method:'POST',
      headers:{'Content-Type':'application/json', Cookie:cookie},
      body:JSON.stringify({key:'aeon-ui', value:{campaignSchedule:'SAVED_AFTER_DEPLOY'}})});
    assert.equal(response.status, 200);
    fs.writeFileSync(path.join(dataDir, 'uploads', 'smoke.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S+QAAAAASUVORK5CYII=', 'base64'));
    await stop();
    await start();
    response = await fetch(`${base}/api/state`);
    state = await response.json();
    assert.equal(state['aeon-products'].length, seed['aeon-products'].length);
    assert.equal(state['aeon-ui'].campaignSchedule, 'SAVED_AFTER_DEPLOY');
    assert.equal(state['aeon-layout'].accentColor, '#123456');
    response = await fetch(`${base}/assets/uploads/smoke.png`);
    assert.equal(response.status, 200);
    console.log(`Persistence check passed: ${state['aeon-products'].length} products, saved settings and uploaded image survive restart.`);
  } finally {
    await stop();
    if (path.dirname(dataDir) === os.tmpdir()) fs.rmSync(dataDir, {recursive:true, force:true});
  }
}

run().catch(error => {console.error(error); process.exitCode = 1;});
