'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function sqlText(value) {
  if (value === null || value === undefined) return 'NULL';
  const hex = Buffer.from(String(value), 'utf8').toString('hex');
  return `CAST(X'${hex}' AS TEXT)`;
}

function sqlInteger(value) {
  if (value === null || value === undefined) return 'NULL';
  if (!Number.isSafeInteger(value)) {
    throw new Error('A user record contains a non-safe integer field.');
  }
  return String(value);
}

function exportUsers(databasePath, outputPath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const users = db.prepare(
      `SELECT id, email, password_hash, name, failed_attempts, locked_until, created_at, updated_at
       FROM users ORDER BY id`
    ).all();
    const statements = users.map((user) => (
      `INSERT INTO users (id, email, password_hash, name, failed_attempts, locked_until, created_at, updated_at) VALUES (`
      + `${sqlInteger(user.id)}, ${sqlText(user.email)}, ${sqlText(user.password_hash)}, ${sqlText(user.name)}, `
      + `${sqlInteger(user.failed_attempts)}, ${sqlInteger(user.locked_until)}, `
      + `${sqlInteger(user.created_at)}, ${sqlInteger(user.updated_at)}) `
      + 'ON CONFLICT(email) DO NOTHING;'
    ));
    fs.writeFileSync(outputPath, `${statements.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    return users.length;
  } finally {
    db.close();
  }
}

const [databaseArgument, outputArgument] = process.argv.slice(2);
if (!databaseArgument || !outputArgument) {
  console.error('Usage: node scripts/export-auth-users.js <sqlite-file> <output-sql-file>');
  process.exitCode = 1;
} else {
  try {
    const databasePath = path.resolve(databaseArgument);
    const outputPath = path.resolve(outputArgument);
    const count = exportUsers(databasePath, outputPath);
    console.log(`Exported ${count} user records to ${outputPath}.`);
    console.log('The SQL contains password hashes; keep it private and remove it after import.');
  } catch (error) {
    console.error(`Could not export auth users: ${error.message}`);
    process.exitCode = 1;
  }
}
