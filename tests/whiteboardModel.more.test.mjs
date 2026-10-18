// Quadro branco (src/whiteboard/model.ts), casos extras: entradas corrompidas, limites, migração,
// geometria, operações sem efeito (mesmo objeto) e ida e volta pelo arquivo. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as m from '../src/whiteboard/model.ts';
import { sampleBoard } from '../src/whiteboard/sample.ts';

const rect = (x, y, w = 100, h = 60) => ({ x, y, w, h });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const doc = (elements, extra = {}) => JSON.stringify({ format: m.BOARD_FORMAT, version: m.BOARD_VERSION, elements, ...extra });
const parse = (elements, extra) => m.parseBoard(doc(elements, extra));
const shape = (id, extra = {}) => ({ id, kind: 'rectangle', x: 0, y: 0, w: 100, h: 60, text: '', stroke: '#1a1f26', fill: 'transparent', ...extra });
const build = (...steps) => {
  let board = m.emptyBoard();
  const ids = [];
  for (const [kind, r, props] of steps) {
    const result = m.addShape(board, kind, r, props);
    board = result.board;
    ids.push(result.id);
  }
  return { board, ids };
};
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const roundTrip = (board) => {
  const parsed = m.parseBoard(m.serializeBoard(board));
  assert.equal(parsed.ok, true);
  return parsed.board;
};

// ---------------------------------------------------------------- leitura e migração

test('parseBoard: JSON que não é objeto (array, null, número, texto) não é quadro', () => {
  for (const text of ['[]', 'null', '42', '"quadro"', 'true']) assert.deepEqual(m.parseBoard(text), { ok: false, error: 'not-a-board' }, text);
});

test('parseBoard: só espaços e quebras de linha vira quadro vazio', () => {
  const result = m.parseBoard('  \n\t ');
  assert.equal(result.ok, true);
  assert.deepEqual(result.board, m.emptyBoard());
});

test('parseBoard: formato errado, versão inválida e versão futura', () => {
  assert.deepEqual(m.parseBoard(JSON.stringify({ format: 'outro', version: 2 })), { ok: false, error: 'not-a-board' });
  for (const version of [-1, 1.5, '2', null, true])
    assert.deepEqual(m.parseBoard(JSON.stringify({ format: m.BOARD_FORMAT, version })), { ok: false, error: 'not-a-board' }, String(version));
  assert.deepEqual(m.parseBoard(JSON.stringify({ format: m.BOARD_FORMAT, version: 99 })), { ok: false, error: 'newer-version' });
});

test('parseBoard: tamanho no limite passa; um caractere acima é recusado', () => {
  const base = doc([]);
  const fits = base.slice(0, -1) + ',"pad":"' + 'x'.repeat(m.MAX_BOARD_BYTES - base.length - 9) + '"}';
  assert.equal(fits.length, m.MAX_BOARD_BYTES);
  assert.equal(m.parseBoard(fits).ok, true);
  assert.deepEqual(m.parseBoard(fits + ' '), { ok: false, error: 'too-large' });
});

test(
  'parseBoard: o limite é de bytes (5 MB), não de caracteres',
  { todo: 'BUG: model.ts:163 compara text.length (unidades UTF-16) com MAX_BOARD_BYTES; texto com acentos/emoji passa de 5 MB em UTF-8 e é aceito' },
  () => {
    const base = doc([]);
    const pad = 'é'.repeat(Math.floor((m.MAX_BOARD_BYTES - base.length) / 1.5));
    const text = base.slice(0, -1) + `,"pad":"${pad}"}`;
    assert.ok(text.length < m.MAX_BOARD_BYTES);
    assert.ok(Buffer.byteLength(text, 'utf8') > m.MAX_BOARD_BYTES);
    assert.deepEqual(m.parseBoard(text), { ok: false, error: 'too-large' });
  },
);

test('parseBoard: elementos demais é erro; exatamente o máximo passa', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => shape(`s${i}`));
  assert.deepEqual(parse(many(m.MAX_ELEMENTS + 1)), { ok: false, error: 'too-many-elements' });
  const ok = parse(many(m.MAX_ELEMENTS));
  assert.equal(ok.ok, true);
  assert.equal(ok.board.elements.length, m.MAX_ELEMENTS);
});

test('parseBoard: "elements" ausente ou que não é lista vira quadro vazio', () => {
  for (const elements of [undefined, {}, 'x', 3]) {
    const result = m.parseBoard(JSON.stringify({ format: m.BOARD_FORMAT, version: 2, elements }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.board.elements, []);
    assert.equal(result.dropped, 0);
  }
});

test('parseBoard: vista inválida volta ao padrão; zoom é limitado; campos extras somem', () => {
  assert.deepEqual(parse([], { view: 'x' }).board.view, { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(parse([], { view: { x: 'a', y: null, zoom: 'z' } }).board.view, { x: 0, y: 0, zoom: 1 });
  assert.equal(parse([], { view: { x: 0, y: 0, zoom: 100 } }).board.view.zoom, m.MAX_ZOOM);
  assert.equal(parse([], { view: { x: 0, y: 0, zoom: 0 } }).board.view.zoom, m.MIN_ZOOM);
  assert.equal(parse([], { view: { x: 0, y: 0, zoom: -3 } }).board.view.zoom, m.MIN_ZOOM);
  assert.deepEqual(parse([], { view: { x: 1e12, y: -1e12, zoom: 1 } }).board.view, { x: 1_000_000, y: -1_000_000, zoom: 1 });
  const extra = parse([], { owner: 'alguém', theme: 'dark' }).board;
  assert.deepEqual(Object.keys(extra).sort(), ['elements', 'format', 'version', 'view']);
});

test('parseBoard: só sample === true marca o quadro como exemplo', () => {
  assert.equal(parse([], { sample: true }).board.sample, true);
  for (const sample of ['true', 1, false, null]) assert.equal('sample' in parse([], { sample }).board, false, String(sample));
});

test('migração v0: sem elements nem view; seta com pontas soltas (objetos) e com start já existente', () => {
  const empty = m.parseBoard(JSON.stringify({ format: m.BOARD_FORMAT }));
  assert.equal(empty.ok, true);
  assert.equal(empty.migrated, true);
  assert.deepEqual(empty.board.view, { x: 0, y: 0, zoom: 1 });
  const v0 = m.parseBoard(
    JSON.stringify({
      format: m.BOARD_FORMAT,
      elements: [
        shape('a'),
        { id: 'r1', kind: 'arrow', from: { x: 5, y: 6 }, to: 'a', stroke: '#1a1f26' },
        { id: 'r2', kind: 'arrow', start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, from: 'zzz', stroke: '#1a1f26' },
      ],
    }),
  );
  assert.equal(v0.ok, true);
  assert.equal(v0.dropped, 0);
  const [, r1, r2] = v0.board.elements;
  assert.deepEqual([r1.start, r1.end], [{ x: 5, y: 6 }, { shape: 'a' }]);
  assert.equal('from' in r1 || 'to' in r1, false);
  assert.deepEqual([r2.start, r2.end], [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
});

test('migrate: devolve o motivo como texto e não altera um documento atual', () => {
  assert.equal(m.migrate({ format: 'x' }), 'not-a-board');
  assert.equal(m.migrate({ format: m.BOARD_FORMAT, version: 3 }), 'newer-version');
  const current = { format: m.BOARD_FORMAT, version: 2, elements: [] };
  assert.deepEqual(m.migrate(current), { doc: current, migrated: false });
  assert.deepEqual(m.migrate({ format: m.BOARD_FORMAT, version: 1 }).doc.version, 2);
});

// ---------------------------------------------------------------- validação de elementos

test('sanitizeElements: ids inválidos, repetidos e não-objetos são descartados', () => {
  const list = [null, 1, 'x', [], shape(''), shape('com espaço'), shape('x'.repeat(65)), shape('ok-1_A'), shape('ok-1_A', { x: 50 }), shape('x'.repeat(64))];
  const result = m.sanitizeElements(list);
  assert.deepEqual(
    result.map((e) => e.id),
    ['ok-1_A', 'x'.repeat(64)],
  );
  assert.equal(result[0].x, 0, 'fica o primeiro com o id repetido');
});

test('sanitizeElements: um elemento inválido não "reserva" o id para o próximo válido', () => {
  const result = m.sanitizeElements([shape('a', { w: -1 }), shape('a', { x: 7 })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].x, 7);
});

test('sanitizeElements: seta pode citar uma forma que aparece depois; ordem de desenho é mantida', () => {
  const result = m.sanitizeElements([{ id: 'r', kind: 'arrow', start: { shape: 'a' }, end: { shape: 'b' } }, shape('a'), shape('b')]);
  assert.deepEqual(
    result.map((e) => e.id),
    ['r', 'a', 'b'],
  );
});

test('sanitizeElements: seta presa a traço, imagem, forma ausente ou a si mesma é descartada', () => {
  const draw = { id: 'd', kind: 'draw', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 1, 1] };
  const img = { id: 'i', kind: 'image', x: 0, y: 0, w: 10, h: 10, src: PNG };
  const result = m.sanitizeElements([
    shape('a'),
    draw,
    img,
    { id: 'r1', kind: 'arrow', start: { shape: 'a' }, end: { shape: 'd' } },
    { id: 'r2', kind: 'arrow', start: { shape: 'i' }, end: { x: 0, y: 0 } },
    { id: 'r3', kind: 'arrow', start: { shape: 'nada' }, end: { x: 0, y: 0 } },
    { id: 'r4', kind: 'arrow', start: { shape: 'a' }, end: { shape: 'a' } },
    { id: 'r5', kind: 'arrow', start: { shape: 'a' }, end: { x: 1, y: 2 } },
  ]);
  assert.deepEqual(
    result.map((e) => e.id),
    ['a', 'd', 'i', 'r5'],
  );
});

test('sanitizeElements: pontas de seta malformadas descartam a seta', () => {
  const bad = [null, 'a', { x: 1 }, { x: 'a', y: 1 }, { x: Infinity, y: 0 }, { shape: 'id inválido' }, { shape: 3 }];
  for (const start of bad) assert.deepEqual(m.sanitizeElements([{ id: 'r', kind: 'arrow', start, end: { x: 0, y: 0 } }]), [], JSON.stringify(start));
});

test('sanitizeElements: seta guarda só pontas válidas (both/none) e estilo; "end" e desconhecidas somem', () => {
  const [a, b, c] = m.sanitizeElements([
    { id: 'a', kind: 'arrow', start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, head: 'end' },
    { id: 'b', kind: 'arrow', start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, head: 'both', strokeWidth: 4 },
    { id: 'c', kind: 'arrow', start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, head: 'start', stroke: 'red' },
  ]);
  assert.equal('head' in a, false);
  assert.equal(b.head, 'both');
  assert.equal(b.strokeWidth, 4);
  assert.equal('head' in c, false);
  assert.equal(c.stroke, m.INK);
});

test('sanitizeElements: caixas com tamanho zero/negativo/não numérico somem; pequenas sobem ao mínimo; enormes são cortadas', () => {
  for (const extra of [{ w: 0 }, { h: -5 }, { w: '10' }, { x: NaN }, { y: undefined }]) assert.deepEqual(m.sanitizeElements([shape('a', extra)]), [], JSON.stringify(extra));
  const [small] = m.sanitizeElements([shape('a', { w: 0.5, h: 3 })]);
  assert.deepEqual([small.w, small.h], [m.MIN_SIZE, m.MIN_SIZE]);
  const [big] = m.sanitizeElements([shape('a', { w: 1e9, h: 1e9, x: -1e9, y: 1e9 })]);
  assert.deepEqual([big.x, big.y, big.w, big.h], [-1_000_000, 1_000_000, 100_000, 100_000]);
});

test('sanitizeElements: tipo desconhecido some; forma guarda só fonte e tamanho válidos', () => {
  assert.deepEqual(m.sanitizeElements([shape('a', { kind: 'star' }), shape('b', { kind: undefined })]), []);
  const [a, b] = m.sanitizeElements([shape('a', { fontSize: 28, font: 'mono' }), shape('b', { fontSize: 15, font: 'serif' })]);
  assert.equal(a.fontSize, 28);
  assert.equal(a.font, 'mono');
  assert.equal('fontSize' in b || 'font' in b, false);
});

test('sanitizeElements: cores em maiúsculas viram minúsculas; inválidas voltam ao padrão', () => {
  const [a, b] = m.sanitizeElements([shape('a', { stroke: '#ABCDEF', fill: '#FFFFFF' }), shape('b', { stroke: '#abc', fill: 'rgb(0,0,0)' })]);
  assert.deepEqual([a.stroke, a.fill], ['#abcdef', '#ffffff']);
  assert.deepEqual([b.stroke, b.fill], [m.INK, 'transparent']);
});

test('sanitizeElements: traço com pontos ímpares, poucos ou não numéricos é descartado', () => {
  const draw = (points) => ({ id: 'd', kind: 'draw', x: 0, y: 0, w: 10, h: 10, points });
  for (const points of [[0, 0, 1], [0, 0], [], [0, 0, 1, '1'], [0, 0, 1, NaN], 'x', undefined]) assert.deepEqual(m.sanitizeElements([draw(points)]), [], JSON.stringify(points));
});

test('sanitizeElements: pontos de traço são limitados a 0–1, arredondados e cortados no máximo', () => {
  const [d] = m.sanitizeElements([{ id: 'd', kind: 'draw', x: 0, y: 0, w: 10, h: 10, points: [-1, 2, 0.123456789, 0.5] }]);
  assert.deepEqual(d.points, [0, 1, 0.1235, 0.5]);
  const long = Array.from({ length: m.MAX_POINTS * 2 + 10 }, (_, i) => (i % 2 ? 0.5 : 0.25));
  const [cut] = m.sanitizeElements([{ id: 'd', kind: 'draw', x: 0, y: 0, w: 10, h: 10, points: long }]);
  assert.equal(cut.points.length, m.MAX_POINTS * 2);
});

test('sanitizeElements: corta a lista no máximo de elementos', () => {
  const list = Array.from({ length: m.MAX_ELEMENTS + 5 }, (_, i) => shape(`s${i}`));
  assert.equal(m.sanitizeElements(list).length, m.MAX_ELEMENTS);
});

test('sanitizeText: CRLF/CR viram \\n, tab fica, controle some, corta em MAX_TEXT', () => {
  assert.equal(m.sanitizeText('a\r\nb\rc\td\u0000e\u001bf\u007fg'), 'a\nb\nc\tdefg');
  assert.equal(m.sanitizeText('x'.repeat(m.MAX_TEXT + 50)).length, m.MAX_TEXT);
  for (const value of [null, undefined, 3, {}, ['a']]) assert.equal(m.sanitizeText(value), '');
});

test('sanitizeColor: só #rrggbb ou transparent; o resto vira o padrão', () => {
  assert.equal(m.sanitizeColor('transparent', '#000000'), 'transparent');
  assert.equal(m.sanitizeColor('#A1B2C3', '#000000'), '#a1b2c3');
  for (const value of ['#a1b2c', '#a1b2c3d', 'a1b2c3', '#gggggg', 'TRANSPARENT', ' #a1b2c3', null, 123])
    assert.equal(m.sanitizeColor(value, '#000000'), '#000000', String(value));
});

test('sanitizeLink: limpa, recusa esquemas e subida de pasta, aceita nota e http(s)', () => {
  assert.equal(m.sanitizeLink('  https://exemplo.com/a?b=1  '), 'https://exemplo.com/a?b=1');
  assert.equal(m.sanitizeLink('HTTP://EXEMPLO.COM'), 'HTTP://EXEMPLO.COM');
  assert.equal(m.sanitizeLink('[[Pasta/Nota]]'), 'Pasta/Nota');
  assert.equal(m.sanitizeLink('Pasta\\Sub\\Nota.md'), 'Pasta/Sub/Nota.md');
  assert.equal(m.sanitizeLink('///Nota'), 'Nota');
  assert.equal(m.sanitizeLink('No\u0000ta\n'), 'Nota');
  for (const value of ['javascript:alert(1)', 'file:///c:/x', 'C:\\Windows', 'mailto:a@b', 'https://a b', 'https://"x', '../segredo', 'a/../../b', '[[..]]', '[[]]', '   ', '', null, 5])
    assert.equal(m.sanitizeLink(value), '', String(value));
  assert.equal(m.sanitizeLink('n'.repeat(m.MAX_LINK + 100)).length, m.MAX_LINK);
});

test('sanitizeImageSrc: só data URL raster em base64 dentro do limite', () => {
  assert.equal(m.sanitizeImageSrc(PNG), PNG);
  for (const type of ['jpeg', 'webp', 'gif']) assert.equal(m.sanitizeImageSrc(`data:image/${type};base64,AAAA`), `data:image/${type};base64,AAAA`);
  for (const value of ['data:image/svg+xml;base64,AAAA', 'data:image/png,AAAA', 'data:image/png;base64,AA AA', 'data:image/png;base64,AAAA===', 'data:image/jpg;base64,AAAA', 'http://x/a.png', null])
    assert.equal(m.sanitizeImageSrc(value), '', String(value));
  const prefix = 'data:image/png;base64,';
  const max = prefix + 'A'.repeat(m.MAX_IMAGE_CHARS - prefix.length);
  assert.equal(m.sanitizeImageSrc(max), max);
  assert.equal(m.sanitizeImageSrc(max + 'A'), '');
});

test('sanitizeStyle: só o que difere do padrão; opacidade entre 10 e 99', () => {
  assert.deepEqual(m.sanitizeStyle({}), {});
  assert.deepEqual(m.sanitizeStyle({ strokeWidth: 2, strokeStyle: 'solid', opacity: 100, locked: false }), {});
  assert.deepEqual(m.sanitizeStyle({ strokeWidth: 3, strokeStyle: 'wavy', opacity: 'x', locked: 'true', group: 'g 1' }), {});
  assert.deepEqual(m.sanitizeStyle({ strokeWidth: 4, strokeStyle: 'dotted', opacity: 0, locked: true, group: 'g1', link: 'Nota' }), {
    strokeWidth: 4,
    strokeStyle: 'dotted',
    opacity: 10,
    group: 'g1',
    locked: true,
    link: 'Nota',
  });
  assert.equal(m.sanitizeStyle({ opacity: 55.4 }).opacity, 55);
  assert.equal(m.sanitizeStyle({ opacity: -20 }).opacity, 10);
  assert.equal(m.sanitizeStyle({ opacity: 250 }).opacity, undefined);
});

test(
  'sanitizeStyle: opacidade quase opaca (99.5–99.99) não grava o valor padrão 100',
  { todo: 'BUG: model.ts:228 testa `opacity < 100` antes de arredondar; 99.6 vira opacity: 100 (o padrão, que não deveria ser gravado) e o arquivo muda na segunda leitura' },
  () => {
    const style = m.sanitizeStyle({ opacity: 99.6 });
    assert.ok(style.opacity === undefined || style.opacity < 100, `opacity = ${style.opacity}`);
    const once = m.parseBoard(doc([shape('a', { opacity: 99.6 })])).board;
    assert.deepEqual(roundTrip(once), once);
  },
);

// ---------------------------------------------------------------- ida e volta

test('ida e volta: quadro com todos os tipos e estilos não muda ao gravar e reler', () => {
  let { board, ids } = build(
    ['rectangle', rect(0, 0), { text: 'Olá\nmundo', fill: '#d7f0ec', strokeWidth: 4, strokeStyle: 'dashed', opacity: 50, fontSize: 40, font: 'mono', link: 'https://a.b' }],
    ['ellipse', rect(200, 0), { text: 'ção', locked: true }],
    ['diamond', rect(400, 0)],
    ['text', rect(0, 200), { text: 'solto', link: '[[Nota]]' }],
  );
  board = m.addDrawing(board, [
    { x: 0, y: 300 },
    { x: 50, y: 350 },
    { x: 100, y: 300 },
  ]).board;
  board = m.addPicture(board, PNG, rect(500, 300, 20, 20)).board;
  board = m.addArrow(board, { shape: ids[0] }, { shape: ids[1] }, '#1d4ed8', { head: 'both', strokeStyle: 'dotted' }).board;
  board = m.addArrow(board, { x: -50, y: -50 }, { shape: ids[2] }, m.INK, { head: 'none' }).board;
  board = m.groupElements(board, [ids[2], ids[3]]).board;
  board = { ...board, view: { x: 12.5, y: -7, zoom: 2 }, sample: true };
  const again = roundTrip(board);
  assert.deepEqual(again, board);
  // Depois da primeira leitura o texto do arquivo também fica estável.
  assert.equal(m.serializeBoard(roundTrip(again)), m.serializeBoard(again));
  assert.ok(m.serializeBoard(board).endsWith('}\n'));
});

test('ida e volta: texto com caracteres especiais, aspas e emoji é preservado', () => {
  const text = 'a "b" <c> & \'d\' \\ 🚀 \t tab';
  const { board } = build(['text', rect(0, 0), { text }]);
  assert.equal(roundTrip(board).elements[0].text, text);
});

test('newId: ids únicos e aceitos pela validação', () => {
  const ids = new Set(Array.from({ length: 500 }, () => m.newId()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[\w-]{1,64}$/);
});

test('newId: sem crypto.randomUUID usa contador e continua único', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    const ids = new Set(Array.from({ length: 50 }, () => m.newId()));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, /^e[0-9a-z]+$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', saved);
  }
});

test('type guards: cada tipo reconhecido; undefined é falso em todos', () => {
  const { board } = build(['text', rect(0, 0)]);
  const t = board.elements[0];
  assert.equal(m.isShape(t) && m.isBox(t), true);
  assert.equal(m.isDrawing(t) || m.isPicture(t) || m.isArrow(t), false);
  for (const guard of [m.isShape, m.isBox, m.isDrawing, m.isPicture, m.isArrow]) assert.equal(guard(undefined), false);
  assert.equal(m.isBound({ shape: 'a' }), true);
  assert.equal(m.isBound({ x: 0, y: 0 }), false);
});

// ---------------------------------------------------------------- geometria

test('center e normalizeRect: qualquer par de cantos dá largura e altura positivas', () => {
  assert.deepEqual(m.center(rect(10, 20, 100, 60)), { x: 60, y: 50 });
  assert.deepEqual(m.normalizeRect({ x: 10, y: 50 }, { x: -10, y: 0 }), { x: -10, y: 0, w: 20, h: 50 });
  assert.deepEqual(m.normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 5, y: 5, w: 0, h: 0 });
});

test('containsPoint: bordas exatas de retângulo, elipse e losango, com e sem tolerância', () => {
  const { board } = build(['rectangle', rect(0, 0, 100, 60)], ['ellipse', rect(0, 0, 100, 60)], ['diamond', rect(0, 0, 100, 60)]);
  const [r, e, d] = board.elements;
  assert.equal(m.containsPoint(r, { x: 100, y: 60 }), true);
  assert.equal(m.containsPoint(r, { x: 101, y: 30 }), false);
  assert.equal(m.containsPoint(r, { x: 101, y: 30 }, 1), true);
  // Canto do retângulo fica fora da elipse e do losango.
  assert.equal(m.containsPoint(e, { x: 2, y: 2 }), false);
  assert.equal(m.containsPoint(d, { x: 10, y: 10 }), false);
  assert.equal(m.containsPoint(e, { x: 100, y: 30 }), true);
  assert.equal(m.containsPoint(d, { x: 50, y: 0 }), true);
  assert.equal(m.containsPoint(d, { x: 75, y: 15 }), true, 'meio da aresta do losango');
  assert.equal(m.containsPoint(d, { x: 76, y: 14 }), false, 'logo acima da aresta');
});

test('borderPoint: o ponto cai exatamente na borda de cada forma', () => {
  const { board } = build(['rectangle', rect(0, 0, 100, 60)], ['ellipse', rect(0, 0, 100, 60)], ['diamond', rect(0, 0, 100, 60)]);
  const [r, e, d] = board.elements;
  for (const toward of [
    { x: 500, y: 30 },
    { x: 50, y: -400 },
    { x: 300, y: 300 },
    { x: -77, y: 13 },
  ]) {
    const pr = m.borderPoint(r, toward);
    assert.ok(Math.abs(pr.x - 50) === 50 || Math.abs(pr.y - 30) === 30 || near(Math.max(Math.abs(pr.x - 50) / 50, Math.abs(pr.y - 30) / 30), 1));
    near(Math.max(Math.abs(pr.x - 50) / 50, Math.abs(pr.y - 30) / 30), 1);
    const pe = m.borderPoint(e, toward);
    near(((pe.x - 50) / 50) ** 2 + ((pe.y - 30) / 30) ** 2, 1);
    const pd = m.borderPoint(d, toward);
    near(Math.abs(pd.x - 50) / 50 + Math.abs(pd.y - 30) / 30, 1);
  }
});

test('borderPoint: alvo no centro ou dentro da forma devolve o centro', () => {
  const { board } = build(['rectangle', rect(0, 0, 100, 60)], ['ellipse', rect(0, 0, 100, 60)]);
  for (const s of board.elements) {
    assert.deepEqual(m.borderPoint(s, { x: 50, y: 30 }), { x: 50, y: 30 });
    assert.deepEqual(m.borderPoint(s, { x: 60, y: 35 }), { x: 50, y: 30 });
  }
});

test('borderPoint: direção puramente horizontal e vertical no retângulo', () => {
  const { board } = build(['rectangle', rect(0, 0, 100, 60)]);
  const [r] = board.elements;
  assert.deepEqual(m.borderPoint(r, { x: 1000, y: 30 }), { x: 100, y: 30 });
  assert.deepEqual(m.borderPoint(r, { x: 50, y: -1000 }), { x: 50, y: 0 });
});

test('arrowSegment: pontas soltas são o próprio segmento; ponta presa a forma sumida dá null', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)]);
  const free = { id: 'r', kind: 'arrow', start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, stroke: m.INK };
  assert.deepEqual(m.arrowSegment(board, free), { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
  assert.equal(m.arrowSegment(board, { ...free, end: { shape: 'sumiu' } }), null);
  const half = m.arrowSegment(board, { ...free, start: { shape: ids[0] }, end: { x: 500, y: 30 } });
  assert.deepEqual(half, { a: { x: 100, y: 30 }, b: { x: 500, y: 30 } });
});

test('drawingFromPoints: sem pontos válidos dá null; um ponto vira caixa mínima', () => {
  assert.equal(m.drawingFromPoints([]), null);
  assert.equal(m.drawingFromPoints([{ x: NaN, y: 0 }, { x: 0, y: Infinity }]), null);
  const dot = m.drawingFromPoints([{ x: 10, y: 10 }]);
  assert.deepEqual([dot.w, dot.h], [m.MIN_SIZE, m.MIN_SIZE]);
  assert.equal(dot.points.length, 4);
  near(dot.x + dot.w / 2, 10.25);
});

test('drawingFromPoints: linha reta horizontal ganha altura mínima, centrada', () => {
  const line = m.drawingFromPoints([
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ]);
  assert.deepEqual([line.x, line.y, line.w, line.h], [0, 46, 100, m.MIN_SIZE]);
  assert.deepEqual(line.points, [0, 0.5, 1, 0.5]);
});

test('drawingFromPoints: pontos muito próximos são descartados, mas o último sempre fica', () => {
  const result = m.drawingFromPoints([
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
    { x: 20, y: 20 },
    { x: 20.5, y: 20 },
  ]);
  const pts = m.drawingPoints({ kind: 'draw', ...result });
  assert.equal(pts.length, 3);
  near(pts.at(-1).x, 20.5, 1e-3);
});

test('drawingFromPoints: gesto longo é reduzido a no máximo MAX_POINTS, mantendo o último', () => {
  const input = Array.from({ length: 10_001 }, (_, i) => ({ x: i * 2, y: Math.sin(i) * 100 }));
  const result = m.drawingFromPoints(input);
  assert.ok(result.points.length / 2 <= m.MAX_POINTS);
  assert.ok(result.points.every((n) => n >= 0 && n <= 1));
  const pts = m.drawingPoints({ kind: 'draw', ...result });
  near(pts.at(-1).x, 20_000, 1e-6 * 20_000);
});

test('drawingPoints: converte os pares normalizados para o quadro e ignora par incompleto', () => {
  const pts = m.drawingPoints({ kind: 'draw', x: 10, y: 20, w: 100, h: 50, points: [0, 0, 1, 1, 0.5] });
  assert.deepEqual(pts, [
    { x: 10, y: 20 },
    { x: 110, y: 70 },
  ]);
});

test('elementContains: traço respeita a espessura; imagem só dentro da caixa; seta pela linha', () => {
  let board = m.emptyBoard();
  board = m.addDrawing(board, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ], { strokeWidth: 4 }).board;
  board = m.addPicture(board, PNG, rect(200, 0, 50, 50)).board;
  board = m.addArrow(board, { x: 0, y: 200 }, { x: 100, y: 200 }).board;
  const [draw, pic, arrow] = board.elements;
  // Traço reto vai de y=4 (caixa mínima centrada em y=0, de -4 a 4) — a linha está em y=0.
  assert.equal(m.elementContains(board, draw, { x: 50, y: 7.9 }), true, 'reach = 6 + 4/2');
  assert.equal(m.elementContains(board, draw, { x: 50, y: 8.1 }), false);
  assert.equal(m.elementContains(board, draw, { x: -50, y: 0 }), false);
  assert.equal(m.elementContains(board, pic, { x: 250, y: 50 }), true);
  assert.equal(m.elementContains(board, pic, { x: 250.1, y: 50 }), false, 'imagem não tem margem');
  assert.equal(m.elementContains(board, arrow, { x: 50, y: 207 }), true);
  assert.equal(m.elementContains(board, arrow, { x: 50, y: 207.1 }), false);
  assert.equal(m.elementContains(board, arrow, { x: 110, y: 200 }), false, 'além da ponta');
});

test('hitTest e shapeAt: o de cima vence; shapeAt ignora traço, imagem e o excluído', () => {
  let { board, ids } = build(['rectangle', rect(0, 0)], ['ellipse', rect(0, 0)]);
  assert.equal(m.hitTest(board, { x: 50, y: 30 }), ids[1]);
  assert.equal(m.hitTest(board, { x: 5000, y: 5000 }), null);
  assert.equal(m.shapeAt(board, { x: 50, y: 30 }, ids[1]).id, ids[0]);
  board = m.addPicture(board, PNG, rect(0, 0, 100, 60)).board;
  assert.equal(m.hitTest(board, { x: 50, y: 30 }), board.elements.at(-1).id);
  assert.equal(m.shapeAt(board, { x: 50, y: 30 }).id, ids[1]);
  assert.equal(m.shapeAt(m.emptyBoard(), { x: 0, y: 0 }), undefined);
});

test('elementBounds, boardBounds e elementsInRect', () => {
  let { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(300, 100)]);
  board = m.addArrow(board, { x: -50, y: 500 }, { x: 50, y: 400 }).board;
  const arrow = board.elements.at(-1);
  assert.deepEqual(m.elementBounds(board, arrow), { x: -50, y: 400, w: 100, h: 100 });
  assert.deepEqual(m.boardBounds(board), { x: -50, y: 0, w: 450, h: 500 });
  assert.deepEqual(m.boardBounds(board, [ids[1]]), rect(300, 100));
  assert.equal(m.boardBounds(board, []), null);
  assert.equal(m.boardBounds(m.emptyBoard()), null);
  assert.equal(m.elementBounds(board, { ...arrow, start: { shape: 'nada' } }), null);
  assert.deepEqual(m.elementsInRect(board, rect(-10, -10, 120, 80)), [ids[0]]);
  assert.deepEqual(m.elementsInRect(board, rect(0, 0, 100, 60)), [ids[0]], 'borda exata conta');
  assert.deepEqual(m.elementsInRect(board, rect(1, 0, 100, 60)), []);
  assert.deepEqual(m.elementsInRect(board, rect(-1000, -1000, 3000, 3000)).length, 3);
});

test('restrições: grade, quadrado, ângulo, proporção e eixo nos casos-limite', () => {
  assert.equal(m.snapToGrid(13, 0), 13);
  assert.equal(m.snapToGrid(13, -10), 13);
  assert.equal(m.snapToGrid(15, 10), 20);
  assert.equal(m.snapToGrid(-16, 10), -20);
  assert.deepEqual(m.constrainSquare({ x: 0, y: 0 }, { x: -10, y: 3 }), { x: -10, y: 10 });
  assert.deepEqual(m.constrainSquare({ x: 0, y: 0 }, { x: 0, y: 0 }), { x: 0, y: 0 });
  const angled = m.constrainAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
  near(angled.y, 0, 1e-9);
  near(angled.x, Math.hypot(100, 10));
  const diag = m.constrainAngle({ x: 0, y: 0 }, { x: 10, y: 9 });
  near(Math.atan2(diag.y, diag.x), Math.PI / 4);
  near(Math.hypot(diag.x, diag.y), Math.hypot(10, 9));
  const ninety = m.constrainAngle({ x: 0, y: 0 }, { x: 10, y: 9 }, Math.PI / 2);
  near(ninety.y, 0, 1e-9);
  assert.deepEqual(m.constrainRatio({ x: 0, y: 0 }, { x: 5, y: 7 }, 0), { x: 5, y: 7 });
  assert.deepEqual(m.constrainRatio({ x: 0, y: 0 }, { x: 5, y: 7 }, -1), { x: 5, y: 7 });
  assert.deepEqual(m.constrainRatio({ x: 0, y: 0 }, { x: 5, y: 7 }, Infinity), { x: 5, y: 7 });
  assert.deepEqual(m.constrainRatio({ x: 0, y: 0 }, { x: 5, y: 7 }, NaN), { x: 5, y: 7 });
  const back = m.constrainRatio({ x: 10, y: 10 }, { x: 0, y: 5 }, 2);
  assert.deepEqual([back.x + 0, back.y], [0, 5]);
  assert.deepEqual(m.constrainRatio({ x: 0, y: 0 }, { x: -40, y: -10 }, 2), { x: -40, y: -20 });
  assert.deepEqual(m.constrainAxis(5, -5), { dx: 5, dy: 0 }, 'empate fica no eixo x');
  assert.deepEqual(m.constrainAxis(1, -5), { dx: 0, dy: -5 });
});

// ---------------------------------------------------------------- operações

test('addShape: tamanho mínimo e props inválidas neutralizadas', () => {
  const { board, id } = m.addShape(m.emptyBoard(), 'rectangle', rect(0, 0, 1, -50), { stroke: 'red', fill: 'url(x)', text: 'a\u0000b', fontSize: 99, font: 'serif', link: 'javascript:x' });
  const s = m.findShape(board, id);
  assert.deepEqual([s.w, s.h], [m.MIN_SIZE, m.MIN_SIZE]);
  assert.deepEqual([s.stroke, s.fill, s.text], [m.INK, 'transparent', 'ab']);
  assert.equal('fontSize' in s || 'font' in s || 'link' in s, false);
});

test('addDrawing e addPicture: null para entradas inválidas; o quadro original não muda', () => {
  const board = m.emptyBoard();
  assert.equal(m.addDrawing(board, []), null);
  assert.equal(m.addDrawing(board, [{ x: NaN, y: NaN }]), null);
  assert.equal(m.addPicture(board, 'data:image/svg+xml;base64,AAAA', rect(0, 0)), null);
  assert.equal(m.addPicture(board, PNG, rect(0, 0, 0, 10)), null);
  assert.equal(board.elements.length, 0);
});

test('addArrow: forma inexistente dá null; head "end" não é gravado; estilo é validado', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)]);
  assert.equal(m.addArrow(board, { shape: ids[0] }, { shape: 'nada' }), null);
  assert.equal(m.addArrow(board, { shape: 'nada' }, { x: 0, y: 0 }), null);
  const end = m.addArrow(board, { shape: ids[0] }, { x: 500, y: 0 }, 'blue', { head: 'end', opacity: 100, strokeWidth: 7 });
  const arrow = m.findElement(end.board, end.id);
  assert.equal('head' in arrow || 'opacity' in arrow || 'strokeWidth' in arrow, false);
  assert.equal(arrow.stroke, m.INK);
  const none = m.addArrow(board, { x: 0, y: 0 }, { x: 1, y: 1 }, '#1d4ed8', { head: 'none' });
  assert.equal(m.findElement(none.board, none.id).head, 'none');
});

test('connect: sentido oposto cria outra seta; mesmo sentido devolve a existente e o mesmo quadro', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(300, 0)]);
  const ab = m.connect(board, ids[0], ids[1]);
  const again = m.connect(ab.board, ids[0], ids[1]);
  assert.equal(again.board, ab.board);
  assert.equal(again.id, ab.id);
  const ba = m.connect(ab.board, ids[1], ids[0]);
  assert.notEqual(ba.id, ab.id);
  assert.equal(ba.board.elements.filter(m.isArrow).length, 2);
  assert.equal(m.connect(board, ids[0], ids[0]), null);
  assert.equal(m.connect(board, ids[0], 'nada'), null);
});

test('setArrowEnd: id que não é seta, ponta igual ou forma ausente devolvem o mesmo quadro', () => {
  let { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(300, 0)], ['rectangle', rect(600, 0)]);
  const ab = m.connect(board, ids[0], ids[1]);
  board = ab.board;
  assert.equal(m.setArrowEnd(board, ids[0], 'end', { x: 0, y: 0 }), board);
  assert.equal(m.setArrowEnd(board, 'nada', 'end', { x: 0, y: 0 }), board);
  assert.equal(m.setArrowEnd(board, ab.id, 'end', { shape: ids[1] }), board);
  assert.equal(m.setArrowEnd(board, ab.id, 'end', { shape: 'nada' }), board);
  assert.equal(m.setArrowEnd(board, ab.id, 'start', { shape: ids[1] }), board);
  const moved = m.setArrowEnd(board, ab.id, 'start', { shape: ids[2] });
  assert.deepEqual(m.findElement(moved, ab.id).start, { shape: ids[2] });
});

test('moveElements: ids vazios, deslocamento zero ou só ids ausentes', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)]);
  assert.equal(m.moveElements(board, [], 10, 10), board);
  assert.equal(m.moveElements(board, ids, 0, 0), board);
  const moved = m.moveElements(board, ['nada'], 10, 10);
  assert.deepEqual(moved.elements, board.elements);
});

test('moveElements: traços e imagens andam pela caixa; pontos normalizados não mudam', () => {
  let board = m.addDrawing(m.emptyBoard(), [
    { x: 0, y: 0 },
    { x: 30, y: 40 },
  ]).board;
  board = m.addPicture(board, PNG, rect(0, 0, 10, 10)).board;
  const ids = board.elements.map((e) => e.id);
  const moved = m.moveElements(board, ids, 5, -5);
  assert.deepEqual(moved.elements[0].points, board.elements[0].points);
  assert.deepEqual([moved.elements[0].x, moved.elements[0].y], [5, -5]);
  assert.deepEqual([moved.elements[1].x, moved.elements[1].y], [5, -5]);
});

test(
  'resizeShape: seta ou id inexistente devolvem o mesmo quadro (nada mudou)',
  { todo: 'BUG: model.ts:605 resizeShape sempre cria um quadro novo, mesmo quando nenhum elemento muda — contradiz o contrato do módulo ("o mesmo objeto quando nada muda") e gera passo de desfazer vazio' },
  () => {
    const { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(300, 0)]);
    const arrow = m.connect(board, ids[0], ids[1]);
    assert.equal(m.resizeShape(arrow.board, arrow.id, rect(0, 0, 50, 50)), arrow.board);
    assert.equal(m.resizeShape(board, 'nada', rect(0, 0, 50, 50)), board);
  },
);

test('resizeShape: tamanho mínimo também para traços e imagens', () => {
  let board = m.addPicture(m.emptyBoard(), PNG, rect(0, 0, 10, 10)).board;
  const id = board.elements[0].id;
  board = m.resizeShape(board, id, { x: 3, y: 4, w: 0, h: -10 });
  assert.deepEqual(board.elements[0], { ...board.elements[0], x: 3, y: 4, w: m.MIN_SIZE, h: m.MIN_SIZE });
});

test('updateElements: patch sem efeito devolve o mesmo quadro; padrões são removidos', () => {
  const { board, ids } = build(['rectangle', rect(0, 0), { fontSize: 28, font: 'mono', opacity: 50, link: 'Nota', locked: true, strokeWidth: 4, strokeStyle: 'dashed' }]);
  assert.equal(m.updateElements(board, ids, {}), board);
  assert.equal(m.updateElements(board, ['nada'], { text: 'x' }), board);
  assert.equal(m.updateElements(board, ids, { fontSize: 15, font: 'serif', head: 'both', strokeWidth: 3, strokeStyle: 'wavy', opacity: NaN }), board);
  const reset = m.updateElements(board, ids, { fontSize: null, font: 'sans', opacity: 100, link: 'javascript:x', locked: false, strokeWidth: 2, strokeStyle: 'solid' });
  const s = reset.elements[0];
  for (const key of ['fontSize', 'font', 'opacity', 'link', 'locked', 'strokeWidth', 'strokeStyle']) assert.equal(key in s, false, key);
  assert.deepEqual(roundTrip(reset), reset);
});

test('updateElements: opacidade é limitada a 10–100 e arredondada', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)]);
  assert.equal(m.updateElements(board, ids, { opacity: 3 }).elements[0].opacity, 10);
  assert.equal(m.updateElements(board, ids, { opacity: 74.6 }).elements[0].opacity, 75);
  assert.equal('opacity' in m.updateElements(board, ids, { opacity: 500 }).elements[0], false);
});

test('updateElements: cada tipo só recebe o que faz sentido (imagem sem traço, seta sem texto)', () => {
  let board = m.addPicture(m.emptyBoard(), PNG, rect(0, 0, 10, 10)).board;
  board = m.addArrow(board, { x: 0, y: 0 }, { x: 10, y: 0 }, m.INK, { head: 'both' }).board;
  const ids = board.elements.map((e) => e.id);
  const next = m.updateElements(board, ids, { stroke: '#1d4ed8', strokeWidth: 4, text: 'x', fill: '#ffffff', fontSize: 40, head: 'end' });
  const [pic, arrow] = next.elements;
  assert.equal('stroke' in pic || 'strokeWidth' in pic, false);
  assert.equal(arrow.stroke, '#1d4ed8');
  assert.equal(arrow.strokeWidth, 4);
  assert.equal('text' in arrow || 'fill' in arrow || 'fontSize' in arrow || 'head' in arrow, false);
});

test('updateElements: cor inválida mantém a anterior', () => {
  const { board, ids } = build(['rectangle', rect(0, 0), { stroke: '#1d4ed8', fill: '#ffffff' }]);
  assert.equal(m.updateElements(board, ids, { stroke: 'red', fill: 'blue' }), board);
});

test('deleteElements: id ausente devolve o mesmo quadro; seta solta no ponto da borda', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(300, 0)]);
  const ab = m.connect(board, ids[0], ids[1]);
  assert.equal(m.deleteElements(ab.board, ['nada']), ab.board);
  const after = m.deleteElements(ab.board, [ids[1]]);
  const arrow = m.findElement(after, ab.id);
  assert.deepEqual(arrow.start, { shape: ids[0] });
  assert.deepEqual(arrow.end, { x: 300, y: 30 });
  assert.deepEqual(m.deleteElements(ab.board, [ab.id]).elements.length, 2);
});

test('cloneElements: trava sai, grupo vira outro (o mesmo para todos os membros), ponta sem forma vira ponto', () => {
  let { board, ids } = build(['rectangle', rect(0, 0), { locked: true }], ['rectangle', rect(300, 0)], ['rectangle', rect(600, 0)]);
  board = m.groupElements(board, [ids[0], ids[1]]).board;
  const arrow = m.connect(board, ids[1], ids[2]);
  board = arrow.board;
  const source = board.elements.filter((e) => [ids[0], ids[1], arrow.id].includes(e.id));
  const { elements } = m.cloneElements(board, source, 10, 20);
  const [c0, c1, ca] = elements;
  assert.equal('locked' in c0, false);
  assert.ok(c0.group && c0.group === c1.group && c0.group !== board.elements[0].group);
  assert.deepEqual(ca.start, { shape: c1.id });
  assert.deepEqual(ca.end, { x: 600 + 10, y: 30 + 20 });
  assert.equal(new Set(elements.map((e) => e.id)).size, 3);
  assert.ok(elements.every((e) => !ids.includes(e.id)));
});

test('duplicateElements: sem seleção ou quadro cheio não faz nada; perto do limite copia só o que cabe', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(300, 0)]);
  assert.deepEqual(m.duplicateElements(board, ['nada']), { board, ids: [] });
  const full = { ...board, elements: Array.from({ length: m.MAX_ELEMENTS }, (_, i) => ({ ...board.elements[0], id: `s${i}` })) };
  assert.deepEqual(m.duplicateElements(full, ['s0']), { board: full, ids: [] });
  const almost = { ...board, elements: [...full.elements.slice(0, m.MAX_ELEMENTS - 1)] };
  const result = m.duplicateElements(almost, ['s0', 's1']);
  assert.equal(result.ids.length, 1);
  assert.equal(result.board.elements.length, m.MAX_ELEMENTS);
  const offset = m.duplicateElements(board, [ids[0]], 5);
  assert.deepEqual([offset.board.elements.at(-1).x, offset.board.elements.at(-1).y], [5, 5]);
});

test('insertElements: lista vazia não muda; seta para forma de fora da colagem é descartada', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)]);
  assert.deepEqual(m.insertElements(board, [], 0, 0), { board, ids: [] });
  const incoming = [{ id: 'r', kind: 'arrow', start: { shape: ids[0] }, end: { x: 5, y: 5 }, stroke: m.INK }];
  assert.deepEqual(m.insertElements(board, incoming, 0, 0).ids, []);
});

test('parseClipboard: só o formato do quadro; JSON inválido, tipo errado ou elementos não-lista dão null', () => {
  assert.equal(m.parseClipboard('{quebrado'), null);
  assert.equal(m.parseClipboard('{"type":"outro","elements":[]}'), null);
  assert.equal(m.parseClipboard(`{"type":"${m.CLIPBOARD_FORMAT}","elements":{}}`), null);
  assert.equal(m.parseClipboard(`[{"type":"${m.CLIPBOARD_FORMAT}"}]`), null);
  assert.equal(m.parseClipboard(' '.repeat(m.MAX_BOARD_BYTES) + '{}'), null);
  const pasted = m.parseClipboard(`  \n{"type":"${m.CLIPBOARD_FORMAT}","elements":[${JSON.stringify(shape('a'))},{"id":"b","kind":"bomb"}]}`);
  assert.deepEqual(
    pasted.map((e) => e.id),
    ['a'],
  );
});

test('clipboardText: só os ids pedidos, na ordem de desenho, e volta igual', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)], ['ellipse', rect(300, 0)], ['diamond', rect(600, 0)]);
  const text = m.clipboardText(board, [ids[2], ids[0]]);
  assert.deepEqual(m.parseClipboard(text), [board.elements[0], board.elements[2]]);
  assert.deepEqual(m.parseClipboard(m.clipboardText(board, [])), []);
});

test('grupos: um só elemento não agrupa; desagrupar sem grupos devolve o mesmo quadro', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(300, 0)]);
  assert.deepEqual(m.groupElements(board, [ids[0]]), { board, group: null });
  assert.deepEqual(m.groupElements(board, [ids[0], 'nada']), { board, group: null });
  assert.equal(m.ungroupElements(board, ids), board);
  const grouped = m.groupElements(board, ids).board;
  assert.deepEqual(m.withGroups(grouped, [ids[1]]), ids);
  assert.deepEqual(m.withGroups(board, ['nada']), []);
});

test('grupos: agrupar elementos que já têm grupos funde tudo num grupo novo', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(100, 0)], ['rectangle', rect(200, 0)], ['rectangle', rect(300, 0)]);
  let b = m.groupElements(board, [ids[0], ids[1]]).board;
  b = m.groupElements(b, [ids[2], ids[3]]).board;
  const merged = m.groupElements(b, [ids[0], ids[2]]);
  assert.ok(merged.group);
  assert.ok(merged.board.elements.every((e) => e.group === merged.group));
});

test('unlockedIds: ignora travados e ids ausentes, na ordem de desenho', () => {
  const { board, ids } = build(['rectangle', rect(0, 0), { locked: true }], ['rectangle', rect(300, 0)], ['rectangle', rect(600, 0)]);
  assert.deepEqual(m.unlockedIds(board, [ids[2], ids[0], 'nada', ids[1]]), [ids[1], ids[2]]);
});

test('reorder: ids vazios e movimentos impossíveis devolvem o mesmo quadro', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(100, 0)], ['rectangle', rect(200, 0)]);
  assert.equal(m.reorder(board, [], 'front'), board);
  assert.equal(m.reorder(board, [ids[2]], 'front'), board);
  assert.equal(m.reorder(board, [ids[2]], 'forward'), board);
  assert.equal(m.reorder(board, [ids[0]], 'back'), board);
  assert.equal(m.reorder(board, [ids[0]], 'backward'), board);
  assert.equal(m.reorder(board, ids, 'forward'), board);
  assert.equal(m.reorder(board, ['nada'], 'backward'), board);
});

test('reorder: blocos selecionados não contíguos sobem/descem um passo cada', () => {
  const { board, ids } = build(...[0, 1, 2, 3, 4].map((i) => ['rectangle', rect(i * 100, 0)]));
  const order = (b) => b.elements.map((e) => ids.indexOf(e.id));
  assert.deepEqual(order(m.reorder(board, [ids[0], ids[2]], 'forward')), [1, 0, 3, 2, 4]);
  assert.deepEqual(order(m.reorder(board, [ids[2], ids[4]], 'backward')), [0, 2, 1, 4, 3]);
  assert.deepEqual(order(m.reorder(board, [ids[3], ids[1]], 'back')), [1, 3, 0, 2, 4]);
});

test('alinhar: menos de dois blocos não muda; direita, base e centro vertical', () => {
  const { board, ids } = build(['rectangle', rect(0, 0, 100, 60)], ['rectangle', rect(300, 200, 50, 20)]);
  assert.equal(m.alignElements(board, [ids[0]], 'left'), board);
  const grouped = m.groupElements(board, ids).board;
  assert.equal(m.alignElements(grouped, ids, 'left'), grouped, 'um grupo é um bloco só');
  const right = m.alignElements(board, ids, 'right');
  assert.deepEqual(right.elements.map((e) => e.x + e.w), [350, 350]);
  const bottom = m.alignElements(board, ids, 'bottom');
  assert.deepEqual(bottom.elements.map((e) => e.y + e.h), [220, 220]);
  const v = m.alignElements(board, ids, 'vcenter');
  assert.deepEqual(v.elements.map((e) => e.y + e.h / 2), [110, 110]);
  assert.deepEqual(v.elements.map((e) => e.x), [0, 300], 'centro vertical não mexe no x');
});

test('distribuir: menos de três blocos não muda; vertical deixa espaços iguais e mantém as pontas', () => {
  const { board, ids } = build(['rectangle', rect(0, 0, 50, 10)], ['rectangle', rect(0, 15, 50, 30)], ['rectangle', rect(0, 200, 50, 20)]);
  assert.equal(m.distributeElements(board, ids.slice(0, 2), 'vertical'), board);
  const next = m.distributeElements(board, ids, 'vertical');
  const [a, b, c] = next.elements;
  near(b.y - (a.y + a.h), c.y - (b.y + b.h));
  assert.equal(a.y, 0);
  assert.equal(c.y, 200);
  assert.deepEqual(next.elements.map((e) => e.x), [0, 0, 0]);
});

test('busca: vazia não acha nada; acha por link de seta e ignora acento na busca', () => {
  let { board, ids } = build(['rectangle', rect(0, 0), { text: 'Revisão' }]);
  board = m.addArrow(board, { x: 0, y: 0 }, { x: 10, y: 10 }, m.INK, { link: 'https://site.com/revisao' }).board;
  assert.deepEqual(m.searchElements(board, ''), []);
  assert.deepEqual(m.searchElements(board, '   '), []);
  assert.deepEqual(m.searchElements(board, 'REVISAO'), [ids[0], board.elements[1].id]);
  assert.deepEqual(m.searchElements(board, 'revisão'), [ids[0], board.elements[1].id]);
  assert.deepEqual(m.searchElements(board, 'inexistente'), []);
});

test('resolveLink: âncora, extensão, caminho exato, fim do caminho; inválido ou ausente dá null', () => {
  const notes = [
    { path: 'Pasta/Plano.md', name: 'Plano' },
    { path: 'Diário.md', name: 'Diário' },
    { path: 'a/b/Fundo.md', name: 'Fundo-x' },
  ];
  assert.deepEqual(m.resolveLink('Plano#Metas', notes), { type: 'note', path: 'Pasta/Plano.md' });
  assert.deepEqual(m.resolveLink('pasta/plano.MD', notes), { type: 'note', path: 'Pasta/Plano.md' });
  assert.deepEqual(m.resolveLink('[[Diário]]', notes), { type: 'note', path: 'Diário.md' });
  assert.deepEqual(m.resolveLink('b/Fundo', notes), { type: 'note', path: 'a/b/Fundo.md' });
  assert.deepEqual(m.resolveLink('https://x.y/#a', notes), { type: 'url', url: 'https://x.y/#a' });
  assert.equal(m.resolveLink('Nada', notes), null);
  assert.equal(m.resolveLink(undefined, notes), null);
  assert.equal(m.resolveLink('javascript:alert(1)', notes), null);
  assert.equal(m.resolveLink('Plano', []), null);
});

test('zoomAt e fitView: limites de zoom e entradas degeneradas', () => {
  const view = { x: 0, y: 0, zoom: 1 };
  assert.equal(m.zoomAt(view, 100, { x: 0, y: 0 }).zoom, m.MAX_ZOOM);
  assert.equal(m.zoomAt(view, 0, { x: 0, y: 0 }).zoom, m.MIN_ZOOM);
  assert.deepEqual(m.zoomAt(view, 1, { x: 50, y: 50 }), view);
  assert.deepEqual(m.fitView(null, 800, 600), { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(m.fitView(rect(0, 0), 0, 600), { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(m.fitView(rect(0, 0), 800, -1), { x: 0, y: 0, zoom: 1 });
  // Retângulo pequeno não amplia além de maxZoom e fica centrado.
  const small = m.fitView(rect(0, 0, 10, 10), 800, 600);
  assert.equal(small.zoom, 1);
  assert.deepEqual([small.x, small.y], [395, 295]);
  assert.equal(m.fitView(rect(0, 0, 10, 10), 800, 600, 48, 3).zoom, 3);
  // Retângulo enorme fica no zoom mínimo; tela menor que a margem também.
  assert.equal(m.fitView(rect(0, 0, 1e6, 1e6), 800, 600).zoom, m.MIN_ZOOM);
  assert.equal(m.fitView(rect(0, 0, 10, 10), 50, 50).zoom, m.MIN_ZOOM);
  // Ponto (largura e altura 0) não divide por zero.
  assert.ok(Number.isFinite(m.fitView(rect(5, 5, 0, 0), 800, 600).x));
});

test('clampZoom: limites exatos', () => {
  assert.equal(m.clampZoom(m.MIN_ZOOM), m.MIN_ZOOM);
  assert.equal(m.clampZoom(m.MAX_ZOOM), m.MAX_ZOOM);
  assert.equal(m.clampZoom(1), 1);
  assert.equal(m.clampZoom(-Infinity), m.MIN_ZOOM);
  assert.equal(m.clampZoom(Infinity), m.MAX_ZOOM);
});

test('quadro de exemplo: textos vêm dos rótulos; cada seta liga duas formas distintas; sobrevive à ida e volta', () => {
  const labels = { note: 'Nota', draft: 'Rascunho', review: 'Revisar?', approved: 'Sim', publish: 'Publicar', fix: 'Corrigir' };
  const board = sampleBoard(labels);
  const texts = board.elements.filter(m.isShape).map((s) => s.text);
  for (const text of Object.values(labels)) assert.ok(texts.includes(text), text);
  const arrows = board.elements.filter(m.isArrow);
  assert.equal(arrows.length, 4);
  for (const a of arrows) {
    assert.ok(m.findShape(board, a.start.shape) && m.findShape(board, a.end.shape));
    assert.notEqual(a.start.shape, a.end.shape);
  }
  assert.deepEqual(roundTrip(board), board);
  assert.notEqual(sampleBoard(labels).elements[0].id, board.elements[0].id, 'ids novos a cada exemplo');
});
