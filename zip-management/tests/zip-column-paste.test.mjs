import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const code = html.slice(html.indexOf('      window.ZipPaste = {'), html.indexOf('// BEGIN STATIC GHL COUNT ENGINE'));
const window = {};
vm.runInNewContext(code, { window, Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } } });
const paste = window.ZipPaste;
test('vertical ZIP columns become a single comma list, preserving zeroes and normal validation inputs', () => {
  for (const separator of ['\n', '\r\n', '\r']) assert.equal(paste.column(['00601', '33701', '1234'].join(separator)), '00601,33701,1234');
  assert.equal(paste.column('ZIP codes\n00601\n\n 33701 \n'), '00601,33701');
  assert.equal(paste.column('00601\t\r\n33701\t\r\n'), '00601,33701');
  assert.equal(paste.column('33701\n33701'), '33701,33701');
});
test('comments, order rows, malformed ZIPs and comma lists retain existing paste handling', () => {
  for (const value of ['Order 123\t00601\nOrder 456\t33701', '123\t00601\n456\t33701', '00601,33701\n90210,10001', '123456\n33701', 'ZIP+4\n33701-1234', '00601\ninvalid', '00601', '00601,33701']) assert.equal(paste.column(value), null);
});
test('paste replaces the selection and fires normal validation without merging adjacent digits', () => {
  const events = []; let prevented = false;
  const field = { value: '1000190210', selectionStart: 5, selectionEnd: 5,
    setRangeText(text, start, end, mode) { this.value = this.value.slice(0, start) + text + this.value.slice(end); assert.equal(mode, 'end'); },
    dispatchEvent(event) { events.push(event); } };
  assert.equal(paste.pasteColumn({ currentTarget: field, clipboardData: { getData: () => '00601\n33701' }, preventDefault() { prevented = true; } }), true);
  assert.equal(field.value, '10001,00601,33701,90210');
  assert.equal(prevented, true); assert.equal(events.length, 1); assert.equal(events[0].type, 'input'); assert.equal(events[0].bubbles, true);
  field.value = '10001,replace,90210'; field.selectionStart = 6; field.selectionEnd = 13;
  paste.pasteColumn({ currentTarget: field, clipboardData: { getData: () => '00601\n33701' }, preventDefault() {} });
  assert.equal(field.value, '10001,00601,33701,90210');
});
test('all ZIP-list paste surfaces use column handling without attaching it to comments', () => {
  assert.match(html, /if \(ZipPaste\.pasteColumn\(event\)\) return;/);
  assert.match(html, /\["zl-check", "zl-used-search"\]/);
  assert.match(html, /"aria-label": "ZIPs for row " \+ \(i \+ 1\),\s+onpaste:/);
});
