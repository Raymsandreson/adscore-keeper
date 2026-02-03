// AdScore Keeper - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const accountsList = document.getElementById('accountsList');
  const newAccountInput = document.getElementById('newAccount');
  const addAccountBtn = document.getElementById('addAccountBtn');
  const webhookUrlInput = document.getElementById('webhookUrl');
  const statusMessage = document.getElementById('statusMessage');

  let settings = {
    isEnabled: true,
    accounts: [],
    webhookUrl: 'https://webhooks.prudenciosolucoes.com.br/webhook/outbound-comment'
  };

  // Load settings
  chrome.storage.sync.get(['isEnabled', 'accounts', 'webhookUrl'], (result) => {
    settings = {
      isEnabled: result.isEnabled !== false,
      accounts: result.accounts || [],
      webhookUrl: result.webhookUrl || 'https://webhooks.prudenciosolucoes.com.br/webhook/outbound-comment'
    };
    
    updateUI();
  });

  function updateUI() {
    // Toggle
    if (settings.isEnabled) {
      toggleEnabled.classList.add('active');
    } else {
      toggleEnabled.classList.remove('active');
    }

    // Webhook URL
    webhookUrlInput.value = settings.webhookUrl;

    // Accounts list
    if (settings.accounts.length === 0) {
      accountsList.innerHTML = '<div class="empty-state">Nenhuma conta adicionada</div>';
    } else {
      accountsList.innerHTML = settings.accounts.map((account, index) => `
        <div class="account-item">
          <span>@${account.replace('@', '')}</span>
          <button class="remove-btn" data-index="${index}">×</button>
        </div>
      `).join('');
    }

    // Status
    if (settings.accounts.length === 0) {
      statusMessage.textContent = 'Adicione contas para monitorar';
      statusMessage.className = 'status';
    } else if (settings.isEnabled) {
      statusMessage.textContent = `✓ Monitorando ${settings.accounts.length} conta(s)`;
      statusMessage.className = 'status success';
    } else {
      statusMessage.textContent = 'Rastreamento pausado';
      statusMessage.className = 'status';
    }
  }

  function saveSettings() {
    chrome.storage.sync.set(settings, () => {
      updateUI();
    });
  }

  // Toggle enabled
  toggleEnabled.addEventListener('click', () => {
    settings.isEnabled = !settings.isEnabled;
    saveSettings();
  });

  // Add account
  addAccountBtn.addEventListener('click', () => {
    const username = newAccountInput.value.trim().replace('@', '');
    if (username && !settings.accounts.includes(username)) {
      settings.accounts.push(username);
      newAccountInput.value = '';
      saveSettings();
    }
  });

  // Enter key to add account
  newAccountInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addAccountBtn.click();
    }
  });

  // Remove account
  accountsList.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-btn')) {
      const index = parseInt(e.target.dataset.index);
      settings.accounts.splice(index, 1);
      saveSettings();
    }
  });

  // Webhook URL change
  webhookUrlInput.addEventListener('change', () => {
    settings.webhookUrl = webhookUrlInput.value.trim();
    saveSettings();
  });
});
