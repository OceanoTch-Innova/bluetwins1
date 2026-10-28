'use strict';

const { AuthServiceError } = require('../services/piscis-session');

function allowedOrigins() {
  return (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function hasTrustedOrigin(req) {
  const origin = req.get('origin');
  if (origin) return allowedOrigins().includes(origin);
  return req.get('sec-fetch-site') === 'same-origin';
}

function requireTrustedOrigin(req, res, next) {
  if (!hasTrustedOrigin(req)) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }
  return next();
}

function requireTrustedCookieRequest(req) {
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    throw new AuthServiceError(403, 'Se requiere HTTPS.', 'HTTPS_REQUIRED');
  }
  if (!hasTrustedOrigin(req)) {
    throw new AuthServiceError(403, 'Origen no permitido.', 'CSRF');
  }
}

module.exports = { hasTrustedOrigin, requireTrustedCookieRequest, requireTrustedOrigin };
