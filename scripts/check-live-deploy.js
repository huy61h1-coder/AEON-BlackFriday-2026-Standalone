const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aeon-live-deploy-'));
const dataDir = path.join(temporary, 'release-data');
const seed = JSON.parse(fs.readFileSync(path.join(root, '.aeon-store.seed.json'), 'utf8'));
let liveState = {
  'aeon-products':seed['aeon-products'].slice(0, 73),
  'aeon-ui':{...seed['aeon-ui'], campaignSchedule:'CURRENT_LIVE_VERSION'},
  'aeon-layout':{...seed['aeon-layout'], accentColor:'#123456'}
};
let sourceAvailable = true;
let app;

const fixture = http.createServer((request, response) => {
  if (!sourceAvailable) { response.writeHead(502); response.end('Unavailable'); return; }
  response.writeHead(200, {'Content-Type':'application/json'});
  response.end(JSON.stringify(liveState));
});

async function start(port, sourcePort) {
  app = spawn(process.execPath, ['server.js'], {
    cwd:root,
    env:{...process.env, HOST:'127.0.0.1', PORT:String(port), AEON_DATA_DIR:dataDir,
      AEON_BOOTSTRAP_PUBLIC_URL:`http://127.0.0.1:${sourcePort}/api/state`,
      AEON_ALLOW_SAMPLE_DATA:'false', ADMIN_USERNAME:'deploy-check', ADMIN_PASSWORD:'local-test-only',
      SUPABASE_URL:'', SUPABASE_ANON_KEY:'', SUPABASE_SECRET_KEY:'', SUPABASE_SERVICE_ROLE_KEY:''},
    stdio:'inherit'
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(`Server exited: ${app.exitCode}`);
    try { if ((await fetch(`${base}/api/state`)).ok) return base; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}

async function stop() {
  if (!app || app.exitCode !== null) return;
  const exited = new Promise(resolve => app.once('exit', resolve));
  app.kill();
  await exited;
  app = null;
}

async function run() {
  try {
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const sourcePort = fixture.address().port;
    const port = 18000 + Math.floor(Math.random() * 4000);
    let base = await start(port, sourcePort);
    let state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state['aeon-products'].length, 90);
    assert.deepEqual(state['aeon-products'], seed['aeon-products']);

    const login = await fetch(`${base}/api/admin/login`, {method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'deploy-check', password:'local-test-only'})});
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${base}/api/state`, {method:'POST',
      headers:{'Content-Type':'application/json', Cookie:cookie},
      body:JSON.stringify({key:'aeon-products', value:state['aeon-products'].slice(0, 89)})});
    assert.equal(response.status, 200);
    liveState = await (await fetch(`${base}/api/state`)).json();
    assert.equal(liveState['aeon-products'].length, 89);
    await stop();

    base = await start(port, sourcePort);
    state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state['aeon-products'].length, 89);
    await stop();

    // An existing release with the old catalog is migrated once, retaining
    // private customer and order data along with its saved appearance.
    const oldState = {...seed, 'aeon-products':seed['aeon-products'].slice(0, 73),
      'aeon-customers':[{id:'customer-fixture'}], 'aeon-orders':[{code:'order-fixture'}]};
    fs.writeFileSync(path.join(dataDir, '.aeon-store.json'), JSON.stringify(oldState));
    base = await start(port, sourcePort);
    state = await (await fetch(`${base}/api/state`, {headers:{Cookie:cookie}})).json();
    assert.equal(state['aeon-products'].length, 90);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, '.aeon-store.json'), 'utf8'));
    assert.equal(saved['aeon-customers'][0].id, 'customer-fixture');
    assert.equal(saved['aeon-orders'][0].code, 'order-fixture');
    await stop();

    fs.rmSync(path.join(dataDir, '.aeon-store.json'));
    sourceAvailable = false;
    base = await start(port, sourcePort);
    state = await (await fetch(`${base}/api/state`)).json();
    const packaged = JSON.parse(fs.readFileSync(path.join(root, '.aeon-public-bootstrap.json'), 'utf8'));
    assert.equal(state['aeon-products'].length, packaged['aeon-products'].length);
    assert.deepEqual(state['aeon-products'], packaged['aeon-products']);
    assert.deepEqual(state['aeon-ui'], packaged['aeon-ui']);
    await stop();
    console.log('Standard catalog check passed: 90 Excel products load without the live domain; existing private data and later product edits survive restart.');
  } finally {
    await stop();
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(temporary, {recursive:true, force:true});
  }
}

run().catch(error => {console.error(error); process.exitCode = 1;});
