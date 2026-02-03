// AdScore Keeper - Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('[AdScore] Extension installed');
  
  // Set default settings
  chrome.storage.sync.get(['webhookUrl', 'isEnabled'], (result) => {
    if (!result.webhookUrl) {
      chrome.storage.sync.set({
        webhookUrl: 'https://webhooks.prudenciosolucoes.com.br/webhook/outbound-comment',
        isEnabled: true,
        accounts: []
      });
    }
  });
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    chrome.storage.sync.get(['accounts', 'webhookUrl', 'isEnabled'], (result) => {
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'saveSettings') {
    chrome.storage.sync.set(request.settings, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
