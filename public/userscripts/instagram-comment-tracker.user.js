// ==UserScript==
// @name         AdScore Keeper - Instagram Comment Tracker
// @namespace    https://adscore-keeper.lovable.app
// @version      1.0.0
// @description  Rastreia automaticamente comentários feitos no Instagram
// @author       AdScore Keeper
// @match        https://www.instagram.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      webhooks.prudenciosolucoes.com.br
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ===== CONFIGURAÇÃO =====
    // Adicione aqui os usernames das contas que você quer monitorar (sem @)
    const MONITORED_ACCOUNTS = [
        'joaopedro.alvarengaa',
        // Adicione mais contas aqui se necessário
    ];

    const WEBHOOK_URL = 'https://webhooks.prudenciosolucoes.com.br/webhook/outbound-comment';
    // ========================

    let currentUsername = null;
    let lastCommentText = '';
    let isProcessing = false;

    console.log('[AdScore] Instagram Comment Tracker iniciado');
    console.log('[AdScore] Monitorando contas:', MONITORED_ACCOUNTS);

    // Detectar username logado
    function detectCurrentUser() {
        // Método 1: Cookie
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'ds_user_id') {
                // Temos o ID, mas precisamos do username
            }
        }

        // Método 2: Procurar no DOM
        const profileLinks = document.querySelectorAll('a[href^=\\\"/\\\"]');
        for (const link of profileLinks) {
            const img = link.querySelector('img[alt*=\\\"foto do perfil\\\"], img[alt*=\\\"profile picture\\\"]');
            if (img && img.alt) {
                const match = img.alt.match(/foto do perfil de (.+)/i) ||
                              img.alt.match(/(.+)'s profile picture/i);
                if (match) {
                    return match[1].toLowerCase();
                }
            }
        }

        // Método 3: Tentar do navigation
        const nav = document.querySelector('nav');
        if (nav) {
            const links = nav.querySelectorAll('a[href^=\\\"/\\\"]');
            for (const link of links) {
                const href = link.getAttribute('href');
                if (href && href.match(/^\\\\/[a-zA-Z0-9._]+\\\\/?$/) && !href.includes('/direct') && !href.includes('/explore')) {
                    const username = href.replace(/\\\\//g, '');
                    if (username && !['reels', 'explore', 'direct', 'accounts'].includes(username)) {
                        // Verificar se é um perfil
                        const img = link.querySelector('img');
                        if (img) {
                            return username.toLowerCase();
                        }
                    }
                }
            }
        }

        return null;
    }

    // Detectar dono do post atual
    function getPostOwner() {
        // Post page
        const articleHeader = document.querySelector('article header a[href^=\\\"/\\\"]');
        if (articleHeader) {
            const href = articleHeader.getAttribute('href');
            const match = href.match(/^\\\\/([^/]+)\\\\/?$/);
            if (match) return match[1];
        }

        // Modal
        const modalHeader = document.querySelector('div[role=\\\"dialog\\\"] article header a[href^=\\\"/\\\"]');
        if (modalHeader) {
            const href = modalHeader.getAttribute('href');
            const match = href.match(/^\\\\/([^/]+)\\\\/?$/);
            if (match) return match[1];
        }

        // Username link
        const usernameSpan = document.querySelector('article header a span');
        if (usernameSpan) {
            return usernameSpan.textContent;
        }

        return null;
    }

    // Obter URL do post
    function getPostUrl() {
        if (window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/')) {
            return window.location.href;
        }

        const modal = document.querySelector('div[role=\\\"dialog\\\"] article');
        if (modal) {
            const timeLink = modal.querySelector('a[href*=\\\"/p/\\\"], a[href*=\\\"/reel/\\\"]');
            if (timeLink) {
                return 'https://www.instagram.com' + timeLink.getAttribute('href');
            }
        }

        return window.location.href;
    }

    // Verificar se a conta atual está sendo monitorada
    function isMonitoredAccount(username) {
        if (!username) return false;
        return MONITORED_ACCOUNTS.some(acc =>
            acc.toLowerCase() === username.toLowerCase()
        );
    }

    // Enviar para webhook
    function sendToWebhook(data) {
        console.log('[AdScore] Enviando para webhook:', data);

        GM_xmlhttpRequest({
            method: 'POST',
            url: WEBHOOK_URL,
            headers: {
                'Content-Type': 'application/json'
            },
            data: JSON.stringify(data),
            onload: function(response) {
                console.log('[AdScore] Webhook response:', response.status);
                showNotification('✅ Comentário registrado!', data.comment_text.substring(0, 50) + '...');
            },
            onerror: function(error) {
                console.error('[AdScore] Webhook error:', error);
            }
        });
    }

    // Mostrar notificação
    function showNotification(title, message) {
        // Notificação visual no DOM
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            animation: slideInRight 0.3s ease;
            max-width: 300px;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);

        notification.innerHTML = `
            <div style=\\\"font-weight: 600; margin-bottom: 4px;\\\">${title}</div>
            <div style=\\\"font-size: 13px; opacity: 0.9;\\\">${message}</div>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideInRight 0.3s ease reverse';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Interceptar comentários via MutationObserver
    function setupCommentInterception() {
        // Monitorar textarea de comentário
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Procurar por textareas de comentário
                        const textareas = node.querySelectorAll ? node.querySelectorAll('textarea, [contenteditable=\\\"true\\\"]') : [];
                        textareas.forEach(setupTextareaMonitor);
                    }
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Também configurar os existentes
        document.querySelectorAll('textarea, [contenteditable=\\\"true\\\"]').forEach(setupTextareaMonitor);
    }

    // Monitorar textarea
    function setupTextareaMonitor(textarea) {
        if (textarea.dataset.adscoreMonitored) return;
        textarea.dataset.adscoreMonitored = 'true';

        // Capturar o texto antes de enviar
        textarea.addEventListener('input', (e) => {
            lastCommentText = e.target.value || e.target.textContent || '';
        });
    }

    // Interceptar fetch/XHR para detectar envio de comentário
    function interceptNetworkRequests() {
        // Interceptar fetch
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const [url, options] = args;

            // Detectar requisição de comentário
            if (url && typeof url === 'string' && url.includes('/api/v1/web/comments/') && options?.method === 'POST') {
                handleCommentRequest(url, options);
            }

            return originalFetch.apply(this, args);
        };

        // Interceptar XMLHttpRequest
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._adscoreUrl = url;
            this._adscoreMethod = method;
            return originalXHROpen.apply(this, [method, url, ...rest]);
        };

        XMLHttpRequest.prototype.send = function(body) {
            if (this._adscoreUrl && this._adscoreUrl.includes('/api/v1/web/comments/') && this._adscoreMethod === 'POST') {
                handleCommentRequest(this._adscoreUrl, { body });
            }
            return originalXHRSend.apply(this, [body]);
        };
    }

    // Processar requisição de comentário detectada
    function handleCommentRequest(url, options) {
        if (isProcessing) return;
        isProcessing = true;

        setTimeout(() => {
            isProcessing = false;

            // Detectar usuário atual
            currentUsername = detectCurrentUser();
            console.log('[AdScore] Usuário atual detectado:', currentUsername);

            if (!isMonitoredAccount(currentUsername)) {
                console.log('[AdScore] Conta não monitorada, ignorando');
                return;
            }

            const postOwner = getPostOwner();
            const postUrl = getPostUrl();

            // Ignorar comentários em posts próprios
            if (currentUsername && postOwner && currentUsername.toLowerCase() === postOwner.toLowerCase()) {
                console.log('[AdScore] Comentário em post próprio, ignorando');
                return;
            }

            // Extrair texto do comentário do body
            let commentText = lastCommentText;
            if (options?.body) {
                try {
                    if (typeof options.body === 'string') {
                        const params = new URLSearchParams(options.body);
                        commentText = params.get('comment_text') || commentText;
                    }
                } catch (e) {
                    // Usar lastCommentText
                }
            }

            if (commentText && commentText.trim()) {
                sendToWebhook({
                    account_name: currentUsername,
                    target_username: postOwner || 'unknown',
                    comment_text: commentText.trim(),
                    post_url: postUrl,
                    timestamp: new Date().toISOString(),
                    source: 'userscript'
                });
            }

            lastCommentText = '';
        }, 500);
    }

    // Inicializar
    function init() {
        currentUsername = detectCurrentUser();
        console.log('[AdScore] Usuário detectado:', currentUsername);
        console.log('[AdScore] É conta monitorada:', isMonitoredAccount(currentUsername));

        setupCommentInterception();
        interceptNetworkRequests();

        // Mostrar status
        if (isMonitoredAccount(currentUsername)) {
            showNotification('📊 AdScore Tracker Ativo', `Monitorando @${currentUsername}`);
        }
    }

    // Aguardar página carregar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1000);
    }
})();
