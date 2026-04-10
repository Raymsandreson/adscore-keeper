// AdScore CRM - WhatsApp Integration Content Script
(function () {
  'use strict';

  const SYSTEM_URL = 'https://adscore-keeper.lovable.app';
  let currentPhone = null;
  let currentContactName = null;
  let currentLeadData = null;
  let currentInstanceName = null;
  let isLoggedIn = false;

  // ===================== DOM INJECTION =====================

  function injectUI() {
    if (document.getElementById('adscore-crm-fab')) return;

    // FAB Button
    const fab = document.createElement('button');
    fab.id = 'adscore-crm-fab';
    fab.innerHTML = '⚖️';
    fab.title = 'AdScore CRM';
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'adscore-crm-overlay';
    overlay.addEventListener('click', closePanel);
    document.body.appendChild(overlay);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'adscore-crm-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <h2>⚖️ AdScore CRM</h2>
        <button class="panel-close" id="adscore-panel-close">✕</button>
      </div>
      <div class="panel-body" id="adscore-panel-body">
        <div class="login-prompt" id="adscore-login-prompt">
          <div class="icon">🔒</div>
          <p>Faça login na extensão para usar as funcionalidades do CRM.</p>
          <p style="margin-top:8px; font-size:11px;">Clique no ícone da extensão na barra do Chrome.</p>
        </div>
        <div id="adscore-actions" style="display:none;">
          <div class="contact-info" id="adscore-contact-info">
            <div class="phone" id="adscore-phone">Selecione uma conversa</div>
            <div class="name" id="adscore-contact-name"></div>
            <div id="adscore-lead-info"></div>
          </div>

          <div class="section-title">Leads & Contatos</div>
          <button class="action-btn" data-action="vincular-lead">
            <span class="icon">🔗</span>
            <div><div class="label">Vincular Lead</div><div class="desc">Buscar e vincular lead existente</div></div>
          </button>
          <button class="action-btn" data-action="criar-lead-contato">
            <span class="icon">➕</span>
            <div><div class="label">Criar Lead + Contato</div><div class="desc">Novo lead e contato a partir da conversa</div></div>
          </button>
          <button class="action-btn" data-action="criar-contato">
            <span class="icon">👤</span>
            <div><div class="label">Criar Contato</div><div class="desc">Apenas criar contato sem lead</div></div>
          </button>

          <div class="section-title">Jurídico</div>
          <button class="action-btn" data-action="criar-caso">
            <span class="icon">⚖️</span>
            <div><div class="label">Criar Caso Jurídico</div><div class="desc">Abrir caso vinculado ao lead</div></div>
          </button>
          <button class="action-btn" data-action="gerar-documento">
            <span class="icon">📄</span>
            <div><div class="label">Gerar Documento para Assinatura</div><div class="desc">ZapSign via WhatsApp</div></div>
          </button>

          <div class="section-title">Agente IA</div>
          <button class="action-btn" data-action="ativar-agente">
            <span class="icon">🤖</span>
            <div><div class="label">Ativar Agente IA</div><div class="desc">Ativar ou trocar agente na conversa</div></div>
          </button>

          <div class="section-title">Conversa</div>
          <button class="action-btn" data-action="trancar-conversa">
            <span class="icon">🔒</span>
            <div><div class="label">Trancar Conversa</div><div class="desc">Marcar como privada</div></div>
          </button>
          <button class="action-btn" data-action="silenciar">
            <span class="icon">🔇</span>
            <div><div class="label">Silenciar Conversa</div><div class="desc">Pausar agente temporariamente</div></div>
          </button>
          <button class="action-btn" data-action="limpar-conversa">
            <span class="icon">🧹</span>
            <div><div class="label">Limpar Conversa</div><div class="desc">Hard reset do histórico e sessões</div></div>
          </button>

          <div id="adscore-status"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // Modal
    const modal = document.createElement('div');
    modal.id = 'adscore-crm-modal';
    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('adscore-panel-close').addEventListener('click', closePanel);
    panel.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', () => handleAction(btn.dataset.action));
    });

    checkSession();
  }

  // ===================== PANEL TOGGLE =====================

  function togglePanel() {
    const panel = document.getElementById('adscore-crm-panel');
    const overlay = document.getElementById('adscore-crm-overlay');
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
      closePanel();
    } else {
      panel.classList.add('open');
      overlay.classList.add('visible');
      detectCurrentConversation();
    }
  }

  function closePanel() {
    document.getElementById('adscore-crm-panel')?.classList.remove('open');
    document.getElementById('adscore-crm-overlay')?.classList.remove('visible');
    closeModal();
  }

  // ===================== SESSION CHECK =====================

  function checkSession() {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (res) => {
      isLoggedIn = !!res?.session?.user;
      const loginPrompt = document.getElementById('adscore-login-prompt');
      const actions = document.getElementById('adscore-actions');
      if (isLoggedIn) {
        loginPrompt.style.display = 'none';
        actions.style.display = 'block';
      } else {
        loginPrompt.style.display = 'block';
        actions.style.display = 'none';
      }
    });
  }

  // ===================== PHONE DETECTION =====================

  function detectCurrentConversation() {
    currentPhone = null;
    currentContactName = null;
    currentLeadData = null;

    // Try to find the conversation header
    const header = document.querySelector('header') || document.querySelector('[data-testid="conversation-header"]');
    if (!header) {
      updateContactInfo();
      return;
    }

    // Try to get contact name from header
    const nameEl = header.querySelector('span[title]') || header.querySelector('[data-testid="conversation-info-header-chat-title"]');
    if (nameEl) {
      const title = nameEl.getAttribute('title') || nameEl.textContent || '';
      currentContactName = title.trim();

      // Check if it's a phone number
      const cleaned = title.replace(/[\s\-\(\)\+]/g, '');
      if (/^\d{10,15}$/.test(cleaned)) {
        currentPhone = cleaned;
      }
    }

    // Try to find phone in contact info or profile panel
    if (!currentPhone) {
      // Check the about/profile section
      const phoneEls = document.querySelectorAll('span[title]');
      for (const el of phoneEls) {
        const text = (el.getAttribute('title') || '').replace(/[\s\-\(\)\+]/g, '');
        if (/^55\d{10,11}$/.test(text) || /^\d{10,13}$/.test(text)) {
          currentPhone = text;
          break;
        }
      }
    }

    // If we found a phone, look up the lead
    if (currentPhone) {
      lookupLead(currentPhone);
    }

    updateContactInfo();
  }

  function updateContactInfo() {
    const phoneEl = document.getElementById('adscore-phone');
    const nameEl = document.getElementById('adscore-contact-name');
    const leadInfoEl = document.getElementById('adscore-lead-info');

    if (currentPhone) {
      phoneEl.textContent = formatPhone(currentPhone);
      nameEl.textContent = currentContactName || '';
      if (currentLeadData) {
        leadInfoEl.innerHTML = `<span class="lead-badge">Lead: ${currentLeadData.lead_name}</span>`;
      } else {
        leadInfoEl.innerHTML = '<span style="font-size:11px; color:#6b7280;">Sem lead vinculado</span>';
      }
    } else if (currentContactName) {
      phoneEl.textContent = currentContactName;
      nameEl.textContent = 'Telefone não detectado';
      leadInfoEl.innerHTML = '';
    } else {
      phoneEl.textContent = 'Selecione uma conversa';
      nameEl.textContent = '';
      leadInfoEl.innerHTML = '';
    }
  }

  function formatPhone(phone) {
    if (phone.length === 13 && phone.startsWith('55')) {
      return `+${phone.slice(0,2)} (${phone.slice(2,4)}) ${phone.slice(4,9)}-${phone.slice(9)}`;
    }
    return phone;
  }

  async function lookupLead(phone) {
    const suffix = phone.slice(-8);
    chrome.runtime.sendMessage({
      type: 'API_CALL',
      endpoint: `leads?lead_phone=ilike.*${suffix}*&select=id,lead_name,lead_status,board_id,status&limit=1`,
      method: 'GET',
    }, (res) => {
      if (res?.data?.length > 0) {
        currentLeadData = res.data[0];
      } else {
        currentLeadData = null;
      }
      updateContactInfo();
    });
  }

  // ===================== ACTIONS =====================

  function handleAction(action) {
    if (!isLoggedIn) {
      showStatus('Faça login primeiro', 'error');
      return;
    }

    switch (action) {
      case 'vincular-lead': vincularLead(); break;
      case 'criar-lead-contato': criarLeadContato(); break;
      case 'criar-contato': criarContato(); break;
      case 'criar-caso': criarCaso(); break;
      case 'gerar-documento': gerarDocumento(); break;
      case 'ativar-agente': ativarAgente(); break;
      case 'trancar-conversa': trancarConversa(); break;
      case 'silenciar': silenciarConversa(); break;
      case 'limpar-conversa': limparConversa(); break;
    }
  }

  // --- Vincular Lead ---
  function vincularLead() {
    if (!currentPhone) { showStatus('Abra uma conversa primeiro', 'error'); return; }
    showModal('Vincular Lead', `
      <div class="form-group">
        <label>Buscar lead por nome ou telefone</label>
        <input type="text" id="modal-search" placeholder="Digite para buscar..." value="${currentPhone || ''}">
      </div>
      <div id="modal-results" style="max-height:200px; overflow-y:auto; font-size:12px;"></div>
    `, null, () => {
      const searchInput = document.getElementById('modal-search');
      let debounce = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => searchLeads(searchInput.value), 300);
      });
      searchLeads(searchInput.value);
    });
  }

  function searchLeads(query) {
    const container = document.getElementById('modal-results');
    if (!container) return;
    container.innerHTML = '<p style="color:#6b7280; text-align:center;">Buscando...</p>';

    const suffix = query.replace(/\D/g, '').slice(-8);
    const searchEndpoint = suffix.length >= 6
      ? `leads?lead_phone=ilike.*${suffix}*&select=id,lead_name,lead_phone,board_id&limit=10`
      : `leads?lead_name=ilike.*${encodeURIComponent(query)}*&select=id,lead_name,lead_phone,board_id&limit=10`;

    chrome.runtime.sendMessage({
      type: 'API_CALL',
      endpoint: searchEndpoint,
      method: 'GET',
    }, (res) => {
      if (!document.getElementById('modal-results')) return;
      if (!res?.data?.length) {
        container.innerHTML = '<p style="color:#6b7280; text-align:center;">Nenhum lead encontrado</p>';
        return;
      }
      container.innerHTML = res.data.map(lead => `
        <div style="padding:8px; border:1px solid #e5e7eb; border-radius:6px; margin-bottom:4px; cursor:pointer; transition:background .1s;"
             onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='#fff'"
             onclick="document.dispatchEvent(new CustomEvent('adscore-link-lead', {detail: '${lead.id}'}))">
          <strong>${lead.lead_name}</strong>
          <br><span style="color:#6b7280;">${lead.lead_phone || 'Sem telefone'}</span>
        </div>
      `).join('');
    });
  }

  document.addEventListener('adscore-link-lead', async (e) => {
    const leadId = e.detail;
    if (!currentPhone) return;

    chrome.runtime.sendMessage({
      type: 'API_CALL',
      endpoint: `leads?id=eq.${leadId}`,
      method: 'PATCH',
      body: { lead_phone: currentPhone },
    }, (res) => {
      if (res?.error) {
        showStatus('Erro ao vincular lead', 'error');
      } else {
        showStatus('Lead vinculado com sucesso!', 'success');
        closeModal();
        lookupLead(currentPhone);
      }
    });
  });

  // --- Criar Lead + Contato ---
  function criarLeadContato() {
    showModal('Criar Lead + Contato', `
      <div class="form-group">
        <label>Nome completo</label>
        <input type="text" id="modal-name" value="${currentContactName || ''}">
      </div>
      <div class="form-group">
        <label>Telefone</label>
        <input type="text" id="modal-phone" value="${currentPhone || ''}">
      </div>
      <div class="form-group">
        <label>Email (opcional)</label>
        <input type="email" id="modal-email">
      </div>
    `, () => {
      const name = document.getElementById('modal-name').value.trim();
      const phone = document.getElementById('modal-phone').value.replace(/\D/g, '');
      const email = document.getElementById('modal-email').value.trim();
      if (!name) { showStatus('Nome é obrigatório', 'error'); return; }

      // Create contact first
      chrome.runtime.sendMessage({
        type: 'API_CALL',
        endpoint: 'contacts',
        method: 'POST',
        body: { full_name: name, phone, email: email || null },
      }, (contactRes) => {
        if (contactRes?.error) {
          showStatus('Erro ao criar contato', 'error');
          return;
        }
        const contactId = contactRes.data?.[0]?.id;
        // Create lead
        chrome.runtime.sendMessage({
          type: 'API_CALL',
          endpoint: 'leads',
          method: 'POST',
          body: {
            lead_name: name,
            lead_phone: phone,
            contact_id: contactId || null,
            lead_status: 'active',
          },
        }, (leadRes) => {
          if (leadRes?.error) {
            showStatus('Contato criado, mas erro ao criar lead', 'error');
          } else {
            showStatus('Lead + Contato criados com sucesso!', 'success');
            closeModal();
            if (phone) lookupLead(phone);
          }
        });
      });
    });
  }

  // --- Criar Contato ---
  function criarContato() {
    showModal('Criar Contato', `
      <div class="form-group">
        <label>Nome completo</label>
        <input type="text" id="modal-name" value="${currentContactName || ''}">
      </div>
      <div class="form-group">
        <label>Telefone</label>
        <input type="text" id="modal-phone" value="${currentPhone || ''}">
      </div>
      <div class="form-group">
        <label>Email (opcional)</label>
        <input type="email" id="modal-email">
      </div>
    `, () => {
      const name = document.getElementById('modal-name').value.trim();
      const phone = document.getElementById('modal-phone').value.replace(/\D/g, '');
      if (!name) { showStatus('Nome é obrigatório', 'error'); return; }

      chrome.runtime.sendMessage({
        type: 'API_CALL',
        endpoint: 'contacts',
        method: 'POST',
        body: { full_name: name, phone, email: document.getElementById('modal-email').value.trim() || null },
      }, (res) => {
        if (res?.error) {
          showStatus('Erro ao criar contato', 'error');
        } else {
          showStatus('Contato criado com sucesso!', 'success');
          closeModal();
        }
      });
    });
  }

  // --- Criar Caso Jurídico ---
  function criarCaso() {
    if (!currentLeadData) {
      showStatus('Vincule um lead primeiro para criar um caso', 'error');
      return;
    }

    // Fetch nuclei for the select
    chrome.runtime.sendMessage({
      type: 'API_CALL',
      endpoint: 'specialized_nuclei?is_active=eq.true&select=id,name,prefix&order=name',
      method: 'GET',
    }, (res) => {
      const nuclei = res?.data || [];
      const nucleiOptions = nuclei.map(n => `<option value="${n.id}">${n.prefix} - ${n.name}</option>`).join('');

      showModal('Criar Caso Jurídico', `
        <div class="form-group">
          <label>Lead</label>
          <input type="text" value="${currentLeadData.lead_name}" disabled>
        </div>
        <div class="form-group">
          <label>Núcleo</label>
          <select id="modal-nucleus">
            <option value="">Sem núcleo</option>
            ${nucleiOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Título do caso</label>
          <input type="text" id="modal-title" value="Caso ${currentLeadData.lead_name}">
        </div>
        <div class="form-group">
          <label>Descrição</label>
          <textarea id="modal-desc" rows="3" placeholder="Descreva o caso..."></textarea>
        </div>
      `, () => {
        const nucleusId = document.getElementById('modal-nucleus').value || null;
        const title = document.getElementById('modal-title').value.trim();
        const desc = document.getElementById('modal-desc').value.trim();

        chrome.runtime.sendMessage({
          type: 'API_CALL',
          endpoint: 'legal_cases',
          method: 'POST',
          body: {
            lead_id: currentLeadData.id,
            title: title || `Caso ${currentLeadData.lead_name}`,
            description: desc || null,
            nucleus_id: nucleusId,
            status: 'active',
          },
        }, (res) => {
          if (res?.error) {
            showStatus('Erro ao criar caso', 'error');
          } else {
            showStatus('Caso jurídico criado com sucesso!', 'success');
            closeModal();
          }
        });
      });
    });
  }

  // --- Gerar Documento ---
  function gerarDocumento() {
    if (!currentPhone) { showStatus('Abra uma conversa primeiro', 'error'); return; }
    
    // Send the #gerar command via the system
    chrome.runtime.sendMessage({
      type: 'INVOKE_FUNCTION',
      functionName: 'send-whatsapp',
      body: {
        phone: currentPhone,
        message: '#gerar',
        instance_id: null, // Will use default
      },
    }, (res) => {
      if (res?.data?.success || res?.data) {
        showStatus('Comando #gerar enviado! O agente IA vai iniciar a coleta.', 'success');
      } else {
        showStatus('Erro ao enviar comando', 'error');
      }
    });
  }

  // --- Ativar Agente IA ---
  function ativarAgente() {
    if (!currentPhone) { showStatus('Abra uma conversa primeiro', 'error'); return; }

    // Fetch available agents
    chrome.runtime.sendMessage({
      type: 'API_CALL',
      endpoint: 'whatsapp_ai_agents?is_active=eq.true&select=id,name,shortcut_name&order=name',
      method: 'GET',
    }, (res) => {
      const agents = res?.data || [];
      if (agents.length === 0) {
        showStatus('Nenhum agente IA ativo encontrado', 'error');
        return;
      }

      const agentButtons = agents.map(a => `
        <button class="action-btn" style="margin-bottom:4px;" 
                onclick="document.dispatchEvent(new CustomEvent('adscore-activate-agent', {detail: '${a.shortcut_name || a.name}'}))">
          <span class="icon">🤖</span>
          <div><div class="label">${a.name}</div><div class="desc">${a.shortcut_name ? '#' + a.shortcut_name : ''}</div></div>
        </button>
      `).join('');

      showModal('Ativar Agente IA', `
        <p style="font-size:12px; color:#6b7280; margin-bottom:10px;">Selecione o agente para ativar nesta conversa:</p>
        ${agentButtons}
      `, null);
    });
  }

  document.addEventListener('adscore-activate-agent', (e) => {
    const shortcutName = e.detail;
    if (!currentPhone) return;

    chrome.runtime.sendMessage({
      type: 'INVOKE_FUNCTION',
      functionName: 'send-whatsapp',
      body: {
        phone: currentPhone,
        message: `#${shortcutName}`,
        instance_id: null,
      },
    }, (res) => {
      showStatus(`Agente ativado: ${shortcutName}`, 'success');
      closeModal();
    });
  });

  // --- Trancar Conversa ---
  function trancarConversa() {
    if (!currentPhone) { showStatus('Abra uma conversa primeiro', 'error'); return; }

    chrome.runtime.sendMessage({
      type: 'API_CALL',
      endpoint: `whatsapp_conversation_agents?phone=ilike.*${currentPhone.slice(-8)}*&select=id,is_locked`,
      method: 'GET',
    }, (res) => {
      const conv = res?.data?.[0];
      const newLocked = !(conv?.is_locked);
      
      if (conv) {
        chrome.runtime.sendMessage({
          type: 'API_CALL',
          endpoint: `whatsapp_conversation_agents?id=eq.${conv.id}`,
          method: 'PATCH',
          body: { is_locked: newLocked },
        }, () => {
          showStatus(newLocked ? '🔒 Conversa trancada' : '🔓 Conversa destrancada', 'success');
        });
      } else {
        showStatus('Conversa não encontrada no sistema', 'error');
      }
    });
  }

  // --- Silenciar Conversa ---
  function silenciarConversa() {
    if (!currentPhone) { showStatus('Abra uma conversa primeiro', 'error'); return; }

    showModal('Silenciar Conversa', `
      <div class="form-group">
        <label>Silenciar por</label>
        <select id="modal-duration">
          <option value="30">30 minutos</option>
          <option value="60">1 hora</option>
          <option value="120">2 horas</option>
          <option value="480">8 horas</option>
          <option value="1440">24 horas</option>
        </select>
      </div>
    `, () => {
      const minutes = parseInt(document.getElementById('modal-duration').value);
      const pausedUntil = new Date(Date.now() + minutes * 60000).toISOString();

      chrome.runtime.sendMessage({
        type: 'API_CALL',
        endpoint: `whatsapp_conversation_agents?phone=ilike.*${currentPhone.slice(-8)}*`,
        method: 'PATCH',
        body: { human_paused_until: pausedUntil },
      }, () => {
        showStatus(`🔇 Conversa silenciada por ${minutes} minutos`, 'success');
        closeModal();
      });
    });
  }

  // --- Limpar Conversa ---
  function limparConversa() {
    if (!currentPhone) { showStatus('Abra uma conversa primeiro', 'error'); return; }

    showModal('Limpar Conversa', `
      <p style="font-size:13px; color:#374151;">Tem certeza que deseja limpar o histórico desta conversa?</p>
      <p style="font-size:11px; color:#6b7280; margin-top:6px;">Isso irá resetar sessões de coleta e histórico do agente IA.</p>
    `, () => {
      chrome.runtime.sendMessage({
        type: 'INVOKE_FUNCTION',
        functionName: 'send-whatsapp',
        body: {
          phone: currentPhone,
          message: '#limpar',
          instance_id: null,
        },
      }, () => {
        showStatus('🧹 Conversa limpa com sucesso!', 'success');
        closeModal();
      });
    });
  }

  // ===================== MODAL HELPERS =====================

  function showModal(title, bodyHtml, onConfirm, onOpen = null) {
    const modal = document.getElementById('adscore-crm-modal');
    modal.innerHTML = `
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" onclick="document.getElementById('adscore-crm-modal').classList.remove('visible')">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${onConfirm ? `
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="document.getElementById('adscore-crm-modal').classList.remove('visible')">Cancelar</button>
          <button class="btn btn-primary" id="modal-confirm-btn">Confirmar</button>
        </div>
      ` : ''}
    `;
    modal.classList.add('visible');

    if (onConfirm) {
      document.getElementById('modal-confirm-btn').addEventListener('click', onConfirm);
    }
    if (onOpen) onOpen();
  }

  function closeModal() {
    document.getElementById('adscore-crm-modal')?.classList.remove('visible');
  }

  function showStatus(message, type = 'info') {
    const container = document.getElementById('adscore-status');
    if (!container) return;
    container.innerHTML = `<div class="status-msg ${type}">${message}</div>`;
    setTimeout(() => { if (container) container.innerHTML = ''; }, 4000);
  }

  // ===================== OBSERVERS =====================

  // Watch for conversation changes
  const observer = new MutationObserver(() => {
    if (document.getElementById('adscore-crm-panel')?.classList.contains('open')) {
      detectCurrentConversation();
    }
  });

  // Listen for storage changes (login/logout from popup)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.session) {
      checkSession();
    }
  });

  // ===================== INIT =====================

  function init() {
    // Wait for WhatsApp to load
    const checkReady = setInterval(() => {
      if (document.querySelector('#app') || document.querySelector('[data-testid="chat-list"]') || document.querySelector('header')) {
        clearInterval(checkReady);
        injectUI();

        // Start observing DOM changes for conversation switches
        const appEl = document.querySelector('#app') || document.body;
        observer.observe(appEl, { childList: true, subtree: true, characterData: true });
      }
    }, 1000);
  }

  init();
})();
