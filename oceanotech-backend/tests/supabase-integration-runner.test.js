'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const backendDirectory = path.resolve(__dirname, '..');
const runnerPath = path.join(backendDirectory, 'scripts', 'run-supabase-integration.js');
const runner = require(runnerPath);
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'piscis-runner-preflight-'));
const projectReference = 'abcdefghijklmnopqrst';

after(() => {
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});

function writeFixture(name, { enabled = 'YES', approval = 'I_CONFIRM_THIS_IS_A_DEDICATED_TEST_PROJECT', clientReference = projectReference } = {}) {
  const configFile = path.join(fixtureDirectory, `${name}.env`);
  const authClientFile = path.join(fixtureDirectory, `${name}-auth-client.js`);
  fs.writeFileSync(authClientFile, `const SUPABASE_URL = 'https://${clientReference}.supabase.co';\n`);
  fs.writeFileSync(configFile, [
    `SUPABASE_INTEGRATION_ENABLED=${enabled}`,
    `SUPABASE_TEST_PROJECT_APPROVAL=${approval}`,
    `SUPABASE_TEST_PROJECT_REF=${projectReference}`,
    `SUPABASE_URL=https://${projectReference}.supabase.co`,
    'SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_key',
    'SUPABASE_TEST_AUTHORIZED_EMAIL=authorized@example.test',
    'SUPABASE_TEST_AUTHORIZED_PASSWORD=test-authorized-password',
    'SUPABASE_TEST_UNPROVISIONED_EMAIL=unprovisioned@example.test',
    'SUPABASE_TEST_UNPROVISIONED_PASSWORD=test-unprovisioned-password',
    '',
  ].join('\n'));
  return { configFile, authClientFile };
}

async function assertPreflightStops(options) {
  let runtimeStarted = false;
  let networkCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    networkCalls += 1;
    throw new Error('network must not be reached during preflight');
  };
  try {
    await assert.rejects(runner.main({
      ...options,
      onRuntimeStart: () => { runtimeStarted = true; },
    }));
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(runtimeStarted, false, 'invalid preflight must not start the integration backend');
  assert.equal(networkCalls, 0, 'invalid preflight must not make network requests');
}

test('runner syntax and formatting checks pass', () => {
  execFileSync(process.execPath, ['--check', runnerPath], { stdio: 'pipe' });
  const source = fs.readFileSync(runnerPath, 'utf8');
  for (const line of source.split(/\r?\n/u)) {
    assert.equal(/[ \t]$/u.test(line), false, 'runner source must not contain trailing whitespace');
  }
});

test('runner accepts only an explicitly confirmed remote logout result', () => {
  assert.doesNotThrow(() => runner.requireConfirmedRemoteLogout({ ok: true, remoteRevoked: true }));
  assert.throws(
    () => runner.requireConfirmedRemoteLogout({ ok: true, remoteRevoked: false }),
    /did not confirm remote Supabase session revocation/u
  );
  assert.throws(
    () => runner.requireConfirmedRemoteLogout({ ok: true }),
    /did not confirm remote Supabase session revocation/u
  );
});

test('runner preflight stops without configuration before runtime activity', async () => {
  await assertPreflightStops({
    configFile: path.join(fixtureDirectory, 'missing.env'),
    authClientFile: path.join(fixtureDirectory, 'missing-client.js'),
  });
});

test('runner preflight requires opt-in and dedicated-project approval', async () => {
  await assertPreflightStops(writeFixture('opt-in-missing', { enabled: 'NO' }));
  await assertPreflightStops(writeFixture('approval-missing', { approval: 'NOT_CONFIRMED' }));
});

test('runner preflight stops when client and backend project references differ', async () => {
  await assertPreflightStops(writeFixture('project-mismatch', {
    clientReference: 'zyxwvutsrqponmlkjihg',
  }));
});
