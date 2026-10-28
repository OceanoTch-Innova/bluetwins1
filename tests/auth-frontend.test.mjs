import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

function loadAuthFlows(auth, source, fetcher = async () => ({
  ok: true,
  async json() { return { accessToken: 'piscis-jwt', user: { id: 'identity-1' } }; },
})) {
  const window = {
    location: { origin: 'https://bluetwins.example.test' },
    supabaseLoginClient: { auth },
    supabaseRecoveryClient: { auth },
  };
  runInNewContext(source, { window, URL, TypeError, fetch: fetcher });
  return window.BlueTwinsAuth;
}

async function setupAuthFlows(auth, fetcher) {
  return loadAuthFlows(auth, await read('auth-flows.js'), fetcher);
}

test('login client is ephemeral while password recovery has its own persistent client', async () => {
  const clientArguments = [];
  const clients = [{ auth: {} }, { auth: {} }];
  const window = {
    supabase: {
      createClient(...args) {
        clientArguments.push(args);
        return clients[clientArguments.length - 1];
      },
    },
  };

  runInNewContext(await read('auth-client.js'), { window });

  assert.equal(clientArguments.length, 2);
  for (const args of clientArguments) {
    assert.equal(args[0], 'https://sisoekcscazcxrsryfqn.supabase.co');
    assert.match(args[1], /^sb_publishable_/u);
    assert.equal(args[2].auth.flowType, 'pkce');
  }
  assert.equal(clientArguments[0][2].auth.persistSession, false);
  assert.equal(clientArguments[0][2].auth.autoRefreshToken, false);
  assert.equal(clientArguments[0][2].auth.detectSessionInUrl, false);
  assert.equal(clientArguments[1][2].auth.persistSession, true);
  assert.equal(clientArguments[1][2].auth.autoRefreshToken, true);
  assert.equal(clientArguments[1][2].auth.detectSessionInUrl, true);
  assert.equal(window.supabaseLoginClient, clients[0]);
  assert.equal(window.supabaseRecoveryClient, clients[1]);
});

test('sign-in exchanges the ephemeral Supabase session and returns only the Piscis session', async () => {
  const expected = {
    session: { access_token: 'test-token', refresh_token: 'test-refresh-token' },
    user: { email: 'member@example.test' },
  };
  let credentials;
  let request;
  const auth = {
    async signInWithPassword(value) {
      credentials = value;
      return { data: expected, error: null };
    },
  };
  const flows = loadAuthFlows(auth, await read('auth-flows.js'), async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() { return { accessToken: 'piscis-access-token', user: { id: 'identity-1' } }; },
    };
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(await flows.signIn(' member@example.test ', 'not-logged'))),
    { accessToken: 'piscis-access-token', user: { id: 'identity-1' } }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(credentials)), {
    email: 'member@example.test',
    password: 'not-logged',
  });
  assert.equal(request.url, '/api/auth/supabase/exchange');
  assert.equal(request.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(request.options.body), {
    accessToken: 'test-token',
    refreshToken: 'test-refresh-token',
  });
  const source = await read('auth-flows.js');
  assert.match(source, /loginClient = null/u);
  assert.match(source, /supabaseLoginClient = null/u);
  assert.doesNotMatch(source, /signOut\s*\(/u);
});

test('sign-in surfaces Supabase credential errors without a success session', async () => {
  const invalidCredentials = Object.assign(new Error('Invalid login credentials'), { status: 400 });
  const flows = await setupAuthFlows({
    async signInWithPassword() {
      return { data: { user: null, session: null }, error: invalidCredentials };
    },
  });

  await assert.rejects(
    flows.signIn('member@example.test', 'wrong'),
    (error) => error === invalidCredentials
  );
  assert.match(flows.errorMessage(invalidCredentials, 'login'), /incorrectos/u);
});

test('sign-in rejects a failed backend session exchange', async () => {
  const flows = loadAuthFlows({
    async signInWithPassword() {
      return {
        data: {
          session: { access_token: 'test-token', refresh_token: 'test-refresh-token' },
          user: { email: 'member@example.test' },
        },
        error: null,
      };
    },
  }, await read('auth-flows.js'), async () => ({
    ok: false,
    status: 503,
    async json() { return { error: 'Backend unavailable.' }; },
  }));

  await assert.rejects(flows.signIn('member@example.test', 'test-password'), /Backend unavailable/u);
});

test('session recovery validates the user with Supabase and handles signed-out state', async () => {
  let userLookupCount = 0;
  const flows = await setupAuthFlows({
    async getSession() {
      return { data: { session: { access_token: 'test-token' } }, error: null };
    },
    async getUser() {
      userLookupCount += 1;
      return { data: { user: { id: 'user-1' } }, error: null };
    },
  });

  const current = await flows.getCurrentUser();
  assert.equal(current.user.id, 'user-1');
  assert.equal(userLookupCount, 1);

  const noSession = await (await setupAuthFlows({
    async getSession() {
      return { data: { session: null }, error: null };
    },
  })).getCurrentUser();
  assert.equal(noSession, null);
});

test('password reset sends a same-origin redirect to the reset page', async () => {
  let request;
  const flows = await setupAuthFlows({
    async resetPasswordForEmail(email, options) {
      request = { email, options };
      return { error: null };
    },
  });

  await flows.requestPasswordReset(' member@example.test ');
  assert.equal(request.email, 'member@example.test');
  assert.equal(request.options.redirectTo, 'https://bluetwins.example.test/reset-password.html');
});

test('password update uses Supabase Auth and reports policy errors', async () => {
  let updated;
  const policyError = Object.assign(new Error('Password rejected'), { status: 422 });
  const flows = await setupAuthFlows({
    async updateUser(value) {
      updated = value;
      return { data: null, error: policyError };
    },
  });

  await assert.rejects(
    flows.updatePassword('a-new-password'),
    (error) => error === policyError
  );
  assert.deepEqual(JSON.parse(JSON.stringify(updated)), { password: 'a-new-password' });
  assert.match(flows.errorMessage(policyError, 'password'), /10 caracteres/u);
});

test('login UI reports invalid Supabase credentials without navigating', async () => {
  const loginSource = await read('login.js');
  const handlers = {};
  const values = {
    loginForm: { addEventListener: (event, callback) => { handlers.login = callback; } },
    errorMsg: {
      textContent: '',
      classList: {
        toggle(name, enabled) {
          if (name === 'show') this.visible = enabled;
        },
      },
    },
    submitBtn: { disabled: false, textContent: 'Entrar' },
    email: { value: 'member@example.test' },
    password: { value: 'wrong-password' },
    darkToggle: { addEventListener() {} },
  };
  const redirected = [];
  const window = {
    location: {
      origin: 'https://bluetwins.example.test',
      search: '',
      replace: (url) => redirected.push(url),
    },
    BlueTwinsAuth: {
      async signIn() { throw Object.assign(new Error('invalid'), { status: 400 }); },
      errorMessage() { return 'Correo electrónico o contraseña incorrectos.'; },
    },
  };
  const document = {
    getElementById: (id) => values[id],
    documentElement: { classList: { toggle() {}, contains() { return false; } } },
  };

  runInNewContext(loginSource, { window, document, URL, URLSearchParams });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(values.submitBtn.disabled, false);
  await handlers.login({ preventDefault() {} });

  assert.equal(redirected.length, 0);
  assert.equal(values.errorMsg.classList.visible, true);
  assert.match(values.errorMsg.textContent, /incorrectos/u);
});

test('login UI does not navigate when the backend exchange fails', async () => {
  const loginSource = await read('login.js');
  const handlers = {};
  const values = {
    loginForm: { addEventListener: (event, callback) => { handlers.login = callback; } },
    errorMsg: {
      textContent: '',
      classList: {
        toggle(name, enabled) {
          if (name === 'show') this.visible = enabled;
        },
      },
    },
    submitBtn: { disabled: false, textContent: 'Entrar' },
    email: { value: 'member@example.test' },
    password: { value: 'correct-password' },
    darkToggle: { addEventListener() {} },
  };
  const redirected = [];
  const window = {
    location: {
      origin: 'https://bluetwins.example.test',
      search: '',
      replace: (url) => redirected.push(url),
    },
    localStorage: { setItem() { assert.fail('A failed exchange must not persist a session.'); } },
    BlueTwinsAuth: {
      async signIn() { throw Object.assign(new Error('Backend unavailable.'), { status: 503 }); },
      errorMessage() { return 'No se pudo conectar con el servicio de autenticación.'; },
    },
  };
  const document = {
    getElementById: (id) => values[id],
    documentElement: { classList: { toggle() {}, contains() { return false; } } },
  };

  runInNewContext(loginSource, { window, document, URL, URLSearchParams });
  await new Promise((resolve) => setImmediate(resolve));
  await handlers.login({ preventDefault() {} });

  assert.deepEqual(redirected, []);
  assert.equal(values.submitBtn.disabled, false);
  assert.equal(values.errorMsg.classList.visible, true);
});

test('successful exchanged login stores the Piscis token and redirects to the dashboard', async () => {
  const loginSource = await read('login.js');
  const handlers = {};
  const values = {
    loginForm: { addEventListener: (event, callback) => { handlers.login = callback; } },
    errorMsg: { textContent: '', classList: { toggle() {} } },
    submitBtn: { disabled: false, textContent: 'Entrar' },
    email: { value: 'member@example.test' },
    password: { value: 'correct-password' },
    darkToggle: { addEventListener() {} },
  };
  const redirected = [];
  const window = {
    location: {
      origin: 'https://bluetwins.example.test',
      search: '',
      replace: (url) => redirected.push(url),
    },
    localStorage: {
      values: new Map(),
      setItem(key, value) { this.values.set(key, value); },
    },
    BlueTwinsAuth: {
      async signIn() {
        return { accessToken: 'piscis-token', user: { id: 'identity-1', email: 'member@example.test' } };
      },
      errorMessage() { return 'auth error'; },
    },
  };
  const document = {
    getElementById: (id) => values[id],
    documentElement: { classList: { toggle() {}, contains() { return false; } } },
  };

  runInNewContext(loginSource, { window, document, URL, URLSearchParams });
  await new Promise((resolve) => setImmediate(resolve));
  await handlers.login({ preventDefault() {} });

  assert.deepEqual(redirected, ['/Dashboard/index.html']);
  assert.equal(window.localStorage.values.get('accessToken'), 'piscis-token');
  assert.equal(JSON.parse(window.localStorage.values.get('user')).id, 'identity-1');
  assert.equal(values.submitBtn.disabled, true);
  assert.equal(values.password.value, '');
});

test('password recovery callback reveals password form and submits the new password', async () => {
  const script = await read('reset-password.js');
  const handlers = {};
  const authElements = {
    requestPanel: { hidden: false },
    setPasswordPanel: { hidden: true },
    status: { textContent: '', style: {} },
    resetRequestForm: {
      addEventListener: (event, callback) => { handlers.request = callback; },
      querySelector: () => ({ disabled: false }),
      reset() {},
    },
    setPasswordForm: {
      addEventListener: (event, callback) => { handlers.update = callback; },
      querySelector: () => ({ disabled: false }),
      reset() {},
    },
    resetEmail: { value: 'member@example.test' },
    newPassword: { value: 'New-Password123!' },
    darkToggle: { addEventListener() {} },
  };
  const window = {
    location: { search: '?code=mock-code', hash: '', origin: 'https://bluetwins.example.test' },
    supabaseRecoveryClient: { auth: { onAuthStateChange() {} } },
    BlueTwinsAuth: {
      async getCurrentUser() { return { user: { id: 'user-1' } }; },
      async requestPasswordReset() {},
      async updatePassword(password) { return { user: { password } }; },
      errorMessage() { return 'auth error'; },
    },
  };
  const document = {
    getElementById: (id) => authElements[id],
    documentElement: { classList: { toggle() {}, contains() { return false; } } },
  };

  runInNewContext(script, { window, document, URLSearchParams });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(authElements.requestPanel.hidden, true);
  assert.equal(authElements.setPasswordPanel.hidden, false);
  await handlers.update({ preventDefault() {} });
  assert.match(authElements.status.textContent, /Contraseña actualizada/u);
});

test('Supabase Auth is limited to the login while the digital-twin dashboard stays unchanged', async () => {
  const [login, dashboard, loginJs, dashboardJs, authFlows, resetJs, resetHtml] = await Promise.all([
    read('index.html'),
    read('Dashboard/index.html'),
    read('login.js'),
    read('Dashboard/app.js'),
    read('auth-flows.js'),
    read('reset-password.js'),
    read('reset-password.html'),
  ]);
  const loginFlow = [login, loginJs, authFlows, resetJs, resetHtml].join('\n');

  assert.match(login, /@supabase\/supabase-js/u);
  assert.match(loginJs, /BlueTwinsAuth\.signIn/u);
  assert.match(authFlows, /\/api\/auth\/supabase\/exchange/u);
  assert.doesNotMatch(loginFlow, /\/api\/auth\/(?:login|me|refresh|logout|register)(?:['"`])/u);
  assert.doesNotMatch(loginFlow, /signUp\s*\(/u);
  assert.doesNotMatch(dashboard, /supabase|BlueTwinsAuth/u);
  assert.match(dashboardJs, /localStorage\.getItem\('accessToken'\)/u);
  assert.match(dashboardJs, /\/api\/v1\/twin\/state/u);
  assert.match(dashboardJs, /Authorization:\s*`Bearer/u);
  assert.match(dashboard, /id="twinStatusBar"/u);
  assert.match(login, /reset-password\.html/u);
  assert.match(authFlows, /resetPasswordForEmail/u);
  assert.match(authFlows, /updateUser/u);
  assert.match(dashboardJs, /function generateDemoSensorSample/u);
});
