'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const {
  AuthServiceError,
  COOKIE_NAME,
  COOKIE_OPTIONS,
  exchangeSession,
  hashToken,
  revokeRemoteSession,
  revokeSessionByCookie,
} = require('../services/piscis-session');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiter');

const router = express.Router();
const LEGACY_COOKIE_NAME = 'oceanotech_refresh';
const LEGACY_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth',
};

function explicitAllowedOrigin(req, res, next) {
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    return res.status(403).json({ error: 'Se requiere HTTPS.' });
  }
  const origin = req.get('origin');
  const allowed = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }
  return next();
}

function requestCookie(req, name, tokenPattern) {
  const values = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length !== 1 || !tokenPattern.test(values[0])) return null;
  return values[0];
}

function clearSessionCookies(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: COOKIE_OPTIONS.secure,
    sameSite: COOKIE_OPTIONS.sameSite,
    path: COOKIE_OPTIONS.path,
  });
  res.clearCookie(LEGACY_COOKIE_NAME, LEGACY_COOKIE_OPTIONS);
}

function authErrorResponse(res, error) {
  if (error instanceof AuthServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error('Piscis authentication route failed:', error.message);
  return res.status(503).json({ error: 'No se pudo completar la operación de autenticación.' });
}

router.post(
  '/supabase/exchange',
  loginLimiter,
  explicitAllowedOrigin,
  [
    body('accessToken').isString().isLength({ min: 20, max: 8192 }),
    body('refreshToken').isString().isLength({ min: 20, max: 8192 }),
  ],
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Datos de sesión inválidos.' });

    try {
      const result = await exchangeSession(req.body.accessToken, req.body.refreshToken);
      res.cookie(COOKIE_NAME, result.cookieToken, COOKIE_OPTIONS);
      res.clearCookie(LEGACY_COOKIE_NAME, LEGACY_COOKIE_OPTIONS);
      return res.json({
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (error) {
      return authErrorResponse(res, error);
    }
  }
);

router.post('/register', registerLimiter, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'El registro local está deshabilitado. Solicita acceso al administrador.' });
});

router.post('/login', loginLimiter, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'El inicio de sesión local está deshabilitado. Usa Supabase Auth.' });
});

router.post('/refresh', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const legacyToken = requestCookie(req, LEGACY_COOKIE_NAME, /^[A-Za-z0-9._-]{20,8192}$/u);
  if (legacyToken) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?')
      .run(hashToken(legacyToken));
  }
  res.clearCookie(LEGACY_COOKIE_NAME, LEGACY_COOKIE_OPTIONS);
  return res.status(401).json({ error: 'Las sesiones heredadas fueron deshabilitadas. Inicia sesión con Supabase.' });
});

router.post('/logout', explicitAllowedOrigin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const piscisToken = requestCookie(req, COOKIE_NAME, /^[A-Za-z0-9_-]{40,128}$/u);
  const legacyToken = requestCookie(req, LEGACY_COOKIE_NAME, /^[A-Za-z0-9._-]{20,8192}$/u);
  let remoteSession = null;

  try {
    if (piscisToken) remoteSession = revokeSessionByCookie(piscisToken);
    if (legacyToken) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?')
        .run(hashToken(legacyToken));
    }
  } catch (error) {
    clearSessionCookies(res);
    return authErrorResponse(res, error);
  }

  clearSessionCookies(res);
  let remoteRevoked = null;
  if (remoteSession?.remoteCredentialUnavailable) {
    remoteRevoked = false;
    console.warn('Piscis local session revoked; the stored Supabase credential could not be decrypted.');
  }
  if (remoteSession?.remoteRefreshToken) {
    try {
      await revokeRemoteSession(remoteSession.remoteRefreshToken);
      remoteRevoked = true;
    } catch {
      remoteRevoked = false;
      console.warn('Piscis local session revoked; Supabase local-session revocation could not be confirmed.');
    } finally {
      remoteSession.remoteRefreshToken = null;
    }
  }

  return res.json({
    ok: true,
    remoteRevoked,
    ...(remoteRevoked === false ? { notice: 'La sesión Piscis fue revocada; la revocación remota de Supabase no pudo confirmarse.' } : {}),
  });
});

router.get('/me', requireAuth, (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
    },
  });
});

module.exports = router;
