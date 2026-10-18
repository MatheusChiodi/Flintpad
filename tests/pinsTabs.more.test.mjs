// Mais casos de favoritos/recentes (src/lib/pins.ts) e guias/sessão (src/lib/tabs.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as p from '../src/lib/pins.ts';
import * as g from '../src/lib/tabs.ts';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
};
const tab = (id, path, pinned) => ({ id, stack: [path], idx: 0, ...(pinned ? { pinned: true } : {}) });
const ids = (tabs) => tabs.map((t) => t.id);

// ---------------------------------------------------------------------------------------------
// Favoritos e recentes

test('parsePins: JSON "null", número e listas com lixo', () => {
  assert.deepEqual(p.parsePins('null'), { favorites: [], recents: [] });
  assert.deepEqual(p.parsePins('42'), { favorites: [], recents: [] });
  assert.deepEqual(p.parsePins(''), p.emptyPins);
  assert.deepEqual(p.parsePins(undefined), p.emptyPins);
  assert.deepEqual(
    p.parsePins(JSON.stringify({ favorites: ['a.md', '', 3, null, 'a.md', 'Ação.md'], recents: 'x' })),
    { favorites: ['a.md', 'Ação.md'], recents: [] },
  );
});

test('addFavorite com caminho vazio e removeFavorite inexistente devolvem o mesmo objeto', () => {
  const pins = { favorites: ['a.md'], recents: [] };
  assert.equal(p.addFavorite(pins, ''), pins);
  assert.equal(p.removeFavorite(pins, 'z.md'), pins);
  assert.equal(p.isFavorite(pins, 'A.md'), false);
});

test('touchRecent: vazio e já no topo não mudam; caminho do meio sobe', () => {
  const pins = { favorites: [], recents: ['a.md', 'b.md', 'c.md'] };
  assert.equal(p.touchRecent(pins, ''), pins);
  assert.equal(p.touchRecent(pins, 'a.md'), pins);
  assert.deepEqual(p.touchRecent(pins, 'c.md').recents, ['c.md', 'a.md', 'b.md']);
});

test('removeRecent tira só das recentes e mantém o favorito', () => {
  const pins = { favorites: ['a.md'], recents: ['a.md', 'b.md'] };
  const next = p.removeRecent(pins, 'a.md');
  assert.deepEqual(next, { favorites: ['a.md'], recents: ['b.md'] });
  assert.equal(next.favorites, pins.favorites);
  assert.equal(p.removeRecent(pins, 'z.md'), pins);
});

test('clearRecents: lista vazia devolve o mesmo objeto, senão esvazia e mantém favoritos', () => {
  assert.equal(p.clearRecents(p.emptyPins), p.emptyPins);
  const pins = { favorites: ['a.md'], recents: ['b.md'] };
  assert.deepEqual(p.clearRecents(pins), { favorites: ['a.md'], recents: [] });
});

test('renamePath: mesmo caminho ou caminho ausente não mudam', () => {
  const pins = { favorites: ['a.md'], recents: ['a.md'] };
  assert.equal(p.renamePath(pins, 'a.md', 'a.md'), pins);
  assert.equal(p.renamePath(pins, 'z.md', 'y.md'), pins);
  assert.deepEqual(p.renamePath(pins, 'a.md', 'Pasta/Ação.md'), { favorites: ['Pasta/Ação.md'], recents: ['Pasta/Ação.md'] });
});

test('removePath ausente devolve o mesmo objeto', () => {
  const pins = { favorites: ['a.md'], recents: [] };
  assert.equal(p.removePath(pins, 'z.md'), pins);
});

test('prunePins: tudo existe devolve o mesmo objeto; aceita qualquer iterável', () => {
  const pins = { favorites: ['a.md'], recents: ['b.md', 'a.md'] };
  assert.equal(p.prunePins(pins, ['a.md', 'b.md', 'c.md']), pins);
  assert.deepEqual(p.prunePins(pins, new Set(['a.md'])), { favorites: ['a.md'], recents: ['a.md'] });
  assert.deepEqual(p.prunePins(pins, []), { favorites: [], recents: [] });
});

test('pinsKey diferencia vaults com acentos e barras', () => {
  assert.equal(p.pinsKey('D:/Notas/Ação'), 'obnotion:pins:D:/Notas/Ação');
  assert.notEqual(p.pinsKey('a'), p.pinsKey('A'));
});

test('loadPins de vault nunca salvo começa vazio', () => {
  assert.deepEqual(p.loadPins('novo', memory()), p.emptyPins);
});

test('savePins grava JSON que parsePins lê de volta', () => {
  const store = memory();
  const pins = { favorites: ['Ação.md'], recents: ['b.md'] };
  p.savePins('v', pins, store);
  assert.deepEqual(JSON.parse(store.data.get(p.pinsKey('v'))), pins);
  assert.deepEqual(p.loadPins('v', store), pins);
});

// ---------------------------------------------------------------------------------------------
// Guias

test('tabPath: posição fora do histórico dá vazio', () => {
  assert.equal(g.tabPath({ id: 1, stack: ['a.md', 'b.md'], idx: 1 }), 'b.md');
  assert.equal(g.tabPath({ id: 1, stack: ['a.md'], idx: 5 }), '');
  assert.equal(g.tabPath({ id: 1, stack: [], idx: 0 }), '');
});

test('togglePin com id desconhecido devolve a mesma lista; várias fixadas mantêm a ordem', () => {
  const tabs = [tab(1, 'a.md'), tab(2, 'b.md'), tab(3, 'c.md')];
  assert.equal(g.togglePin(tabs, 99), tabs);
  const once = g.togglePin(tabs, 2);
  const twice = g.togglePin(once, 3);
  assert.deepEqual(ids(twice), [2, 3, 1]);
  assert.deepEqual(twice.map((t) => !!t.pinned), [true, true, false]);
});

test('togglePin não altera as guias de entrada', () => {
  const tabs = [tab(1, 'a.md')];
  g.togglePin(tabs, 1);
  assert.equal(tabs[0].pinned, undefined);
});

test('closeOthers: nada a fechar devolve a mesma lista; id desconhecido deixa só as fixadas', () => {
  const tabs = [tab(1, 'a.md', true), tab(2, 'b.md')];
  assert.equal(g.closeOthers([tab(1, 'a.md')], 1).length, 1);
  assert.equal(g.closeOthers(tabs, 2), tabs);
  assert.deepEqual(ids(g.closeOthers(tabs, 99)), [1]);
});

test('closeToRight: id desconhecido ou última guia devolvem a mesma lista', () => {
  const tabs = [tab(1, 'a.md'), tab(2, 'b.md')];
  assert.equal(g.closeToRight(tabs, 99), tabs);
  assert.equal(g.closeToRight(tabs, 2), tabs);
  assert.deepEqual(ids(g.closeToRight(tabs, 1)), [1]);
});

test('moveTab: id desconhecido, mesma posição e posições fora da faixa', () => {
  const tabs = [tab(1, 'a.md'), tab(2, 'b.md'), tab(3, 'c.md')];
  assert.equal(g.moveTab(tabs, 99, 0), tabs);
  assert.equal(g.moveTab(tabs, 2, 1), tabs);
  assert.deepEqual(ids(g.moveTab(tabs, 1, 100)), [2, 3, 1]);
  assert.deepEqual(ids(g.moveTab(tabs, 3, -5)), [3, 1, 2]);
});

test('moveTab: fixada se move só entre as fixadas', () => {
  const tabs = [tab(1, 'a.md', true), tab(2, 'b.md', true), tab(3, 'c.md')];
  assert.deepEqual(ids(g.moveTab(tabs, 1, 9)), [2, 1, 3]);
  assert.deepEqual(ids(g.moveTab(tabs, 3, 0)), [1, 2, 3]);
});

// ---------------------------------------------------------------------------------------------
// Sessão

test('serializeSession: guia ativa ausente vira 0, guias vazias saem e o limite vale', () => {
  const s = g.serializeSession([tab(1, ''), tab(2, 'a.md')], 99);
  assert.deepEqual(s, { tabs: [{ stack: ['a.md'], idx: 0 }], active: 0 });
  const many = Array.from({ length: 40 }, (_, i) => tab(i, `n${i}.md`));
  const big = g.serializeSession(many, 35);
  assert.equal(big.tabs.length, g.MAX_SESSION_TABS);
  assert.equal(big.active, 0);
});

test('serializeSession: posição antes do corte do histórico fica em 0', () => {
  const stack = Array.from({ length: 60 }, (_, i) => `n${i}.md`);
  const [saved] = g.serializeSession([{ id: 1, stack, idx: 2 }], 1).tabs;
  assert.equal(saved.stack.length, 50);
  assert.equal(saved.idx, 0);
});

test('restoreSession: vazio, JSON inválido e formato errado dão sessão vazia', () => {
  const empty = { tabs: [], activeId: 0 };
  const yes = () => true;
  assert.deepEqual(g.restoreSession(null, yes, 1), empty);
  assert.deepEqual(g.restoreSession('', yes, 1), empty);
  assert.deepEqual(g.restoreSession('{quebrado', yes, 1), empty);
  assert.deepEqual(g.restoreSession('null', yes, 1), empty);
  assert.deepEqual(g.restoreSession('{"tabs":"x"}', yes, 1), empty);
  assert.deepEqual(g.restoreSession(JSON.stringify({ tabs: [null, { stack: 'a' }, { stack: [] }] }), yes, 1), empty);
});

test('restoreSession: página atual apagada cai no fim do histórico e ids seguem firstId', () => {
  const raw = JSON.stringify({ tabs: [{ stack: ['a.md', 'x.md', 'b.md'], idx: 1 }, { stack: ['c.md'], idx: 0 }], active: 1 });
  const out = g.restoreSession(raw, (path) => path !== 'x.md', 10);
  assert.deepEqual(out.tabs, [
    { id: 10, stack: ['a.md', 'b.md'], idx: 1 },
    { id: 11, stack: ['c.md'], idx: 0 },
  ]);
  assert.equal(out.activeId, 11);
});

test('restoreSession: itens que não são texto saem do histórico e "pinned" só vale se for true', () => {
  const raw = JSON.stringify({ tabs: [{ stack: [1, 'a.md', '', null], idx: 1, pinned: 'sim' }], active: 0 });
  const out = g.restoreSession(raw, () => true, 1);
  assert.deepEqual(out.tabs, [{ id: 1, stack: ['a.md'], idx: 0 }]);
});

test('restoreSession: ativa descartada cai na primeira guia; fixadas vêm primeiro', () => {
  const raw = JSON.stringify({ tabs: [{ stack: ['a.md'], idx: 0 }, { stack: ['b.md'], idx: 0, pinned: true }, { stack: ['sumiu.md'], idx: 0 }], active: 2 });
  const out = g.restoreSession(raw, (path) => path !== 'sumiu.md', 1);
  assert.deepEqual(ids(out.tabs), [2, 1]);
  assert.equal(out.activeId, 2);
});

test('restoreSession: active inválido vale como a primeira posição salva', () => {
  const raw = JSON.stringify({ tabs: [{ stack: ['a.md'], idx: 0 }, { stack: ['b.md'], idx: 0 }], active: 'x' });
  assert.equal(g.restoreSession(raw, () => true, 1).activeId, 1);
});

test('restoreSession com firstId 0 mantém a guia ativa salva', () => {
  const raw = JSON.stringify({ tabs: [{ stack: ['a.md'], idx: 0 }, { stack: ['b.md'], idx: 0, pinned: true }], active: 0 });
  const out = g.restoreSession(raw, () => true, 0);
  assert.equal(out.activeId, 0);
});

test('saveSession e loadSession: ida e volta isolada por vault', () => {
  const store = memory();
  g.saveSession('v1', [tab(5, 'a.md', true), tab(6, 'b.md')], 6, store);
  assert.equal(g.loadSession('v2', store), null);
  const out = g.restoreSession(g.loadSession('v1', store), () => true, 1);
  assert.deepEqual(out, { tabs: [{ id: 1, stack: ['a.md'], idx: 0, pinned: true }, { id: 2, stack: ['b.md'], idx: 0 }], activeId: 2 });
  assert.equal(g.sessionKey('v1'), 'obnotion:session:v1');
});

test('saveSession e loadSession toleram armazenamento que falha', () => {
  const broken = {
    getItem() {
      throw new Error('bloqueado');
    },
    setItem() {
      throw new Error('cheio');
    },
  };
  assert.equal(g.loadSession('v', broken), null);
  assert.doesNotThrow(() => g.saveSession('v', [tab(1, 'a.md')], 1, broken));
});
