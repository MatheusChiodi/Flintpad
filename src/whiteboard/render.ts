// Do modelo para primitivas de desenho. A tela (React) e a exportação SVG desenham a partir das
// mesmas primitivas, então o arquivo exportado sai igual ao que se vê.
import {
  arrowSegment,
  boardBounds,
  DEFAULT_STROKE_WIDTH,
  drawingPoints,
  isArrow,
  isDrawing,
  isPicture,
  isShape,
  sanitizeImageSrc,
  type Board,
  type BoardElement,
  type Point,
  type Shape,
  type StrokeStyle,
} from './model.ts';

export const FONT_FAMILY = "'Instrument Sans Variable', 'Segoe UI', system-ui, sans-serif";
export const MONO_FAMILY = "'JetBrains Mono Variable', Consolas, 'Courier New', monospace";
export const LABEL_SIZE = 16;
export const TEXT_SIZE = 20;
export const LINE_HEIGHT = 1.25;
export const STROKE_WIDTH = DEFAULT_STROKE_WIDTH;
const HEAD_LENGTH = 14;
const HEAD_WIDTH = 9;

/** Traço: espessura e tracejado (`dash` vazio = contínuo). */
export type Line = { width: number; dash: string };

export type Primitive =
  | ({ type: 'rect'; x: number; y: number; w: number; h: number; rx: number; stroke: string; fill: string } & Line)
  | ({ type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; stroke: string; fill: string } & Line)
  | ({ type: 'polygon'; points: Point[]; stroke: string; fill: string } & Line)
  | ({ type: 'line'; a: Point; b: Point; stroke: string } & Line)
  | ({ type: 'path'; points: Point[]; stroke: string } & Line)
  | { type: 'image'; x: number; y: number; w: number; h: number; src: string }
  | { type: 'text'; x: number; y: number; lines: string[]; size: number; color: string; anchor: 'middle' | 'start'; mono: boolean };

export const fontSize = (shape: Shape) => shape.fontSize ?? (shape.kind === 'text' ? TEXT_SIZE : LABEL_SIZE);
export const fontFamily = (shape: Shape) => (shape.font === 'mono' ? MONO_FAMILY : FONT_FAMILY);

/** Tracejado proporcional à espessura. */
export function dashArray(style: StrokeStyle | undefined, width: number): string {
  if (style === 'dashed') return `${width * 4} ${width * 3}`;
  if (style === 'dotted') return `0 ${width * 2.5}`;
  return '';
}

export const lineOf = (element: BoardElement): Line => {
  const width = element.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  return { width, dash: dashArray(element.strokeStyle, width) };
};

/** Texto centrado na forma; texto solto começa no canto. `y` é a linha de base da primeira linha. */
export function textPrimitive(shape: Shape): Primitive | null {
  if (!shape.text) return null;
  const size = fontSize(shape);
  const lines = shape.text.split('\n');
  const step = size * LINE_HEIGHT;
  const block = step * lines.length;
  const mono = shape.font === 'mono';
  if (shape.kind === 'text') return { type: 'text', x: shape.x, y: shape.y + size, lines, size, color: shape.stroke, anchor: 'start', mono };
  return {
    type: 'text',
    x: shape.x + shape.w / 2,
    y: shape.y + (shape.h - block) / 2 + size,
    lines,
    size,
    color: shape.stroke,
    anchor: 'middle',
    mono,
  };
}

export function shapeOutline(shape: Shape): Primitive | null {
  const { x, y, w, h, stroke, fill } = shape;
  const line = lineOf(shape);
  if (shape.kind === 'rectangle') return { type: 'rect', x, y, w, h, rx: Math.min(10, w / 4, h / 4), stroke, fill, ...line };
  if (shape.kind === 'ellipse') return { type: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, stroke, fill, ...line };
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
      ...line,
    };
  return null;
}

/** Ponta de seta em `b`, vinda de `a`; cresce um pouco com traços grossos. */
export function arrowHead(a: Point, b: Point, width = DEFAULT_STROKE_WIDTH): Point[] {
  const scale = Math.max(1, width / DEFAULT_STROKE_WIDTH) ** 0.6;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const back = { x: b.x - ux * HEAD_LENGTH * scale, y: b.y - uy * HEAD_LENGTH * scale };
  const half = HEAD_WIDTH * 0.5 * scale;
  return [b, { x: back.x - uy * half, y: back.y + ux * half }, { x: back.x + uy * half, y: back.y - ux * half }];
}

export function elementPrimitives(board: Board, element: BoardElement, options: { hideText?: boolean } = {}): Primitive[] {
  if (isShape(element)) {
    const outline = shapeOutline(element);
    const text = options.hideText ? null : textPrimitive(element);
    return [outline, text].filter((p): p is Primitive => Boolean(p));
  }
  if (isDrawing(element)) return [{ type: 'path', points: drawingPoints(element), stroke: element.stroke, ...lineOf(element) }];
  if (isPicture(element)) return [{ type: 'image', x: element.x, y: element.y, w: element.w, h: element.h, src: element.src }];
  if (!isArrow(element)) return [];
  const segment = arrowSegment(board, element);
  if (!segment) return [];
  const line = lineOf(element);
  // A ponta é sempre cheia, mesmo numa seta tracejada.
  const head = (from: Point, to: Point): Primitive => ({ type: 'polygon', points: arrowHead(from, to, line.width), stroke: element.stroke, fill: element.stroke, width: line.width, dash: '' });
  const heads = element.head === 'none' ? [] : element.head === 'both' ? [head(segment.b, segment.a), head(segment.a, segment.b)] : [head(segment.a, segment.b)];
  return [{ type: 'line', a: segment.a, b: segment.b, stroke: element.stroke, ...line }, ...heads];
}

/** Caminho SVG de uma polilinha (traço de lápis). */
export const pathData = (points: Point[]) => points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('');

// ---------------------------------------------------------------- SVG

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Números sempre finitos e curtos: nada de "NaN" ou notação científica no arquivo.
const n = (value: number) => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0');
// As cores já foram validadas no modelo (#rrggbb ou transparent); a checagem aqui é a segunda barreira.
const color = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : value === 'transparent' ? 'none' : '#1a1f26');
const dash = (value: string) => (/^[\d. ]+$/.test(value) ? ` stroke-dasharray="${value}"` : '');

function primitiveSvg(p: Primitive): string {
  const paint = (stroke: string, fill: string, width: number, pattern: string) =>
    `stroke="${color(stroke)}" stroke-width="${n(width)}"${dash(pattern)}${pattern ? ' stroke-linecap="round"' : ''} fill="${color(fill)}"`;
  switch (p.type) {
    case 'rect':
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="${n(p.rx)}" ${paint(p.stroke, p.fill, p.width, p.dash)}/>`;
    case 'ellipse':
      return `<ellipse cx="${n(p.cx)}" cy="${n(p.cy)}" rx="${n(p.rx)}" ry="${n(p.ry)}" ${paint(p.stroke, p.fill, p.width, p.dash)}/>`;
    case 'polygon':
      return `<polygon points="${p.points.map((q) => `${n(q.x)},${n(q.y)}`).join(' ')}" stroke-linejoin="round" ${paint(p.stroke, p.fill, p.width, p.dash)}/>`;
    case 'line':
      return `<line x1="${n(p.a.x)}" y1="${n(p.a.y)}" x2="${n(p.b.x)}" y2="${n(p.b.y)}" stroke="${color(p.stroke)}" stroke-width="${n(p.width)}"${dash(p.dash)} stroke-linecap="round"/>`;
    case 'path':
      return `<path d="${pathData(p.points)}" stroke="${color(p.stroke)}" stroke-width="${n(p.width)}"${dash(p.dash)} stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
    case 'image': {
      // Segunda barreira: só data URLs raster validadas chegam ao atributo.
      const src = sanitizeImageSrc(p.src);
      return src ? `<image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none" href="${src}"/>` : '';
    }
    case 'text': {
      const step = p.size * LINE_HEIGHT;
      const spans = p.lines.map((line, i) => `<tspan x="${n(p.x)}" y="${n(p.y + i * step)}">${escapeXml(line) || ' '}</tspan>`).join('');
      const family = p.mono ? ` font-family="${escapeXml(MONO_FAMILY)}"` : '';
      return `<text font-size="${n(p.size)}"${family} fill="${color(p.color)}" text-anchor="${p.anchor}" xml:space="preserve">${spans}</text>`;
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
    .map((element) => {
      const markup = elementPrimitives(board, element).map(primitiveSvg).join('');
      return element.opacity !== undefined && element.opacity < 100 ? `<g opacity="${n(element.opacity / 100)}">${markup}</g>` : markup;
    })
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
