'use strict';

const crypto = require('node:crypto');
const db = require('../db');
const { signAccessToken } = require('../utils/jwt');

const COOKIE_NAME = 'piscis_refresh';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api',
  maxAge: 8 * 60 * 60 * 1000,
};
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const DEFAULT_REMOTE_REVALIDATION_MS = 5 * 60 * 1000;
const ROTATION_INTERVAL_MS = 15 * 60 * 1000;
const ROTATION_GRACE_MS = 60 * 1000;
const REMOTE_TIMEOUT_MS = 3000;
const LOCK_LEASE_MS = 10000;

class AuthServiceError extends Error {
  constructor(status, message, code = 'AUTH_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function configuration() {
  const base = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const encryptionKey = process.env.PISCIS_REFRESH_ENCRYPTION_KEY;
  if (!base || !apiKey || !/^[a-f0-9]{64}$/iu.test(encryptionKey || '')) {
    throw new AuthServiceError(503, 'El servicio de autenticación no está configurado.', 'CONFIG');
  }
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new AuthServiceError(503, 'La configuración de Supabase no es válida.', 'CONFIG');
  }
  if (
    url.protocol !== 'https:'
    || url.pathname !== '/'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new AuthServiceError(503, 'La configuración de Supabase no es válida.', 'CONFIG');
  }
  return { base: url.origin, apiKey, encryptionKey: Buffer.from(encryptionKey, 'hex') };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function encryptSecret(value) {
  const { encryptionKey } = configuration();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptSecret(value) {
  const { encryptionKey } = configuration();
  const [encodedIv, encodedTag, encodedCiphertext] = String(value || '').split('.');
  if (!encodedIv || !encodedTag || !encodedCiphertext) {
    throw new AuthServiceError(503, 'La sesión remota no se puede recuperar.', 'CREDENTIAL_STORAGE');
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey,
      Buffer.from(encodedIv, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AuthServiceError(503, 'La sesión remota no se puede recuperar.', 'CREDENTIAL_STORAGE');
  }
}

async function supabaseRequest(path, options = {}) {
  const { base, apiKey } = configuration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          apikey: apiKey,
          'content-type': 'application/json',
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new AuthServiceError(503, 'No se pudo verificar la sesión con Supabase.', 'REMOTE_UNAVAILABLE');
    }
    let body = null;
    if (response.status !== 204) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      const invalid = response.status === 400 || response.status === 401 || response.status === 403;
      throw new AuthServiceError(
        invalid ? 401 : 503,
        invalid ? 'La sesión de Supabase no es válida.' : 'Supabase no pudo verificar la sesión.',
        invalid ? 'REMOTE_INVALID' : 'REMOTE_UNAVAILABLE'
      );
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifySupabaseAccessToken(accessToken) {
  if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 8192) {
    throw new AuthServiceError(401, 'La sesión de Supabase no es válida.');
  }
  return supabaseRequest('/auth/v1/user', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

async function rotateSupabaseRefreshToken(refreshToken) {
  if (typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 8192) {
    throw new AuthServiceError(401, 'La sesión de Supabase no es válida.');
  }
  return supabaseRequest('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

function issueCookieToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createLocalAccessToken(identity, sid) {
  return signAccessToken(identity, sid);
}

async function exchangeSession(accessToken, refreshToken) {
  const verifiedUser = await verifySupabaseAccessToken(accessToken);
  if (!verifiedUser?.id) throw new AuthServiceError(401, 'La sesión de Supabase no es válida.');

  const identity = db.prepare(
    `SELECT identity_id AS id, supabase_sub, email, display_name, enabled
     FROM piscis_identities WHERE supabase_sub = ?`
  ).get(verifiedUser.id);
  if (!identity || identity.enabled !== 1) {
    throw new AuthServiceError(403, 'La identidad no está autorizada para acceder a Piscis.', 'NOT_AUTHORIZED');
  }

  const refreshed = await rotateSupabaseRefreshToken(refreshToken);
  if (
    refreshed?.user?.id !== verifiedUser.id
    || typeof refreshed.refresh_token !== 'string'
    || !refreshed.refresh_token
  ) {
    throw new AuthServiceError(401, 'La sesión de Supabase no es válida.');
  }

  const now = Date.now();
  const sid = crypto.randomUUID();
  const cookieToken = issueCookieToken();
  const identityView = {
    id: identity.id,
    email: verifiedUser.email || identity.email,
    name: identity.display_name,
  };

  db.prepare(
    `INSERT INTO piscis_sessions (
       sid, identity_id, refresh_token_hash, refresh_rotated_at,
       supabase_refresh_token_encrypted, supabase_verified_at,
       last_activity_at, created_at, absolute_expires_at, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    sid,
    identity.id,
    hashToken(cookieToken),
    now,
    encryptSecret(refreshed.refresh_token),
    now,
    now,
    now,
    now + ABSOLUTE_TIMEOUT_MS
  );
  db.prepare('INSERT INTO piscis_refresh_history (sid, token_hash, issued_at) VALUES (?, ?, ?)')
    .run(sid, hashToken(cookieToken), now);

  return {
    accessToken: createLocalAccessToken(identityView, sid),
    user: identityView,
    cookieToken,
  };
}

function getSession(sid, identityId) {
  return db.prepare(
    `SELECT s.*, i.email, i.display_name, i.enabled, i.supabase_sub
     FROM piscis_sessions s
     JOIN piscis_identities i ON i.identity_id = s.identity_id
     WHERE s.sid = ? AND s.identity_id = ?`
  ).get(sid, String(identityId));
}

function expireInactiveSessions(now = Date.now()) {
  db.prepare(
    `UPDATE piscis_sessions
     SET status = 'expired_or_disabled', revoked_at = ?,
         supabase_refresh_token_encrypted = NULL, refresh_token_hash = NULL,
         previous_refresh_token_hash = NULL, rotation_successor_encrypted = NULL,
         refresh_lock_id = NULL, refresh_lock_until = NULL
     WHERE status = 'active'
       AND (
         absolute_expires_at <= ?
         OR last_activity_at + ? <= ?
         OR identity_id IN (SELECT identity_id FROM piscis_identities WHERE enabled = 0)
       )`
  ).run(now, now, IDLE_TIMEOUT_MS, now);
  db.prepare(
    `DELETE FROM piscis_refresh_history
     WHERE sid IN (SELECT sid FROM piscis_sessions WHERE status != 'active')`
  ).run();
}

function revokeSession(sid, reason = 'revoked') {
  db.prepare(
    `UPDATE piscis_sessions
     SET status = ?, revoked_at = ?, supabase_refresh_token_encrypted = NULL,
         refresh_token_hash = NULL, previous_refresh_token_hash = NULL,
         rotation_successor_encrypted = NULL, refresh_lock_id = NULL, refresh_lock_until = NULL
     WHERE sid = ? AND status = 'active'`
  ).run(reason, Date.now(), sid);
  db.prepare('DELETE FROM piscis_refresh_history WHERE sid = ?').run(sid);
}

async function revalidateRemoteSession(session) {
  const now = Date.now();
  const revalidationMs = DEFAULT_REMOTE_REVALIDATION_MS;
  if (now - session.supabase_verified_at < revalidationMs) return;

  const lockId = crypto.randomUUID();
  const claimed = db.prepare(
    `UPDATE piscis_sessions SET refresh_lock_id = ?, refresh_lock_until = ?
     WHERE sid = ? AND status = 'active'
       AND (refresh_lock_until IS NULL OR refresh_lock_until < ?)`
  ).run(lockId, now + LOCK_LEASE_MS, session.sid, now);

  if (claimed.changes === 0) {
    for (let attempt = 0; attempt < 70; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const latest = getSession(session.sid, session.identity_id);
      if (!latest || latest.status !== 'active' || latest.enabled !== 1) {
        throw new AuthServiceError(401, 'La sesión fue revocada.');
      }
      if (Date.now() - latest.supabase_verified_at < revalidationMs) return;
    }
    throw new AuthServiceError(503, 'La verificación de sesión está en curso. Reintenta la solicitud.');
  }

  try {
    const current = getSession(session.sid, session.identity_id);
    if (!current || current.status !== 'active' || current.enabled !== 1) {
      throw new AuthServiceError(401, 'La sesión fue revocada.');
    }
    const oldRefreshToken = decryptSecret(current.supabase_refresh_token_encrypted);
    let refreshed;
    try {
      refreshed = await rotateSupabaseRefreshToken(oldRefreshToken);
      if (refreshed?.user?.id !== current.supabase_sub || !refreshed.refresh_token) {
        throw new AuthServiceError(401, 'La sesión remota no coincide con la identidad autorizada.', 'REMOTE_INVALID');
      }
    } catch (error) {
      if (error.code === 'REMOTE_INVALID' || error.status === 401) {
        revokeSession(session.sid, 'remote_revoked');
      }
      throw error;
    }

    let saved;
    try {
      saved = db.prepare(
        `UPDATE piscis_sessions
         SET supabase_refresh_token_encrypted = ?, supabase_verified_at = ?,
             refresh_lock_id = NULL, refresh_lock_until = NULL
         WHERE sid = ? AND status = 'active' AND refresh_lock_id = ?`
      ).run(encryptSecret(refreshed.refresh_token), Date.now(), session.sid, lockId);
    } catch {
      // Supabase has already consumed the predecessor refresh token. Never leave
      // a locally active session pointing at that predecessor after a failed save.
      revokeSession(session.sid, 'remote_revoked');
      throw new AuthServiceError(
        503,
        'No se pudo guardar la renovación remota; inicia sesión de nuevo.',
        'REMOTE_ROTATION_PERSIST_FAILED'
      );
    }
    if (saved.changes !== 1) {
      const latest = getSession(session.sid, session.identity_id);
      if (!latest || Date.now() - latest.supabase_verified_at >= revalidationMs) {
        throw new AuthServiceError(503, 'No se pudo guardar la verificación remota.');
      }
    }
  } finally {
    db.prepare(
      `UPDATE piscis_sessions SET refresh_lock_id = NULL, refresh_lock_until = NULL
       WHERE sid = ? AND refresh_lock_id = ?`
    ).run(session.sid, lockId);
  }
}

function cookieHashMatches(session, cookieToken) {
  const candidate = Buffer.from(hashToken(cookieToken));
  const current = Buffer.from(session.refresh_token_hash || '');
  if (candidate.length === current.length && crypto.timingSafeEqual(candidate, current)) {
    return 'current';
  }
  const previousHash = session.previous_refresh_token_hash || '';
  const previous = Buffer.from(previousHash);
  if (previousHash && candidate.length === previous.length && crypto.timingSafeEqual(candidate, previous)) {
    return 'previous';
  }
  return null;
}

function rotatePiscisCookie(session, cookieToken, now = Date.now()) {
  const match = cookieHashMatches(session, cookieToken);
  if (!match) throw new AuthServiceError(401, 'La cookie de sesión no es válida.');

  if (match === 'previous') {
    if (now - session.refresh_rotated_at > ROTATION_GRACE_MS) {
      revokeSession(session.sid, 'refresh_reuse');
      throw new AuthServiceError(401, 'La sesión fue revocada por reuso de una cookie anterior.');
    }
    return decryptSecret(session.rotation_successor_encrypted);
  }

  if (now - session.refresh_rotated_at < ROTATION_INTERVAL_MS) return null;

  const nextToken = issueCookieToken();
  const nextHash = hashToken(nextToken);
  const updated = db.transaction(() => {
    const result = db.prepare(
      `UPDATE piscis_sessions
       SET previous_refresh_token_hash = refresh_token_hash,
           refresh_token_hash = ?, refresh_rotated_at = ?,
           rotation_successor_encrypted = ?
       WHERE sid = ? AND status = 'active' AND refresh_token_hash = ?`
    ).run(
      nextHash,
      now,
      encryptSecret(nextToken),
      session.sid,
      session.refresh_token_hash
    );
    if (result.changes === 1) {
      db.prepare('INSERT INTO piscis_refresh_history (sid, token_hash, issued_at) VALUES (?, ?, ?)')
        .run(session.sid, nextHash, now);
    }
    return result;
  })();
  if (updated.changes !== 1) {
    const latest = getSession(session.sid, session.identity_id);
    if (
      latest
      && latest.status === 'active'
      && cookieHashMatches(latest, cookieToken) === 'previous'
      && now - latest.refresh_rotated_at <= ROTATION_GRACE_MS
    ) {
      return decryptSecret(latest.rotation_successor_encrypted);
    }
    throw new AuthServiceError(503, 'No se pudo rotar la cookie de sesión.');
  }
  return nextToken;
}

async function authorizeRequest({ sid, identityId, cookieToken, expired }) {
  const session = getSession(sid, identityId);
  const now = Date.now();
  if (
    !session
    || session.status !== 'active'
    || session.enabled !== 1
    || !session.supabase_refresh_token_encrypted
    || session.absolute_expires_at <= now
    || session.last_activity_at + IDLE_TIMEOUT_MS <= now
  ) {
    if (session && session.status === 'active') revokeSession(sid, 'expired_or_disabled');
    throw new AuthServiceError(401, 'La sesión está vencida, revocada o no autorizada.');
  }

  if (expired && !cookieToken) {
    throw new AuthServiceError(401, 'Se requiere la cookie de sesión para renovar el acceso.');
  }
  if (expired && !cookieHashMatches(session, cookieToken)) {
    const reused = findSessionByCookie(cookieToken);
    if (reused?.sid === session.sid) {
      revokeSession(session.sid, 'refresh_reuse');
      throw new AuthServiceError(401, 'La sesión fue revocada por reuso de una cookie anterior.');
    }
    throw new AuthServiceError(401, 'La cookie no corresponde a la sesión del token.');
  }

  await revalidateRemoteSession(session);
  const latest = getSession(sid, identityId);
  if (!latest || latest.status !== 'active' || latest.enabled !== 1) {
    throw new AuthServiceError(401, 'La sesión fue revocada.');
  }
  db.prepare('UPDATE piscis_sessions SET last_activity_at = ? WHERE sid = ? AND status = ?')
    .run(Date.now(), sid, 'active');

  const nextCookie = expired ? rotatePiscisCookie(latest, cookieToken) : null;
  return {
    user: {
      id: latest.identity_id,
      email: latest.email,
      name: latest.display_name,
    },
    nextCookie,
  };
}

function findSessionByCookie(cookieToken) {
  const tokenHash = hashToken(cookieToken);
  const session = db.prepare(
    `SELECT s.*, i.supabase_sub
     FROM piscis_sessions s JOIN piscis_identities i ON i.identity_id = s.identity_id
     JOIN piscis_refresh_history h ON h.sid = s.sid
     WHERE h.token_hash = ?`
  ).get(tokenHash);
  if (!session) return null;
  const match = cookieHashMatches(session, cookieToken);
  if (match === 'previous' && Date.now() - session.refresh_rotated_at <= ROTATION_GRACE_MS) {
    return session;
  }
  if (match !== 'current') {
    revokeSession(session.sid, 'refresh_reuse');
    return { ...session, replayDetected: true };
  }
  return session;
}

function revokeSessionByCookie(cookieToken) {
  const session = findSessionByCookie(cookieToken);
  if (!session) return null;
  let remoteRefreshToken = null;
  let remoteCredentialUnavailable = false;
  if (session.supabase_refresh_token_encrypted) {
    try {
      remoteRefreshToken = decryptSecret(session.supabase_refresh_token_encrypted);
    } catch {
      remoteCredentialUnavailable = true;
    }
  }
  revokeSession(session.sid, 'revoked');
  return {
    sid: session.sid,
    supabaseSub: session.supabase_sub,
    remoteRefreshToken,
    remoteCredentialUnavailable,
  };
}

async function revokeRemoteSession(refreshToken) {
  const refreshed = await rotateSupabaseRefreshToken(refreshToken);
  if (!refreshed?.access_token) {
    throw new AuthServiceError(503, 'No se pudo renovar la sesión para revocarla.');
  }
  return supabaseRequest('/auth/v1/logout?scope=local', {
    method: 'POST',
    headers: { authorization: `Bearer ${refreshed.access_token}` },
  });
}

module.exports = {
  AuthServiceError,
  ABSOLUTE_TIMEOUT_MS,
  COOKIE_NAME,
  COOKIE_OPTIONS,
  IDLE_TIMEOUT_MS,
  authorizeRequest,
  exchangeSession,
  expireInactiveSessions,
  findSessionByCookie,
  hashToken,
  revokeRemoteSession,
  revokeSessionByCookie,
};
