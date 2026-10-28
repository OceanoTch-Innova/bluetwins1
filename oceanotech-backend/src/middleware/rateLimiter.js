const rateLimit = require('express-rate-limit');

// Límite general para toda la API
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Límite estricto para login: frena fuerza bruta a nivel de IP,
// además del bloqueo por cuenta que se maneja en la base de datos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos desde esta red. Intenta de nuevo más tarde.' },
});

// Límite para registro, para evitar creación masiva de cuentas
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, loginLimiter, registerLimiter };
