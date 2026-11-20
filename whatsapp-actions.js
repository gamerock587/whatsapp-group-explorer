/* Invoked only by the extension worker after an explicit UI action. */
async function runWhatsAppAction(request) {
  'use strict';
  const serial = id => typeof id === 'string' ? id : id?._serialized || (id?.user && id?.server ? id.user + '@' + id.server : '');
  const models = collection => collection?.getModelsArray?.() || collection?.models || [];
  const requireModule = name => {
    try { return window.require(name); } catch { throw new Error('WhatsApp API unavailable. Refresh WhatsApp Web and try again.'); }
  };
  const bounded = (promise, ms = 15000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WhatsApp response timed out. Check WhatsApp before retrying; the action may still complete.')), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  try {
    if (!/^\d+(?:-\d+)?@g\.us$/.test(request.groupId || '')) throw new Error('Invalid group.');
    const store = requireModule('WAWebCollections');
    const group = store.Chat.get(request.groupId);
    if (!group) throw new Error('Group is no longer loaded. Refresh it.');
    await bounded(requireModule('WAWebGroupQueryJob').queryAndUpdateGroupMetadataById({ id: request.groupId }));
    const metadata = store.GroupMetadata?.get?.(request.groupId) || group.groupMetadata;
    if (!metadata?.participants) throw new Error('Fresh membership is unavailable. Open the group in WhatsApp and refresh.');
    const participants = models(metadata.participants);
    if (request.action === 'removeMember') {
      if (typeof group.iAmAdmin !== 'function' || !group.iAmAdmin()) throw new Error('Only a group admin can remove members.');
      if (!Array.isArray(request.rosterPhones) || !request.rosterPhones.length) throw new Error('Import a valid Excel roster first.');
      const target = participants.find(participant => serial(participant.id) === request.memberId);
      if (!target) throw new Error('This person is no longer in the group. Refresh members.');
      if (target.isAdmin || target.isSuperAdmin) throw new Error('Admin and owner removals are disabled in this roster view.');
      const me = requireModule('WAWebUserPrefsMeUser');
      if ([me.getMaybeMePnUser?.(), me.getMaybeMeLidUser?.()].some(id => serial(id) === request.memberId)) throw new Error('You cannot remove yourself from this view.');
      let wid = target.id;
      if (serial(wid).endsWith('@lid')) wid = await bounded(requireModule('WAWebApiContact').getPhoneNumber(wid));
      const match = serial(wid).match(/^(\d+)@(c\.us|s\.whatsapp\.net)$/);
      if (!match || '+' + match[1] !== request.phone) throw new Error('Phone number could not be verified. Refresh the comparison.');
      if (request.rosterPhones.includes(request.phone)) throw new Error('This number is in the Excel roster. Removal cancelled.');
      const result = await bounded(requireModule('WAWebModifyParticipantsGroupAction').removeParticipants(group, [target]));
      const codes = Array.isArray(result) ? result.map(item => item?.code ?? item?.status) : [result?.code ?? result?.status];
      if (codes.some(code => code != null && ![200, '200'].includes(code))) throw new Error('WhatsApp rejected the removal. Refresh the group to check membership.');
      await bounded(requireModule('WAWebGroupQueryJob').queryAndUpdateGroupMetadataById({ id: request.groupId }));
      const latest = store.GroupMetadata?.get?.(request.groupId) || group.groupMetadata;
      if (models(latest?.participants).some(member => serial(member.id) === request.memberId)) throw new Error('WhatsApp has not confirmed removal. Refresh the group before retrying.');
      return { success: true };
    }
    if (request.action !== 'sendInvite' || !/^\+[1-9]\d{6,14}$/.test(request.phone || '')) throw new Error('Invalid recipient number.');
    if (!/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]{10,64}$/.test(request.inviteLink || '')) throw new Error('Enter a valid WhatsApp group invite link.');
    let knownCode = '';
    try {
      const response = await bounded(requireModule('WAWebMexFetchGroupInviteCodeJob').fetchMexGroupInviteCode(request.groupId), 5000);
      knownCode = typeof response === 'string' ? response : response?.code || '';
    } catch { /* A non-admin can use a manually supplied link. */ }
    if (knownCode && request.inviteLink !== 'https://chat.whatsapp.com/' + knownCode) throw new Error('This link does not match the current group invite link. Refresh the group.');
    let cursor = 0, alreadyMember = false;
    const deadline = Date.now() + 5000;
    await Promise.all(Array.from({ length: Math.min(8, participants.length) }, async () => {
      while (cursor < participants.length) {
        const participant = participants[cursor++];
        let wid = participant.phoneNumber || participant.id;
        if (serial(wid).endsWith('@lid') && Date.now() < deadline) {
          try { wid = await bounded(requireModule('WAWebApiContact').getPhoneNumber(wid), 1500); }
          catch { continue; }
        }
        if (serial(wid).split('@')[0] === request.phone.slice(1)) alreadyMember = true;
      }
    }));
    if (alreadyMember) throw new Error('This number is already in the group. Refresh the comparison.');
    const factory = requireModule('WAWebWidFactory');
    const wid = factory.createWid(request.phone.slice(1) + '@c.us');
    const registered = await bounded(requireModule('WAWebQueryExistsJob').queryWidExists(wid));
    if (!registered?.wid) throw new Error('This number is not registered on WhatsApp.');
    const destination = registered.wid;
    let chat = store.Chat.get(destination);
    if (!chat) {
      const found = await bounded(requireModule('WAWebFindChatAction').findOrCreateLatestChat(destination));
      chat = found?.chat || found;
    }
    if (!chat?.id) throw new Error('WhatsApp could not open a conversation for this number.');
    const users = requireModule('WAWebUserPrefsMeUser');
    const from = serial(chat.id).endsWith('@lid') ? users.getMaybeMeLidUser?.() : users.getMaybeMePnUser?.();
    if (!from) throw new Error('WhatsApp account is not ready.');
    const MsgKey = requireModule('WAWebMsgKey');
    const key = new MsgKey({ from, to: chat.id, id: await MsgKey.newId(), selfDir: 'out' });
    const fields = await requireModule('WAWebGetEphemeralFieldsMsgActionsUtils').getEphemeralFields(chat);
    const message = { id: key, ack: 0, body: request.inviteLink, from, to: chat.id, local: true, self: 'out', t: Math.floor(Date.now() / 1000), isNewMsg: true, type: 'chat', ...fields };
    // Wait for the server-send result, not just the local message insertion.
    const [messagePromise, sentPromise] = requireModule('WAWebSendMsgChatAction').addAndSendMsgToChat(chat, message);
    if (!sentPromise || typeof sentPromise.then !== 'function') {
      await bounded(messagePromise);
      throw new Error('Server confirmation unavailable. Check WhatsApp before retrying; the invite may have been sent.');
    }
    const [, sent] = await bounded(Promise.all([messagePromise, sentPromise]), 25000);
    if (sent?.messageSendResult && sent.messageSendResult !== 'OK') throw new Error('WhatsApp did not confirm sending. Check the conversation before retrying.');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'WhatsApp rejected the action. Check your connection and permissions.' };
  }
}
