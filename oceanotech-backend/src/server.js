if (require.main === module) require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const db = require('./db');
const authRoutes = require('./routes/auth');
const { router: twinRouter } = require('./routes/twin');
const readingsRouter = require('./routes/readings');
const { generalLimiter } = require('./middleware/rateLimiter');
const { expireInactiveSessions } = require('./services/piscis-session');

const app = express();

// Necesario para que express-rate-limit y req.ip funcionen bien detrás de un proxy
app.set('trust proxy', 1);

// ---------- CORS ----------
// Acepta orígenes explícitos y el origen null sólo en desarrollo (file://).
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5500')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        (origin === 'null' && process.env.NODE_ENV !== 'production') ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origen no permitido: ${origin}`));
    },
    credentials: true,
  })
);

// ---------- Seguridad base ----------
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(generalLimiter);

// ---------- Rutas ----------
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api/v1/twin', twinRouter);
app.use('/api/v1/readings', readingsRouter);

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// ---------- Manejador de errores ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.message?.startsWith('CORS')) {
    return res.status(403).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const PORT = Number(process.env.PORT || 4000);

function validateConfiguration() {
  const missing = ['JWT_ACCESS_SECRET', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'PISCIS_REFRESH_ENCRYPTION_KEY']
    .filter((key) => !process.env[key] || process.env[key].startsWith('cambia_'));
  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
    missing.push('CORS_ORIGIN');
  }
  if (process.env.JWT_ACCESS_SECRET && process.env.JWT_ACCESS_SECRET.length < 32) {
    missing.push('JWT_ACCESS_SECRET (minimum 32 characters)');
  }
  if (process.env.PISCIS_REFRESH_ENCRYPTION_KEY
      && !/^[a-f0-9]{64}$/iu.test(process.env.PISCIS_REFRESH_ENCRYPTION_KEY)) {
    missing.push('PISCIS_REFRESH_ENCRYPTION_KEY (32-byte hexadecimal value)');
  }
  try {
    const supabaseUrl = new URL(process.env.SUPABASE_URL || '');
    if (
      supabaseUrl.protocol !== 'https:'
      || supabaseUrl.pathname !== '/'
      || supabaseUrl.username
      || supabaseUrl.password
      || supabaseUrl.search
      || supabaseUrl.hash
    ) {
      missing.push('SUPABASE_URL (HTTPS origin)');
    }
  } catch {
    missing.push('SUPABASE_URL (HTTPS origin)');
  }
  try {
    db.prepare('SELECT identity_id FROM piscis_identities LIMIT 0');
    db.prepare('SELECT sid FROM piscis_sessions LIMIT 0');
    db.prepare('SELECT token_hash FROM piscis_refresh_history LIMIT 0');
  } catch {
    missing.push('Piscis auth migration (apply oceanotech-backend/migrations/0001_piscis_supabase_auth.sql)');
  }
  if (missing.length) {
    throw new Error(`Invalid backend configuration. Set: ${[...new Set(missing)].join(', ')}.`);
  }
}

function listen(host, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once('error', reject);
  });
}

async function startServer() {
  validateConfiguration();
  expireInactiveSessions();
  const sessionCleanup = setInterval(() => {
    try {
      expireInactiveSessions();
    } catch (err) {
      console.error('Piscis session cleanup failed:', err.message);
    }
  }, 60 * 1000);
  sessionCleanup.unref();

  if (process.env.NODE_ENV === 'production') {
    await listen('0.0.0.0', PORT);
    console.log(`OceanoTech AquaTwins backend listening on 0.0.0.0:${PORT}`);
    return;
  }

  // On Windows, localhost may resolve to ::1, so keep both local loopback bindings.
  const results = await Promise.allSettled([
    listen('127.0.0.1', PORT),
    listen('::1', PORT),
  ]);
  const started = results.filter((result) => result.status === 'fulfilled');
  if (started.length === 0) {
    throw results[0].reason;
  }
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`Could not bind a local address: ${result.reason.message}`);
    }
  }
  console.log(`OceanoTech AquaTwins backend — http://localhost:${PORT}`);
  console.log(`  POST /api/auth/supabase/exchange`);
  console.log(`  POST /api/auth/logout`);
  console.log(`  GET  /api/v1/twin/cages`);
  console.log(`  GET  /api/v1/twin/state/:twin_id`);
  console.log(`  POST /api/v1/twin/sync`);
  console.log(`  GET  /api/v1/twin/history/:twin_id`);
  console.log(`  POST /api/v1/readings`);
  console.log(`  GET  /api/v1/readings/latest`);
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error(`Backend startup failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = app;
module.exports.validateConfiguration = validateConfiguration;
