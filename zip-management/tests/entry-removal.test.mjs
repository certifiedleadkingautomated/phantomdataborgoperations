import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = html.match(/\/\/ BEGIN ENTRY REMOVAL REQUEST([\s\S]*?)\/\/ END ENTRY REMOVAL REQUEST/)[1];
const context = vm.createContext({});
vm.runInContext(core + '\nglobalThis.request = entryRemovalRequest;', context);
const correction = { date: '2026-11-09', comment: 'Keep metadata', remove_zips: ['00601', '10001'] };
test('whole-entry buttons route through the existing correction handlers and preserve all ZIPs', () => {
  for (const [kind, action] of [['correct_history', 'edit_history'], ['correct_new', 'edit_new']]) {
    const result = context.request({ kind, row: 'entry', correction });
    assert.equal(result.action, action);
    assert.equal(result.payload.row, 'entry');
    assert.deepEqual(JSON.parse(JSON.stringify(result.payload.remove_zips)), ['00601', '10001']);
    assert.equal(result.payload.comment, correction.comment);
  }
});
test('unknown or incomplete entry removal cannot fall through into a workspace reset', () => {
  for (const value of [{ kind: 'unknown' }, { kind: 'correct_history' }, { kind: 'correct_new', correction: { remove_zips: [] } }]) assert.throws(() => context.request(value));
  assert.equal(context.request({ kind: 'all' }).action, 'reset');
  assert.equal(context.request({ kind: 'pending', row: 'entry' }).action, 'cancel_pending');
});
