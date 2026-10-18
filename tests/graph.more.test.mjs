// Mais casos da lógica do grafo (src/lib/graph.ts): bordas, acentos e entradas inválidas. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as g from '../src/lib/graph.ts';

const note = (path) => ({ path, name: path.split('/').pop().replace(/\.md$/, '') });
const item = (over) => ({ id: 'x.md', kind: 'note', label: 'x', path: 'x.md', folder: '', tags: [], text: '', ...over });

const DEFAULTS = {
  search: '',
  showOrphans: true,
  showTags: false,
  showUnresolved: false,
  showArrow: false,
  colorByFolder: false,
  sizeBy: 'links',
  textFade: 0,
  nodeSize: 1,
  lineSize: 1,
  center: 0.5,
  repel: 10,
  link: 0.5,
  linkDistance: 100,
  localDepth: 1,
  groups: [],
};

// ---------------------------------------------------------------------------------------------
// Ids e montagem

test('tagId e unresolvedId', () => {
  assert.equal(g.tagId('casa/web'), '#casa/web');
  assert.equal(g.unresolvedId('  Nova Página '), '?nova página');
  assert.equal(g.unresolvedId('AÇÃO'), '?ação');
});

test('buildGraph vazio e notas sem conteúdo', () => {
  assert.deepEqual(g.buildGraph([], {}), { items: [], edges: [] });
  const data = g.buildGraph([note('a.md')], {});
  assert.deepEqual(data.edges, []);
  assert.equal(data.items[0].text, '');
  assert.deepEqual(data.items[0].tags, []);
});

test('buildGraph: link sem página com grafias diferentes vira um nó só, com rótulo do nome-base', () => {
  const notes = [note('a.md'), note('b.md')];
  const contents = { 'a.md': '[[Pasta/Nova Ideia]] [[pasta/nova ideia]]', 'b.md': '[[ Pasta/Nova Ideia ]]' };
  const data = g.buildGraph(notes, contents, { unresolved: true });
  const pending = data.items.filter((i) => i.kind === 'unresolved');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, '?pasta/nova ideia');
  assert.equal(pending[0].label, 'Nova Ideia');
  assert.equal(pending[0].target, 'Pasta/Nova Ideia');
  assert.deepEqual(data.edges, [['a.md', '?pasta/nova ideia'], ['b.md', '?pasta/nova ideia']]);
});

test('buildGraph sem as opções não cria nós de tag nem de pendentes', () => {
  const data = g.buildGraph([note('a.md')], { 'a.md': '#tag [[Fantasma]]' });
  assert.deepEqual(data.items.map((i) => i.kind), ['note']);
  assert.deepEqual(data.edges, []);
});

test('buildGraph guarda o texto em minúsculas para content:', () => {
  const data = g.buildGraph([note('a.md')], { 'a.md': 'Olá MUNDO Ação' });
  assert.equal(data.items[0].text, 'olá mundo ação');
});

test('buildGraph: duas notas com a mesma tag compartilham o nó', () => {
  const data = g.buildGraph([note('a.md'), note('b.md')], { 'a.md': '#Ação', 'b.md': '#ação' }, { tags: true });
  assert.deepEqual(data.items.filter((i) => i.kind === 'tag').map((i) => [i.id, i.label]), [['#ação', '#ação']]);
  assert.deepEqual(data.edges, [['a.md', '#ação'], ['b.md', '#ação']]);
});

// ---------------------------------------------------------------------------------------------
// Consulta

test('parseQuery: vazio, só espaços, OR soltos e "-" sozinho', () => {
  assert.deepEqual(g.parseQuery(''), []);
  assert.deepEqual(g.parseQuery('   '), []);
  assert.deepEqual(g.parseQuery('OR OR - OR'), []);
  assert.deepEqual(g.parseQuery('a OR OR b'), [
    [{ field: 'any', value: 'a', negate: false }],
    [{ field: 'any', value: 'b', negate: false }],
  ]);
});

test('parseQuery: campo desconhecido vale como texto, "or" minúsculo é palavra, tag tira #', () => {
  assert.deepEqual(g.parseQuery('autor:ana or TAG:#Casa'), [
    [
      { field: 'any', value: 'autor:ana', negate: false },
      { field: 'any', value: 'or', negate: false },
      { field: 'tag', value: 'casa', negate: false },
    ],
  ]);
});

test('parseQuery: aspas com campo e negação, aspas abertas e valores vazios somem', () => {
  assert.deepEqual(g.parseQuery('-path:"Pasta Nova" "sem fim'), [
    [
      { field: 'path', value: 'pasta nova', negate: true },
      { field: 'any', value: 'sem fim', negate: false },
    ],
  ]);
  assert.deepEqual(g.parseQuery('tag: "" content:'), []);
});

test('matchQuery: caminho sem path usa o rótulo; tag casa subtag mas não prefixo', () => {
  const tag = item({ id: '#proj/web', kind: 'tag', label: '#proj/web', path: undefined, tags: ['proj/web'] });
  assert.equal(g.matchQuery(g.parseQuery('path:proj'), tag), true);
  assert.equal(g.matchQuery(g.parseQuery('tag:proj'), tag), true);
  assert.equal(g.matchQuery(g.parseQuery('tag:pro'), tag), false);
});

test('matchQuery: file olha só o rótulo, any olha caminho e rótulo, OR escolhe qualquer grupo', () => {
  const it = item({ id: 'Pasta/Nota.md', label: 'Nota', path: 'Pasta/Nota.md', text: 'conteúdo secreto' });
  assert.equal(g.matchQuery(g.parseQuery('file:pasta'), it), false);
  assert.equal(g.matchQuery(g.parseQuery('pasta nota'), it), true);
  assert.equal(g.matchQuery(g.parseQuery('content:secreto'), it), true);
  assert.equal(g.matchQuery(g.parseQuery('-content:secreto'), it), false);
  assert.equal(g.matchQuery(g.parseQuery('zzz OR file:nota'), it), true);
  assert.equal(g.matchQuery([], it), true);
});

// ---------------------------------------------------------------------------------------------
// Vizinhança e filtro

test('neighborsWithin: profundidade zero e id sem arestas devolvem só o próprio id', () => {
  const edges = [['a', 'b'], ['b', 'c']];
  assert.deepEqual([...g.neighborsWithin(edges, 'a', 0)], ['a']);
  assert.deepEqual([...g.neighborsWithin(edges, 'z', 3)], ['z']);
  assert.deepEqual([...g.neighborsWithin([], 'a', 2)], ['a']);
});

test('neighborsWithin não entra em laço em ciclos', () => {
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'a']];
  assert.deepEqual([...g.neighborsWithin(edges, 'a', 10)].sort(), ['a', 'b', 'c']);
});

test('filterGraph: nós ocultos saem junto com suas arestas', () => {
  const data = g.buildGraph([note('a.md'), note('b.md'), note('c.md')], { 'a.md': '[[b]] [[c]]', 'b.md': '', 'c.md': '' });
  const out = g.filterGraph(data, { query: '', showOrphans: true, hidden: new Set(['b.md']) });
  assert.deepEqual(out.items.map((i) => i.id), ['a.md', 'c.md']);
  assert.deepEqual(out.edges, [['a.md', 'c.md']]);
});

test('filterGraph: tag oculta não é levada pelas notas', () => {
  const data = g.buildGraph([note('a.md')], { 'a.md': '#x' }, { tags: true });
  const out = g.filterGraph(data, { query: '', showOrphans: true, hidden: new Set(['#x']) });
  assert.deepEqual(out.items.map((i) => i.id), ['a.md']);
  assert.deepEqual(out.edges, []);
});

test('filterGraph: centro local que não sobrou no filtro é ignorado', () => {
  const data = g.buildGraph([note('a.md'), note('b.md')], { 'a.md': '[[b]]', 'b.md': '' });
  const out = g.filterGraph(data, { query: 'file:a', showOrphans: true, local: { id: 'b.md', depth: 1 } });
  assert.deepEqual(out.items.map((i) => i.id), ['a.md']);
});

test('filterGraph: centro local sem ligações continua visível mesmo sem órfãos', () => {
  const data = g.buildGraph([note('a.md'), note('b.md')], {});
  const out = g.filterGraph(data, { query: '', showOrphans: false, local: { id: 'a.md', depth: 2 } });
  assert.deepEqual(out.items.map((i) => i.id), ['a.md']);
});

test('filterGraph de grafo vazio', () => {
  assert.deepEqual(g.filterGraph({ items: [], edges: [] }, { query: 'x', showOrphans: false }), { items: [], edges: [] });
});

// ---------------------------------------------------------------------------------------------
// Estatísticas

test('degrees de lista vazia e de arestas repetidas', () => {
  assert.equal(g.degrees([]).size, 0);
  const d = g.degrees([['a', 'b'], ['a', 'b'], ['b', 'a']]);
  assert.deepEqual(d.get('a'), { incoming: 1, outgoing: 2 });
  assert.deepEqual(d.get('b'), { incoming: 2, outgoing: 1 });
});

test('graphStats: nota só com tags é órfã, hubCount limita e empate vai pelo rótulo', () => {
  const notes = ['b.md', 'a.md', 'c.md', 'd.md'].map(note);
  const contents = { 'a.md': '[[c]]', 'b.md': '[[c]]', 'd.md': '#só-tag' };
  const stats = g.graphStats(g.buildGraph(notes, contents, { tags: true }), 2);
  assert.equal(stats.notes, 4);
  assert.equal(stats.orphans, 1);
  assert.equal(stats.tags, 1);
  assert.deepEqual(stats.hubs, [
    { id: 'c.md', label: 'c', links: 2 },
    { id: 'a.md', label: 'a', links: 1 },
  ]);
});

test('graphStats de grafo vazio', () => {
  assert.deepEqual(g.graphStats({ items: [], edges: [] }), { notes: 0, orphans: 0, unresolved: 0, tags: 0, hubs: [] });
});

// ---------------------------------------------------------------------------------------------
// Teclado e câmera

test('nearestInDirection: sem candidatos, só o próprio nó ou tudo fora do cone dá null', () => {
  const from = { id: 'o', x: 0, y: 0 };
  assert.equal(g.nearestInDirection(from, [], 'right'), null);
  assert.equal(g.nearestInDirection(from, [from], 'right'), null);
  assert.equal(g.nearestInDirection(from, [{ id: 'a', x: 1, y: 5 }], 'right'), null);
  assert.equal(g.nearestInDirection(from, [{ id: 'b', x: -5, y: 0 }], 'right'), null);
});

test('nearestInDirection: borda do cone (45°) entra e as quatro direções funcionam', () => {
  const from = { id: 'o', x: 0, y: 0 };
  const pts = [
    { id: 'r', x: 10, y: 0 },
    { id: 'l', x: -10, y: 0 },
    { id: 'u', x: 0, y: -10 },
    { id: 'd', x: 0, y: 10 },
  ];
  assert.equal(g.nearestInDirection(from, pts, 'right'), 'r');
  assert.equal(g.nearestInDirection(from, pts, 'left'), 'l');
  assert.equal(g.nearestInDirection(from, pts, 'up'), 'u');
  assert.equal(g.nearestInDirection(from, pts, 'down'), 'd');
  assert.equal(g.nearestInDirection(from, [{ id: 'diag', x: 5, y: 5 }], 'right'), 'diag');
});

test('nearestInDirection prefere o alinhado ao mais perto em linha reta', () => {
  const from = { id: 'o', x: 0, y: 0 };
  // a: 10 + 2*0 = 10; b: 6 + 2*4 = 14.
  assert.equal(g.nearestInDirection(from, [{ id: 'b', x: 6, y: 4 }, { id: 'a', x: 10, y: 0 }], 'right'), 'a');
});

test('fitCamera: sem pontos ou área inválida centra com escala 1', () => {
  assert.deepEqual(g.fitCamera([], 800, 600), { scale: 1, panX: 400, panY: 300 });
  assert.deepEqual(g.fitCamera([{ x: 5, y: 5 }], 0, 600), { scale: 1, panX: 0, panY: 300 });
  assert.deepEqual(g.fitCamera([{ x: 5, y: 5 }], 800, -1), { scale: 1, panX: 400, panY: -0.5 });
});

test('fitCamera: um ponto só usa o zoom máximo e fica no centro', () => {
  const cam = g.fitCamera([{ x: 100, y: 50 }], 800, 600);
  assert.equal(cam.scale, 2);
  assert.equal(cam.panX, 400 - 100 * 2);
  assert.equal(cam.panY, 300 - 50 * 2);
});

test('fitCamera conta o raio e respeita o zoom mínimo', () => {
  const withR = g.fitCamera([{ x: 0, y: 0, r: 50 }], 300, 300, 50);
  // Caixa de 100x100, área útil 200x200 → escala 2 (no limite).
  assert.equal(withR.scale, 2);
  const far = g.fitCamera([{ x: 0, y: 0 }, { x: 1e9, y: 0 }], 800, 600);
  assert.equal(far.scale, 1 / 128);
});

test('folderColor: mesma pasta com caixa diferente dá a mesma cor, dentro da paleta', () => {
  assert.equal(g.folderColor('Projetos/', 8), g.folderColor('projetos/', 8));
  for (const folder of ['a/', 'Ação/', 'x/y/z/', '日本/']) {
    const color = g.folderColor(folder, 8);
    assert.ok(color >= 0 && color < 8);
  }
  assert.equal(g.folderColor('a/', 0), -1);
  assert.equal(g.folderColor('a/', -3), -1);
  assert.equal(g.folderColor('qualquer/', 1), 0);
});

test('groupIndex sem grupos ou com nenhum casando devolve -1', () => {
  const it = item({});
  assert.equal(g.groupIndex([], it), -1);
  assert.equal(g.groupIndex([{ query: '   ' }, { query: 'zzz' }], it), -1);
  assert.equal(g.groupIndex([{ query: '' }, { query: 'x' }], it), 1);
});

// ---------------------------------------------------------------------------------------------
// Preferências

test('sanitizeOptions com entrada inválida devolve cópia dos padrões', () => {
  for (const raw of [null, undefined, 42, 'texto', [1, 2], true]) {
    const out = g.sanitizeOptions(raw, DEFAULTS);
    assert.deepEqual(out, DEFAULTS);
    assert.notEqual(out, DEFAULTS);
    assert.notEqual(out.groups, DEFAULTS.groups);
  }
});

test('sanitizeOptions: NaN e Infinity são descartados, localDepth arredonda e prende', () => {
  const out = g.sanitizeOptions({ nodeSize: NaN, repel: Infinity, localDepth: 2.6, linkDistance: 10, center: -1 }, DEFAULTS);
  assert.equal(out.nodeSize, 1);
  assert.equal(out.repel, 10);
  assert.equal(out.localDepth, 3);
  assert.equal(out.linkDistance, 30);
  assert.equal(out.center, 0);
  assert.equal(g.sanitizeOptions({ localDepth: 99 }, DEFAULTS).localDepth, 5);
});

test('sanitizeOptions: cores negativas giram na paleta, consulta é cortada e grupos têm limite', () => {
  const groups = [
    { query: 'a', color: -1 },
    { query: 'b'.repeat(300), color: 17 },
    { query: 'c', color: 1.5 },
    { query: 5, color: 1 },
    null,
  ];
  const out = g.sanitizeOptions({ groups }, DEFAULTS);
  assert.deepEqual(out.groups.map((x) => x.color), [7, 1]);
  assert.equal(out.groups[1].query.length, 200);
  const many = Array.from({ length: 30 }, (_, i) => ({ query: `q${i}`, color: i }));
  assert.equal(g.sanitizeOptions({ groups: many }, DEFAULTS).groups.length, g.MAX_GROUPS);
});

test('sanitizeOptions: texto longo é cortado, sizeBy desconhecido e chaves extras são ignorados', () => {
  const out = g.sanitizeOptions({ search: 'x'.repeat(800), sizeBy: 'gigante', extra: 1, showTags: 'sim' }, DEFAULTS);
  assert.equal(out.search.length, 500);
  assert.equal(out.sizeBy, 'links');
  assert.equal(out.showTags, false);
  assert.equal('extra' in out, false);
  assert.equal(g.sanitizeOptions({ sizeBy: 'uniform' }, DEFAULTS).sizeBy, 'uniform');
});

test('sanitizeViews: entrada não lista, entradas inválidas, nomes vazios e repetidos', () => {
  assert.deepEqual(g.sanitizeViews(null, DEFAULTS), []);
  assert.deepEqual(g.sanitizeViews({ name: 'x' }, DEFAULTS), []);
  const views = g.sanitizeViews([null, 3, { name: '  ' }, { name: 5 }, { name: ' Foco ' }, { name: 'Foco' }, { name: 'Ação', options: { repel: 3 } }], DEFAULTS);
  assert.deepEqual(views.map((v) => v.name), ['Foco', 'Ação']);
  assert.equal(views[0].options.repel, 10);
  assert.equal(views[1].options.repel, 3);
});

test('sanitizeViews corta nomes em 60 e guarda no máximo MAX_VIEWS', () => {
  const raw = Array.from({ length: 30 }, (_, i) => ({ name: `${'n'.repeat(70)}${i}` }));
  const views = g.sanitizeViews(raw, DEFAULTS);
  // Cortados em 60, os 30 nomes ficam iguais: sobra um.
  assert.equal(views.length, 1);
  assert.equal(views[0].name.length, 60);
  const distinct = Array.from({ length: 30 }, (_, i) => ({ name: `v${i}` }));
  assert.equal(g.sanitizeViews(distinct, DEFAULTS).length, g.MAX_VIEWS);
});

test('upsertView: nome vazio devolve a mesma lista, nome é aparado e o limite vale', () => {
  const views = [{ name: 'a', options: DEFAULTS }];
  assert.equal(g.upsertView(views, '   ', DEFAULTS), views);
  assert.deepEqual(g.upsertView(views, '  b  ', DEFAULTS).map((v) => v.name), ['b', 'a']);
  const full = Array.from({ length: g.MAX_VIEWS }, (_, i) => ({ name: `v${i}`, options: DEFAULTS }));
  const next = g.upsertView(full, 'nova', DEFAULTS);
  assert.equal(next.length, g.MAX_VIEWS);
  assert.equal(next[0].name, 'nova');
  assert.equal(next.at(-1).name, `v${g.MAX_VIEWS - 2}`);
});

test('clipLabel: limite exato, máximo pequeno e acentos', () => {
  assert.equal(g.clipLabel('abc', 3), 'abc');
  assert.equal(g.clipLabel('abcd', 3), 'ab…');
  assert.equal(g.clipLabel('abcd', 1), 'a…');
  assert.equal(g.clipLabel('', 3), '');
  assert.equal(g.clipLabel('ação rápida', 6), 'ação…');
  assert.equal(g.clipLabel('x'.repeat(g.LABEL_MAX)), 'x'.repeat(g.LABEL_MAX));
});
