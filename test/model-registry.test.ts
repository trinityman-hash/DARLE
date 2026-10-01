import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectModel, type ModelProvider } from '../src/model-registry.ts';

const provider = (role: ModelProvider['role'], id = role): ModelProvider => ({
  id, role, endpoint: 'http://127.0.0.1:9000', model: id, available: true, maxInputChars: 4000,
});

test('deterministic workloads do not select a neural provider', () => {
  const r = selectModel('deterministic', [provider('language')], 12);
  assert.equal(r.selected, 'deterministic');
  assert.equal(r.provider, null);
});
test('specialist is selected only when explicitly available and within input budget', () => {
  assert.equal(selectModel('needle', [provider('needle')], 100).selected, 'needle');
  assert.equal(selectModel('trm', [provider('trm')], 100).selected, 'trm');
  assert.equal(selectModel('needle', [provider('needle')], 5000).selected, 'none');
  assert.equal(selectModel('trm', [{ ...provider('trm'), available: false }], 100).selected, 'none');
});
test('specialist falls back only to a configured eligible language provider', () => {
  const r = selectModel('trm', [provider('language')], 100);
  assert.equal(r.selected, 'language');
  assert.equal(r.reason, 'trm-provider-unavailable-language-fallback');
  assert.equal(selectModel('needle', [], 100).selected, 'none');
});
test('invalid or incomplete provider configuration is not selected', () => {
  const invalid = { ...provider('needle'), endpoint: ' ' };
  assert.equal(selectModel('needle', [invalid], 20).selected, 'none');
});
