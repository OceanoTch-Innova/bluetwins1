'use strict';

const jwt = require('jsonwebtoken');

const { JWT_ACCESS_SECRET } = process.env;

const ACCESS_ISSUER = 'piscis-api';
const ACCESS_AUDIENCE = 'piscis-dashboard';
const ACCESS_TTL_SECONDS = 900;

function signAccessToken(identity, sessionId) {
  if (!JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET is not configured.');
  return jwt.sign(
    { email: identity.email, sid: sessionId },
    JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      subject: String(identity.id),
      issuer: ACCESS_ISSUER,
      audience: ACCESS_AUDIENCE,
      expiresIn: ACCESS_TTL_SECONDS,
    }
  );
}

function verifyAccessToken(token) {
  if (!JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET is not configured.');
  return jwt.verify(token, JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: ACCESS_ISSUER,
    audience: ACCESS_AUDIENCE,
    ignoreExpiration: true,
  });
}

module.exports = {
  ACCESS_AUDIENCE,
  ACCESS_ISSUER,
  ACCESS_TTL_SECONDS,
  signAccessToken,
  verifyAccessToken,
};
