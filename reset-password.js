'use strict';

(() => {
  const requestPanel = document.getElementById('requestPanel');
  const setPasswordPanel = document.getElementById('setPasswordPanel');
  const status = document.getElementById('status');
  const requestForm = document.getElementById('resetRequestForm');
  const passwordForm = document.getElementById('setPasswordForm');

  function showStatus(message, isError = true) {
    status.textContent = message;
    status.style.color = isError ? 'var(--error)' : 'var(--accent)';
  }

  function showPasswordForm() {
    requestPanel.hidden = true;
    setPasswordPanel.hidden = false;
    showStatus('');
  }

  const params = new URLSearchParams(window.location.search);
  const recoveryCallback = params.has('code')
    || params.get('type') === 'recovery'
    || window.location.hash.includes('type=recovery');
  if (params.has('error') || window.location.hash.includes('error=')) {
    showStatus('El enlace de recuperación expiró o no es válido. Solicita otro.');
  }

  document.getElementById('darkToggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    document.getElementById('darkToggle').textContent =
      document.documentElement.classList.contains('dark') ? 'Modo día' : 'Modo noche';
  });

  window.supabaseRecoveryClient?.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showPasswordForm();
  });

  (async () => {
    try {
      const current = await window.BlueTwinsAuth.getCurrentUser();
      if (current && recoveryCallback) showPasswordForm();
    } catch (error) {
      showStatus(window.BlueTwinsAuth.errorMessage(error, 'session'));
    }
  })();

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = requestForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showStatus('');
    try {
      await window.BlueTwinsAuth.requestPasswordReset(
        document.getElementById('resetEmail').value
      );
      showStatus('Si la cuenta existe, recibirás un correo con los pasos para continuar.', false);
      requestForm.reset();
    } catch (error) {
      showStatus(window.BlueTwinsAuth.errorMessage(error, 'reset'));
    } finally {
      button.disabled = false;
    }
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = passwordForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showStatus('');
    try {
      await window.BlueTwinsAuth.updatePassword(
        document.getElementById('newPassword').value
      );
      showStatus('Contraseña actualizada. Ya puedes continuar al dashboard.', false);
      passwordForm.reset();
    } catch (error) {
      showStatus(window.BlueTwinsAuth.errorMessage(error, 'password'));
    } finally {
      button.disabled = false;
    }
  });
})();
