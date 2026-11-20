'use strict';
importScripts('whatsapp-actions.js');
const running = new Set();
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('popup.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.url === url);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
});
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  if (!['sendInvite', 'removeMember'].includes(request?.action)) return;
  const key = request.action + ':' + request.groupId + ':' + (request.phone || request.memberId);
  (async () => {
    if (running.has(key)) throw new Error('This action is already in progress.');
    running.add(key);
    try {
      const tab = await chrome.tabs.get(request.tabId);
      if (!tab.url?.startsWith('https://web.whatsapp.com/')) throw new Error('The connected WhatsApp tab is no longer available. Refresh groups.');
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: runWhatsAppAction, args: [request] });
      const result = results[0]?.result;
      respond(result || { success: false, error: 'WhatsApp did not return an action result.' });
    } finally { running.delete(key); }
  })().catch(error => respond({ success: false, error: error.message }));
  return true;
});
