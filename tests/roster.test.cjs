const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const XLSX = require('../vendor/xlsx.full.min.js');
const { normalizePhone, buildRoster, compare } = require('../roster.js');

test('Iraqi local, international, numeric, and Arabic formats normalize identically', () => {
  for (const input of ['07701234567', '+9647701234567', '00964 770 123 4567', 7701234567, '٠٧٧٠١٢٣٤٥٦٧', '۰۷۷۰۱۲۳۴۵۶۷']) assert.equal(normalizePhone(input), '+9647701234567');
  assert.equal(normalizePhone('111111@lid'), null);
  assert.equal(normalizePhone('hello 07701234567'), null);
  assert.equal(normalizePhone('07701234567/07801234567'), null);
});
test('duplicate phone rows retain names and invalid rows stay visible', () => {
  const roster = buildRoster([['Name', 'Phone'], ['Ali', '07701234567'], ['Sara', '+9647701234567'], ['Missing', ''], ['Two', '07801234567 / 07901234567']], { nameColumn: 0, phoneColumn: 1 });
  assert.equal(roster.entries.length, 3);
  assert.equal(roster.duplicates, 1);
  assert.equal(roster.entries[0].name, 'Ali / Sara');
  assert.equal(roster.invalid[0].row, 4);
});
test('phone matches ignore display names; unresolved members are never extras', () => {
  const roster = buildRoster([['Name', 'Phone'], ['Excel Name', '07701234567'], ['Absent', '07801234567']], { nameColumn: 0, phoneColumn: 1 });
  const result = compare([{ id: '1', name: 'Different name', phone: '+9647701234567' }, { id: '2', name: 'Extra', phone: '+9647901234567' }, { id: '3', name: 'Hidden', phone: null }], roster);
  assert.equal(result.matched.length, 1);
  assert.equal(result.extra.length, 1);
  assert.equal(result.missing.length, 1);
  assert.equal(result.unknown.length, 1);
});
test('a synthetic Arabic workbook imports all 26 entries', () => {
  const synthetic = [['الاسم', 'رقم الهاتف'], ...Array.from({length:26}, (_,i) => ['Example '+i, '+964770'+String(1000000+i)])];
  const input = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(input, XLSX.utils.aoa_to_sheet(synthetic), 'Example');
  const book = XLSX.read(XLSX.write(input, {type:'buffer', bookType:'xlsx'}), {type:'buffer'});
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true });
  const roster = buildRoster(rows, { nameColumn: 0, phoneColumn: 1 });
  assert.equal(rows[0][0], 'الاسم');
  assert.equal(rows[0][1], 'رقم الهاتف');
  assert.equal(roster.entries.length + roster.duplicates + roster.invalid.length, 26);
  assert.equal(roster.invalid.length, 0);
  assert.ok(roster.entries.every(entry => /^\+9647\d{9}$/.test(entry.phone)));
});
