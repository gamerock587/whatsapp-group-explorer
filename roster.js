/* Shared import and matching rules. No names are used as membership keys. */
(function (root) {
  'use strict';
  function digits(value) {
    return String(value ?? '').replace(/[\u0660-\u0669]/g, char => String(char.charCodeAt(0) - 0x660))
      .replace(/[\u06f0-\u06f9]/g, char => String(char.charCodeAt(0) - 0x6f0));
  }
  function normalizePhone(value, country = '964') {
    let text = digits(value).trim().replace(/^'/, '');
    if (!text || /[a-z@]/i.test(text) || !/^[+\d\s().-]+$/.test(text)) return null;
    let number = text.replace(/\D/g, '');
    if (text.startsWith('00')) number = number.slice(2);
    else if (!text.startsWith('+')) {
      if (number.startsWith('0')) number = country + number.replace(/^0+/, '');
      else if (country === '964' && /^7\d{9}$/.test(number)) number = country + number;
      // An unprefixed international number is accepted as written.
    }
    return /^[1-9]\d{6,14}$/.test(number) ? '+' + number : null;
  }
  function buildRoster(rows, { nameColumn, phoneColumn, startRow = 1, country = '964' }) {
    const byPhone = new Map(), invalid = [];
    let duplicates = 0;
    for (let index = startRow; index < rows.length; index++) {
      const row = rows[index] || [];
      if (!row.some(value => String(value ?? '').trim())) continue;
      const name = String(row[nameColumn] ?? '').trim() || 'Name unavailable';
      const raw = row[phoneColumn];
      const parts = digits(raw).split(/[,;\n/\u060c]+/).filter(part => part.trim());
      if (!parts.length) { invalid.push({ name, row: index + 1, raw: String(raw ?? ''), reason: 'Missing phone number' }); continue; }
      for (const part of parts) {
        const phone = normalizePhone(part, country);
        if (!phone) { invalid.push({ name, row: index + 1, raw: part, reason: 'Invalid phone number' }); continue; }
        if (byPhone.has(phone)) {
          duplicates++;
          const record = byPhone.get(phone);
          if (!record.names.includes(name)) record.names.push(name);
          record.name = record.names.join(' / ');
          record.rows.push(index + 1);
        } else byPhone.set(phone, { name, names: [name], phone, rows: [index + 1] });
      }
    }
    return { entries: [...byPhone.values()], invalid, duplicates };
  }
  function compare(members, roster, country = '964') {
    const excel = new Map(roster.entries.map(entry => [entry.phone, entry]));
    const groupPhones = new Set(members.map(member => normalizePhone(member.phone, country)).filter(Boolean));
    const extra = [], matched = [], unknown = [];
    for (const member of members) {
      const phone = normalizePhone(member.phone, country);
      if (!phone) unknown.push({ ...member, status: 'unverified' });
      else if (excel.has(phone)) matched.push({ ...member, phone, excelName: excel.get(phone).name, status: 'matched' });
      else extra.push({ ...member, phone, status: 'extra' });
    }
    const missing = roster.entries.filter(entry => !groupPhones.has(entry.phone)).map(entry => ({ ...entry, status: 'missing', role: 'Excel' }));
    return { extra, missing, matched, unknown };
  }
  const api = { digits, normalizePhone, buildRoster, compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Roster = api;
})(globalThis);
