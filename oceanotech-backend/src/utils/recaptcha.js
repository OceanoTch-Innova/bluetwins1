/**
 * Verificación de reCAPTCHA (Google) — apagada por defecto.
 *
 * Cuando quieras activarla:
 *  1. Crea las claves en https://www.google.com/recaptcha/admin
 *  2. Pon RECAPTCHA_SECRET_KEY y RECAPTCHA_ENABLED=true en tu .env
 *  3. En el frontend, envía el token del widget como "recaptchaToken" en el body de /login
 *
 * No necesitas tocar las rutas: si RECAPTCHA_ENABLED es "true", auth.js ya llama
 * a verifyRecaptcha() antes de procesar el login.
 */

async function verifyRecaptcha(token, remoteIp) {
  const enabled = process.env.RECAPTCHA_ENABLED === 'true';
  if (!enabled) return { success: true, skipped: true };

  if (!token) return { success: false, reason: 'missing_token' };

  const params = new URLSearchParams({
    secret: process.env.RECAPTCHA_SECRET_KEY || '',
    response: token,
  });
  if (remoteIp) params.append('remoteip', remoteIp);

  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    return data; // { success, score?, action?, 'error-codes'? }
  } catch (err) {
    return { success: false, reason: 'verification_request_failed' };
  }
}

module.exports = { verifyRecaptcha };
