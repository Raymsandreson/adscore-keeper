import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Copy, Check, Zap, Settings, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InstagramAccount {
  id: string;
  instagram_id: string;
  account_name: string;
}

export const UserscriptInstaller = () => {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [copied, setCopied] = useState(false);
  const [showScript, setShowScript] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    const { data } = await supabase
      .from("instagram_accounts")
      .select("id, instagram_id, account_name")
      .eq("is_active", true);
    
    if (data) {
      setAccounts(data);
    }
  };

  const accountsList = accounts.map(a => `        '${a.account_name.replace("@", "")}'`).join(",\n");

  const generateScript = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://gliigkupoebmlbwyvijp.supabase.co';
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38';
    
    return `// ==UserScript==
// @name         AdScore Keeper - Instagram Comment Tracker
// @namespace    https://adscore-keeper.lovable.app
// @version      1.1.0
// @description  Rastreia automaticamente comentários feitos no Instagram
// @author       AdScore Keeper
// @match        https://www.instagram.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      gliigkupoebmlbwyvijp.supabase.co
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ===== CONFIGURAÇÃO =====
    const MONITORED_ACCOUNTS = [
${accountsList}
    ];
    const SUPABASE_URL = '${supabaseUrl}';
    const SUPABASE_ANON_KEY = '${supabaseAnonKey}';
    // ========================

    let currentUsername = null;
    let lastCommentText = '';
    let isProcessing = false;

    console.log('[AdScore] Tracker v1.1 iniciado. Contas:', MONITORED_ACCOUNTS);

    function detectCurrentUser() {
        // Try to find logged-in user from navigation or profile elements
        const profileLinks = document.querySelectorAll('a[href^="/"]');
        for (const link of profileLinks) {
            const img = link.querySelector('img[alt*="foto do perfil"], img[alt*="profile picture"]');
            if (img && img.alt) {
                const match = img.alt.match(/foto do perfil de (.+)/i) || img.alt.match(/(.+)'s profile picture/i);
                if (match) return match[1].toLowerCase();
            }
        }
        // Fallback: check for profile menu
        const profileMenu = document.querySelector('[aria-label="Perfil"], [aria-label="Profile"]');
        if (profileMenu) {
            const href = profileMenu.closest('a')?.getAttribute('href');
            if (href) return href.replace(/\\//g, '');
        }
        return null;
    }

    function getPostOwner() {
        // Try multiple selectors for post owner
        const selectors = [
            'article header a[href^="/"]:not([href*="/explore"])',
            'div[role="dialog"] article header a[href^="/"]',
            'main article header a[href^="/"]'
        ];
        for (const sel of selectors) {
            const header = document.querySelector(sel);
            if (header) {
                const href = header.getAttribute('href');
                const match = href?.match(/^\\/([^/]+)\\/?$/);
                if (match) return match[1];
            }
        }
        return null;
    }

    function getPostUrl() {
        if (window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/')) {
            return window.location.href.split('?')[0];
        }
        const timeLink = document.querySelector('div[role="dialog"] a[href*="/p/"], div[role="dialog"] a[href*="/reel/"], article a[href*="/p/"], article a[href*="/reel/"]');
        if (timeLink) return 'https://www.instagram.com' + timeLink.getAttribute('href').split('?')[0];
        return window.location.href.split('?')[0];
    }

    function isMonitoredAccount(username) {
        if (!username) return false;
        return MONITORED_ACCOUNTS.some(acc => acc.toLowerCase() === username.toLowerCase());
    }

    function findInstagramAccountId(username) {
        // Find matching account ID from our accounts list
        const accountsMap = {
${accounts.map(a => `            '${a.account_name.replace("@", "").toLowerCase()}': '${a.instagram_id}'`).join(",\n")}
        };
        return accountsMap[username?.toLowerCase()] || null;
    }

    function sendToSupabase(data) {
        console.log('[AdScore] Enviando para Supabase:', data);
        
        GM_xmlhttpRequest({
            method: 'POST',
            url: SUPABASE_URL + '/functions/v1/n8n-comment-webhook',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                'apikey': SUPABASE_ANON_KEY
            },
            data: JSON.stringify({
                action: 'register_outbound',
                account_id: data.account_id,
                account_name: data.account_name,
                target_username: data.target_username,
                comment_text: data.comment_text,
                post_url: data.post_url
            }),
            onload: function(response) {
                console.log('[AdScore] Resposta:', response.status, response.responseText);
                if (response.status >= 200 && response.status < 300) {
                    showNotification('✅ Comentário registrado!', data.comment_text.substring(0, 40) + '...');
                } else {
                    showNotification('❌ Erro ao registrar', 'Status: ' + response.status);
                }
            },
            onerror: function(error) {
                console.error('[AdScore] Erro:', error);
                showNotification('❌ Erro de conexão', 'Verifique o console');
            }
        });
    }

    function showNotification(title, message) {
        const n = document.createElement('div');
        n.style.cssText = 'position:fixed;bottom:20px;right:20px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:16px 20px;border-radius:12px;z-index:999999;font-family:system-ui;box-shadow:0 10px 40px rgba(0,0,0,0.3);animation:slideIn .3s ease;max-width:300px';
        n.innerHTML = '<style>@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}</style><div style="font-weight:600;margin-bottom:4px">' + title + '</div><div style="font-size:13px;opacity:0.9">' + message + '</div>';
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 3500);
    }

    function setupMonitoring() {
        document.querySelectorAll('textarea, [contenteditable="true"], form textarea').forEach(el => {
            if (el.dataset.adscoreTracked) return;
            el.dataset.adscoreTracked = 'true';
            el.addEventListener('input', e => { 
                lastCommentText = e.target.value || e.target.textContent || ''; 
            });
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey && lastCommentText.trim()) {
                    // Capture text before it gets cleared
                    console.log('[AdScore] Enter detectado, texto:', lastCommentText);
                }
            });
        });
    }

    // Intercept fetch requests to detect comment submissions
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        const [url, opts] = args;
        const urlStr = typeof url === 'string' ? url : url?.url || '';
        
        // Detect comment POST requests
        if (urlStr.includes('/api/v1/web/comments/') && opts?.method === 'POST' && !isProcessing) {
            isProcessing = true;
            
            // Small delay to ensure DOM has updated
            setTimeout(() => {
                isProcessing = false;
                currentUsername = detectCurrentUser();
                console.log('[AdScore] Comentário detectado! User:', currentUsername);
                
                if (!isMonitoredAccount(currentUsername)) {
                    console.log('[AdScore] Conta não monitorada:', currentUsername);
                    return;
                }
                
                const postOwner = getPostOwner();
                console.log('[AdScore] Dono do post:', postOwner);
                
                // Skip if commenting on own post
                if (currentUsername?.toLowerCase() === postOwner?.toLowerCase()) {
                    console.log('[AdScore] Comentário no próprio post, ignorando');
                    return;
                }
                
                if (lastCommentText?.trim()) {
                    sendToSupabase({
                        account_id: findInstagramAccountId(currentUsername),
                        account_name: currentUsername,
                        target_username: postOwner || 'unknown',
                        comment_text: lastCommentText.trim(),
                        post_url: getPostUrl()
                    });
                } else {
                    console.log('[AdScore] Texto do comentário vazio');
                }
                lastCommentText = '';
            }, 500);
        }
        return origFetch.apply(this, args);
    };

    // Also intercept XMLHttpRequest for older Instagram code paths
    const origXHROpen = XMLHttpRequest.prototype.open;
    const origXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url) {
        this._adscoreUrl = url;
        this._adscoreMethod = method;
        return origXHROpen.apply(this, arguments);
    };
    
    XMLHttpRequest.prototype.send = function(body) {
        if (this._adscoreUrl?.includes('/api/v1/web/comments/') && this._adscoreMethod === 'POST' && !isProcessing) {
            isProcessing = true;
            setTimeout(() => {
                isProcessing = false;
                currentUsername = detectCurrentUser();
                if (!isMonitoredAccount(currentUsername)) return;
                const postOwner = getPostOwner();
                if (currentUsername?.toLowerCase() === postOwner?.toLowerCase()) return;
                if (lastCommentText?.trim()) {
                    sendToSupabase({
                        account_id: findInstagramAccountId(currentUsername),
                        account_name: currentUsername,
                        target_username: postOwner || 'unknown',
                        comment_text: lastCommentText.trim(),
                        post_url: getPostUrl()
                    });
                }
                lastCommentText = '';
            }, 500);
        }
        return origXHRSend.apply(this, arguments);
    };

    // Watch for new textareas/inputs
    new MutationObserver(setupMonitoring).observe(document.body, { childList: true, subtree: true });

    // Initial setup
    setTimeout(() => {
        currentUsername = detectCurrentUser();
        console.log('[AdScore] Usuário detectado:', currentUsername);
        if (isMonitoredAccount(currentUsername)) {
            showNotification('📊 AdScore Ativo', 'Monitorando @' + currentUsername);
        } else {
            console.log('[AdScore] Esperando conta monitorada. Contas:', MONITORED_ACCOUNTS);
        }
        setupMonitoring();
    }, 2000);
})();`;
  };

  const script = generateScript();

  const copyScript = () => {
    navigator.clipboard.writeText(script);
    setCopied(true);
    toast.success("Script copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-500" />
          Rastreamento Automático
        </CardTitle>
        <CardDescription>
          Instale o script para registrar comentários automaticamente quando você comentar no Instagram
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step 1 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary">Passo 1</Badge>
            <span className="font-medium">Instale o Tampermonkey</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Tampermonkey é uma extensão gratuita que permite executar scripts personalizados em sites.
          </p>
          <Button variant="outline" asChild>
            <a 
              href="https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Instalar Tampermonkey (Chrome Web Store)
            </a>
          </Button>
        </div>

        {/* Step 2 */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary">Passo 2</Badge>
            <span className="font-medium">Adicione o script</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Após instalar o Tampermonkey, clique no ícone dele → "Criar novo script" → cole o código abaixo → salve (Ctrl+S)
          </p>
          
          {accounts.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Contas configuradas: {accounts.map(a => a.account_name).join(", ")}
                </span>
                <Button size="sm" variant="outline" onClick={() => setShowScript(!showScript)}>
                  <Settings className="h-4 w-4 mr-2" />
                  {showScript ? "Ocultar" : "Ver"} Script
                </Button>
              </div>
              
              {showScript && (
                <div className="relative">
                  <Textarea 
                    value={script} 
                    readOnly 
                    className="font-mono text-xs h-64"
                  />
                  <Button 
                    size="sm" 
                    className="absolute top-2 right-2"
                    onClick={copyScript}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}
              
              <Button onClick={copyScript} className="w-full">
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                Copiar Script Completo
              </Button>
            </div>
          ) : (
            <p className="text-sm text-amber-500">
              ⚠️ Nenhuma conta cadastrada. Adicione uma conta do Instagram primeiro.
            </p>
          )}
        </div>

        {/* Step 3 */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary">Passo 3</Badge>
            <span className="font-medium">Use normalmente</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Pronto! Agora quando você fizer um comentário no Instagram pelo navegador, ele será registrado automaticamente no sistema. Uma notificação roxa aparecerá confirmando.
          </p>
        </div>

        {/* Notes */}
        <div className="bg-muted/30 rounded-lg p-4 text-sm space-y-2">
          <p className="font-medium">📝 Notas:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Funciona apenas no navegador (desktop), não no app mobile</li>
            <li>Você verá uma notificação roxa quando um comentário for registrado</li>
            <li>Comentários em seus próprios posts são ignorados</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
