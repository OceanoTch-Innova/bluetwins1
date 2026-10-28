import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createWorker } from '../src/worker.mjs';

const previewOrigin = 'https://preview.example.workers.dev';
const apiOrigin = 'https://api.example.test';

test('allows an explicit loopback-only HTTP API when running Worker development locally', async (t) => {
  const server = createServer((request, response) => {
    assert.equal(request.url, '/api/health');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ status: 'ok', service: 'test-api' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const response = await createWorker().fetch(
    new Request('http://localhost:8787/api/health'),
    {
      API_ORIGIN: `http://127.0.0.1:${port}`,
      ALLOW_INSECURE_LOCAL_API: 'true',
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'test-api' });
});

test('proxies /api/health to the configured API origin', async () => {
  let forwarded;
  const worker = createWorker(async (request) => {
    forwarded = request;
    return Response.json({ status: 'ok' });
  });

  const response = await worker.fetch(
    new Request(`${previewOrigin}/api/health?probe=1`, {
      headers: { authorization: 'Bearer health-token', cookie: 'session=abc' },
    }),
    { API_ORIGIN: apiOrigin }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(forwarded.url, `${apiOrigin}/api/health?probe=1`);
  assert.equal(forwarded.method, 'GET');
  assert.equal(forwarded.headers.get('authorization'), 'Bearer health-token');
  assert.equal(forwarded.headers.get('cookie'), 'session=abc');
});

test('proxies digital-twin, readings, and sensor API routes instead of returning 501', async () => {
  const forwardedUrls = [];
  const worker = createWorker(async (request) => {
    forwardedUrls.push(request.url);
    return Response.json({ forwarded: true });
  });
  const paths = [
    '/api/v1/twin/state',
    '/api/v1/readings/latest',
    '/api/sensores/limpios',
  ];

  for (const path of paths) {
    const response = await worker.fetch(
      new Request(`${previewOrigin}${path}`),
      { API_ORIGIN: apiOrigin }
    );
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { forwarded: true });
  }

  assert.deepEqual(
    forwardedUrls,
    paths.map((path) => `${apiOrigin}${path}`)
  );
});

test('rejects HTTP API_ORIGIN values outside loopback, even during local development', async () => {
  let called = false;
  const worker = createWorker(async () => {
    called = true;
    return new Response('unexpected');
  });

  const response = await worker.fetch(
    new Request('http://localhost:8787/api/health'),
    {
      API_ORIGIN: 'http://api.example.test',
      ALLOW_INSECURE_LOCAL_API: 'true',
    }
  );

  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test('does not activate the HTTP development exception for a deployed Worker request', async () => {
  let called = false;
  const worker = createWorker(async () => {
    called = true;
    return new Response('unexpected');
  });

  const response = await worker.fetch(
    new Request(`${previewOrigin}/api/health`),
    {
      API_ORIGIN: 'http://127.0.0.1:4000',
      ALLOW_INSECURE_LOCAL_API: 'true',
    }
  );

  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test('forwards method, query, body, auth headers, cookies, and Set-Cookie', async () => {
  let forwarded;
  const worker = createWorker(async (request) => {
    forwarded = request;
    return new Response('{"accessToken":"issued-by-api"}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'oceanotech_refresh=refresh-token; HttpOnly; Secure; SameSite=Strict; Path=/api/auth',
      },
    });
  });
  const payload = JSON.stringify({ email: 'user@example.test', password: 'not-a-real-password' });

  const response = await worker.fetch(
    new Request(`${previewOrigin}/api/auth/login?from=preview`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer existing-token',
        cookie: 'existing=session-cookie',
        'content-type': 'application/json',
      },
      body: payload,
    }),
    { API_ORIGIN: apiOrigin }
  );

  assert.equal(forwarded.url, `${apiOrigin}/api/auth/login?from=preview`);
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.headers.get('authorization'), 'Bearer existing-token');
  assert.equal(forwarded.headers.get('cookie'), 'existing=session-cookie');
  assert.equal(forwarded.headers.get('content-type'), 'application/json');
  assert.equal(await forwarded.text(), payload);
  assert.match(response.headers.get('set-cookie'), /oceanotech_refresh=refresh-token/i);
  assert.equal(await response.json().then(({ accessToken }) => accessToken), 'issued-by-api');
});

test('returns a clear 503 without calling an API when API_ORIGIN is absent', async () => {
  let called = false;
  const worker = createWorker(async () => {
    called = true;
    return new Response('unexpected');
  });

  const response = await worker.fetch(new Request(`${previewOrigin}/api/health`), {});

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /API_ORIGIN/i);
  assert.equal(called, false);
});

test('returns 502 when the configured API cannot be reached', async () => {
  const worker = createWorker(async () => {
    throw new TypeError('network unavailable');
  });

  const response = await worker.fetch(
    new Request(`${previewOrigin}/api/health`),
    { API_ORIGIN: apiOrigin }
  );

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /unavailable/i);
});

test('rejects API_ORIGIN URLs with paths, query strings, fragments, or credentials', async () => {
  const worker = createWorker(async () => {
    throw new Error('must not be called');
  });

  for (const origin of [
    'https://api.example.test/not-an-origin',
    'https://api.example.test?environment=preview',
    'https://api.example.test#fragment',
    'https://username:password@api.example.test',
  ]) {
    const response = await worker.fetch(
      new Request(`${previewOrigin}/api/health`),
      { API_ORIGIN: origin }
    );
    assert.equal(response.status, 503, origin);
  }
});

test('uses the Static Assets binding for non-API requests', async () => {
  let requestedPath;
  const worker = createWorker();
  const response = await worker.fetch(new Request(`${previewOrigin}/Dashboard/index.html`), {
    ASSETS: {
      fetch(request) {
        requestedPath = new URL(request.url).pathname;
        return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
      },
    },
  });

  assert.equal(requestedPath, '/Dashboard/index.html');
  assert.equal(await response.text(), '<!doctype html>');
});

test('asset exclusion rules cover secrets, SQLite files, tests, dependencies, and the backend', async () => {
  const ignore = await readFile(new URL('../.assetsignore', import.meta.url), 'utf8');

  for (const rule of [
    '/oceanotech-backend/',
    '/src/',
    '/**/node_modules/',
    '/**/tests/',
    '/**/*.sqlite',
    '/**/*.db',
    '/.dev.vars',
    '/.dev.vars.*',
  ]) {
    assert.match(ignore, new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
