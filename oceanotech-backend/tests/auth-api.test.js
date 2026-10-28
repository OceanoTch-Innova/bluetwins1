'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { after, before, test } = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aquatwins-auth-'));
process.env.DB_PATH = path.join(testDirectory, 'auth.sqlite');
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.PISCIS_REFRESH_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
process.env.CORS_ORIGIN = 'https://frontend.test';
process.env.NODE_ENV = 'test';

const db = require('../src/db');
const oldRefresh = 'legacy-refresh-token-for-migration-test';
const oldUser = db.prepare(
  `INSERT INTO users (email, password_hash, name, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?)`
).run('legacy@example.test', 'not-a-real-password-hash', 'Legacy', Date.now(), Date.now());
db.prepare(
  `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
   VALUES (?, ?, ?, ?)`
).run(oldUser.lastInsertRowid, crypto.createHash('sha256').update(oldRefresh).digest('hex'), Date.now() + 60000, Date.now());
db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_piscis_supabase_auth.sql'), 'utf8'));

const app = require('../src/server');
const { validateConfiguration } = app;
const nativeFetch = global.fetch;
const supabaseUserId = crypto.randomUUID();
const supabaseEmail = 'authorized@example.test';
const identityId = crypto.randomUUID();
let remoteInvalid = false;
let remoteUnavailable = false;
let remoteLogoutFailure = false;
let remoteRefreshDelayMs = 0;
let remoteRefreshRequests = 0;
let exchangeIp = 1;
let server;
let baseUrl;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

global.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.origin !== 'https://supabase.test') return nativeFetch(input, init);

  if (url.pathname === '/auth/v1/user') {
    const token = new Headers(init.headers).get('authorization');
    if (token === 'Bearer invalid-access-token-value-1234567890') {
      return jsonResponse({ message: 'invalid' }, 401);
    }
    return jsonResponse({ id: supabaseUserId, email: supabaseEmail });
  }

  if (url.pathname === '/auth/v1/token') {
    remoteRefreshRequests += 1;
    if (remoteRefreshDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, remoteRefreshDelayMs));
    }
    if (remoteUnavailable) return jsonResponse({ message: 'unavailable' }, 503);
    if (remoteInvalid) return jsonResponse({ message: 'invalid refresh' }, 401);
    const requestBody = JSON.parse(init.body);
    if (!requestBody.refresh_token) return jsonResponse({ message: 'missing' }, 400);
    if (requestBody.refresh_token === 'invalid-supabase-refresh-token-value-123456') {
      return jsonResponse({ message: 'invalid refresh' }, 401);
    }
    return jsonResponse({
      access_token: 'rotated-supabase-access-token-1234567890',
      refresh_token: `rotated-supabase-refresh-token-${crypto.randomUUID()}`,
      user: { id: supabaseUserId, email: supabaseEmail },
    });
  }

  if (url.pathname === '/auth/v1/logout') {
    if (url.searchParams.get('scope') !== 'local') {
      return jsonResponse({ message: 'wrong scope' }, 400);
    }
    return remoteLogoutFailure ? jsonResponse({ message: 'unavailable' }, 503) : new Response(null, { status: 204 });
  }
  return jsonResponse({ message: 'unexpected endpoint' }, 404);
};

let serverUrl;
let testIdentity;

before(async () => {
  testIdentity = db.prepare(
    `INSERT INTO piscis_identities
       (identity_id, supabase_sub, email, display_name, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  ).run(identityId, supabaseUserId, supabaseEmail, 'Authorized User', Date.now(), Date.now());
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  serverUrl = baseUrl;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  global.fetch = nativeFetch;
  db.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

function exchangeRequest(body = {
  accessToken: 'valid-supabase-access-token-for-tests',
  refreshToken: 'valid-supabase-refresh-token-for-tests',
}, origin = process.env.CORS_ORIGIN) {
  return fetch(`${baseUrl}/api/auth/supabase/exchange`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Forwarded-For': `198.51.100.${exchangeIp++}`,
    },
    body: JSON.stringify(body),
  });
}

function extractPiscisCookie(response) {
  const header = response.headers.get('set-cookie') || '';
  const match = /(?:^|,\\s*)piscis_refresh=([A-Za-z0-9_-]+)/u.exec(header);
  assert.ok(match, 'exchange should set the Piscis refresh cookie');
  return match[1];
}

function expiredTokenFor(sessionId) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      email: supabaseEmail,
      sid: sessionId,
      iat: now - 901,
      exp: now - 1,
    },
    process.env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      subject: identityId,
      issuer: 'piscis-api',
      audience: 'piscis-dashboard',
    }
  );
}

async function createSession() {
  const response = await exchangeRequest();
  assert.equal(response.status, 200);
  const body = await response.json();
  return {
    accessToken: body.accessToken,
    user: body.user,
    cookie: extractPiscisCookie(response),
    sid: jwt.decode(body.accessToken).sid,
  };
}

test('auth migration revokes prior refresh sessions without creating Piscis identities', () => {
  const revoked = db.prepare('SELECT revoked FROM refresh_tokens WHERE token_hash = ?')
    .get(crypto.createHash('sha256').update(oldRefresh).digest('hex'));
  assert.equal(revoked.revoked, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM piscis_identities').get().count, 1);
});

test('auth migration can initialize its auth schema in an isolated fresh SQLite database', () => {
  const fresh = new Database(':memory:');
  try {
    fresh.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_piscis_supabase_auth.sql'), 'utf8'));
    const tables = fresh.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'piscis_%' ORDER BY name"
    ).all().map(({ name }) => name);
    assert.deepEqual(tables, ['piscis_identities', 'piscis_refresh_history', 'piscis_sessions']);
  } finally {
    fresh.close();
  }
});

test('backend configuration validates the Piscis auth schema using the isolated database', () => {
  assert.doesNotThrow(() => validateConfiguration());
});

test('legacy login, registration, and refresh cannot issue new sessions', async () => {
  for (const route of ['login', 'register']) {
    const response = await fetch(`${baseUrl}/api/auth/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.test', password: 'not-a-real-password' }),
    });
    assert.equal(response.status, 410);
  }
  const refresh = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: 'oceanotech_refresh=legacy-refresh-token-for-migration-test' },
  });
  assert.equal(refresh.status, 401);
  assert.equal(
    db.prepare('SELECT revoked FROM refresh_tokens WHERE token_hash = ?')
      .get(crypto.createHash('sha256').update(oldRefresh).digest('hex')).revoked,
    1
  );
});

test('exchange requires an exact allowed Origin and denies an unprovisioned Supabase identity', async () => {
  const badOrigin = await exchangeRequest(undefined, 'https://attacker.example');
  assert.equal(badOrigin.status, 403);

  const unprovisionedId = crypto.randomUUID();
  const originalFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin === 'https://supabase.test' && url.pathname === '/auth/v1/user') {
      return jsonResponse({ id: unprovisionedId, email: 'unprovisioned@example.test' });
    }
    return originalFetch(input, init);
  };
  try {
    const denied = await exchangeRequest();
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('set-cookie'), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('exchange rejects invalid Supabase access and refresh credentials without setting a Piscis cookie', async () => {
  const invalidAccess = await exchangeRequest({
    accessToken: 'invalid-access-token-value-1234567890',
    refreshToken: 'valid-supabase-refresh-token-for-tests',
  });
  assert.equal(invalidAccess.status, 401);
  assert.equal(invalidAccess.headers.get('set-cookie'), null);

  const invalidRefresh = await exchangeRequest({
    accessToken: 'valid-supabase-access-token-for-tests',
    refreshToken: 'invalid-supabase-refresh-token-value-123456',
  });
  assert.equal(invalidRefresh.status, 401);
  assert.equal(invalidRefresh.headers.get('set-cookie'), null);
});

test('exchange returns a Piscis JWT and a distinct HttpOnly cookie without exposing Supabase refresh tokens', async () => {
  const response = await exchangeRequest();
  assert.equal(response.status, 200);
  const body = await response.json();
  const cookieHeader = response.headers.get('set-cookie') || '';

  assert.equal(body.user.id, identityId);
  assert.equal(body.user.email, supabaseEmail);
  assert.ok(body.accessToken);
  assert.doesNotMatch(JSON.stringify(body), /valid-supabase-refresh-token|rotated-supabase-refresh-token/u);
  assert.match(cookieHeader, /piscis_refresh=/u);
  assert.match(cookieHeader, /HttpOnly/iu);
  assert.match(cookieHeader, /SameSite=Strict/iu);
  assert.match(cookieHeader, /Path=\/api(?:;|,)/u);
  assert.doesNotMatch(cookieHeader, /oceanotech_refresh=[^;,]+/u);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('valid Bearer requests check the active local session and cookie alone never authorizes data APIs', async () => {
  const session = await createSession();
  const profile = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(profile.status, 200);

  const readings = await fetch(`${baseUrl}/api/v1/readings/latest`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(readings.status, 200);

  const withoutBearer = await fetch(`${baseUrl}/api/v1/twin/cages`, {
    headers: { Cookie: `piscis_refresh=${session.cookie}` },
  });
  assert.equal(withoutBearer.status, 401);

  db.prepare('UPDATE piscis_identities SET enabled = 0 WHERE identity_id = ?').run(identityId);
  const disabled = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(disabled.status, 401);
  db.prepare('UPDATE piscis_identities SET enabled = 1 WHERE identity_id = ?').run(identityId);
});

test('expired Bearer requires its matching cookie, enforces Origin, and renews the cookie', async () => {
  const session = await createSession();
  const expired = expiredTokenFor(session.sid);
  const noCookie = await fetch(`${baseUrl}/api/v1/twin/cages`, {
    headers: { Authorization: `Bearer ${expired}`, Origin: process.env.CORS_ORIGIN },
  });
  assert.equal(noCookie.status, 401);

  const wrongOrigin = await fetch(`${baseUrl}/api/v1/twin/cages`, {
    headers: {
      Authorization: `Bearer ${expired}`,
      Cookie: `piscis_refresh=${session.cookie}`,
      Origin: 'https://attacker.example',
    },
  });
  assert.equal(wrongOrigin.status, 403);

  db.prepare('UPDATE piscis_sessions SET refresh_rotated_at = 0 WHERE sid = ?').run(session.sid);
  const authorized = await fetch(`${baseUrl}/api/v1/twin/cages`, {
    headers: {
      Authorization: `Bearer ${expired}`,
      Cookie: `piscis_refresh=${session.cookie}`,
      Origin: process.env.CORS_ORIGIN,
    },
  });
  assert.equal(authorized.status, 200);
  const renewedCookie = extractPiscisCookie(authorized);
  assert.notEqual(renewedCookie, session.cookie);
});

test('invalid JWTs do not fall back to the cookie, and concurrent rotations share one successor', async () => {
  const session = await createSession();
  const expired = expiredTokenFor(session.sid);
  const tampered = `${expired.slice(0, -1)}${expired.endsWith('a') ? 'b' : 'a'}`;
  const invalid = await fetch(`${baseUrl}/api/v1/twin/cages`, {
    headers: {
      Authorization: `Bearer ${tampered}`,
      Cookie: `piscis_refresh=${session.cookie}`,
      Origin: process.env.CORS_ORIGIN,
    },
  });
  assert.equal(invalid.status, 401);

  db.prepare('UPDATE piscis_sessions SET refresh_rotated_at = 0 WHERE sid = ?').run(session.sid);
  const responses = await Promise.all(Array.from({ length: 5 }, () =>
    fetch(`${baseUrl}/api/v1/twin/cages`, {
      headers: {
        Authorization: `Bearer ${expired}`,
        Cookie: `piscis_refresh=${session.cookie}`,
        Origin: process.env.CORS_ORIGIN,
      },
    })
  ));
  assert.ok(responses.every((response) => response.status === 200));
  const successors = responses.map(extractPiscisCookie);
  assert.equal(new Set(successors).size, 1);
});

test('concurrent remote revalidation uses one Supabase refresh-token rotation', async () => {
  const session = await createSession();
  db.prepare('UPDATE piscis_sessions SET supabase_verified_at = 0 WHERE sid = ?').run(session.sid);
  remoteRefreshRequests = 0;
  remoteRefreshDelayMs = 250;

  try {
    const responses = await Promise.all(Array.from({ length: 5 }, () =>
      fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
    ));
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(remoteRefreshRequests, 1);
  } finally {
    remoteRefreshDelayMs = 0;
  }
});

test('failed persistence after a remote rotation revokes the local session and fails closed', async () => {
  const session = await createSession();
  db.prepare('UPDATE piscis_sessions SET supabase_verified_at = 0 WHERE sid = ?').run(session.sid);

  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('SET supabase_refresh_token_encrypted = ?, supabase_verified_at = ?')) {
      return { run: () => { throw new Error('injected SQLite persistence failure'); } };
    }
    return originalPrepare(sql);
  };

  try {
    const failedRevalidation = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(failedRevalidation.status, 503);
  } finally {
    db.prepare = originalPrepare;
  }

  const stored = db.prepare(
    'SELECT status, supabase_refresh_token_encrypted FROM piscis_sessions WHERE sid = ?'
  ).get(session.sid);
  assert.equal(stored.status, 'remote_revoked');
  assert.equal(stored.supabase_refresh_token_encrypted, null);

  const followUp = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(followUp.status, 401);
});

test('reusing a rotated refresh cookie outside the grace window revokes that session', async () => {
  const session = await createSession();
  const expired = expiredTokenFor(session.sid);
  db.prepare('UPDATE piscis_sessions SET refresh_rotated_at = 0 WHERE sid = ?').run(session.sid);
  const first = await fetch(`${baseUrl}/api/v1/twin/cages`, {
    headers: {
      Authorization: `Bearer ${expired}`,
      Cookie: `piscis_refresh=${session.cookie}`,
      Origin: process.env.CORS_ORIGIN,
    },
  });
  assert.equal(first.status, 200);

  db.prepare('UPDATE piscis_sessions SET refresh_rotated_at = ? WHERE sid = ?')
    .run(Date.now() - 61000, session.sid);
  const replay = await fetch(`${baseUrl}/api/v1/twin/cages`, {
    headers: {
      Authorization: `Bearer ${expired}`,
      Cookie: `piscis_refresh=${session.cookie}`,
      Origin: process.env.CORS_ORIGIN,
    },
  });
  assert.equal(replay.status, 401);
  assert.equal(db.prepare('SELECT status FROM piscis_sessions WHERE sid = ?').get(session.sid).status, 'refresh_reuse');
});

test('idle and absolute session limits reject otherwise valid Bearer tokens', async () => {
  const idleSession = await createSession();
  db.prepare('UPDATE piscis_sessions SET last_activity_at = ? WHERE sid = ?')
    .run(Date.now() - 31 * 60 * 1000, idleSession.sid);
  const idleResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${idleSession.accessToken}` },
  });
  assert.equal(idleResponse.status, 401);
  assert.equal(
    db.prepare('SELECT status FROM piscis_sessions WHERE sid = ?').get(idleSession.sid).status,
    'expired_or_disabled'
  );

  const absoluteSession = await createSession();
  db.prepare('UPDATE piscis_sessions SET absolute_expires_at = ? WHERE sid = ?')
    .run(Date.now() - 1, absoluteSession.sid);
  const absoluteResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${absoluteSession.accessToken}` },
  });
  assert.equal(absoluteResponse.status, 401);
});

test('Supabase revalidation failure revokes the session and logout revokes locally before remote logout', async () => {
  const session = await createSession();
  db.prepare('UPDATE piscis_sessions SET supabase_verified_at = 0 WHERE sid = ?').run(session.sid);
  remoteInvalid = true;
  const remoteRevoked = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  remoteInvalid = false;
  assert.equal(remoteRevoked.status, 401);
  assert.equal(db.prepare('SELECT status FROM piscis_sessions WHERE sid = ?').get(session.sid).status, 'remote_revoked');

  const unavailableSession = await createSession();
  db.prepare('UPDATE piscis_sessions SET supabase_verified_at = 0 WHERE sid = ?').run(unavailableSession.sid);
  remoteUnavailable = true;
  const unavailable = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${unavailableSession.accessToken}` },
  });
  remoteUnavailable = false;
  assert.equal(unavailable.status, 503);
  assert.equal(db.prepare('SELECT status FROM piscis_sessions WHERE sid = ?').get(unavailableSession.sid).status, 'active');

  const logoutSession = await createSession();
  remoteLogoutFailure = true;
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Origin: process.env.CORS_ORIGIN,
      Cookie: `piscis_refresh=${logoutSession.cookie}`,
    },
  });
  remoteLogoutFailure = false;
  const logoutBody = await logout.json();
  assert.equal(logout.status, 200);
  assert.equal(logoutBody.ok, true);
  assert.equal(logoutBody.remoteRevoked, false);
  const stored = db.prepare('SELECT status, supabase_refresh_token_encrypted FROM piscis_sessions WHERE sid = ?')
    .get(logoutSession.sid);
  assert.equal(stored.status, 'revoked');
  assert.equal(stored.supabase_refresh_token_encrypted, null);
  assert.match(logout.headers.get('set-cookie') || '', /piscis_refresh=;/u);
});

test('successful logout revokes only its Piscis session and uses Supabase local scope', async () => {
  const session = await createSession();
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Origin: process.env.CORS_ORIGIN,
      Cookie: `piscis_refresh=${session.cookie}`,
    },
  });
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true, remoteRevoked: true });
  assert.equal(db.prepare('SELECT status FROM piscis_sessions WHERE sid = ?').get(session.sid).status, 'revoked');
  const protectedRequest = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(protectedRequest.status, 401);
});

test('health endpoint remains available and CORS rejects unconfigured origins', async () => {
  const health = await fetch(`${serverUrl}/api/health`);
  assert.equal(health.status, 200);
  const rejected = await fetch(`${serverUrl}/api/health`, {
    headers: { Origin: 'https://unconfigured.example' },
  });
  assert.equal(rejected.status, 403);
});
