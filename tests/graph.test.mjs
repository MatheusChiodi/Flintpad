// Lógica da tela do grafo (src/lib/graph.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as g from '../src/lib/graph.ts';

const note = (path) => ({ path, name: path.split('/').pop().replace(/\.md$/, '') });
const notes = ['Inicio.md', 'Projetos/A.md', 'Projetos/B.md', 'Sozinha.md'].map(note);
const contents = {
  'Inicio.md': 'Veja [[A]], [[a]] e [[B]]. #hub',
  'Projetos/A.md': '---\ntags: [projeto]\n---\n[[B]] e [[Fantasma]] e [[Req/x.bru|x]] #projeto/web',
  'Projetos/B.md': 'Volta para [[Inicio]] e [[Projetos/B]].',
  'Sozinha.md': 'Nada aqui, nem segredo.',
};

test('buildGraph junta links repetidos, ignora auto-links e requests', () => {
  const data = g.buildGraph(notes, contents);
  assert.deepEqual(data.items.map((item) => item.id), notes.map((n) => n.path));
  assert.deepEqual(data.edges, [
    ['Inicio.md', 'Projetos/A.md'],
    ['Inicio.md', 'Projetos/B.md'],
    ['Projetos/A.md', 'Projetos/B.md'],
    ['Projetos/B.md', 'Inicio.md'],
  ]);
  assert.equal(data.items[1].folder, 'Projetos/');
  assert.deepEqual(data.items[1].tags.sort(), ['projeto', 'projeto/web']);
});

test('buildGraph cria nós de tag e de link sem página quando pedido', () => {
  const data = g.buildGraph(notes, contents, { tags: true, unresolved: true });
  const ghost = data.items.find((item) => item.kind === 'unresolved');
  assert.equal(ghost.id, '?fantasma');
  assert.equal(ghost.label, 'Fantasma');
  assert.ok(data.edges.some(([a, b]) => a === 'Projetos/A.md' && b === '?fantasma'));
  assert.ok(data.items.some((item) => item.id === '#hub' && item.label === '#hub'));
  assert.ok(data.edges.some(([a, b]) => a === 'Projetos/A.md' && b === '#projeto/web'));
});

test('parseQuery entende campos, negação, aspas e OR', () => {
  assert.deepEqual(g.parseQuery(''), []);
  assert.deepEqual(g.parseQuery('path:Projetos -tag:#web'), [
    [
      { field: 'path', value: 'projetos', negate: false },
      { field: 'tag', value: 'web', negate: true },
    ],
  ]);
  assert.deepEqual(g.parseQuery('"nem segredo" OR file:a'), [[{ field: 'any', value: 'nem segredo', negate: false }], [{ field: 'file', value: 'a', negate: false }]]);
  assert.deepEqual(g.parseQuery('content:"nem segredo"'), [[{ field: 'content', value: 'nem segredo', negate: false }]]);
  assert.deepEqual(g.parseQuery('url:x'), [[{ field: 'any', value: 'url:x', negate: false }]]);
  assert.deepEqual(g.parseQuery('OR - tag:'), []);
});

test('matchQuery aplica cada campo', () => {
  const data = g.buildGraph(notes, contents);
  const find = (q) => data.items.filter((item) => g.matchQuery(g.parseQuery(q), item)).map((item) => item.id);
  assert.deepEqual(find('projetos'), ['Projetos/A.md', 'Projetos/B.md']);
  assert.deepEqual(find('tag:projeto'), ['Projetos/A.md']);
  assert.deepEqual(find('tag:proj'), []);
  assert.deepEqual(find('content:segredo'), ['Sozinha.md']);
  assert.deepEqual(find('file:a -path:projetos'), ['Sozinha.md']);
  assert.deepEqual(find('file:inicio OR file:sozinha'), ['Inicio.md', 'Sozinha.md']);
});

test('filterGraph: consulta leva junto as tags das notas que sobram, e órfãos somem', () => {
  const data = g.buildGraph(notes, contents, { tags: true, unresolved: true });
  const onlyA = g.filterGraph(data, { query: 'file:a path:projetos', showOrphans: true });
  assert.deepEqual(onlyA.items.map((item) => item.id).sort(), ['#projeto', '#projeto/web', '?fantasma', 'Projetos/A.md']);
  assert.ok(!onlyA.items.some((item) => item.id === '#hub'));

  const plain = g.buildGraph(notes, contents);
  const noOrphans = g.filterGraph(plain, { query: '', showOrphans: false });
  assert.ok(!noOrphans.items.some((item) => item.id === 'Sozinha.md'));
  const hidden = g.filterGraph(plain, { query: '', showOrphans: true, hidden: new Set(['Inicio.md']) });
  assert.ok(!hidden.items.some((item) => item.id === 'Inicio.md'));
  assert.ok(hidden.edges.every(([a, b]) => a !== 'Inicio.md' && b !== 'Inicio.md'));
});

test('filterGraph local: profundidade e centro sempre visível', () => {
  const data = g.buildGraph(notes, contents);
  const one = g.filterGraph(data, { query: '', showOrphans: true, local: { id: 'Projetos/A.md', depth: 1 } });
  assert.deepEqual(one.items.map((item) => item.id).sort(), ['Inicio.md', 'Projetos/A.md', 'Projetos/B.md']);
  const alone = g.filterGraph(data, { query: '', showOrphans: false, local: { id: 'Sozinha.md', depth: 2 } });
  assert.deepEqual(alone.items.map((item) => item.id), ['Sozinha.md']);
  // Centro filtrado pela consulta: o modo local não vale.
  const gone = g.filterGraph(data, { query: 'file:inicio', showOrphans: true, local: { id: 'Sozinha.md', depth: 1 } });
  assert.deepEqual(gone.items.map((item) => item.id), ['Inicio.md']);
});

test('neighborsWithin anda nos dois sentidos até a profundidade', () => {
  const edges = [['a', 'b'], ['c', 'b'], ['c', 'd'], ['d', 'e']];
  assert.deepEqual([...g.neighborsWithin(edges, 'a', 0)], ['a']);
  assert.deepEqual([...g.neighborsWithin(edges, 'a', 2)].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...g.neighborsWithin(edges, 'e', 9)].sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('graphStats conta órfãs, pendentes, tags e as páginas mais ligadas', () => {
  const stats = g.graphStats(g.buildGraph(notes, contents, { tags: true, unresolved: true }), 2);
  assert.equal(stats.notes, 4);
  assert.equal(stats.orphans, 1);
  assert.equal(stats.unresolved, 1);
  assert.equal(stats.tags, 3);
  assert.deepEqual(stats.hubs.map((hub) => [hub.label, hub.links]), [['A', 3], ['B', 3]]);
});

test('degrees separa entrada e saída', () => {
  const d = g.degrees([['a', 'b'], ['a', 'c'], ['c', 'a']]);
  assert.deepEqual(d.get('a'), { incoming: 1, outgoing: 2 });
  assert.deepEqual(d.get('b'), { incoming: 1, outgoing: 0 });
});

test('nearestInDirection segue a seta dentro do cone', () => {
  const from = { id: 'o', x: 0, y: 0 };
  const points = [from, { id: 'r', x: 10, y: 2 }, { id: 'far', x: 30, y: 0 }, { id: 'up', x: 1, y: -10 }, { id: 'diag', x: 5, y: 8 }];
  assert.equal(g.nearestInDirection(from, points, 'right'), 'r');
  assert.equal(g.nearestInDirection(from, points, 'up'), 'up');
  assert.equal(g.nearestInDirection(from, points, 'down'), 'diag');
  assert.equal(g.nearestInDirection(from, points, 'left'), null);
});

test('fitCamera centra e cabe com margem', () => {
  const cam = g.fitCamera([{ x: -200, y: -100 }, { x: 200, y: 100 }], 500, 300, 50);
  assert.equal(cam.scale, 1);
  assert.equal(cam.panX, 250);
  assert.equal(cam.panY, 150);
  const big = g.fitCamera([{ x: 0, y: 0 }, { x: 4000, y: 0 }], 500, 300, 50);
  assert.equal(big.scale, 0.1);
  assert.equal(big.panX, 250 - 2000 * 0.1);
  assert.equal(g.fitCamera([{ x: 0, y: 0 }], 500, 300).scale, 2);
  assert.deepEqual(g.fitCamera([], 400, 200), { scale: 1, panX: 200, panY: 100 });
});

test('folderColor é estável e a raiz não tem cor', () => {
  assert.equal(g.folderColor('', 8), -1);
  const a = g.folderColor('Projetos/', 8);
  assert.equal(a, g.folderColor('projetos/', 8));
  assert.ok(a >= 0 && a < 8);
});

test('groupIndex devolve o primeiro grupo que bate', () => {
  const [inicio, a] = g.buildGraph(notes, contents).items;
  const groups = [{ query: '', color: 0 }, { query: 'tag:projeto', color: 1 }, { query: 'path:projetos', color: 2 }];
  assert.equal(g.groupIndex(groups, a), 1);
  assert.equal(g.groupIndex(groups, inicio), -1);
});

const defaults = {
  search: '', showOrphans: true, showTags: false, showUnresolved: false, showArrow: false, colorByFolder: false, sizeBy: 'links',
  textFade: 0, nodeSize: 1, lineSize: 1, center: 0.5, repel: 10, link: 1, linkDistance: 250, localDepth: 1, groups: [],
};

test('sanitizeOptions descarta tipos errados e prende números às faixas', () => {
  assert.deepEqual(g.sanitizeOptions(null, defaults), defaults);
  assert.deepEqual(g.sanitizeOptions('x', defaults), defaults);
  const clean = g.sanitizeOptions(
    { nodeSize: 99, repel: 'muito', showTags: 'sim', showArrow: true, sizeBy: 'peso', localDepth: 2.6, linkDistance: NaN, groups: [{ query: 'a', color: 9 }, { query: 1, color: 0 }, null, { query: 'b', color: -1 }], extra: 1 },
    defaults,
  );
  assert.equal(clean.nodeSize, 5);
  assert.equal(clean.repel, 10);
  assert.equal(clean.showTags, false);
  assert.equal(clean.showArrow, true);
  assert.equal(clean.sizeBy, 'links');
  assert.equal(clean.localDepth, 3);
  assert.equal(clean.linkDistance, 250);
  assert.deepEqual(clean.groups, [{ query: 'a', color: 1 }, { query: 'b', color: 7 }]);
  assert.equal('extra' in clean, false);
});

test('visões salvas: limpeza, nomes únicos e a mais recente no topo', () => {
  const views = g.sanitizeViews([{ name: ' Trabalho ', options: { nodeSize: 2 } }, { name: 'Trabalho', options: {} }, { name: '', options: {} }, 3], defaults);
  assert.equal(views.length, 1);
  assert.equal(views[0].name, 'Trabalho');
  assert.equal(views[0].options.nodeSize, 2);
  assert.deepEqual(g.sanitizeViews({}, defaults), []);
  const next = g.upsertView(g.upsertView(views, 'Casa', defaults), 'Trabalho', defaults);
  assert.deepEqual(next.map((view) => view.name), ['Trabalho', 'Casa']);
  assert.equal(next[0].options.nodeSize, 1);
  assert.equal(g.upsertView(next, '   ', defaults), next);
});
