const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Política mínima: 10+ caracteres, al menos una mayúscula, una minúscula,
// un número y un símbolo. Súbela cuando conectes el módulo de seguridad extrema.
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim()) && email.length <= 254;
}

function isValidPassword(password) {
  return typeof password === 'string' && PASSWORD_RE.test(password) && password.length <= 128;
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

module.exports = { isValidEmail, isValidPassword, normalizeEmail };
