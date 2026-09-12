'use strict';

// Testes do parser de GPU do MetricsCollector (não dependem de GPU real —
// exercitam MetricsCollector.parseGpuCsv com saídas simuladas do nvidia-smi).
// Rodar: node --test src/services/MetricsCollector.test.js (a partir de backend/)

const test = require('node:test');
const assert = require('node:assert/strict');
const MetricsCollector = require('./MetricsCollector');

test('parseGpuCsv: uma GPU com todos os campos', () => {
  const csv = '0, Tesla T10, 42, 10, 8000, 16384, 55, 90.50, 150.00';
  const [g] = MetricsCollector.parseGpuCsv(csv);
  assert.equal(g.index, 0);
  assert.equal(g.name, 'Tesla T10');
  assert.equal(g.utilization, 42);
  assert.equal(g.memoryUsedMB, 8000);
  assert.equal(g.memoryTotalMB, 16384);
  assert.equal(g.temperature, 55);
  assert.equal(g.powerDraw, 90.5);
  assert.equal(g.powerLimit, 150);
  // memoryPercent derivado de used/total: 8000/16384 ≈ 48.8%
  assert.equal(g.memoryPercent, 48.8);
});

test('parseGpuCsv: múltiplas GPUs', () => {
  const csv = [
    '0, Tesla T10, 0, 0, 10233, 16384, 32, 36.75, 150.00',
    '1, Tesla T10, 75, 20, 9787, 16384, 33, 120.00, 150.00',
  ].join('\n');
  const gpus = MetricsCollector.parseGpuCsv(csv);
  assert.equal(gpus.length, 2);
  assert.equal(gpus[1].index, 1);
  assert.equal(gpus[1].utilization, 75);
});

test('parseGpuCsv: valores [N/A] viram null', () => {
  const csv = '0, GPU X, [N/A], [N/A], 100, 2000, 40, [N/A], [N/A]';
  const [g] = MetricsCollector.parseGpuCsv(csv);
  assert.equal(g.utilization, null);
  assert.equal(g.powerDraw, null);
  assert.equal(g.powerLimit, null);
  assert.equal(g.memoryPercent, 5); // 100/2000 = 5%
});

test('parseGpuCsv: entrada vazia/indefinida retorna []', () => {
  assert.deepEqual(MetricsCollector.parseGpuCsv(''), []);
  assert.deepEqual(MetricsCollector.parseGpuCsv(undefined), []);
  assert.deepEqual(MetricsCollector.parseGpuCsv('   \n  '), []);
});

test('parseGpuCsv: linha malformada (poucos campos) é descartada', () => {
  const csv = '0, incompleta\n1, Tesla T10, 10, 5, 100, 200, 30, 50, 150';
  const gpus = MetricsCollector.parseGpuCsv(csv);
  assert.equal(gpus.length, 1);
  assert.equal(gpus[0].index, 1);
});

test('getGPU: nunca lança e sempre retorna shape consistente', () => {
  const c = new MetricsCollector();
  const r = c.getGPU();
  assert.equal(typeof r.available, 'boolean');
  assert.ok(Array.isArray(r.devices));
});
