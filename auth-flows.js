'use strict';

(() => {
  let loginClient = window.supabaseLoginClient;

  function clientForLogin() {
    if (!loginClient) {
      const error = new Error('Authentication service is unavailable.');
      error.name = 'AuthClientUnavailableError';
      throw error;
    }
    return loginClient;
  }

  function clientForRecovery() {
    if (!window.supabaseRecoveryClient) {
      const error = new Error('Authentication service is unavailable.');
      error.name = 'AuthClientUnavailableError';
      throw error;
    }
    return window.supabaseRecoveryClient;
  }

  async function signIn(email, password) {
    let data;
    const { data: sessionData, error } = await clientForLogin().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    data = sessionData;
    const session = data?.session;
    if (!session?.access_token || !session.refresh_token || !data.user) {
      throw new Error('Supabase Auth returned no complete session.');
    }

    let response;
    try {
      response = await fetch('/api/auth/supabase/exchange', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        }),
      });
    } finally {
      data = null;
    }

    let result;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    if (!response.ok || !result?.accessToken || !result.user) {
      const exchangeError = new Error(result?.error || 'No se pudo completar el intercambio de sesión.');
      exchangeError.status = response.status;
      throw exchangeError;
    }

    loginClient = null;
    window.supabaseLoginClient = null;
    return result;
  }

  async function getCurrentUser() {
    const auth = clientForRecovery().auth;
    const { data: sessionData, error: sessionError } = await auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) return null;

    const { data: userData, error: userError } = await auth.getUser();
    if (userError) throw userError;
    return userData.user ? { session: sessionData.session, user: userData.user } : null;
  }

  async function requestPasswordReset(email) {
    const redirectTo = new URL('/reset-password.html', window.location.origin).href;
    const { error } = await clientForRecovery().auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw error;
  }

  async function updatePassword(password) {
    const { data, error } = await clientForRecovery().auth.updateUser({ password });
    if (error) throw error;
    return data;
  }

  function errorMessage(error, context) {
    if (!error || error.name === 'AuthClientUnavailableError'
      || error.name === 'AuthRetryableFetchError'
      || error instanceof TypeError
      || /network|fetch|timeout|timed out/iu.test(error.message || '')) {
      return 'No se pudo conectar con el servicio de autenticación. Comprueba tu conexión e inténtalo de nuevo.';
    }
    if (context === 'login' && [400, 401].includes(error.status)) {
      return 'Correo electrónico o contraseña incorrectos.';
    }
    if (context === 'login' && error.status === 403) {
      return 'Esta cuenta todavía no está autorizada para Piscis. Contacta al administrador.';
    }
    if (context === 'login' && error.status === 410) {
      return 'El servicio de autenticación local está deshabilitado. Contacta al administrador.';
    }
    if (error.status === 429) {
      return 'Se realizaron demasiados intentos. Espera un momento e inténtalo de nuevo.';
    }
    if (context === 'password' && [400, 422].includes(error.status)) {
      return 'La contraseña no cumple los requisitos configurados. Usa al menos 10 caracteres e inténtalo de nuevo.';
    }
    if (context === 'session') {
      return 'No se pudo verificar la sesión. Inicia sesión de nuevo.';
    }
    if (context === 'reset') {
      return 'No se pudo procesar la solicitud. Comprueba los datos e inténtalo de nuevo.';
    }
    return 'No se pudo completar la operación. Inténtalo de nuevo o contacta al administrador.';
  }

  window.BlueTwinsAuth = Object.freeze({
    signIn,
    getCurrentUser,
    requestPasswordReset,
    updatePassword,
    errorMessage,
  });
})();
