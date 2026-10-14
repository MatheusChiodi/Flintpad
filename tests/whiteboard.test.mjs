// Quadro branco (src/whiteboard): modelo, migração, validação, exportação SVG e nomes de arquivo. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as f from '../src/whiteboard/files.ts';
import * as m from '../src/whiteboard/model.ts';
import { boardToSvg } from '../src/whiteboard/render.ts';
import { sampleBoard } from '../src/whiteboard/sample.ts';

const rect = (x, y, w = 100, h = 60) => ({ x, y, w, h });
const twoShapes = () => {
  const a = m.addShape(m.emptyBoard(), 'rectangle', rect(0, 0), { text: 'A' });
  const b = m.addShape(a.board, 'ellipse', rect(300, 0), { text: 'B' });
  return { board: b.board, a: a.id, b: b.id };
};
const labels = { note: 'n', draft: 'd', review: 'r', approved: 'ok', publish: 'p', fix: 'f' };

test('fluxo principal: criar, ligar, mover, gravar e reabrir sem perder nada', () => {
  let { board, a, b } = twoShapes();
  const arrow = m.connect(board, a, b);
  board = arrow.board;
  board = m.moveElements(board, [a], 40, 120);
  const reopened = m.parseBoard(m.serializeBoard(board));
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.board, board);
  assert.equal(reopened.migrated, false);
  assert.equal(reopened.dropped, 0);
  const moved = m.findShape(reopened.board, a);
  assert.deepEqual([moved.x, moved.y], [40, 120]);
  const segment = m.arrowSegment(reopened.board, reopened.board.elements.find((e) => e.id === arrow.id));
  // A seta acompanha a forma movida: sai da borda de A e chega na borda de B.
  assert.ok(m.containsPoint(moved, segment.a, 0.01));
  assert.ok(m.containsPoint(m.findShape(board, b), segment.b, 0.01));
});

test('arquivo vazio vira quadro vazio; o formato tem versão', () => {
  const result = m.parseBoard('  ');
  assert.equal(result.ok, true);
  assert.deepEqual(result.board, m.emptyBoard());
  assert.equal(JSON.parse(m.serializeBoard(m.emptyBoard())).version, m.BOARD_VERSION);
  assert.equal(JSON.parse(m.serializeBoard(m.emptyBoard())).format, m.BOARD_FORMAT);
});

test('parseBoard recusa o que não é quadro, com o motivo', () => {
  assert.deepEqual(m.parseBoard('{nope'), { ok: false, error: 'invalid-json' });
  assert.deepEqual(m.parseBoard('[]'), { ok: false, error: 'not-a-board' });
  assert.deepEqual(m.parseBoard('{"type":"excalidraw","elements":[]}'), { ok: false, error: 'not-a-board' });
  assert.deepEqual(m.parseBoard(JSON.stringify({ format: m.BOARD_FORMAT, version: 99, elements: [] })), { ok: false, error: 'newer-version' });
  assert.deepEqual(m.parseBoard(JSON.stringify({ format: m.BOARD_FORMAT, version: 1.5 })), { ok: false, error: 'not-a-board' });
  assert.deepEqual(m.parseBoard(' '.repeat(m.MAX_BOARD_BYTES + 1) + '{}'), { ok: false, error: 'too-large' });
  const many = Array.from({ length: m.MAX_ELEMENTS + 1 }, (_, i) => ({ id: `s${i}`, kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }));
  assert.deepEqual(m.parseBoard(JSON.stringify({ format: m.BOARD_FORMAT, version: 1, elements: many })), { ok: false, error: 'too-many-elements' });
});

test('migração: arquivo sem versão (setas com from/to) sobe para a versão atual', () => {
  const legacy = {
    format: m.BOARD_FORMAT,
    elements: [
      { id: 'a', kind: 'rectangle', x: 0, y: 0, w: 50, h: 50, text: 'A' },
      { id: 'b', kind: 'rectangle', x: 200, y: 0, w: 50, h: 50, text: 'B' },
      { id: 'c', kind: 'arrow', from: 'a', to: 'b' },
      { id: 'd', kind: 'arrow', from: 'a', to: { x: 10, y: 300 } },
    ],
  };
  const result = m.parseBoard(JSON.stringify(legacy));
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.board.version, m.BOARD_VERSION);
  assert.deepEqual(result.board.view, { x: 0, y: 0, zoom: 1 });
  const [, , c, d] = result.board.elements;
  assert.deepEqual([c.start, c.end], [{ shape: 'a' }, { shape: 'b' }]);
  assert.deepEqual([d.start, d.end], [{ shape: 'a' }, { x: 10, y: 300 }]);
});

test('validação: descarta o inválido e neutraliza o perigoso', () => {
  const doc = {
    format: m.BOARD_FORMAT,
    version: 1,
    view: { x: 'x', y: 5, zoom: 999 },
    elements: [
      { id: 'ok', kind: 'rectangle', x: 1, y: 2, w: 3, h: 40, text: 'oi\u0000\r\nlá', stroke: 'red" onload="x', fill: '#ABCDEF' },
      { id: 'ok', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 },
      { id: 'bad id!', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 },
      { id: 'nan', kind: 'ellipse', x: null, y: 0, w: 10, h: 10 },
      { id: 'zero', kind: 'ellipse', x: 0, y: 0, w: 0, h: 10 },
      { id: 'what', kind: 'image', x: 0, y: 0, w: 10, h: 10 },
      { id: 'far', kind: 'text', x: 1e12, y: -1e12, w: 10, h: 10, text: 'x'.repeat(m.MAX_TEXT + 50) },
      { id: 'dangling', kind: 'arrow', start: { shape: 'ghost' }, end: { x: 0, y: 0 } },
      { id: 'self', kind: 'arrow', start: { shape: 'ok' }, end: { shape: 'ok' } },
      { id: 'later', kind: 'arrow', start: { shape: 'ok' }, end: { shape: 'after' } },
      { id: 'after', kind: 'diamond', x: 0, y: 100, w: 20, h: 20 },
    ],
  };
  const result = m.parseBoard(JSON.stringify(doc));
  assert.equal(result.ok, true);
  assert.deepEqual(result.board.elements.map((e) => e.id), ['ok', 'far', 'later', 'after']);
  assert.equal(result.dropped, 7);
  const [ok, far] = result.board.elements;
  assert.equal(ok.text, 'oi\nlá');
  assert.equal(ok.stroke, m.INK);
  assert.equal(ok.fill, '#abcdef');
  assert.equal(ok.w, m.MIN_SIZE);
  assert.equal(far.x, 1_000_000);
  assert.equal(far.y, -1_000_000);
  assert.equal(far.text.length, m.MAX_TEXT);
  assert.deepEqual(result.board.view, { x: 0, y: 5, zoom: m.MAX_ZOOM });
});

test('setas: não ligam uma forma a ela mesma e não duplicam a mesma ligação', () => {
  const { board, a, b } = twoShapes();
  assert.equal(m.connect(board, a, a), null);
  assert.equal(m.addArrow(board, { shape: a }, { shape: 'ghost' }), null);
  const first = m.connect(board, a, b);
  const again = m.connect(first.board, a, b);
  assert.equal(again.id, first.id);
  assert.equal(again.board, first.board);
  assert.notEqual(m.connect(first.board, b, a).id, first.id);
});

test('mover: pontas presas acompanham a forma; pontas soltas só se a seta estiver selecionada', () => {
  const { board: base, a } = twoShapes();
  const free = m.addArrow(base, { shape: a }, { x: 50, y: 300 });
  const board = free.board;
  const movedShape = m.moveElements(board, [a], 10, 0);
  const arrowAfterShape = movedShape.elements.find((e) => e.id === free.id);
  assert.deepEqual(arrowAfterShape.end, { x: 50, y: 300 });
  const movedArrow = m.moveElements(board, [free.id], 10, 5);
  assert.deepEqual(movedArrow.elements.find((e) => e.id === free.id).end, { x: 60, y: 305 });
  assert.equal(m.moveElements(board, [a], 0, 0), board);
  assert.equal(m.moveElements(board, [], 5, 5), board);
});

test('apagar forma solta a ponta da seta onde estava; apagar as duas formas apaga a seta', () => {
  const { board: base, a, b } = twoShapes();
  const { board, id } = m.connect(base, a, b);
  const segment = m.arrowSegment(board, board.elements.find((e) => e.id === id));
  const withoutB = m.deleteElements(board, [b]);
  const arrow = withoutB.elements.find((e) => e.id === id);
  assert.deepEqual(arrow.start, { shape: a });
  assert.deepEqual(arrow.end, segment.b);
  assert.equal(m.deleteElements(board, [a, b]).elements.length, 0);
  assert.equal(m.deleteElements(board, ['nada']), board);
});

test('duplicar: as cópias ganham ids novos e a seta copiada liga as cópias', () => {
  const { board: base, a, b } = twoShapes();
  const { board, id } = m.connect(base, a, b);
  const copy = m.duplicateElements(board, [a, b, id], 24);
  assert.equal(copy.ids.length, 3);
  assert.equal(copy.board.elements.length, 6);
  const [ca, cb, carrow] = copy.ids.map((cid) => copy.board.elements.find((e) => e.id === cid));
  assert.ok(![a, b, id].includes(ca.id));
  assert.deepEqual([ca.x, ca.y], [24, 24]);
  assert.deepEqual([carrow.start, carrow.end], [{ shape: ca.id }, { shape: cb.id }]);
});

test('redimensionar respeita o tamanho mínimo; editar texto e cor valida a entrada', () => {
  const { board, a } = twoShapes();
  const small = m.resizeShape(board, a, rect(5, 5, 1, 2));
  assert.deepEqual([m.findShape(small, a).w, m.findShape(small, a).h], [m.MIN_SIZE, m.MIN_SIZE]);
  const styled = m.updateElements(board, [a], { stroke: 'javascript:alert(1)', fill: '#0C6C64', text: 'novo' });
  assert.equal(m.findShape(styled, a).stroke, m.INK);
  assert.equal(m.findShape(styled, a).fill, '#0c6c64');
  assert.equal(m.findShape(styled, a).text, 'novo');
  assert.equal(m.updateElements(board, [a], { text: 'A' }), board);
});

test('geometria: borda de cada forma e acerto do clique', () => {
  const box = { id: 'r', kind: 'rectangle', x: 0, y: 0, w: 100, h: 50, text: '', stroke: m.INK, fill: 'transparent' };
  assert.deepEqual(m.borderPoint(box, { x: 500, y: 25 }), { x: 100, y: 25 });
  assert.deepEqual(m.borderPoint({ ...box, kind: 'ellipse' }, { x: 50, y: 500 }), { x: 50, y: 50 });
  const diamond = m.borderPoint({ ...box, kind: 'diamond', w: 100, h: 100 }, { x: 500, y: 500 });
  assert.ok(Math.abs(diamond.x - 75) < 1e-9 && Math.abs(diamond.y - 75) < 1e-9);
  assert.deepEqual(m.borderPoint(box, { x: 50, y: 25 }), { x: 50, y: 25 });

  const { board: base, a, b } = twoShapes();
  const { board, id } = m.connect(base, a, b);
  assert.equal(m.hitTest(board, { x: 50, y: 30 }), a);
  assert.equal(m.hitTest(board, { x: 200, y: 33 }), id);
  assert.equal(m.hitTest(board, { x: 200, y: 200 }), null);
  const over = m.addShape(board, 'rectangle', rect(20, 10, 40, 40));
  assert.equal(m.hitTest(over.board, { x: 30, y: 20 }), over.id);
  assert.deepEqual(m.elementsInRect(board, rect(-5, -5, 120, 80)), [a]);
});

test('área de transferência: ida e volta com ids novos; texto comum não é elemento', () => {
  const { board: base, a, b } = twoShapes();
  const { board, id } = m.connect(base, a, b);
  const text = m.clipboardText(board, [a, b, id]);
  const elements = m.parseClipboard(text);
  assert.equal(elements.length, 3);
  const pasted = m.insertElements(board, elements, 10, 10);
  assert.equal(pasted.board.elements.length, 6);
  assert.ok(pasted.ids.every((pid) => ![a, b, id].includes(pid)));
  assert.equal(m.parseClipboard('olá'), null);
  assert.equal(m.parseClipboard('{"type":"outra-coisa","elements":[]}'), null);
  assert.equal(m.parseClipboard('{quebrado'), null);
});

test('vista: zoom mantém o ponto sob o cursor e enquadrar cabe na tela', () => {
  const view = { x: 10, y: 20, zoom: 1 };
  const next = m.zoomAt(view, 2, { x: 110, y: 120 });
  assert.equal((110 - next.x) / next.zoom, 100);
  assert.equal((120 - next.y) / next.zoom, 100);
  assert.equal(m.zoomAt(view, 100, { x: 0, y: 0 }).zoom, m.MAX_ZOOM);
  const fit = m.fitView(rect(0, 0, 2000, 1000), 1000, 600, 0);
  assert.equal(fit.zoom, 0.5);
  assert.deepEqual(m.fitView(null, 100, 100), { x: 0, y: 0, zoom: 1 });
});

test('SVG exportado: escapa texto, só usa cores validadas e não tem NaN', () => {
  let board = m.addShape(m.emptyBoard(), 'rectangle', rect(0, 0), { text: '<script>alert("x")</script> & </text>' }).board;
  board = m.addShape(board, 'text', rect(200, 0, 50, 20), { text: 'linha 1\nlinha 2' }).board;
  const [r] = board.elements;
  board = m.connect(board, r.id, board.elements[1].id).board;
  // Mesmo que algo escape da validação, a cor não vira atributo novo.
  board.elements[0] = { ...board.elements[0], stroke: '"/><script>' };
  const { svg, width, height } = boardToSvg(board);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(!svg.includes('<script'));
  assert.ok(svg.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;/text&gt;'));
  assert.ok(!svg.includes('NaN'));
  assert.ok(svg.includes('<line'));
  assert.equal((svg.match(/<tspan/g) ?? []).length, 3);
  assert.ok(width > 250 && height > 60);
  const empty = boardToSvg(m.emptyBoard());
  assert.ok(empty.svg.includes('<svg') && !empty.svg.includes('NaN'));
});

test('nomes de arquivo: seguros no Windows, únicos e com a extensão do quadro', () => {
  assert.equal(f.sanitizeName('  a/b\\c:d*e?"f<g>h|  '), 'abcdefgh');
  assert.equal(f.sanitizeName('..oculto.'), 'oculto');
  assert.equal(f.sanitizeName('///'), '');
  assert.equal(f.sanitizeName('x'.repeat(300)).length, 120);
  assert.equal(f.uniqueName('Quadro', ['quadro', 'Quadro 2']), 'Quadro 3');
  assert.equal(f.uniqueName('Novo', ['Outro']), 'Novo');
  assert.equal(f.isBoardPath('Whiteboards/Plano.whiteboard.json'), true);
  assert.equal(f.isBoardPath('package.json'), false);
  assert.equal(f.boardName('Whiteboards/Plano.whiteboard.json'), 'Plano');
  assert.equal(f.boardFolder('Whiteboards/Plano.whiteboard.json'), 'Whiteboards/');
  assert.equal(f.importedName('Plano.whiteboard.json'), 'Plano');
  assert.equal(f.importedName('Diagrama.JSON'), 'Diagrama');
});

test('quadro de exemplo: marcado como exemplo, válido e com setas ligadas', () => {
  const board = sampleBoard(labels);
  assert.equal(board.sample, true);
  const reopened = m.parseBoard(m.serializeBoard(board));
  assert.equal(reopened.ok, true);
  assert.equal(reopened.dropped, 0);
  assert.equal(reopened.board.sample, true);
  const arrows = board.elements.filter((e) => e.kind === 'arrow');
  assert.equal(arrows.length, 4);
  assert.ok(arrows.every((e) => 'shape' in e.start && 'shape' in e.end));
});
