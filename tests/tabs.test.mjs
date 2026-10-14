// Guias e sessão (src/lib/tabs.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as g from '../src/lib/tabs.ts';

const tab = (id, path, pinned) => ({ id, stack: [path], idx: 0, ...(pinned ? { pinned: true } : {}) });
const ids = (tabs) => tabs.map((t) => t.id);

test('togglePin fixa e leva a guia para a esquerda; soltar deixa no lugar', () => {
  const tabs = [tab(1, 'a.md'), tab(2, 'b.md'), tab(3, 'c.md')];
  const pinned = g.togglePin(tabs, 3);
  assert.deepEqual(ids(pinned), [3, 1, 2]);
  assert.equal(pinned[0].pinned, true);
  const unpinned = g.togglePin(pinned, 3);
  assert.deepEqual(ids(unpinned), [3, 1, 2]);
  assert.equal(unpinned[0].pinned, false);
  assert.equal(g.togglePin(tabs, 9), tabs);
});

test('closeOthers e closeToRight poupam as fixadas', () => {
  const tabs = [tab(1, 'a.md', true), tab(2, 'b.md'), tab(3, 'c.md'), tab(4, 'd.md')];
  assert.deepEqual(ids(g.closeOthers(tabs, 3)), [1, 3]);
  assert.deepEqual(ids(g.closeToRight(tabs, 2)), [1, 2]);
  assert.equal(g.closeToRight(tabs, 4), tabs);
});

test('moveTab não atravessa a fronteira das fixadas', () => {
  const tabs = [tab(1, 'a.md', true), tab(2, 'b.md'), tab(3, 'c.md')];
  assert.deepEqual(ids(g.moveTab(tabs, 3, 0)), [1, 3, 2]);
  assert.deepEqual(ids(g.moveTab(tabs, 1, 2)), [1, 2, 3]);
  assert.deepEqual(ids(g.moveTab(tabs, 2, 5)), [1, 3, 2]);
});

test('sessão: salva, restaura e descarta o que não existe mais', () => {
  const tabs = [{ id: 7, stack: ['a.md', 'x.md', 'b.md'], idx: 1 }, tab(8, '::graph', true), { id: 9, stack: [''], idx: 0 }];
  const saved = JSON.stringify(g.serializeSession(tabs, 8));
  const exists = (path) => path !== 'x.md';
  const restored = g.restoreSession(saved, exists, 100);
  assert.deepEqual(restored.tabs.map((t) => [t.stack, t.idx, Boolean(t.pinned)]), [
    [['::graph'], 0, true],
    [['a.md', 'b.md'], 1, false],
  ]);
  assert.equal(restored.activeId, restored.tabs[0].id);
  assert.deepEqual(g.restoreSession('lixo{', exists, 1), { tabs: [], activeId: 0 });
  assert.deepEqual(g.restoreSession(JSON.stringify({ tabs: [{ stack: [42] }] }), exists, 1).tabs, []);
});

test('sessão: o histórico longo guarda só o fim e a posição acompanha', () => {
  const stack = Array.from({ length: 60 }, (_, i) => `n${i}.md`);
  const [saved] = g.serializeSession([{ id: 1, stack, idx: 59 }], 1).tabs;
  assert.equal(saved.stack.length, 50);
  assert.equal(saved.stack[saved.idx], 'n59.md');
});
