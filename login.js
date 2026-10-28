'use strict';

(() => {
  const form = document.getElementById('loginForm');
  const errorMessage = document.getElementById('errorMsg');
  const submitButton = document.getElementById('submitBtn');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');

  function showMessage(message, success = false) {
    errorMessage.textContent = message;
    errorMessage.classList.toggle('show', Boolean(message));
    errorMessage.classList.toggle('success', success);
  }

  document.getElementById('darkToggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    document.getElementById('darkToggle').textContent =
      document.documentElement.classList.contains('dark') ? 'Modo día' : 'Modo noche';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    submitButton.disabled = true;
    submitButton.textContent = 'Verificando…';

    try {
      const result = await window.BlueTwinsAuth.signIn(emailInput.value, passwordInput.value);
      if (!result.accessToken || !result.user) {
        throw new Error('El backend no devolvió una sesión Piscis válida.');
      }
      window.localStorage.setItem('accessToken', result.accessToken);
      window.localStorage.setItem('user', JSON.stringify(result.user));
      passwordInput.value = '';
      window.location.replace('/Dashboard/index.html');
    } catch (error) {
      showMessage(window.BlueTwinsAuth.errorMessage(error, 'login'));
      submitButton.disabled = false;
      submitButton.textContent = 'Entrar';
    }
  });
})();
