'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');

const backendDirectory = path.resolve(__dirname, '..');
const repositoryDirectory = path.resolve(backendDirectory, '..');
const configPath = path.join(backendDirectory, '.env.integration.local');
const migrationPath = path.join(backendDirectory, 'migrations', '0001_piscis_supabase_auth.sql');
const clientPath = path.join(repositoryDirectory, 'auth-client.js');
const APPROVAL_VALUE = 'I_CONFIRM_THIS_IS_A_DEDICATED_TEST_PROJECT';
const ENABLED_VALUE = 'YES';

function projectReference(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid Supabase URL configuration.');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !url.hostname.endsWith('.supabase.co')
  ) {
    throw new Error('Supabase URL must be a plain HTTPS project origin.');
  }
  return url.hostname.slice(0, -'.supabase.co'.length);
}

function extractClientProjectReference(authClientPath = clientPath) {
  const clientSource = fs.readFileSync(authClientPath, 'utf8');
  const match = /^\s*const\s+SUPABASE_URL\s*=\s*['"]([^'"]+)['"]\s*;/mu.exec(clientSource);
  if (!match) throw new Error('Could not identify the Supabase URL configured in auth-client.js.');
  return projectReference(match[1]);
}

function loadAndValidateConfiguration({
  configFile = configPath,
  authClientFile = clientPath,
} = {}) {
  if (!fs.existsSync(configFile)) {
    throw new Error('Missing oceanotech-backend/.env.integration.local; copy the example and configure a dedicated test project.');
  }

  const values = dotenv.parse(fs.readFileSync(configFile));
  if (values.SUPABASE_INTEGRATION_ENABLED !== ENABLED_VALUE) {
    throw new Error('Integration runner is not explicitly enabled.');
  }
  if (values.SUPABASE_TEST_PROJECT_APPROVAL !== APPROVAL_VALUE) {
    throw new Error('Dedicated test-project approval is missing.');
  }

  const required = [
    'SUPABASE_TEST_PROJECT_REF',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_TEST_AUTHORIZED_EMAIL',
    'SUPABASE_TEST_AUTHORIZED_PASSWORD',
    'SUPABASE_TEST_UNPROVISIONED_EMAIL',
    'SUPABASE_TEST_UNPROVISIONED_PASSWORD',
  ];
  for (const name of required) {
    if (!values[name] || /replace_with|REPLACE_WITH|example\.invalid/iu.test(values[name])) {
      throw new Error(`Missing or placeholder integration setting: ${name}.`);
    }
  }

  const configuredRef = projectReference(values.SUPABASE_URL);
  const requestedRef = values.SUPABASE_TEST_PROJECT_REF;
  const clientRef = extractClientProjectReference(authClientFile);
  if (!/^[a-z0-9]{20}$/u.test(requestedRef)) {
    throw new Error('Test project reference must be a 20-character Supabase project reference.');
  }
  if (configuredRef !== requestedRef || clientRef !== requestedRef) {
    throw new Error('Backend URL, browser client URL, and explicitly selected test project do not match.');
  }
  if (!values.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
    throw new Error('Integration config must use the test project publishable key, not a secret key.');
  }
  if (values.SUPABASE_TEST_AUTHORIZED_EMAIL.toLowerCase()
      === values.SUPABASE_TEST_UNPROVISIONED_EMAIL.toLowerCase()) {
    throw new Error('Authorized and unprovisioned test accounts must be different.');
  }

  return {
    supabaseUrl: new URL(values.SUPABASE_URL).origin,
    publishableKey: values.SUPABASE_PUBLISHABLE_KEY,
    authorizedEmail: values.SUPABASE_TEST_AUTHORIZED_EMAIL,
    authorizedPassword: values.SUPABASE_TEST_AUTHORIZED_PASSWORD,
    unprovisionedEmail: values.SUPABASE_TEST_UNPROVISIONED_EMAIL,
    unprovisionedPassword: values.SUPABASE_TEST_UNPROVISIONED_PASSWORD,
  };
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function supabasePasswordLogin(config, email, password) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: config.publishableKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function revokeTestSupabaseSession(config, accessToken) {
  if (!accessToken) return;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok && response.status !== 401) {
      process.stderr.write('Warning: could not confirm cleanup of one test-only Supabase session.\n');
    }
  } catch {
    process.stderr.write('Warning: could not confirm cleanup of one test-only Supabase session.\n');
  }
}

function minimalChildEnvironment(overrides) {
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, ...overrides };
}

function requireConfirmedRemoteLogout(logoutResult) {
  assert.equal(
    logoutResult?.remoteRevoked,
    true,
    'Piscis logout did not confirm remote Supabase session revocation'
  );
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForHealth(child, origin) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Isolated backend exited before becoming healthy.');
    }
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).status === 'ok') return;
      throw new Error('Isolated backend health check returned an unexpected response.');
    } catch (error) {
      if (error.message === 'Isolated backend health check returned an unexpected response.') throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Isolated backend did not become healthy in time.');
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = waitForExit(child);
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    exit,
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
  if (!stopped) {
    child.kill('SIGKILL');
    await exit;
  }
}

async function main({
  configFile = configPath,
  authClientFile = clientPath,
  onRuntimeStart,
} = {}) {
  const config = loadAndValidateConfiguration({ configFile, authClientFile });
  if (onRuntimeStart) onRuntimeStart();
  const port = await availablePort();
  const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'piscis-supabase-integration-'));
  const databasePath = path.join(testDirectory, 'piscis-integration.sqlite');
  const origin = `http://127.0.0.1:${port}`;
  const remoteSessions = new Set();
  let child;

  try {
    const db = new Database(databasePath);
    try {
      db.exec(fs.readFileSync(migrationPath, 'utf8'));
    } finally {
      db.close();
    }

    const invalidLogin = await supabasePasswordLogin(
      config,
      `invalid-${crypto.randomUUID()}@example.invalid`,
      'not-a-valid-test-password'
    );
    assert.ok([400, 401].includes(invalidLogin.response.status), 'invalid credentials should be rejected');

    const authorizedLogin = await supabasePasswordLogin(
      config,
      config.authorizedEmail,
      config.authorizedPassword
    );
    assert.equal(authorizedLogin.response.status, 200, 'authorized test account should sign in');
    assert.ok(
      authorizedLogin.body?.user?.id
      && authorizedLogin.body?.access_token
      && authorizedLogin.body?.refresh_token,
      'Supabase should return a complete test session'
    );
    remoteSessions.add(authorizedLogin.body.access_token);

    const identityId = crypto.randomUUID();
    const identityDb = new Database(databasePath);
    try {
      const now = Date.now();
      identityDb.prepare(
        `INSERT INTO piscis_identities
           (identity_id, supabase_sub, email, display_name, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      ).run(
        identityId,
        authorizedLogin.body.user.id,
        authorizedLogin.body.user.email || config.authorizedEmail,
        'Supabase integration test account',
        now,
        now
      );
    } finally {
      identityDb.close();
    }

    const unauthorizedLogin = await supabasePasswordLogin(
      config,
      config.unprovisionedEmail,
      config.unprovisionedPassword
    );
    assert.equal(unauthorizedLogin.response.status, 200, 'unprovisioned test account must exist in Supabase');
    assert.ok(
      unauthorizedLogin.body?.user?.id
      && unauthorizedLogin.body?.access_token
      && unauthorizedLogin.body?.refresh_token,
      'Supabase should return a complete unprovisioned test session'
    );
    remoteSessions.add(unauthorizedLogin.body.access_token);

    child = spawn(process.execPath, [path.join(backendDirectory, 'src', 'server.js')], {
      cwd: testDirectory,
      env: minimalChildEnvironment({
        DB_PATH: databasePath,
        NODE_ENV: 'test',
        PORT: String(port),
        JWT_ACCESS_SECRET: crypto.randomBytes(64).toString('hex'),
        SUPABASE_URL: config.supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
        PISCIS_REFRESH_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
        CORS_ORIGIN: origin,
      }),
      stdio: 'ignore',
    });
    await waitForHealth(child, origin);

    const exchange = async (session) => fetch(`${origin}/api/auth/supabase/exchange`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const authorizedExchange = await exchange(authorizedLogin.body);
    assert.equal(authorizedExchange.status, 200, 'provisioned test identity should exchange successfully');
    const authorizedResult = await authorizedExchange.json();
    assert.ok(authorizedResult.accessToken && authorizedResult.user, 'Piscis session response should be complete');
    const cookie = authorizedExchange.headers.get('set-cookie') || '';
    assert.match(cookie, /(?:^|,\s*)piscis_refresh=[A-Za-z0-9_-]+/u);
    assert.match(cookie, /httponly/iu);
    assert.match(cookie, /samesite=strict/iu);
    assert.match(cookie, /path=\/api(?:;|,|$)/iu);

    const unprovisionedExchange = await exchange(unauthorizedLogin.body);
    assert.equal(unprovisionedExchange.status, 403, 'unprovisioned test identity must be denied');
    assert.doesNotMatch(
      unprovisionedExchange.headers.get('set-cookie') || '',
      /piscis_refresh=/u,
      'unprovisioned test identity must not receive a Piscis cookie'
    );

    const logout = await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { origin, cookie: cookie.split(';')[0] },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(logout.status, 200, 'temporary Piscis session cleanup should complete');
    const logoutResult = await logout.json();
    assert.equal(logoutResult.ok, true);
    requireConfirmedRemoteLogout(logoutResult);
    remoteSessions.delete(authorizedLogin.body.access_token);

    process.stdout.write(
      'Supabase integration checks passed: project match, invalid credentials, authorized exchange, cookie, and unprovisioned identity denial.\n'
    );
  } finally {
    await stopChild(child);
    for (const accessToken of remoteSessions) {
      await revokeTestSupabaseSession(config, accessToken);
    }
    fs.rmSync(testDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(
      'Supabase integration runner stopped. Check the local test configuration and test-project setup; sensitive values are intentionally not displayed.\n'
    );
    process.exitCode = 1;
  });
}

module.exports = {
  extractClientProjectReference,
  loadAndValidateConfiguration,
  main,
  projectReference,
  requireConfirmedRemoteLogout,
};
