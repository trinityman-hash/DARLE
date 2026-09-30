import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Darle, seeded } from '../src/darle.ts';

test('capacity: recall vs facts superposed in ONE bank', () => {
  for (const m of [20, 50, 100, 150]) {
    const d = new Darle(); d.seed(Array.from({ length: m }, (_, i) => `hub likes item${i}`));
    let ok = 0; for (let i = 0; i < m; i++) if (d.verify({ s: 'hub', rel: 'likes', o: 'item' + i, neg: false }).v === 'supported') ok++;
    console.log(`  m=${m}: verified ${ok}/${m}`);
    if (m <= 100) assert.ok(ok / m >= 0.95, `recall at m=${m} was ${ok}/${m}`);
  }
});
test('recalls a fact stated 300 turns earlier', () => {
  const d = seeded(); d.chat('Sam lives in Lyon.');
  for (let i = 0; i < 300; i++) d.chat(`person${i} likes thing${i}.`);
  assert.match(d.chat('Where does Sam live?').text, /lyon/i);
});
test('no false support: 300 random unstored claims', () => {
  const d = seeded(); let bad = 0;
  for (let i = 0; i < 300; i++) if (d.verify({ s: ['france', 'dog', 'paris', 'oak'][i % 4], rel: 'is a', o: 'zz' + i, neg: false }).v === 'supported') bad++;
  assert.equal(bad, 0);
});
test('contradiction, refusal to overwrite, explicit correction', () => {
  const d = seeded(); d.chat('Sam lives in Paris.');
  assert.equal(d.chat('Sam lives in Rome.').verdict, 'contradicted');
  assert.match(d.chat('Where does Sam live?').text, /paris/i);
  d.chat('Actually, Sam lives in Rome.');
  const r = d.chat('Where does Sam live?').text; assert.match(r, /rome/i); assert.doesNotMatch(r, /paris/i);
});
test('multi-hop proof and unknown', () => {
  const d = seeded(), r = d.chat('Is a whale an animal?');
  assert.equal(r.verdict, 'supported'); assert.equal(r.proof.length, 3);
  assert.equal(d.chat('Is a dog a reptile?').verdict, 'unknown');
  assert.match(d.chat('Is Paris in Europe?').text, /^Yes/);
  assert.match(d.chat('What is the capital of Japan?').text, /tokyo/i);
});
test('negation and functional exclusion', () => {
  const d = seeded(); d.chat('Ann lives in Oslo.');
  assert.equal(d.verify({ s: 'ann', rel: 'lives in', o: 'rome', neg: true }).v, 'supported');
  assert.equal(d.chat('Ann does not live in Oslo.').verdict, 'contradicted');
});
test('deterministic', () => {
  const a = seeded(), b = seeded();
  for (const q of ['Is a bat a mammal?', 'What is a penguin?', 'Sam works for Acme.', 'Who works for Acme?']) assert.deepEqual(a.chat(q), b.chat(q));
});
