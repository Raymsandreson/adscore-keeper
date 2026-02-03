// AdScore Keeper - Instagram Comment Tracker
// Content script that detects when comments are posted on Instagram

(function() {
  'use strict';

  let registeredAccounts = [];
  let webhookUrl = '';
  let isEnabled = false;

  // Load settings from storage
  chrome.storage.sync.get(['accounts', 'webhookUrl', 'isEnabled'], (result) => {
    registeredAccounts = result.accounts || [];
    webhookUrl = result.webhookUrl || 'https://webhooks.prudenciosolucoes.com.br/webhook/outbound-comment';
    isEnabled = result.isEnabled !== false;
    console.log('[AdScore] Extension loaded. Accounts:', registeredAccounts.length, 'Enabled:', isEnabled);
  });

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.accounts) registeredAccounts = changes.accounts.newValue || [];
    if (changes.webhookUrl) webhookUrl = changes.webhookUrl.newValue;
    if (changes.isEnabled) isEnabled = changes.isEnabled.newValue;
  });

  // Get current logged-in username from Instagram
  function getCurrentUsername() {
    // Try multiple methods to get the username
    const profileLink = document.querySelector('a[href*="/accounts/edit/"]');
    if (profileLink) {
      const match = profileLink.href.match(/instagram\.com\/([^/]+)/);
      if (match) return match[1];
    }

    // Try from navigation
    const navProfile = document.querySelector('a[href^="/"][role="link"] img[alt]');
    if (navProfile && navProfile.alt) {
      const altMatch = navProfile.alt.match(/foto do perfil de (.+)/i) || 
                       navProfile.alt.match(/profile picture of (.+)/i) ||
                       navProfile.alt.match(/(.+)'s profile picture/i);
      if (altMatch) return altMatch[1];
    }

    // Try from settings/profile area
    const settingsSpan = document.querySelector('span[dir="auto"]');
    if (settingsSpan) {
      const text = settingsSpan.textContent;
      if (text && text.startsWith('@')) return text.substring(1);
    }

    return null;
  }

  // Get post owner username from current page
  function getPostOwnerUsername() {
    // For post pages like /p/xxx/ or /reel/xxx/
    const articleHeader = document.querySelector('article header a[href^="/"]');
    if (articleHeader) {
      const href = articleHeader.getAttribute('href');
      if (href) {
        const match = href.match(/^\/([^/]+)\/?$/);
        if (match) return match[1];
      }
    }

    // Try from username link in post
    const usernameLink = document.querySelector('article a[href^="/"][tabindex="0"]');
    if (usernameLink) {
      const href = usernameLink.getAttribute('href');
      if (href) {
        const match = href.match(/^\/([^/]+)\/?$/);
        if (match) return match[1];
      }
    }

    return null;
  }

  // Get current post URL
  function getCurrentPostUrl() {
    // Check if we're on a post page
    if (window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/')) {
      return window.location.href;
    }
    
    // Check for modal post
    const modalPost = document.querySelector('div[role="dialog"] article');
    if (modalPost) {
      const timeLink = modalPost.querySelector('a[href*="/p/"], a[href*="/reel/"]');
      if (timeLink) return 'https://www.instagram.com' + timeLink.getAttribute('href');
    }

    return window.location.href;
  }

  // Check if username is in registered accounts
  function isRegisteredAccount(username) {
    if (!username) return false;
    const normalizedUsername = username.toLowerCase().replace('@', '');
    return registeredAccounts.some(acc => 
      acc.toLowerCase().replace('@', '') === normalizedUsername
    );
  }

  // Send comment to webhook
  async function sendCommentToWebhook(commentData) {
    if (!webhookUrl) {
      console.log('[AdScore] Webhook URL not configured');
      return;
    }

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        mode: 'no-cors',
        body: JSON.stringify({
          account_name: commentData.account,
          target_username: commentData.postOwner,
          comment_text: commentData.text,
          post_url: commentData.postUrl,
          timestamp: new Date().toISOString(),
          source: 'chrome_extension'
        })
      });
      
      console.log('[AdScore] Comment sent to webhook:', commentData);
      showNotification('Comentário registrado!', commentData.text.substring(0, 50));
    } catch (error) {
      console.error('[AdScore] Error sending to webhook:', error);
    }
  }

  // Show notification
  function showNotification(title, message) {
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
      animation: slideIn 0.3s ease;
      max-width: 300px;
    `;
    notification.innerHTML = `
      <style>
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      </style>
      <div style="font-weight: 600; margin-bottom: 4px;">✓ ${title}</div>
      <div style="font-size: 13px; opacity: 0.9;">${message}...</div>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // Intercept form submissions and button clicks for comments
  function setupCommentDetection() {
    // Monitor for comment submission via keyboard
    document.addEventListener('keydown', (e) => {
      if (!isEnabled) return;
      
      if (e.key === 'Enter' && !e.shiftKey) {
        const activeElement = document.activeElement;
        if (activeElement && (
          activeElement.getAttribute('aria-label')?.includes('comentário') ||
          activeElement.getAttribute('aria-label')?.includes('comment') ||
          activeElement.getAttribute('placeholder')?.includes('comentário') ||
          activeElement.getAttribute('placeholder')?.includes('comment') ||
          activeElement.closest('form')?.querySelector('[aria-label*="comentário"]') ||
          activeElement.closest('form')?.querySelector('[aria-label*="comment"]')
        )) {
          const commentText = activeElement.textContent || activeElement.value;
          if (commentText && commentText.trim()) {
            handlePotentialComment(commentText.trim());
          }
        }
      }
    }, true);

    // Monitor for click on post/submit button
    document.addEventListener('click', (e) => {
      if (!isEnabled) return;
      
      const target = e.target;
      const isPostButton = 
        target.textContent?.toLowerCase() === 'publicar' ||
        target.textContent?.toLowerCase() === 'post' ||
        target.closest('button')?.textContent?.toLowerCase() === 'publicar' ||
        target.closest('button')?.textContent?.toLowerCase() === 'post';
      
      if (isPostButton) {
        // Find the comment input
        const form = target.closest('form') || target.closest('section');
        if (form) {
          const textarea = form.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
          if (textarea) {
            const commentText = textarea.textContent || textarea.value;
            if (commentText && commentText.trim()) {
              setTimeout(() => handlePotentialComment(commentText.trim()), 100);
            }
          }
        }
      }
    }, true);

    // Use MutationObserver to detect new comments appearing
    const observer = new MutationObserver((mutations) => {
      if (!isEnabled) return;
      
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this might be a newly posted comment
            const commentElement = node.querySelector?.('span[dir="auto"]');
            if (commentElement) {
              // Could be a new comment, but we need to verify it's from our account
            }
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Handle potential comment detection
  function handlePotentialComment(commentText) {
    const currentUsername = getCurrentUsername();
    const postOwner = getPostOwnerUsername();
    const postUrl = getCurrentPostUrl();

    console.log('[AdScore] Potential comment detected:', {
      text: commentText,
      currentUser: currentUsername,
      postOwner: postOwner,
      postUrl: postUrl,
      isRegistered: isRegisteredAccount(currentUsername)
    });

    // Only track if the current user is a registered account
    if (!isRegisteredAccount(currentUsername)) {
      console.log('[AdScore] Current user not in registered accounts, skipping');
      return;
    }

    // Don't track comments on own posts
    if (currentUsername && postOwner && currentUsername.toLowerCase() === postOwner.toLowerCase()) {
      console.log('[AdScore] Comment on own post, skipping');
      return;
    }

    // Send to webhook
    sendCommentToWebhook({
      account: currentUsername,
      postOwner: postOwner || 'unknown',
      text: commentText,
      postUrl: postUrl
    });
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupCommentDetection);
  } else {
    setupCommentDetection();
  }

  console.log('[AdScore] Instagram Comment Tracker initialized');
})();
