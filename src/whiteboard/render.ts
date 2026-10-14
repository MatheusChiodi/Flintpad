// Do modelo para primitivas de desenho. A tela (React) e a exportação SVG desenham a partir das
// mesmas primitivas, então o arquivo exportado sai igual ao que se vê.
import { arrowSegment, boardBounds, isShape, type Board, type BoardElement, type Point, type Shape } from './model.ts';

export const FONT_FAMILY = "'Instrument Sans Variable', 'Segoe UI', system-ui, sans-serif";
export const LABEL_SIZE = 16;
export const TEXT_SIZE = 20;
export const LINE_HEIGHT = 1.25;
export const STROKE_WIDTH = 2;
const HEAD_LENGTH = 14;
const HEAD_WIDTH = 9;

export type Primitive =
  | { type: 'rect'; x: number; y: number; w: number; h: number; rx: number; stroke: string; fill: string }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; stroke: string; fill: string }
  | { type: 'polygon'; points: Point[]; stroke: string; fill: string }
  | { type: 'line'; a: Point; b: Point; stroke: string }
  | { type: 'text'; x: number; y: number; lines: string[]; size: number; color: string; anchor: 'middle' | 'start' };

export const fontSize = (shape: Shape) => (shape.kind === 'text' ? TEXT_SIZE : LABEL_SIZE);

/** Texto centrado na forma; texto solto começa no canto. `y` é a linha de base da primeira linha. */
export function textPrimitive(shape: Shape): Primitive | null {
  if (!shape.text) return null;
  const size = fontSize(shape);
  const lines = shape.text.split('\n');
  const step = size * LINE_HEIGHT;
  const block = step * lines.length;
  if (shape.kind === 'text') return { type: 'text', x: shape.x, y: shape.y + size, lines, size, color: shape.stroke, anchor: 'start' };
  return {
    type: 'text',
    x: shape.x + shape.w / 2,
    y: shape.y + (shape.h - block) / 2 + size,
    lines,
    size,
    color: shape.stroke,
    anchor: 'middle',
  };
}

export function shapeOutline(shape: Shape): Primitive | null {
  const { x, y, w, h, stroke, fill } = shape;
  if (shape.kind === 'rectangle') return { type: 'rect', x, y, w, h, rx: Math.min(10, w / 4, h / 4), stroke, fill };
  if (shape.kind === 'ellipse') return { type: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, stroke, fill };
  if (shape.kind === 'diamond')
    return {
      type: 'polygon',
      points: [
        { x: x + w / 2, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w / 2, y: y + h },
        { x, y: y + h / 2 },
      ],
      stroke,
      fill,
    };
  return null;
}

export function arrowHead(a: Point, b: Point): Point[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const back = { x: b.x - ux * HEAD_LENGTH, y: b.y - uy * HEAD_LENGTH };
  return [b, { x: back.x - uy * HEAD_WIDTH * 0.5, y: back.y + ux * HEAD_WIDTH * 0.5 }, { x: back.x + uy * HEAD_WIDTH * 0.5, y: back.y - ux * HEAD_WIDTH * 0.5 }];
}

export function elementPrimitives(board: Board, element: BoardElement, options: { hideText?: boolean } = {}): Primitive[] {
  if (isShape(element)) {
    const outline = shapeOutline(element);
    const text = options.hideText ? null : textPrimitive(element);
    return [outline, text].filter((p): p is Primitive => Boolean(p));
  }
  const segment = arrowSegment(board, element);
  if (!segment) return [];
  return [
    { type: 'line', a: segment.a, b: segment.b, stroke: element.stroke },
    { type: 'polygon', points: arrowHead(segment.a, segment.b), stroke: element.stroke, fill: element.stroke },
  ];
}

// ---------------------------------------------------------------- SVG

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Números sempre finitos e curtos: nada de "NaN" ou notação científica no arquivo.
const n = (value: number) => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0');
// As cores já foram validadas no modelo (#rrggbb ou transparent); a checagem aqui é a segunda barreira.
const color = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : value === 'transparent' ? 'none' : '#1a1f26');

function primitiveSvg(p: Primitive): string {
  const paint = (stroke: string, fill: string) => `stroke="${color(stroke)}" stroke-width="${STROKE_WIDTH}" fill="${color(fill)}"`;
  switch (p.type) {
    case 'rect':
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="${n(p.rx)}" ${paint(p.stroke, p.fill)}/>`;
    case 'ellipse':
      return `<ellipse cx="${n(p.cx)}" cy="${n(p.cy)}" rx="${n(p.rx)}" ry="${n(p.ry)}" ${paint(p.stroke, p.fill)}/>`;
    case 'polygon':
      return `<polygon points="${p.points.map((q) => `${n(q.x)},${n(q.y)}`).join(' ')}" stroke-linejoin="round" ${paint(p.stroke, p.fill)}/>`;
    case 'line':
      return `<line x1="${n(p.a.x)}" y1="${n(p.a.y)}" x2="${n(p.b.x)}" y2="${n(p.b.y)}" stroke="${color(p.stroke)}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round"/>`;
    case 'text': {
      const step = p.size * LINE_HEIGHT;
      const spans = p.lines.map((line, i) => `<tspan x="${n(p.x)}" y="${n(p.y + i * step)}">${escapeXml(line) || ' '}</tspan>`).join('');
      return `<text font-size="${n(p.size)}" fill="${color(p.color)}" text-anchor="${p.anchor}" xml:space="preserve">${spans}</text>`;
    }
  }
}

export type SvgOptions = { padding?: number; background?: string | null; ids?: Iterable<string> };

/** O quadro inteiro (ou só os ids pedidos) como um documento SVG independente. */
export function boardToSvg(board: Board, { padding = 32, background = '#ffffff', ids }: SvgOptions = {}): { svg: string; width: number; height: number } {
  const wanted = ids ? new Set(ids) : null;
  const bounds = boardBounds(board, wanted ?? undefined) ?? { x: 0, y: 0, w: 0, h: 0 };
  const width = Math.ceil(bounds.w + padding * 2);
  const height = Math.ceil(bounds.h + padding * 2);
  const body = board.elements
    .filter((e) => !wanted || wanted.has(e.id))
    .map((element) => elementPrimitives(board, element).map(primitiveSvg).join(''))
    .join('\n  ');
  const fill = background ? `\n  <rect x="${n(bounds.x - padding)}" y="${n(bounds.y - padding)}" width="${width}" height="${height}" fill="${color(background)}"/>` : '';
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(bounds.x - padding)} ${n(bounds.y - padding)} ${width} ${height}" font-family="${escapeXml(FONT_FAMILY)}">`,
    `${fill}`,
    `  ${body}`,
    '</svg>',
    '',
  ].join('\n');
  return { svg, width, height };
}
