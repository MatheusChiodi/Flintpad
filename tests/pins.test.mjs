// Favoritos e recentes (src/lib/pins.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as p from '../src/lib/pins.ts';

const memory = () => {
  const data = new Map();
  return { data, getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => void data.set(key, value) };
};
const base = { favorites: ['a.md', 'b.md'], recents: ['b.md', 'c.md', 'a.md'] };

test('addFavorite acrescenta no fim e não duplica', () => {
  assert.deepEqual(p.addFavorite(base, 'c.md').favorites, ['a.md', 'b.md', 'c.md']);
  assert.equal(p.addFavorite(base, 'a.md'), base);
  assert.equal(p.addFavorite(base, ''), base);
});

test('removeFavorite tira só o pedido e não mexe nas recentes', () => {
  assert.deepEqual(p.removeFavorite(base, 'a.md').favorites, ['b.md']);
  assert.deepEqual(p.removeFavorite(base, 'a.md').recents, base.recents);
  assert.equal(p.removeFavorite(base, 'x.md'), base);
});

test('toggleFavorite alterna', () => {
  const on = p.toggleFavorite(p.emptyPins, 'n.md');
  assert.equal(p.isFavorite(on, 'n.md'), true);
  assert.equal(p.isFavorite(p.toggleFavorite(on, 'n.md'), 'n.md'), false);
});

test('touchRecent põe na frente sem duplicar', () => {
  assert.deepEqual(p.touchRecent(base, 'a.md').recents, ['a.md', 'b.md', 'c.md']);
  assert.deepEqual(p.touchRecent(base, 'z.md').recents, ['z.md', 'b.md', 'c.md', 'a.md']);
  assert.equal(p.touchRecent(base, 'b.md'), base);
  assert.equal(p.touchRecent(base, ''), base);
});

test('touchRecent guarda no máximo 20 e descarta a mais antiga', () => {
  let pins = p.emptyPins;
  for (let i = 0; i < 25; i++) pins = p.touchRecent(pins, `n${i}.md`);
  assert.equal(p.MAX_RECENTS, 20);
  assert.equal(pins.recents.length, 20);
  assert.equal(pins.recents[0], 'n24.md');
  assert.equal(pins.recents[19], 'n5.md');
});

test('renamePath troca nas duas listas mantendo a posição', () => {
  assert.deepEqual(p.renamePath(base, 'a.md', 'pasta/z.md'), {
    favorites: ['pasta/z.md', 'b.md'],
    recents: ['b.md', 'c.md', 'pasta/z.md'],
  });
  assert.equal(p.renamePath(base, 'x.md', 'y.md'), base);
  assert.equal(p.renamePath(base, 'a.md', 'a.md'), base);
});

test('renamePath só nas recentes não recria a lista de favoritos', () => {
  const next = p.renamePath(base, 'c.md', 'd.md');
  assert.equal(next.favorites, base.favorites);
  assert.deepEqual(next.recents, ['b.md', 'd.md', 'a.md']);
});

test('renamePath para um caminho já presente não duplica', () => {
  assert.deepEqual(p.renamePath(base, 'a.md', 'b.md'), { favorites: ['b.md'], recents: ['b.md', 'c.md'] });
});

test('removePath tira das duas listas', () => {
  assert.deepEqual(p.removePath(base, 'a.md'), { favorites: ['b.md'], recents: ['b.md', 'c.md'] });
  assert.equal(p.removePath(base, 'x.md'), base);
});

test('prunePins descarta o que não existe mais', () => {
  assert.deepEqual(p.prunePins(base, ['a.md', 'c.md']), { favorites: ['a.md'], recents: ['c.md', 'a.md'] });
  assert.equal(p.prunePins(base, new Set(['a.md', 'b.md', 'c.md', 'd.md'])), base);
  assert.deepEqual(p.prunePins(base, []), { favorites: [], recents: [] });
});

test('parsePins tolera lixo no armazenamento', () => {
  assert.deepEqual(p.parsePins(null), p.emptyPins);
  assert.deepEqual(p.parsePins('{nao json'), p.emptyPins);
  assert.deepEqual(p.parsePins('null'), p.emptyPins);
  assert.deepEqual(p.parsePins('[]'), p.emptyPins);
  assert.deepEqual(p.parsePins('{"favorites":"x","recents":[1,"a.md","a.md","",null,"b.md"]}'), {
    favorites: [],
    recents: ['a.md', 'b.md'],
  });
  const many = JSON.stringify({ favorites: [], recents: Array.from({ length: 30 }, (_, i) => `n${i}.md`) });
  assert.equal(p.parsePins(many).recents.length, 20);
});

test('a chave inclui o caminho do vault', () => {
  assert.equal(p.pinsKey('D:\\Notas'), 'obnotion:pins:D:\\Notas');
  assert.notEqual(p.pinsKey('D:\\A'), p.pinsKey('D:\\B'));
});

test('savePins e loadPins: ida e volta, isolado por vault', () => {
  const store = memory();
  p.savePins('D:\\A', base, store);
  assert.deepEqual(p.loadPins('D:\\A', store), base);
  assert.deepEqual(p.loadPins('D:\\B', store), p.emptyPins);
  assert.deepEqual([...store.data.keys()], ['obnotion:pins:D:\\A']);
});

test('armazenamento que falha não derruba o app', (t) => {
  const broken = {
    getItem: () => {
      throw new Error('indisponível');
    },
    setItem: () => {
      throw new Error('cheio');
    },
  };
  t.mock.method(console, 'error', () => {});
  assert.deepEqual(p.loadPins('v', broken), p.emptyPins);
  assert.doesNotThrow(() => p.savePins('v', base, broken));
});

test('nenhuma função altera a entrada', () => {
  const frozen = Object.freeze({
    favorites: Object.freeze(['a.md', 'b.md']),
    recents: Object.freeze(['b.md', 'c.md', 'a.md']),
  });
  p.addFavorite(frozen, 'q.md');
  p.removeFavorite(frozen, 'a.md');
  p.touchRecent(frozen, 'q.md');
  p.renamePath(frozen, 'a.md', 'q.md');
  p.removePath(frozen, 'a.md');
  p.prunePins(frozen, ['a.md']);
});
