import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorkload } from '../src/model-routing.ts';

test('workload router keeps arithmetic on deterministic path', () => {
  assert.equal(classifyWorkload('What is 12 * 13?').workload, 'deterministic');
});
test('workload router sends explicit structured puzzles to TRM domain', () => {
  assert.equal(classifyWorkload('Solve this Sudoku: 1..2').workload, 'trm');
  assert.equal(classifyWorkload('ARC-AGI input: grid').workload, 'trm');
  assert.equal(classifyWorkload('I use a grid in my website').workload, 'language');
});
test('workload router reserves Needle for bounded structured tasks', () => {
  assert.equal(classifyWorkload('Extract names and dates as JSON').workload, 'needle');
  assert.equal(classifyWorkload('Which tool call should handle this?').workload, 'needle');
});
test('workload router defaults conservatively to language', () => {
  assert.equal(classifyWorkload('Explain recursive reasoning and its limitations').workload, 'language');
  assert.equal(classifyWorkload('').workload, 'language');
});
