'use strict';

const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

test('backend starts as an independent process and serves its health endpoint', async () => {
  const port = await availablePort();
  const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aquatwins-server-smoke-'));
  const backendDirectory = path.resolve(__dirname, '..');
  const databasePath = path.join(testDirectory, 'startup.sqlite');
  const serverPath = path.join(backendDirectory, 'src', 'server.js');
  const migrationPath = path.join(backendDirectory, 'migrations', '0001_piscis_supabase_auth.sql');
  const databaseModulePath = path.join(backendDirectory, 'src', 'db.js');
  const testEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: testDirectory,
    TMP: testDirectory,
    DB_PATH: databasePath,
    NODE_ENV: 'test',
    PORT: String(port),
    JWT_ACCESS_SECRET: crypto.randomBytes(64).toString('hex'),
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    PISCIS_REFRESH_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    CORS_ORIGIN: 'http://localhost:5500',
  };
  let child;
  let exitPromise;
  let stdout = '';
  let stderr = '';

  try {
    execFileSync(
      process.execPath,
      ['-e', `
        const fs = require('node:fs');
        const db = require(process.env.STARTUP_TEST_DB_MODULE);
        db.exec(fs.readFileSync(process.env.STARTUP_TEST_MIGRATION, 'utf8'));
        db.close();
      `],
      {
        cwd: testDirectory,
        env: {
          ...testEnv,
          STARTUP_TEST_DB_MODULE: databaseModulePath,
          STARTUP_TEST_MIGRATION: migrationPath,
        },
        stdio: 'pipe',
      }
    );

    child = spawn(process.execPath, [serverPath], {
      cwd: testDirectory,
      env: testEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    exitPromise = waitForExit(child);

    const deadline = Date.now() + 10000;
    let healthResponse;
    let lastError;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Backend exited before becoming healthy. stdout=${stdout} stderr=${stderr}`);
      }
      try {
        healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    assert.ok(
      healthResponse,
      `Backend did not serve /api/health before timeout: ${lastError?.message || 'no response'}; stdout=${stdout} stderr=${stderr}`
    );
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json()).status, 'ok');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const stopped = await Promise.race([
        exitPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (!stopped) {
        child.kill('SIGKILL');
        await exitPromise;
      }
    }
    fs.rmSync(testDirectory, { recursive: true, force: true });
  }
});
