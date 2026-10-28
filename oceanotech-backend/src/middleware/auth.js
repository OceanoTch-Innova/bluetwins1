'use strict';

const { AuthServiceError, COOKIE_NAME, COOKIE_OPTIONS, authorizeRequest } =
  require('../services/piscis-session');
const { ACCESS_TTL_SECONDS, verifyAccessToken } = require('../utils/jwt');
const { requireTrustedCookieRequest } = require('./trustedOrigin');

function uniqueCookieValue(req, name) {
  const values = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{40,128}$/u.test(values[0])) return null;
  return values[0];
}

async function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer ([^\s]+)$/u.exec(authorization);
  if (!match) return res.status(401).json({ error: 'No autenticado.' });

  let payload;
  try {
    payload = verifyAccessToken(match[1]);
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    typeof payload.sub !== 'string'
    || typeof payload.sid !== 'string'
    || typeof payload.email !== 'string'
    || !Number.isInteger(payload.iat)
    || !Number.isInteger(payload.exp)
    || payload.iat > nowSeconds + 60
    || payload.exp <= payload.iat
    || payload.exp - payload.iat > ACCESS_TTL_SECONDS
  ) {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const expired = payload.exp <= nowSeconds;
  let cookieToken = null;
  if (expired) {
    try {
      requireTrustedCookieRequest(req);
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.message });
    }
    cookieToken = uniqueCookieValue(req, COOKIE_NAME);
    if (!cookieToken) {
      return res.status(401).json({ error: 'Se requiere una cookie de sesión válida.' });
    }
  }

  try {
    const authorizationResult = await authorizeRequest({
      sid: payload.sid,
      identityId: payload.sub,
      cookieToken,
      expired,
    });
    req.user = authorizationResult.user;
    if (authorizationResult.nextCookie) {
      res.cookie(COOKIE_NAME, authorizationResult.nextCookie, COOKIE_OPTIONS);
    }
    return next();
  } catch (error) {
    if (error instanceof AuthServiceError) {
      if (error.status === 401 && expired) {
        res.clearCookie(COOKIE_NAME, {
          httpOnly: true,
          secure: COOKIE_OPTIONS.secure,
          sameSite: COOKIE_OPTIONS.sameSite,
          path: COOKIE_OPTIONS.path,
        });
      }
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Piscis authentication middleware failed:', error.message);
    return res.status(503).json({ error: 'No se pudo verificar la sesión.' });
  }
}

module.exports = { requireAuth };
