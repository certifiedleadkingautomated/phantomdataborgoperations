import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = html.match(/const SCHEMA = `([\s\S]*?)`;/)[1];
const core = html.match(/\/\/ BEGIN ENTRY CORRECTION CORE([\s\S]*?)\/\/ END ENTRY CORRECTION CORE/)[1];
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
  sqlite.exec("ALTER TABLE history_rows ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'");
  sqlite.exec("INSERT INTO subaccounts VALUES ('a','A',0),('b','B',0)");
  const db = { run(sql, args = []) { sqlite.prepare(sql).run(...args); } };
  const query = (_db, sql, args = []) => sqlite.prepare(sql).all(...args);
  const ctx = vm.createContext({ query, first: (...args) => query(...args)[0],
    assert: (value, message) => assert.ok(value, message),
    checkZips: zips => assert.ok(zips.length && zips.every(z => /^[0-9]{5}$/.test(z)) && new Set(zips).size === zips.length) });
  vm.runInContext(core + '\nglobalThis.correct = correctEntry;', ctx);
  const history = (id, zips, account = 'a', status = 'confirmed') => {
    db.run("INSERT INTO history_rows VALUES (?,?,'2026-11-09','contacts','','2026-11-09T10:00:00Z',?)", [id, account, status]);
    for (const zip of zips) db.run("INSERT INTO history_zips(row_id,zip) VALUES (?,?)", [id, zip]);
  };
  const incoming = (id, zips) => {
    db.run("INSERT INTO new_zip_rows VALUES (?,'a','2026-11-09','','2026-11-09T10:00:00Z')", [id]);
    for (const zip of zips) db.run("INSERT INTO new_zip_items VALUES (?,?)", [id, zip]);
  };
  return { sqlite, db, query: (sql, args) => query(db, sql, args), correct: (entry, kind, zips) => ctx.correct(db, 'a', entry, kind, zips), history, incoming };
}
test('history corrections remove only the selected occurrence, with no deletion event', () => {
  const f = fixture(); try {
    f.history('wrong', ['00601', '10001']); f.history('valid', ['00601']); f.history('other-client', ['10001'], 'b');
    f.correct('wrong', 'history', ['00601']);
    assert.deepEqual(f.query("SELECT zip FROM history_zips WHERE row_id='wrong'").map(r => r.zip), ['10001']);
    assert.equal(f.query("SELECT zip FROM history_zips WHERE row_id='valid'").length, 1);
    assert.equal(f.query("SELECT id FROM deletion_events").length, 0);
    f.correct('wrong', 'history', ['10001']);
    assert.equal(f.query("SELECT id FROM history_rows WHERE id='wrong'").length, 0);
    assert.equal(f.query("SELECT zip FROM history_zips WHERE row_id='other-client'").length, 1);
  } finally { f.sqlite.close(); }
});
test('New correction removes its own entry while retaining another New occurrence', () => {
  const f = fixture(); try {
    f.incoming('wrong', ['00601', '10001']); f.incoming('valid', ['00601']);
    f.correct('wrong', 'new', ['00601', '10001']);
    assert.equal(f.query("SELECT id FROM new_zip_rows WHERE id='wrong'").length, 0);
    assert.equal(f.query("SELECT zip FROM new_zip_items WHERE row_id='valid'").length, 1);
  } finally { f.sqlite.close(); }
});
test('correcting a sole historical origin removes orphaned deletion and restoration traces', () => {
  const f = fixture(); try {
    f.history('wrong', ['00601']);
    f.db.run("INSERT INTO deletion_events VALUES ('deletion','a','individual','','','2026-11-09T10:00:00Z')");
    f.db.run("INSERT INTO deletion_items(event_id,zip) VALUES ('deletion','00601')");
    f.db.run("INSERT INTO restoration_events VALUES ('restore','a','deletion','2026-11-09T11:00:00Z','Comment','[\"00601\"]')");
    f.correct('wrong', 'history', ['00601']);
    assert.equal(f.query("SELECT id FROM deletion_events").length, 0);
    assert.equal(f.query("SELECT id FROM restoration_events").length, 0);
  } finally { f.sqlite.close(); }
});
test('pending ZIPs cannot be corrected and valid pending origins are preserved', () => {
  const f = fixture(); try {
    f.history('pending', ['10001'], 'a', 'pending'); f.incoming('source', ['00601']);
    f.db.run("INSERT INTO pending_sources VALUES ('pending','source','10001')");
    assert.throws(() => f.correct('pending', 'history', ['10001']), /Confirm or cancel/);
    f.correct('source', 'new', ['00601']);
    assert.equal(f.query("SELECT id FROM new_zip_rows WHERE id='source'").length, 1);
    assert.equal(f.query("SELECT zip FROM pending_sources").length, 1);
  } finally { f.sqlite.close(); }
});
