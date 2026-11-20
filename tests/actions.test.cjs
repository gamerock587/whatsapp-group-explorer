const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture({ admin = true, targetAdmin = false, removeFailure = false, inviteMismatch = false, sendFailure = false } = {}) {
  const target = { id: { _serialized: '9647701234567@c.us' }, isAdmin: targetAdmin };
  const group = { id: { _serialized: '123@g.us' }, iAmAdmin: () => admin, groupMetadata: { participants: { models: [target] } } };
  const destination = { id: { _serialized: '9647801234567@c.us' } };
  const calls = { sent: [], removed: [] };
  class MsgKey { constructor(props) { Object.assign(this, props); } static newId() { return Promise.resolve('message-id'); } }
  const modules = {
    WAWebCollections: { Chat: { get: id => id === '123@g.us' ? group : null } },
    WAWebGroupQueryJob: { queryAndUpdateGroupMetadataById: async () => {} },
    WAWebUserPrefsMeUser: { getMaybeMePnUser: () => ({ _serialized: '9647999999999@c.us' }) },
    WAWebModifyParticipantsGroupAction: { removeParticipants: async (chat, targets) => { calls.removed.push({ chat, targets }); if (removeFailure) return [{ code: 403 }]; chat.groupMetadata.participants.models = []; return [{ code: 200 }]; } },
    WAWebMexFetchGroupInviteCodeJob: { fetchMexGroupInviteCode: async () => ({ code: inviteMismatch ? 'DifferentLinkCode000000' : 'ExampleInviteCode000000' }) },
    WAWebWidFactory: { createWid: id => ({ _serialized: id }) },
    WAWebQueryExistsJob: { queryWidExists: async wid => ({ wid }) },
    WAWebFindChatAction: { findOrCreateLatestChat: async () => ({ chat: destination }) },
    WAWebMsgKey: MsgKey,
    WAWebGetEphemeralFieldsMsgActionsUtils: { getEphemeralFields: () => ({}) },
    WAWebSendMsgChatAction: { addAndSendMsgToChat: (chat, message) => { calls.sent.push({ chat, message }); return [Promise.resolve({}), sendFailure ? Promise.reject(new Error('Send rejected')) : Promise.resolve({ messageSendResult: 'OK' })]; } }
  };
  const context = { window: { require: name => { if (!modules[name]) throw new Error('missing'); return modules[name]; } }, setTimeout, clearTimeout };
  vm.createContext(context); vm.runInContext(fs.readFileSync('whatsapp-actions.js', 'utf8'), context);
  return { run: context.runWhatsAppAction, calls };
}
const remove = { action: 'removeMember', groupId: '123@g.us', memberId: '9647701234567@c.us', phone: '+9647701234567', rosterPhones: ['+9647801234567'] };
const invite = { action: 'sendInvite', groupId: '123@g.us', phone: '+9647801234567', inviteLink: 'https://chat.whatsapp.com/ExampleInviteCode000000' };
test('removal verifies admin, phone identity, roster absence, and server membership', async () => {
  const { run, calls } = fixture();
  assert.equal((await run(remove)).success, true);
  assert.equal(calls.removed.length, 1);
  assert.equal(calls.removed[0].targets[0].id._serialized, remove.memberId);
});
test('removal cannot target roster entries, other phones, admins, or run as non-admin', async () => {
  for (const [options, request] of [[{ admin: false }, remove], [{ targetAdmin: true }, remove], [{}, { ...remove, phone: '+9647999999999' }], [{}, { ...remove, rosterPhones: [remove.phone] }]]) {
    const { run, calls } = fixture(options);
    assert.equal((await run(request)).success, false);
    assert.equal(calls.removed.length, 0);
  }
});
test('server rejection is not reported as a successful removal', async () => {
  assert.equal((await fixture({ removeFailure: true }).run(remove)).success, false);
});
test('send invite uses a private chat and waits for server confirmation', async () => {
  const { run, calls } = fixture();
  assert.equal((await run(invite)).success, true);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].message.body, invite.inviteLink);
  assert.equal(calls.sent[0].chat.id._serialized, '9647801234567@c.us');
});
test('existing members and wrong group links are not sent an invite', async () => {
  const existing = fixture();
  assert.equal((await existing.run({ ...invite, phone: remove.phone })).success, false);
  assert.equal(existing.calls.sent.length, 0);
  const wrong = fixture({ inviteMismatch: true });
  assert.equal((await wrong.run(invite)).success, false);
  assert.equal(wrong.calls.sent.length, 0);
});
test('server send failures stay failures', async () => {
  assert.equal((await fixture({ sendFailure: true }).run(invite)).success, false);
});
