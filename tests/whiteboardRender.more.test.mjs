// Quadro branco (src/whiteboard/render.ts), casos extras: primitivas de cada tipo, pontas de seta,
// texto, tracejado e o SVG exportado (opções, filtros e barreiras contra entrada que escapou do modelo).
// Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as m from '../src/whiteboard/model.ts';
import * as r from '../src/whiteboard/render.ts';

const rect = (x, y, w = 100, h = 60) => ({ x, y, w, h });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const one = (kind, r0, props) => {
  const result = m.addShape(m.emptyBoard(), kind, r0, props);
  return { board: result.board, shape: result.board.elements[0] };
};
const svgOf = (board, options) => r.boardToSvg(board, options).svg;

// ---------------------------------------------------------------- estilo e texto

test('fontSize e fontFamily: padrão 16 nas formas, 20 no texto solto; mono só com font: mono', () => {
  assert.equal(r.fontSize(one('rectangle', rect(0, 0)).shape), r.LABEL_SIZE);
  assert.equal(r.fontSize(one('text', rect(0, 0)).shape), r.TEXT_SIZE);
  assert.equal(r.fontSize(one('ellipse', rect(0, 0), { fontSize: 40 }).shape), 40);
  assert.equal(r.fontFamily(one('text', rect(0, 0)).shape), r.FONT_FAMILY);
  assert.equal(r.fontFamily(one('text', rect(0, 0), { font: 'mono' }).shape), r.MONO_FAMILY);
});

test('dashArray e lineOf: tracejado proporcional; padrão contínuo de espessura 2', () => {
  assert.equal(r.dashArray(undefined, 2), '');
  assert.equal(r.dashArray('solid', 4), '');
  assert.equal(r.dashArray('dashed', 1), '4 3');
  assert.equal(r.dashArray('dotted', 4), '0 10');
  assert.deepEqual(r.lineOf(one('rectangle', rect(0, 0)).shape), { width: r.STROKE_WIDTH, dash: '' });
  assert.deepEqual(r.lineOf(one('rectangle', rect(0, 0), { strokeWidth: 4, strokeStyle: 'dashed' }).shape), { width: 4, dash: '16 12' });
});

test('textPrimitive: sem texto não há primitiva; texto solto ancora no canto', () => {
  assert.equal(r.textPrimitive(one('rectangle', rect(0, 0)).shape), null);
  const t = r.textPrimitive(one('text', rect(10, 20), { text: 'oi', stroke: '#1d4ed8' }).shape);
  assert.deepEqual(t, { type: 'text', x: 10, y: 20 + r.TEXT_SIZE, lines: ['oi'], size: r.TEXT_SIZE, color: '#1d4ed8', anchor: 'start', mono: false });
});

test('textPrimitive: bloco de várias linhas fica centrado na vertical da forma', () => {
  const s = one('rectangle', rect(0, 0, 200, 100), { text: 'a\nb\nc', font: 'mono' }).shape;
  const t = r.textPrimitive(s);
  const step = r.LABEL_SIZE * r.LINE_HEIGHT;
  assert.equal(t.anchor, 'middle');
  assert.equal(t.x, 100);
  assert.deepEqual(t.lines, ['a', 'b', 'c']);
  assert.equal(t.mono, true);
  // Topo do bloco (linha de base − tamanho) + altura do bloco deixa a mesma folga em cima e embaixo.
  const top = t.y - r.LABEL_SIZE;
  near(top, 100 - (top + step * 3));
});

test('shapeOutline: raio do retângulo limitado; elipse e losango; texto solto não tem contorno', () => {
  const big = r.shapeOutline(one('rectangle', rect(0, 0, 200, 100)).shape);
  assert.equal(big.rx, 10);
  const small = r.shapeOutline(one('rectangle', rect(0, 0, 20, 12)).shape);
  assert.equal(small.rx, 3);
  const e = r.shapeOutline(one('ellipse', rect(10, 20, 100, 60)).shape);
  assert.deepEqual([e.type, e.cx, e.cy, e.rx, e.ry], ['ellipse', 60, 50, 50, 30]);
  const d = r.shapeOutline(one('diamond', rect(0, 0, 100, 60), { fill: '#ffffff' }).shape);
  assert.equal(d.type, 'polygon');
  assert.deepEqual(d.points, [
    { x: 50, y: 0 },
    { x: 100, y: 30 },
    { x: 50, y: 60 },
    { x: 0, y: 30 },
  ]);
  assert.equal(d.fill, '#ffffff');
  assert.equal(r.shapeOutline(one('text', rect(0, 0), { text: 'x' }).shape), null);
});

// ---------------------------------------------------------------- pontas de seta

test('arrowHead: ponta em b, comprimento 14 e largura 9 no traço padrão, simétrica', () => {
  const [tip, left, right] = r.arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 });
  assert.deepEqual(tip, { x: 100, y: 0 });
  near(left.x, 86);
  near(right.x, 86);
  near(Math.abs(left.y - right.y), 9);
  near(left.y, -right.y);
});

test('arrowHead: traço fino não encolhe; grosso cresce com expoente 0.6', () => {
  const thin = r.arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 1);
  near(thin[1].x, 86);
  const thick = r.arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
  near(100 - thick[1].x, 14 * 2 ** 0.6);
});

test('arrowHead: segmento de comprimento zero não gera NaN', () => {
  const head = r.arrowHead({ x: 5, y: 5 }, { x: 5, y: 5 });
  assert.ok(head.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('arrowHead: direção vertical aponta para baixo', () => {
  const [tip, left] = r.arrowHead({ x: 0, y: 0 }, { x: 0, y: 50 });
  assert.deepEqual(tip, { x: 0, y: 50 });
  near(left.y, 36);
});

// ---------------------------------------------------------------- primitivas por elemento

test('elementPrimitives: forma com texto dá contorno + texto; hideText omite o texto', () => {
  const { board, shape } = one('rectangle', rect(0, 0), { text: 'A' });
  assert.deepEqual(
    r.elementPrimitives(board, shape).map((p) => p.type),
    ['rect', 'text'],
  );
  assert.deepEqual(
    r.elementPrimitives(board, shape, { hideText: true }).map((p) => p.type),
    ['rect'],
  );
  const text = one('text', rect(0, 0), { text: 'solto' });
  assert.deepEqual(
    r.elementPrimitives(text.board, text.shape).map((p) => p.type),
    ['text'],
  );
  const blank = one('text', rect(0, 0));
  assert.deepEqual(r.elementPrimitives(blank.board, blank.shape), []);
});

test('elementPrimitives: traço vira path com os pontos do quadro; imagem vira image', () => {
  let board = m.addDrawing(m.emptyBoard(), [
    { x: 0, y: 0 },
    { x: 40, y: 30 },
  ], { stroke: '#7c3aed', strokeStyle: 'dotted' }).board;
  board = m.addPicture(board, PNG, rect(5, 6, 7, 8)).board;
  const [path] = r.elementPrimitives(board, board.elements[0]);
  assert.equal(path.type, 'path');
  assert.deepEqual(path.points, [
    { x: 0, y: 0 },
    { x: 40, y: 30 },
  ]);
  assert.equal(path.stroke, '#7c3aed');
  assert.equal(path.dash, r.dashArray('dotted', 2));
  assert.deepEqual(r.elementPrimitives(board, board.elements[1]), [{ type: 'image', x: 5, y: 6, w: 8, h: 8, src: PNG }]);
});

test('elementPrimitives: seta padrão tem uma ponta no fim; both tem duas (uma em cada ponta); none nenhuma', () => {
  let board = m.emptyBoard();
  for (const head of ['end', 'both', 'none']) board = m.addArrow(board, { x: 0, y: 0 }, { x: 100, y: 0 }, m.INK, { head }).board;
  const [end, both, none] = board.elements.map((e) => r.elementPrimitives(board, e));
  assert.deepEqual(
    end.map((p) => p.type),
    ['line', 'polygon'],
  );
  assert.deepEqual(end[1].points[0], { x: 100, y: 0 });
  assert.equal(both.length, 3);
  assert.deepEqual(
    both.slice(1).map((p) => p.points[0]),
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  );
  assert.deepEqual(
    none.map((p) => p.type),
    ['line'],
  );
});

test('elementPrimitives: ponta de seta tracejada é cheia e contínua, na cor do traço', () => {
  const board = m.addArrow(m.emptyBoard(), { x: 0, y: 0 }, { x: 100, y: 0 }, '#b91c1c', { strokeStyle: 'dashed', strokeWidth: 4 }).board;
  const [line, head] = r.elementPrimitives(board, board.elements[0]);
  assert.equal(line.dash, '16 12');
  assert.equal(head.dash, '');
  assert.equal(head.fill, '#b91c1c');
  assert.equal(head.width, 4);
});

test('elementPrimitives: seta presa a forma que sumiu não desenha nada', () => {
  const board = m.emptyBoard();
  const ghost = { id: 'r', kind: 'arrow', start: { shape: 'sumiu' }, end: { x: 0, y: 0 }, stroke: m.INK };
  assert.deepEqual(r.elementPrimitives(board, ghost), []);
  assert.deepEqual(r.elementPrimitives(board, { id: 'x', kind: 'desconhecido' }), []);
});

test('pathData: M no primeiro ponto, L nos demais, números arredondados a 2 casas', () => {
  assert.equal(
    r.pathData([
      { x: 0, y: 0 },
      { x: 1.23456, y: -2.005 },
      { x: NaN, y: Infinity },
    ]),
    'M0 0L1.23 -2L0 0',
  );
  assert.equal(r.pathData([]), '');
});

// ---------------------------------------------------------------- SVG

test('boardToSvg: quadro vazio vira um SVG só com a margem e o fundo', () => {
  const { svg, width, height } = r.boardToSvg(m.emptyBoard());
  assert.deepEqual([width, height], [64, 64]);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="64" height="64" viewBox="-32 -32 64 64"/);
  assert.match(svg, /<rect x="-32" y="-32" width="64" height="64" fill="#ffffff"\/>/);
  assert.ok(svg.endsWith('</svg>\n'));
});

test('boardToSvg: padding 0, fundo nulo e fundo transparente', () => {
  const { board } = one('rectangle', rect(10, 20, 100, 60));
  const tight = r.boardToSvg(board, { padding: 0, background: null });
  assert.deepEqual([tight.width, tight.height], [100, 60]);
  assert.match(tight.svg, /viewBox="10 20 100 60"/);
  assert.ok(!tight.svg.includes('fill="#ffffff"/>'), 'sem retângulo de fundo');
  assert.match(svgOf(board, { background: 'transparent' }), /<rect x="-22" y="-12" width="164" height="124" fill="none"\/>/);
});

test('boardToSvg: largura e altura arredondadas para cima com caixa fracionária', () => {
  const { board } = one('rectangle', { x: 0.3, y: 0.3, w: 10.2, h: 10.7 });
  const { width, height } = r.boardToSvg(board, { padding: 0 });
  assert.deepEqual([width, height], [11, 11]);
});

test('boardToSvg: ids filtra os elementos e o enquadramento', () => {
  let { board } = one('rectangle', rect(0, 0, 100, 60), { text: 'primeiro' });
  const second = m.addShape(board, 'ellipse', rect(1000, 1000, 50, 50), { text: 'segundo' });
  board = second.board;
  const { svg, width } = r.boardToSvg(board, { ids: [second.id], padding: 0 });
  assert.equal(width, 50);
  assert.ok(svg.includes('segundo') && !svg.includes('primeiro'));
  assert.ok(svg.includes('<ellipse') && !svg.includes('<rect x="0"'));
  const none = r.boardToSvg(board, { ids: [] });
  assert.deepEqual([none.width, none.height], [64, 64]);
  assert.ok(!none.svg.includes('<ellipse'));
});

test('boardToSvg: opacidade embrulha o elemento num grupo; opaco não', () => {
  let { board } = one('rectangle', rect(0, 0), { opacity: 25 });
  board = m.addShape(board, 'ellipse', rect(200, 0)).board;
  const svg = svgOf(board);
  assert.equal((svg.match(/<g opacity="0\.25">/g) ?? []).length, 1);
  assert.equal((svg.match(/<g /g) ?? []).length, 1);
});

test('boardToSvg: texto escapa todos os caracteres especiais e linha vazia vira espaço', () => {
  const { board } = one('rectangle', rect(0, 0), { text: `<a href="x">&'</a>\n\nfim` });
  const svg = svgOf(board);
  assert.ok(svg.includes('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'));
  assert.ok(!svg.includes('<a href'));
  assert.equal((svg.match(/<tspan /g) ?? []).length, 3);
  assert.match(svg, /<tspan [^>]*> <\/tspan>/);
  assert.ok(svg.includes('xml:space="preserve"'));
});

test('boardToSvg: fonte mono é escapada no atributo; fonte padrão vem do svg raiz', () => {
  const { board } = one('text', rect(0, 0), { text: 'code', font: 'mono' });
  const svg = svgOf(board);
  assert.ok(svg.includes(`font-family="${r.MONO_FAMILY.replace(/'/g, '&#39;')}"`));
  assert.ok(svg.includes(`font-family="${r.FONT_FAMILY.replace(/'/g, '&#39;')}"`));
  assert.ok(!/font-family="[^"]*'/.test(svg), 'nenhuma aspa simples crua no atributo');
});

test('boardToSvg: segunda barreira — cor, tracejado e imagem inválidos que escaparam do modelo', () => {
  // Elementos montados à mão, sem passar por sanitizeElements.
  const board = {
    ...m.emptyBoard(),
    elements: [
      { id: 'a', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10, text: 'x', stroke: 'red" onload="alert(1)', fill: 'url(#x)' },
      { id: 'b', kind: 'image', x: 0, y: 0, w: 10, h: 10, src: 'javascript:alert(1)' },
      { id: 'c', kind: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { id: 'd', kind: 'arrow', start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, stroke: 'transparent' },
    ],
  };
  const svg = svgOf(board);
  assert.ok(!svg.includes('onload') && !svg.includes('alert') && !svg.includes('url('));
  assert.ok(!svg.includes('<image'));
  assert.ok(svg.includes('stroke="#1a1f26"'), 'cor inválida vira tinta');
  assert.ok(svg.includes('fill="#1a1f26"'), 'texto com cor inválida vira tinta');
  assert.match(svg, /<line [^>]*stroke="none"/, 'transparent vira none');
});

test(
  'boardToSvg: coordenadas não finitas viram 0, sem NaN nem Infinity no arquivo',
  { todo: 'BUG (defesa em profundidade): render.ts:175-176 width/height usam Math.ceil cru, sem n(); um elemento com coordenada não finita (que escapou do modelo) gera width="NaN" e viewBox com NaN no <svg> raiz e no fundo' },
  () => {
  const board = {
    ...m.emptyBoard(),
    elements: [{ id: 'a', kind: 'rectangle', x: NaN, y: Infinity, w: 10, h: -Infinity, text: '', stroke: m.INK, fill: 'transparent' }],
  };
  const svg = svgOf(board);
  assert.ok(!/NaN|Infinity/.test(svg));
  },
);

test('boardToSvg: números com muitas casas saem arredondados e sem notação científica', () => {
  const board = m.addArrow(m.emptyBoard(), { x: 0.000001, y: 1 / 3 }, { x: 123456.789, y: 2 / 3 }).board;
  const svg = svgOf(board);
  assert.ok(!/\d[eE][+-]?\d/.test(svg));
  assert.ok(svg.includes('x1="0" y1="0.33" x2="123456.79" y2="0.67"'));
});

test('boardToSvg: imagem válida usa href e preserveAspectRatio="none"', () => {
  const board = m.addPicture(m.emptyBoard(), PNG, rect(0, 0, 30, 20)).board;
  const svg = svgOf(board);
  assert.ok(svg.includes(`<image x="0" y="0" width="30" height="20" preserveAspectRatio="none" href="${PNG}"/>`));
});

test('boardToSvg: tracejado leva stroke-linecap round; contínuo não', () => {
  let { board } = one('rectangle', rect(0, 0), { strokeStyle: 'dashed' });
  board = m.addShape(board, 'ellipse', rect(200, 0)).board;
  const svg = svgOf(board);
  assert.match(svg, /<rect [^>]*stroke-dasharray="8 6" stroke-linecap="round"/);
  assert.match(svg, /<ellipse [^>]*stroke-width="2" fill="none"\/>/);
});

test('boardToSvg: setas entre formas param na borda e o SVG cobre o enquadramento', () => {
  const a = m.addShape(m.emptyBoard(), 'rectangle', rect(0, 0, 100, 60));
  const b = m.addShape(a.board, 'rectangle', rect(300, 0, 100, 60));
  const board = m.connect(b.board, a.id, b.id).board;
  const svg = svgOf(board, { padding: 0 });
  assert.ok(svg.includes('<line x1="100" y1="30" x2="300" y2="30"'));
  assert.match(svg, /viewBox="0 0 400 60"/);
});

test('boardToSvg: ordem de desenho do quadro é a ordem do SVG', () => {
  const a = m.addShape(m.emptyBoard(), 'rectangle', rect(0, 0), { text: 'baixo' });
  const b = m.addShape(a.board, 'rectangle', rect(0, 0), { text: 'cima' });
  const svg = svgOf(m.reorder(b.board, [a.id], 'front'));
  assert.ok(svg.indexOf('cima') < svg.indexOf('baixo'));
});
