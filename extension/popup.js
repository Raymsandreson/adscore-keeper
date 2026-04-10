document.addEventListener('DOMContentLoaded', async () => {
  const loginView = document.getElementById('loginView');
  const loggedInView = document.getElementById('loggedInView');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const errorMsg = document.getElementById('errorMsg');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');

  const hasExtensionContext = Boolean(globalThis.chrome?.runtime?.id);

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
  }

  function clearError() {
    errorMsg.textContent = '';
    errorMsg.classList.add('hidden');
  }

  function setLoading(isLoading) {
    loginBtn.disabled = isLoading;
    loginBtn.textContent = isLoading ? 'Entrando...' : 'Entrar';
  }

  function showLoggedIn(user) {
    loginView.classList.add('hidden');
    loggedInView.classList.remove('hidden');
    const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário';
    document.getElementById('userName').textContent = name;
    document.getElementById('userEmail').textContent = user.email || '';
    document.getElementById('avatarInitial').textContent = name.charAt(0).toUpperCase();
  }

  function resetToLogin() {
    loggedInView.classList.add('hidden');
    loginView.classList.remove('hidden');
    emailInput.value = '';
    passwordInput.value = '';
  }

  function disableStandaloneMode() {
    emailInput.disabled = true;
    passwordInput.disabled = true;
    loginBtn.disabled = true;
    showError('Abra pelo ícone da extensão no Chrome. Se abrir o popup.html direto, o login não funciona.');
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!hasExtensionContext) {
        reject(new Error('Abra pelo ícone da extensão no Chrome.'));
        return;
      }

      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || 'Não foi possível conectar à extensão.'));
          return;
        }
        resolve(response);
      });
    });
  }

  if (!hasExtensionContext) {
    disableStandaloneMode();
    return;
  }

  try {
    const res = await sendRuntimeMessage({ type: 'GET_SESSION' });
    if (res?.session?.user) {
      showLoggedIn(res.session.user);
    }
  } catch (error) {
    showError(error.message || 'Não foi possível iniciar a extensão.');
  }

  loginBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showError('Preencha email e senha');
      return;
    }

    clearError();
    setLoading(true);

    try {
      const res = await sendRuntimeMessage({ type: 'LOGIN', email, password });

      if (res?.error) {
        showError(typeof res.error === 'string' ? res.error : 'Não foi possível entrar');
        return;
      }

      if (res?.session?.user) {
        showLoggedIn(res.session.user);
        return;
      }

      showError('A extensão não recebeu resposta válida do login.');
    } catch (error) {
      showError(error.message || 'Falha ao entrar na extensão.');
    } finally {
      setLoading(false);
    }
  });

  [emailInput, passwordInput].forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        loginBtn.click();
      }
    });
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await sendRuntimeMessage({ type: 'LOGOUT' });
      resetToLogin();
      clearError();
    } catch (error) {
      showError(error.message || 'Falha ao sair da extensão.');
    }
  });
});
