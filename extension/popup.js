document.addEventListener('DOMContentLoaded', async () => {
  const loginView = document.getElementById('loginView');
  const loggedInView = document.getElementById('loggedInView');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const errorMsg = document.getElementById('errorMsg');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');

  // Check existing session
  chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (res) => {
    if (res?.session?.user) {
      showLoggedIn(res.session.user);
    }
  });

  loginBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      showError('Preencha email e senha');
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Entrando...';
    errorMsg.classList.add('hidden');

    chrome.runtime.sendMessage({ type: 'LOGIN', email, password }, (res) => {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Entrar';
      if (res?.error) {
        showError(typeof res.error === 'string' ? res.error : 'Credenciais inválidas');
      } else if (res?.session?.user) {
        showLoggedIn(res.session.user);
      }
    });
  });

  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });

  logoutBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LOGOUT' }, () => {
      loggedInView.classList.add('hidden');
      loginView.classList.remove('hidden');
      emailInput.value = '';
      passwordInput.value = '';
    });
  });

  function showLoggedIn(user) {
    loginView.classList.add('hidden');
    loggedInView.classList.remove('hidden');
    const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário';
    document.getElementById('userName').textContent = name;
    document.getElementById('userEmail').textContent = user.email || '';
    document.getElementById('avatarInitial').textContent = name.charAt(0).toUpperCase();
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
  }
});
