// Quadro branco, versão 2 do formato: lápis, imagens, estilos, grupos, travas, camadas, alinhamento,
// busca e links. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as m from '../src/whiteboard/model.ts';
import { boardToSvg, dashArray, elementPrimitives } from '../src/whiteboard/render.ts';

const rect = (x, y, w = 100, h = 60) => ({ x, y, w, h });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
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
const roundTrip = (board) => {
  const parsed = m.parseBoard(m.serializeBoard(board));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.dropped, 0);
  return parsed.board;
};

test('versão 2: arquivo v1 é migrado sem perder nada; v3 é recusado', () => {
  const v1 = { format: m.BOARD_FORMAT, version: 1, view: { x: 0, y: 0, zoom: 1 }, elements: [{ id: 'a', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10, text: '', stroke: '#1a1f26', fill: 'transparent' }] };
  const result = m.parseBoard(JSON.stringify(v1));
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.board.version, 2);
  assert.equal(result.board.elements.length, 1);
  assert.deepEqual(m.parseBoard(JSON.stringify({ ...v1, version: 3 })), { ok: false, error: 'newer-version' });
});

test('lápis: pontos normalizados na caixa, ida e volta pelo arquivo e redimensionar escala o traço', () => {
  const gesture = [{ x: 10, y: 10 }, { x: 10.5, y: 10.2 }, { x: 60, y: 30 }, { x: 110, y: 110 }];
  const result = m.addDrawing(m.emptyBoard(), gesture, { stroke: '#1d4ed8' });
  const drawing = result.board.elements[0];
  assert.equal(drawing.kind, 'draw');
  assert.deepEqual([drawing.x, drawing.y, drawing.w, drawing.h], [10, 10, 100, 100]);
  // O ponto a 0,5 px do anterior foi descartado.
  assert.equal(drawing.points.length, 6);
  assert.ok(drawing.points.every((n) => n >= 0 && n <= 1));
  assert.deepEqual(roundTrip(result.board), result.board);
  const resized = m.resizeShape(result.board, result.id, rect(0, 0, 200, 200));
  assert.deepEqual(m.drawingPoints(resized.elements[0]).at(-1), { x: 200, y: 200 });
  // Acerto pelo traço, não pela caixa vazia.
  assert.equal(m.hitTest(result.board, { x: 60, y: 31 }), result.id);
  assert.equal(m.hitTest(result.board, { x: 100, y: 20 }), null);
  // Um traço reto ganha a altura mínima, centrado.
  const flat = m.drawingFromPoints([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
  assert.deepEqual([flat.y, flat.h], [50 - m.MIN_SIZE / 2, m.MIN_SIZE]);
  assert.equal(m.drawingFromPoints([{ x: NaN, y: 1 }]), null);
  // Muitos pontos são reduzidos ao limite.
  const many = Array.from({ length: 5000 }, (_, i) => ({ x: i * 2, y: Math.sin(i) * 50 }));
  assert.ok(m.drawingFromPoints(many).points.length <= m.MAX_POINTS * 2);
});

test('validação v2: traço, imagem e estilo inválidos são descartados ou neutralizados', () => {
  const doc = {
    format: m.BOARD_FORMAT,
    version: 2,
    elements: [
      { id: 'd1', kind: 'draw', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 2, -1], stroke: 'red' },
      { id: 'd2', kind: 'draw', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 1] },
      { id: 'i1', kind: 'image', x: 0, y: 0, w: 10, h: 10, src: PNG },
      { id: 'i2', kind: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=' },
      { id: 'i3', kind: 'image', x: 0, y: 0, w: 10, h: 10, src: 'https://example.com/a.png' },
      { id: 's1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10, strokeWidth: 3, strokeStyle: 'wavy', opacity: 0, fontSize: 99, font: 'comic', group: 'g 1', locked: 'yes', link: 'javascript:alert(1)' },
      { id: 's2', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10, strokeWidth: 4, strokeStyle: 'dotted', opacity: 50, fontSize: 28, font: 'mono', group: 'g1', locked: true, link: '[[Ideias]]' },
      { id: 'a1', kind: 'arrow', start: { shape: 's1' }, end: { shape: 'i1' } },
      { id: 'a2', kind: 'arrow', start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, head: 'both' },
    ],
  };
  const result = m.parseBoard(JSON.stringify(doc));
  assert.equal(result.ok, true);
  const byId = Object.fromEntries(result.board.elements.map((e) => [e.id, e]));
  assert.deepEqual(byId.d1.points, [0, 0, 1, 0]);
  assert.equal(byId.d1.stroke, m.INK);
  assert.equal(byId.d2, undefined);
  assert.equal(byId.i1.src, PNG);
  assert.equal(byId.i2, undefined, 'SVG embutido pode ter script');
  assert.equal(byId.i3, undefined, 'nada de imagem da rede');
  assert.deepEqual(Object.keys(byId.s1).sort(), ['fill', 'h', 'id', 'kind', 'opacity', 'stroke', 'text', 'w', 'x', 'y']);
  assert.equal(byId.s1.opacity, 10);
  assert.deepEqual(
    [byId.s2.strokeWidth, byId.s2.strokeStyle, byId.s2.opacity, byId.s2.fontSize, byId.s2.font, byId.s2.group, byId.s2.locked, byId.s2.link],
    [4, 'dotted', 50, 28, 'mono', 'g1', true, 'Ideias'],
  );
  assert.equal(byId.a1, undefined, 'seta não se prende a imagem');
  assert.equal(byId.a2.head, 'both');
  assert.equal(result.dropped, 4);
});

test('links: só http(s) ou nota do vault; resolve por caminho ou nome', () => {
  assert.equal(m.sanitizeLink('https://obnotion.app/x?y=1'), 'https://obnotion.app/x?y=1');
  assert.equal(m.sanitizeLink('  [[Projetos/Plano]] '), 'Projetos/Plano');
  for (const bad of ['javascript:alert(1)', 'file:///C:/x', 'C:\\Windows\\x.md', '../fora.md', 'Notas/../../x', 'https://a b', 42, '']) assert.equal(m.sanitizeLink(bad), '', String(bad));
  const notes = [
    { path: 'Projetos/Plano.md', name: 'Plano' },
    { path: 'Diário/2026-10-14.md', name: '2026-10-14' },
  ];
  assert.deepEqual(m.resolveLink('Projetos/Plano.md', notes), { type: 'note', path: 'Projetos/Plano.md' });
  assert.deepEqual(m.resolveLink('projetos/plano', notes), { type: 'note', path: 'Projetos/Plano.md' });
  assert.deepEqual(m.resolveLink('[[2026-10-14]]', notes), { type: 'note', path: 'Diário/2026-10-14.md' });
  assert.deepEqual(m.resolveLink('Plano#Metas', notes), { type: 'note', path: 'Projetos/Plano.md' });
  assert.deepEqual(m.resolveLink('https://example.com', notes), { type: 'url', url: 'https://example.com' });
  assert.equal(m.resolveLink('Inexistente', notes), null);
  assert.equal(m.resolveLink('javascript:x', notes), null);
});

test('estilos: aplicar só o que cabe em cada tipo; padrão não é gravado', () => {
  let { board, ids } = build(['rectangle', rect(0, 0)], ['text', rect(0, 100, 40, 28), { text: 'oi' }]);
  const arrow = m.addArrow(board, { shape: ids[0] }, { x: 300, y: 0 });
  board = arrow.board;
  const picture = m.addPicture(board, PNG, rect(500, 0));
  board = picture.board;
  const all = [...ids, arrow.id, picture.id];
  board = m.updateElements(board, all, { strokeWidth: 4, strokeStyle: 'dashed', opacity: 50, fontSize: 28, font: 'mono', head: 'both' });
  const [shape, text, line, image] = board.elements;
  assert.deepEqual([shape.strokeWidth, shape.strokeStyle, shape.opacity, shape.fontSize, shape.font, shape.head], [4, 'dashed', 50, 28, 'mono', undefined]);
  assert.equal(text.fontSize, 28);
  assert.deepEqual([line.strokeWidth, line.head, line.fontSize], [4, 'both', undefined]);
  assert.deepEqual([image.strokeWidth, image.opacity], [undefined, 50]);
  // Voltar ao padrão tira a propriedade do arquivo.
  board = m.updateElements(board, all, { strokeWidth: 2, strokeStyle: 'solid', opacity: 100, fontSize: null, font: 'sans', head: 'end' });
  for (const element of board.elements) for (const key of ['strokeWidth', 'strokeStyle', 'opacity', 'fontSize', 'font', 'head']) assert.equal(key in element, false, key);
  // Valores fora da lista são ignorados; nada muda, o mesmo objeto volta.
  assert.equal(m.updateElements(board, all, { strokeWidth: 7, strokeStyle: 'wavy', fontSize: 13 }), board);
  assert.deepEqual(roundTrip(board), board);
});

test('estilos chegam ao SVG: tracejado, espessura, opacidade, pontas, fonte mono e imagem', () => {
  let { board, ids } = build(['rectangle', rect(0, 0), { text: 'x' }]);
  board = m.updateElements(board, ids, { strokeStyle: 'dashed', strokeWidth: 4, opacity: 50, font: 'mono' });
  const arrow = m.addArrow(board, { x: 0, y: 200 }, { x: 200, y: 200 }, '#1d4ed8', { head: 'both' });
  board = arrow.board;
  board = m.addPicture(board, PNG, rect(300, 0)).board;
  board = m.addDrawing(board, [{ x: 0, y: 300 }, { x: 50, y: 330 }]).board;
  const { svg } = boardToSvg(board);
  assert.match(svg, /<g opacity="0.5"><rect [^>]*stroke-width="4" stroke-dasharray="16 12"/);
  assert.match(svg, /font-family="&#39;JetBrains Mono Variable/);
  assert.equal((svg.match(/<polygon /g) ?? []).length, 2, 'duas pontas');
  assert.match(svg, /<image [^>]*href="data:image\/png;base64,/);
  assert.match(svg, /<path d="M0 300L50 330"/);
  const none = m.updateElements(board, [arrow.id], { head: 'none' });
  assert.equal(elementPrimitives(none, none.elements.find((e) => e.id === arrow.id)).length, 1);
  assert.equal(dashArray('solid', 2), '');
  assert.equal(dashArray('dotted', 2), '0 5');
});

test('grupos: selecionar um seleciona todos; duplicar cria grupo novo; desagrupar solta todos', () => {
  let { board, ids } = build(['rectangle', rect(0, 0)], ['ellipse', rect(200, 0)], ['diamond', rect(400, 0)]);
  const grouped = m.groupElements(board, [ids[0], ids[1]]);
  board = grouped.board;
  assert.ok(grouped.group);
  assert.deepEqual(m.withGroups(board, [ids[1]]), [ids[0], ids[1]]);
  assert.deepEqual(m.withGroups(board, [ids[2]]), [ids[2]]);
  assert.equal(m.groupElements(board, [ids[2]]).group, null, 'um elemento só não vira grupo');
  const copy = m.duplicateElements(board, m.withGroups(board, [ids[0]]));
  const copies = copy.board.elements.filter((e) => copy.ids.includes(e.id));
  assert.equal(new Set(copies.map((e) => e.group)).size, 1);
  assert.notEqual(copies[0].group, grouped.group);
  board = m.ungroupElements(board, [ids[0]]);
  assert.ok(board.elements.every((e) => !('group' in e)));
  assert.equal(m.ungroupElements(board, [ids[0]]), board);
});

test('travas: travado fica fora das operações; a cópia sai destravada', () => {
  let { board, ids } = build(['rectangle', rect(0, 0)], ['ellipse', rect(200, 0)]);
  board = m.updateElements(board, [ids[0]], { locked: true });
  assert.equal(board.elements[0].locked, true);
  assert.deepEqual(m.unlockedIds(board, ids), [ids[1]]);
  const copy = m.duplicateElements(board, [ids[0]]);
  assert.equal(copy.board.elements.at(-1).locked, undefined);
  board = m.updateElements(board, [ids[0]], { locked: false });
  assert.equal('locked' in board.elements[0], false);
});

test('camadas: um passo e direto para o topo/fundo, mantendo a ordem relativa', () => {
  const { board, ids } = build(['rectangle', rect(0, 0)], ['rectangle', rect(0, 0)], ['rectangle', rect(0, 0)], ['rectangle', rect(0, 0)]);
  const order = (b) => b.elements.map((e) => ids.indexOf(e.id));
  assert.deepEqual(order(m.reorder(board, [ids[0], ids[1]], 'front')), [2, 3, 0, 1]);
  assert.deepEqual(order(m.reorder(board, [ids[3]], 'back')), [3, 0, 1, 2]);
  assert.deepEqual(order(m.reorder(board, [ids[1]], 'forward')), [0, 2, 1, 3]);
  assert.deepEqual(order(m.reorder(board, [ids[2]], 'backward')), [0, 2, 1, 3]);
  assert.equal(m.reorder(board, [ids[3]], 'forward'), board, 'já no topo: nada muda');
  assert.equal(m.reorder(board, [ids[3]], 'front'), board);
});

test('alinhar e distribuir: blocos (grupos contam como um) e espaços iguais', () => {
  let { board, ids } = build(['rectangle', rect(0, 0, 100, 50)], ['rectangle', rect(300, 40, 50, 50)], ['rectangle', rect(120, 200, 80, 20)]);
  const left = m.alignElements(board, ids, 'left');
  assert.deepEqual(left.elements.map((e) => e.x), [0, 0, 0]);
  const right = m.alignElements(board, ids, 'right');
  assert.deepEqual(right.elements.map((e) => e.x + e.w), [350, 350, 350]);
  const middle = m.alignElements(board, ids, 'vcenter');
  assert.deepEqual(middle.elements.map((e) => e.y + e.h / 2), [110, 110, 110]);
  assert.equal(m.alignElements(board, [ids[0]], 'left'), board, 'um bloco só: nada muda');
  const spread = m.distributeElements(board, ids, 'horizontal');
  const sorted = spread.elements.map((e) => [e.x, e.x + e.w]).sort((a, b) => a[0] - b[0]);
  assert.equal(sorted[1][0] - sorted[0][1], sorted[2][0] - sorted[1][1]);
  assert.deepEqual([sorted[0][0], sorted[2][1]], [0, 350], 'as pontas ficam no lugar');
  // Um grupo se move junto ao alinhar.
  board = m.groupElements(board, [ids[0], ids[2]]).board;
  const top = m.alignElements(board, ids, 'top');
  assert.deepEqual(top.elements.map((e) => e.y), [0, 0, 200]);
});

test('busca: texto e link, sem caixa nem acentos', () => {
  let { board, ids } = build(['rectangle', rect(0, 0), { text: 'Revisão do Código' }], ['text', rect(0, 0), { text: 'outra coisa' }], ['ellipse', rect(0, 0)]);
  board = m.updateElements(board, [ids[2]], { link: 'Projetos/Revisao' });
  assert.deepEqual(m.searchElements(board, 'revisao'), [ids[0], ids[2]]);
  assert.deepEqual(m.searchElements(board, 'CÓDIGO'), [ids[0]]);
  assert.deepEqual(m.searchElements(board, '   '), []);
});

test('pontas de seta: religar a outra forma ou soltar; nunca na mesma forma das duas pontas', () => {
  let { board, ids } = build(['rectangle', rect(0, 0)], ['ellipse', rect(300, 0)], ['diamond', rect(0, 300)]);
  const arrow = m.connect(board, ids[0], ids[1]);
  board = arrow.board;
  const moved = m.setArrowEnd(board, arrow.id, 'end', { shape: ids[2] });
  assert.deepEqual(moved.elements.at(-1).end, { shape: ids[2] });
  assert.equal(m.setArrowEnd(board, arrow.id, 'end', { shape: ids[0] }), board);
  assert.equal(m.setArrowEnd(board, arrow.id, 'end', { shape: 'nada' }), board);
  const free = m.setArrowEnd(board, arrow.id, 'start', { x: -50, y: -50 });
  assert.deepEqual(free.elements.at(-1).start, { x: -50, y: -50 });
});

test('restrições com Shift e grade', () => {
  assert.deepEqual(m.constrainSquare({ x: 0, y: 0 }, { x: -30, y: 10 }), { x: -30, y: 30 });
  const angled = m.constrainAngle({ x: 0, y: 0 }, { x: 100, y: 4 });
  assert.ok(Math.abs(angled.y) < 1e-9 && Math.abs(angled.x - Math.hypot(100, 4)) < 1e-9);
  assert.deepEqual(m.constrainAxis(5, -12), { dx: 0, dy: -12 });
  assert.deepEqual(m.constrainRatio({ x: 0, y: 0 }, { x: 100, y: 10 }, 2), { x: 100, y: 50 });
  assert.deepEqual(m.constrainRatio({ x: 0, y: 0 }, { x: -10, y: -40 }, 2), { x: -80, y: -40 });
  assert.deepEqual(m.constrainRatio({ x: 0, y: 0 }, { x: 5, y: 5 }, NaN), { x: 5, y: 5 });
  assert.equal(m.snapToGrid(37, 24), 48);
  assert.equal(m.snapToGrid(-13, 24), -24);
  assert.equal(m.snapToGrid(7, 0), 7);
});

test('imagem: só data URL raster dentro do limite', () => {
  assert.equal(m.sanitizeImageSrc(PNG), PNG);
  assert.equal(m.sanitizeImageSrc('data:image/png;base64,abc"onload="x'), '');
  assert.equal(m.sanitizeImageSrc(`data:image/png;base64,${'A'.repeat(m.MAX_IMAGE_CHARS)}`), '');
  assert.equal(m.addPicture(m.emptyBoard(), 'data:text/html;base64,AAAA', rect(0, 0)), null);
  const result = m.addPicture(m.emptyBoard(), PNG, rect(0, 0, 40, 30));
  assert.equal(m.hitTest(result.board, { x: 20, y: 15 }), result.id);
  assert.deepEqual(roundTrip(result.board), result.board);
});
