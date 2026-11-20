'use strict';
const $ = id => document.getElementById(id);
const state = { tabId: null, groups: [], group: null, busy: false, generation: 0, workbook: null, rows: [], roster: null, country: '964', mutating: false, sent: new Set(), uncertain: new Set(), actionErrors: new Map() };
const knownPhones = () => [...new Set((state.group?.members || []).map(member => member.phone).filter(Boolean))];
function inviteValue() {
  try {
    const url = new URL($('inviteLink').value.trim());
    const code = url.pathname.match(/^\/([A-Za-z0-9_-]{10,64})\/?$/)?.[1];
    return url.origin === 'https://chat.whatsapp.com' && !url.username && !url.password && code ? 'https://chat.whatsapp.com/' + code : '';
  } catch { return ''; }
}
const validLink = () => Boolean(inviteValue());
function setBusy(busy, message = '') {
  state.busy = busy;
  $('refresh').disabled = busy || state.mutating;
  $('back').disabled = state.mutating;
  $('search').disabled = busy || state.mutating;
  $('copy').disabled = busy || !knownPhones().length;
  $('export').disabled = busy || !state.group?.members.length;
  $('status').textContent = message;
  $('list').setAttribute('aria-busy', String(busy));
  for (const id of ['excelFile', 'sheet', 'nameColumn', 'phoneColumn', 'country', 'hasHeader', 'compare', 'clearExcel', 'inviteLink']) $(id).disabled = busy || state.mutating;
  document.body.classList.toggle('mutating', state.mutating);
}
async function request(action, groupId) {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find(tab => tab.id === state.tabId) || tabs.find(tab => tab.id === active[0]?.id) || tabs[0];
  if (!tab) {
    $('openWhatsApp').hidden = false;
    throw new Error('Open WhatsApp Web and sign in to load your groups.');
  }
  state.tabId = tab.id;
  $('openWhatsApp').hidden = true;
  let response;
  try { response = await chrome.tabs.sendMessage(tab.id, { action, groupId }); }
  catch { throw new Error('Refresh your WhatsApp Web tab to connect the extension, then try again.'); }
  if (!response?.success) throw new Error(response?.error || 'WhatsApp did not return any data.');
  return response.data;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function comparison() {
  return state.group && state.roster ? Roster.compare(state.group.members, state.roster, state.country) : null;
}
function actionKey(action, item) { return state.group.id + ':' + action + ':' + (item.phone || item.id); }
function rowFor(item) {
  const row = element('div', 'member ' + (item.status || ''));
  const info = element('div', 'member-content');
  info.append(element('span', 'member-name', item.name));
  const phone = element('span', item.phone ? 'phone' : 'unavailable', item.phone || 'Number unavailable');
  phone.dir = 'ltr'; info.append(phone);
  if (item.excelName) info.append(element('span', 'excel-name', 'Excel: ' + item.excelName));
  const label = { extra: 'In group · Not in Excel', missing: 'In Excel · Not found in loaded group numbers', unverified: 'Unverified · Phone unavailable', matched: 'Matched by phone number' }[item.status];
  if (label) info.append(element('span', 'badge', label));
  row.append(info);
  const actions = element('div', 'member-actions');
  if (item.role && !['Member', 'Excel'].includes(item.role)) actions.append(element('span', 'role', item.role));
  if (item.phone) {
    const copy = element('button', 'copy-one', 'Copy');
    copy.setAttribute('aria-label', 'Copy phone number for ' + item.name);
    copy.addEventListener('click', () => copyText(item.phone, 'Number copied.'));
    actions.append(copy);
  }
  if (item.status === 'missing') {
    const key = actionKey('sendInvite', item);
    const button = element('button', 'send-invite', state.sent.has(key) ? 'Invite sent' : state.uncertain.has(key) ? 'Check WhatsApp' : 'Send invite');
    button.disabled = !validLink() || state.mutating || state.sent.has(key) || state.uncertain.has(key);
    button.title = validLink() ? 'Send the invite link to ' + item.phone : 'Add a valid group invite link first';
    button.addEventListener('click', () => runAction('sendInvite', item));
    actions.append(button);
    if (state.actionErrors.has(key)) info.append(element('span', 'error-note', state.actionErrors.get(key)));
  }
  if (item.status === 'extra') {
    const button = element('button', 'remove-member', 'Remove');
    const allowed = state.group.isAdmin && item.role === 'Member' && !item.isMe && !state.roster.invalid.length && state.roster.entries.length > 0;
    button.disabled = !allowed || state.mutating;
    button.title = !state.group.isAdmin ? 'Group admin access is required' : !allowed ? 'Unavailable for yourself, admins, owners, or an incomplete Excel roster' : 'Review removal of ' + item.phone;
    button.addEventListener('click', () => confirmRemoval(item));
    actions.append(button);
    const key = actionKey('removeMember', item);
    if (state.actionErrors.has(key)) info.append(element('span', 'error-note', state.actionErrors.get(key)));
  }
  row.append(actions);
  return row;
}
function render() {
  const group = state.group;
  $('back').hidden = !group;
  $('title').textContent = group ? group.name : 'Your groups';
  $('subtitle').textContent = group ? 'Import Excel to compare the roster with group membership.' : state.groups.length + ' groups loaded · Select one to view its members.';
  $('search').placeholder = group ? 'Search names or numbers…' : 'Search groups…';
  $('search').setAttribute('aria-label', group ? 'Search names or numbers' : 'Search groups');
  for (const id of ['stats', 'actions', 'invitePanel', 'excelPanel']) $(id).hidden = !group;
  $('list').setAttribute('aria-label', group ? 'Members and comparison results' : 'Groups');
  $('copyInvite').disabled = !group || !validLink();
  if (group) {
    const available = group.members.filter(member => member.phone).length;
    $('memberCount').textContent = group.members.length;
    $('phoneCount').textContent = available;
    $('missingCount').textContent = group.members.length - available;
    $('warning').textContent = [group.warning, available < group.members.length ? 'Some members have unavailable phone numbers. Excel entries missing from the loaded numbers may belong to these members; their membership is unverified.' : ''].filter(Boolean).join(' ');
    $('warning').hidden = !$('warning').textContent;
  } else $('warning').hidden = true;
  const result = comparison();
  $('comparisonSummary').hidden = !result;
  if (result) {
    $('comparisonSummary').textContent = result.extra.length + ' in group but not Excel · ' + result.missing.length + ' Excel numbers not found · ' + result.matched.length + ' matched · ' + result.unknown.length + ' unverified. ' +
      state.roster.entries.length + ' unique Excel numbers; ' + state.roster.duplicates + ' duplicate entries combined; ' + state.roster.invalid.length + ' invalid entries.' +
      (state.roster.invalid.length ? ' Fix invalid entries before removing members.' : '');
  }
  const query = $('search').value.trim().toLocaleLowerCase();
  const match = item => !query || [item.name, item.excelName, item.phone].filter(Boolean).join(' ').toLocaleLowerCase().includes(query) || (/^[+\d\s().-]+$/.test(Roster.digits(query)) && (item.phone || '').replace(/\D/g, '').includes(Roster.digits(query).replace(/\D/g, '')));
  $('list').replaceChildren();
  let visible = 0;
  if (!group) {
    for (const item of state.groups.filter(match)) {
      const row = element('button', 'group'); row.type = 'button';
      row.append(element('span', 'avatar', item.name.slice(0, 1).toLocaleUpperCase()));
      const info = element('span', 'group-content');
      info.append(element('span', 'group-name', item.name), element('span', 'group-meta', item.count === null ? 'View members' : item.count + ' members'));
      row.append(info, element('span', 'arrow', '›'));
      row.addEventListener('click', () => loadMembers(item));
      $('list').append(row); visible++;
    }
  } else {
    const sections = result ? [
      ['In group, missing from Excel', result.extra],
      ['In Excel, not found in group numbers', result.missing],
      ['Matched members', result.matched],
      ['Unverified members', result.unknown]
    ] : [['Members', group.members]];
    for (const [title, items] of sections) {
      const filtered = items.filter(match);
      if (!filtered.length) continue;
      $('list').append(element('h3', 'section-title', title + ' (' + filtered.length + ')'));
      filtered.forEach(item => { $('list').append(rowFor(item)); visible++; });
    }
  }
  const status = visible ? '' : query ? 'No matches. Try another search.' : group ? 'No members are loaded. Open this group in WhatsApp and refresh.' : 'No groups loaded yet. Wait for WhatsApp to sync your chats, then refresh.';
  setBusy(false, status);
}
async function loadGroups() {
  if (state.mutating) return;
  const generation = ++state.generation;
  state.group = null;
  $('search').value = '';
  $('list').replaceChildren();
  for (const id of ['stats', 'actions', 'warning', 'invitePanel', 'excelPanel', 'comparisonSummary']) $(id).hidden = true;
  $('back').hidden = true;
  $('title').textContent = 'Your groups';
  $('subtitle').textContent = 'Choose a group to see names and phone numbers.';
  $('feedback').textContent = '';
  setBusy(true, 'Loading your groups…');
  try {
    const result = await request('listGroups');
    if (generation !== state.generation) return;
    state.groups = result.groups; render();
  } catch (error) { if (generation === state.generation) setBusy(false, error.message); }
}
async function loadMembers(group) {
  if (state.busy || state.mutating) return;
  const generation = ++state.generation;
  const oldLink = state.group?.id === group.id ? $('inviteLink').value : '';
  $('list').replaceChildren();
  for (const id of ['warning', 'stats', 'actions', 'invitePanel', 'excelPanel', 'comparisonSummary']) $(id).hidden = true;
  $('back').hidden = false;
  $('title').textContent = group.name;
  $('subtitle').textContent = 'Reading group members and resolving phone numbers…';
  $('search').value = ''; $('feedback').textContent = '';
  setBusy(true, 'Loading members…');
  try {
    const result = await request('listMembers', group.id);
    if (generation !== state.generation) return;
    state.group = result;
    $('inviteLink').value = result.inviteLink || oldLink;
    $('inviteNote').textContent = result.inviteError || 'Existing group link. Send invite sends this link as a private message.';
    render();
  } catch (error) {
    if (generation !== state.generation) return;
    state.group = { ...group, members: [], warning: '', isAdmin: false };
    setBusy(false, error.message);
  }
}
async function copyText(text, message) {
  try { await navigator.clipboard.writeText(text); $('feedback').textContent = message; }
  catch { $('feedback').textContent = 'Clipboard unavailable. Select the link manually or export CSV for numbers.'; }
}
function fillColumns() {
  state.rows = XLSX.utils.sheet_to_json(state.workbook.Sheets[$('sheet').value], { header: 1, raw: true, defval: '', blankrows: true });
  const count = Math.max(0, ...state.rows.slice(0, 100).map(row => row.length));
  const first = state.rows[0] || [];
  for (const id of ['nameColumn', 'phoneColumn']) {
    $(id).replaceChildren();
    for (let index = 0; index < count; index++) {
      const option = element('option', '', XLSX.utils.encode_col(index) + ' — ' + (String(first[index] ?? '').slice(0, 50) || 'Column ' + (index + 1)));
      option.value = index; $(id).append(option);
    }
  }
  let name = first.findIndex(value => /name|الاسم|اسم/i.test(String(value)));
  let phone = first.findIndex(value => /phone|mobile|number|هاتف|رقم|جوال|موبايل/i.test(String(value)));
  $('nameColumn').value = Math.max(0, name);
  $('phoneColumn').value = phone < 0 ? Math.min(1, count - 1) : phone;
  $('hasHeader').checked = name >= 0 || phone >= 0;
  state.roster = null; $('importError').textContent = '';
  render();
}
function doCompare() {
  if (!state.workbook || !state.group || state.busy || state.mutating) return;
  if (state.rows.length > 10001 || state.workbook.Sheets[$('sheet').value]['!fullref']) {
    state.roster = null; $('importError').textContent = 'This sheet exceeds 10,000 rows. Use a smaller roster.'; render(); return;
  }
  const country = Roster.digits($('country').value).trim();
  if (!/^[1-9]\d{0,2}$/.test(country)) { $('importError').textContent = 'Enter a country calling code such as 964.'; return; }
  if ($('nameColumn').value === $('phoneColumn').value) { $('importError').textContent = 'Choose separate name and phone columns.'; return; }
  state.country = country;
  state.roster = Roster.buildRoster(state.rows, { nameColumn: Number($('nameColumn').value), phoneColumn: Number($('phoneColumn').value), startRow: $('hasHeader').checked ? 1 : 0, country });
  const errors = state.roster.invalid.slice(0, 8).map(item => 'Row ' + item.row + ': ' + item.name + ' — ' + item.reason);
  if (state.roster.invalid.length > 8) errors.push('…and ' + (state.roster.invalid.length - 8) + ' more invalid entries.');
  if (!state.roster.entries.length) errors.unshift('No valid phone numbers found. Check the selected sheet and columns.');
  $('importError').textContent = errors.join('\n');
  render();
}
$('excelFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const generation = state.generation;
  state.roster = null; state.workbook = null; $('mapping').hidden = true; $('importError').textContent = '';
  render();
  if (file.size > 10 * 1024 * 1024) { $('importError').textContent = 'Choose a file smaller than 10 MB.'; return; }
  try {
    const data = await file.arrayBuffer();
    if (generation !== state.generation) return;
    state.workbook = XLSX.read(data, { type: 'array', sheetRows: 10002 });
    if (!state.workbook.SheetNames.length) throw new Error('Workbook has no sheets.');
    $('sheet').replaceChildren();
    for (const name of state.workbook.SheetNames) { const option = element('option', '', name); option.value = name; $('sheet').append(option); }
    $('mapping').hidden = false;
    $('fileNote').textContent = file.name + ' · Select sheet and columns, then compare. Up to 10,000 rows are supported.';
    fillColumns();
    if (state.rows.length > 10001 || state.workbook.Sheets[$('sheet').value]['!fullref']) throw new Error('This sheet exceeds 10,000 rows. Use a smaller roster.');
    doCompare();
  } catch (error) { state.roster = null; state.workbook = null; $('mapping').hidden = true; $('importError').textContent = 'Could not import file: ' + error.message; render(); }
});
$('sheet').addEventListener('change', () => { fillColumns(); });
for (const id of ['nameColumn', 'phoneColumn', 'country', 'hasHeader']) $(id).addEventListener('change', () => { state.roster = null; $('importError').textContent = 'Column settings changed. Click Compare members to update the results.'; render(); });
$('compare').addEventListener('click', doCompare);
$('clearExcel').addEventListener('click', () => {
  state.workbook = state.roster = null; state.rows = [];
  $('excelFile').value = ''; $('mapping').hidden = true; $('importError').textContent = '';
  $('fileNote').textContent = 'Select a workbook with names and phone numbers. Iraqi local numbers use +964 by default.';
  render();
});
$('inviteLink').addEventListener('input', render);
$('copyInvite').addEventListener('click', () => { if (validLink()) copyText(inviteValue(), 'Invite link copied.'); });
let removal = null;
function confirmRemoval(item) {
  if (state.mutating) return;
  removal = { ...item, groupId: state.group.id };
  $('removeDetails').textContent = item.name + ' (' + item.phone + ') from ' + state.group.name + '. This number is not in the selected Excel roster.';
  $('removeDialog').showModal();
}
$('cancelRemove').addEventListener('click', () => { removal = null; $('removeDialog').close(); });
$('confirmRemove').addEventListener('click', () => {
  const item = removal; removal = null; $('removeDialog').close();
  if (item && state.group?.id === item.groupId) runAction('removeMember', item);
});
async function runAction(action, item) {
  if (state.busy || state.mutating || !state.group || !state.roster) return;
  const result = comparison();
  const eligible = (action === 'sendInvite' ? result.missing : result.extra).some(entry => action === 'sendInvite' ? entry.phone === item.phone : entry.id === item.id);
  if (!eligible) { $('feedback').textContent = 'Comparison changed. Refresh and review this person again.'; return; }
  if (action === 'removeMember' && (state.roster.invalid.length || !state.roster.entries.length || !state.group.isAdmin || item.isMe || item.role !== 'Member')) return;
  const key = actionKey(action, item);
  if (action === 'sendInvite' && (!validLink() || state.sent.has(key) || state.uncertain.has(key))) return;
  const group = state.group;
  state.mutating = true; state.actionErrors.delete(key);
  render();
  $('feedback').textContent = (action === 'sendInvite' ? 'Sending invite to ' : 'Removing ') + item.phone + '…';
  try {
    const response = await chrome.runtime.sendMessage({ action, tabId: state.tabId, groupId: group.id, phone: item.phone, memberId: item.id,
      inviteLink: inviteValue(), rosterPhones: state.roster.entries.map(entry => entry.phone) });
    if (!response?.success) throw new Error(response?.error || 'Action result unavailable. Check WhatsApp before retrying.');
    if (action === 'sendInvite') state.sent.add(key);
    state.mutating = false;
    if (action === 'removeMember') await loadMembers(group);
    else render();
    $('feedback').textContent = action === 'sendInvite' ? 'Invite sent to ' + item.phone + '.' : 'Removal requested for ' + item.phone + '. Membership refreshed.';
  } catch (error) {
    if (action === 'sendInvite' && /timed out|before retrying|result unavailable|message port|receiving end|channel closed/i.test(error.message)) state.uncertain.add(key);
    state.actionErrors.set(key, error.message);
    state.mutating = false; render();
    $('feedback').textContent = error.message;
  }
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
$('search').addEventListener('input', render);
$('back').addEventListener('click', () => {
  if (state.mutating) return;
  ++state.generation; state.group = null; $('search').value = ''; $('feedback').textContent = ''; render();
});
$('refresh').addEventListener('click', () => state.group ? loadMembers(state.group) : loadGroups());
$('copy').addEventListener('click', () => copyText(knownPhones().join('\n'), knownPhones().length + ' unique numbers copied.'));
$('export').addEventListener('click', () => {
  if (!state.group) return;
  const comparisonResult = comparison();
  const items = comparisonResult ? [...comparisonResult.extra, ...comparisonResult.missing, ...comparisonResult.matched, ...comparisonResult.unknown] : state.group.members;
  const rows = [['Name', 'Phone number', 'Role', 'Comparison status', 'Excel name'], ...items.map(member => [member.name, member.phone || '', member.role, member.status || (member.phone ? 'Available' : 'Unavailable'), member.excelName || ''])];
  const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = element('a'); anchor.href = url;
  anchor.download = (state.group.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'group') + '-members.csv';
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  $('feedback').textContent = 'Exported all results, including unavailable numbers.';
});
$('openWhatsApp').addEventListener('click', () => chrome.tabs.create({ url: 'https://web.whatsapp.com/' }));
loadGroups();

