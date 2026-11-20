/* Read adapter for WhatsApp Web collections and the existing invite link. */
(() => {
  'use strict';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const serial = id => typeof id === 'string' ? id : id?._serialized || (id?.user && id?.server ? id.user + '@' + id.server : '');
  const models = collection => collection?.getModelsArray?.() || collection?.models || collection?._models || [];
  const optional = name => { try { return window.require(name); } catch { return null; } };
  const bounded = (promise, ms = 8000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WhatsApp request timed out.')), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  async function getStore() {
    for (let i = 0; i < 60; i++) {
      if (typeof window.require === 'function') {
        const store = optional('WAWebCollections');
        if (store?.Chat) return store;
      }
      await sleep(500);
    }
    throw new Error('WhatsApp is not ready. Sign in and wait for your chats to load. If this persists, WhatsApp may have changed its internal API.');
  }
  function phoneFrom(value) {
    // LIDs are account identifiers, never phone numbers.
    const match = serial(value).match(/^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net)$/);
    return match ? '+' + match[1] : null;
  }
  async function memberInfo(participant, store, allowLookup) {
    const id = serial(participant.id);
    let contact = store.Contact?.get?.(id);
    let phone = phoneFrom(participant.id) || phoneFrom(participant.phoneNumber) || phoneFrom(contact?.phoneNumber) || phoneFrom(contact?.id);
    if (!phone && id.endsWith('@lid') && allowLookup) {
      const api = optional('WAWebApiContact');
      const lids = optional('WAWebLidUtils');
      for (const [owner, method] of [[api, 'getPhoneNumber'], [lids, 'getPhoneNumber']]) {
        if (typeof owner?.[method] !== 'function') continue;
        try {
          const resolved = await bounded(owner[method](participant.id), 3000);
          phone = phoneFrom(resolved) || phoneFrom(resolved?.phoneNumber);
          if (phone) {
            contact = store.Contact?.get?.(serial(resolved)) || contact;
            break;
          }
        } catch { /* Retain the member when a phone mapping is unavailable. */ }
      }
    }
    return { id, name: contact?.name || contact?.pushname || contact?.verifiedName || participant.name || 'Name unavailable',
      phone, role: participant.isSuperAdmin ? 'Owner' : participant.isAdmin ? 'Admin' : 'Member' };
  }
  async function listGroups() {
    const store = await getStore();
    return { groups: models(store.Chat).filter(chat => serial(chat.id).endsWith('@g.us'))
      .map(chat => ({ id: serial(chat.id), name: chat.name || chat.formattedTitle || chat.groupMetadata?.subject || 'Unnamed group',
        count: chat.groupMetadata?.participants?.length ?? chat.groupMetadata?.size ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)) };
  }
  async function listMembers(groupId) {
    if (typeof groupId !== 'string' || !/^\d+(?:-\d+)?@g\.us$/.test(groupId)) throw new Error('Invalid group. Refresh the group list.');
    const store = await getStore();
    const chat = store.Chat.get(groupId);
    if (!chat) throw new Error('This group is no longer loaded. Refresh the group list.');
    const invitePromise = (async () => {
      try {
        const api = optional('WAWebMexFetchGroupInviteCodeJob');
        if (!api?.fetchMexGroupInviteCode) throw new Error('Invite API unavailable');
        const response = await bounded(api.fetchMexGroupInviteCode(groupId));
        const code = typeof response === 'string' ? response : response?.code;
        if (!/^[A-Za-z0-9_-]{10,64}$/.test(code || '')) throw new Error('No invite code returned');
        return { inviteLink: 'https://chat.whatsapp.com/' + code, inviteError: '' };
      } catch {
        return { inviteLink: '', inviteError: 'WhatsApp did not provide an invite link. Admin access may be required. You can paste the group link below.' };
      }
    })();
    let warning = '';
    const query = optional('WAWebGroupQueryJob');
    if (typeof query?.queryAndUpdateGroupMetadataById === 'function') {
      try { await bounded(query.queryAndUpdateGroupMetadataById({ id: groupId }), 10000); }
      catch { warning = 'Could not refresh membership. Showing the members currently loaded in WhatsApp.'; }
    } else warning = 'Showing loaded members. Open the group in WhatsApp to refresh its details.';
    const metadata = store.GroupMetadata?.get?.(groupId) || chat.groupMetadata;
    if (!metadata?.participants) throw new Error('Member details are not loaded. Open this group in WhatsApp, then try again.');
    const participants = models(metadata.participants);
    const members = new Array(participants.length);
    let cursor = 0;
    const deadline = Date.now() + 20000;
    await Promise.all(Array.from({ length: Math.min(8, participants.length) }, async () => {
      while (cursor < participants.length) {
        const index = cursor++;
        members[index] = await memberInfo(participants[index], store, Date.now() < deadline);
      }
    }));
    const unique = [...new Map(members.filter(member => member.id).map(member => [member.id, member])).values()];
    unique.sort((a, b) => Number(Boolean(b.phone)) - Number(Boolean(a.phone)) || a.name.localeCompare(b.name));
    const expectedCount = metadata.size ?? null;
    if (expectedCount !== null && unique.length < expectedCount) warning = (warning + ' Only ' + unique.length + ' of ' + expectedCount + ' members loaded. Open the group in WhatsApp and refresh.').trim();
    const users = optional('WAWebUserPrefsMeUser');
    const ownIds = [serial(users?.getMaybeMePnUser?.()), serial(users?.getMaybeMeLidUser?.())].filter(Boolean);
    unique.forEach(member => { member.isMe = ownIds.includes(member.id); });
    return { id: groupId, name: chat.name || metadata.subject || 'Unnamed group', members: unique, warning,
      isAdmin: typeof chat.iAmAdmin === 'function' && Boolean(chat.iAmAdmin()), ...await invitePromise };
  }
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const request = event.data;
    if (request?.channel !== 'WA_GROUP_EXPLORER_REQUEST' || typeof request.id !== 'string') return;
    if (!['listGroups', 'listMembers'].includes(request.action)) return;
    try {
      const result = request.action === 'listGroups' ? await listGroups() : await listMembers(request.groupId);
      window.postMessage({ channel: 'WA_GROUP_EXPLORER_RESULT', id: request.id, result }, location.origin);
    } catch (error) {
      window.postMessage({ channel: 'WA_GROUP_EXPLORER_RESULT', id: request.id, error: error.message || 'Could not read WhatsApp data.' }, location.origin);
    }
  });
})();

