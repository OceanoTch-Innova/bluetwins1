/**
 * Creates a development/demo account from explicitly supplied environment values.
 * Usage: set DEMO_USER_EMAIL and DEMO_USER_PASSWORD, then run npm run seed.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { isValidEmail, isValidPassword, normalizeEmail } = require('./utils/validators');

const DEMO_EMAIL = process.env.DEMO_USER_EMAIL
  ? normalizeEmail(process.env.DEMO_USER_EMAIL)
  : null;
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD;
const DEMO_NAME = 'Demo User';

const SALT_ROUNDS = 12;

function seed() {
  if (!DEMO_EMAIL || !DEMO_PASSWORD) {
    throw new Error('Set DEMO_USER_EMAIL and DEMO_USER_PASSWORD to create a demo account.');
  }
  if (!isValidEmail(DEMO_EMAIL) || !isValidPassword(DEMO_PASSWORD)) {
    throw new Error('Demo account values do not meet the email and password requirements.');
  }

  const db = require('./db');
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL);
  if (existing) {
    console.log('[seed] The configured demo account already exists.');
    return;
  }

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, SALT_ROUNDS);
  const now = Date.now();

  db.prepare(
    `INSERT INTO users (email, password_hash, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(DEMO_EMAIL, passwordHash, DEMO_NAME, now, now);

  console.log('[seed] Configured demo account created.');
}

try {
  seed();
} catch (err) {
  console.error(`[seed] ${err.message}`);
  process.exitCode = 1;
}
