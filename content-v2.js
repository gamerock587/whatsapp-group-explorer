/* Isolated bridge: read-only, without storage or backend connections. */
(() => {
  'use strict';
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.channel !== 'WA_GROUP_EXPLORER_RESULT') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(data.id);
    entry.respond(data.error ? { success: false, error: data.error } : { success: true, data: data.result });
  });
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['listGroups', 'listMembers'].includes(request?.action)) return;
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      respond({ success: false, error: 'WhatsApp took too long to respond. Wait for chats to load, then try again.' });
    }, 70000);
    pending.set(id, { respond, timer });
    window.postMessage({ channel: 'WA_GROUP_EXPLORER_REQUEST', id, action: request.action, groupId: request.groupId }, location.origin);
    return true;
  });
})();

