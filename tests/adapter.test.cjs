const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture({ failRefresh = false, partial = false } = {}) {
  const participants = [
    { id: { _serialized: '9647701234567@c.us' }, isAdmin: true },
    { id: { _serialized: '111111111@lid' } },
    { id: { _serialized: '222222222@lid' } },
    { id: { _serialized: '9647701234567@c.us' }, isAdmin: true }
  ];
  const group = { id: { _serialized: '123456789@g.us' }, name: '<script>Group</script>', groupMetadata: { participants: { models: participants }, size: partial ? 10 : 3 } };
  const contacts = { '9647701234567@c.us': { name: 'Saved contact' }, '111111111@lid': { pushname: 'Mapped member' }, '222222222@lid': { pushname: 'Private member' } };
  const modules = {
    WAWebCollections: { Chat: { models: [group, { id: { _serialized: '999@c.us' }, name: 'Direct chat' }], get: id => id === group.id._serialized ? group : null }, Contact: { get: id => contacts[id] } },
    WAWebGroupQueryJob: { queryAndUpdateGroupMetadataById: async ({ id }) => { assert.equal(id, group.id._serialized); if (failRefresh) throw new Error('offline'); } },
    WAWebApiContact: { getPhoneNumber: id => id._serialized === '111111111@lid' ? { _serialized: '9647801234567@c.us' } : id }
  };
  let listener;
  const output = [];
  const window = { require: name => { if (!modules[name]) throw new Error('missing module'); return modules[name]; }, addEventListener: (_, handler) => { listener = handler; }, postMessage: result => output.push(result) };
  vm.runInNewContext(fs.readFileSync('injected-v2.js', 'utf8'), { window, location: { origin: 'https://web.whatsapp.com' }, setTimeout, clearTimeout });
  return async (action, groupId, origin = 'https://web.whatsapp.com') => {
    output.length = 0;
    await listener({ source: window, origin, data: { channel: 'WA_GROUP_EXPLORER_REQUEST', id: 'test', action, groupId } });
    return output[0];
  };
}

test('lists groups and excludes direct conversations', async () => {
  const response = await fixture()('listGroups');
  assert.equal(response.result.groups.length, 1);
  assert.equal(response.result.groups[0].id, '123456789@g.us');
});
test('resolves phone mappings, retains unavailable LIDs, and deduplicates participants', async () => {
  const response = await fixture()('listMembers', '123456789@g.us');
  const members = response.result.members;
  assert.equal(members.length, 3);
  assert.equal(members.find(member => member.name === 'Saved contact').phone, '+9647701234567');
  assert.equal(members.find(member => member.name === 'Saved contact').role, 'Admin');
  assert.equal(members.find(member => member.name === 'Mapped member').phone, '+9647801234567');
  assert.equal(members.find(member => member.name === 'Private member').phone, null);
  assert.equal(members.at(-1).name, 'Private member');
});
test('cached and partial metadata are explicitly flagged', async () => {
  const response = await fixture({ failRefresh: true, partial: true })('listMembers', '123456789@g.us');
  assert.match(response.result.warning, /Could not refresh/);
  assert.match(response.result.warning, /3 of 10/);
});
test('invalid IDs and unloaded groups return useful errors', async () => {
  assert.match((await fixture()('listMembers', '111@lid')).error, /Invalid group/);
  assert.match((await fixture()('listMembers', '999@g.us')).error, /no longer loaded/);
});
test('ignores foreign origins and unsupported actions', async () => {
  assert.equal(await fixture()('listGroups', null, 'https://example.com'), undefined);
  assert.equal(await fixture()('sendMessage'), undefined);
});

test('isolated bridge forwards only authorized read actions and correlates replies', () => {
  let runtimeListener, pageListener, posted;
  const timers = new Map();
  const window = { addEventListener: (_, handler) => { pageListener = handler; }, postMessage: data => { posted = data; } };
  vm.runInNewContext(fs.readFileSync('content-v2.js', 'utf8'), {
    window, location: { origin: 'https://web.whatsapp.com' }, crypto: { randomUUID: () => 'request-1' },
    chrome: { runtime: { id: 'extension-id', onMessage: { addListener: handler => { runtimeListener = handler; } } } },
    setTimeout: handler => { timers.set(1, handler); return 1; }, clearTimeout: id => timers.delete(id)
  });
  assert.equal(runtimeListener({ action: 'listGroups' }, { id: 'other-extension' }, () => {}), undefined);
  assert.equal(runtimeListener({ action: 'sendMessage' }, { id: 'extension-id' }, () => {}), undefined);
  let response;
  assert.equal(runtimeListener({ action: 'listGroups' }, { id: 'extension-id' }, value => { response = value; }), true);
  assert.equal(posted.id, 'request-1');
  pageListener({ source: window, origin: 'https://web.whatsapp.com', data: { channel: 'WA_GROUP_EXPLORER_RESULT', id: 'unrelated', result: {} } });
  assert.equal(response, undefined);
  pageListener({ source: window, origin: 'https://web.whatsapp.com', data: { channel: 'WA_GROUP_EXPLORER_RESULT', id: posted.id, result: { groups: [] } } });
  assert.equal(response.success, true);
  assert.equal(timers.size, 0);
});
