// Modelo do quadro branco: formato do arquivo, migração, validação e operações puras.
// Nada aqui toca o DOM nem o disco: as funções recebem um quadro e devolvem outro
// (o mesmo objeto quando nada muda), o que facilita desfazer e os testes.

export const BOARD_FORMAT = 'obnotion-whiteboard';
// Versão 2: lápis, imagens, estilos de traço, texto, grupos, travas e links. Um arquivo v2 aberto por uma
// versão antiga do app dá "versão mais nova" em vez de perder, na próxima gravação, o que ela não conhece.
export const BOARD_VERSION = 2;
export const CLIPBOARD_FORMAT = 'obnotion-whiteboard/clipboard';

// Limites para arquivos importados e conteúdo colado.
export const MAX_BOARD_BYTES = 5 * 1024 * 1024;
export const MAX_ELEMENTS = 5000;
export const MAX_TEXT = 2000;
export const MAX_LINK = 1000;
/** Imagem embutida (data URL). O quadro inteiro ainda precisa caber em MAX_BOARD_BYTES. */
export const MAX_IMAGE_CHARS = 3_000_000;
/** Pontos de um traço de lápis. */
export const MAX_POINTS = 2000;
const COORD_LIMIT = 1_000_000;
const MAX_SIZE = 100_000;
export const MIN_SIZE = 8;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const SHAPE_KINDS = ['rectangle', 'ellipse', 'diamond', 'text'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const STROKE_WIDTHS = [1, 2, 4] as const;
export const DEFAULT_STROKE_WIDTH = 2;
export const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type StrokeStyle = (typeof STROKE_STYLES)[number];
/** Tamanhos de texto oferecidos (sem valor, vale o padrão do tipo: 16 nas formas, 20 no texto solto). */
export const FONT_SIZES = [14, 20, 28, 40] as const;
export const FONTS = ['sans', 'mono'] as const;
export type Font = (typeof FONTS)[number];
/** Pontas da seta: só no fim (padrão, não gravado), nas duas ou nenhuma (linha). */
export const ARROW_HEADS = ['end', 'both', 'none'] as const;
export type ArrowHead = (typeof ARROW_HEADS)[number];
export const OPACITIES = [100, 75, 50, 25] as const;

/** Propriedades comuns a todos os elementos. Valores padrão não são gravados. */
export type Style = {
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  /** 10–99; sem valor = opaco. */
  opacity?: number;
  /** Elementos com o mesmo grupo são selecionados e movidos juntos. */
  group?: string;
  /** Travado: dá para selecionar e copiar, mas não mover, redimensionar, editar nem apagar. */
  locked?: boolean;
  /** Nota do vault (caminho ou nome) ou endereço http(s). */
  link?: string;
};

export type Shape = Style & {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  stroke: string;
  fill: string;
  fontSize?: number;
  font?: 'mono';
};

/** Traço livre (lápis). `points` são pares x,y normalizados (0–1) na caixa: redimensionar escala o traço. */
export type Drawing = Style & { id: string; kind: 'draw'; x: number; y: number; w: number; h: number; points: number[]; stroke: string };

/** Imagem embutida como data URL (só formatos raster: png, jpeg, webp, gif). */
export type Picture = Style & { id: string; kind: 'image'; x: number; y: number; w: number; h: number; src: string };

/** Tudo o que ocupa uma caixa (x, y, w, h): move e redimensiona pelos cantos. */
export type Box = Shape | Drawing | Picture;

// A ponta de uma seta fica presa a uma forma (acompanha quando ela se move) ou solta num ponto.
export type Endpoint = { shape: string } | { x: number; y: number };

export type Arrow = Style & { id: string; kind: 'arrow'; start: Endpoint; end: Endpoint; stroke: string; head?: 'both' | 'none' };

export type BoardElement = Box | Arrow;

export type View = { x: number; y: number; zoom: number };

export type Board = {
  format: typeof BOARD_FORMAT;
  version: typeof BOARD_VERSION;
  /** Ordem de desenho: o último fica por cima. */
  elements: BoardElement[];
  view: View;
  /** Quadro de exemplo criado pelo app. */
  sample?: boolean;
};

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

// Paleta: só cores #rrggbb ou "transparent" chegam ao SVG.
export const INK = '#1a1f26';
export const STROKES = ['#1a1f26', '#0c6c64', '#1d4ed8', '#7c3aed', '#c2410c', '#b91c1c'] as const;
export const FILLS = ['transparent', '#ffffff', '#d7f0ec', '#dbe6fb', '#efe3fb', '#fde7d3', '#fbdada'] as const;

export const emptyBoard = (): Board => ({ format: BOARD_FORMAT, version: BOARD_VERSION, elements: [], view: { x: 0, y: 0, zoom: 1 } });

export const isShape = (element: BoardElement | undefined): element is Shape =>
  Boolean(element) && (SHAPE_KINDS as readonly string[]).includes(element!.kind);
export const isBox = (element: BoardElement | undefined): element is Box => Boolean(element) && element!.kind !== 'arrow';
export const isDrawing = (element: BoardElement | undefined): element is Drawing => element?.kind === 'draw';
export const isPicture = (element: BoardElement | undefined): element is Picture => element?.kind === 'image';
export const isArrow = (element: BoardElement | undefined): element is Arrow => element?.kind === 'arrow';
export const isBound = (endpoint: Endpoint): endpoint is { shape: string } => 'shape' in endpoint;

let counter = 0;
export function newId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12);
  return random ?? `e${Date.now().toString(36)}${(counter++).toString(36)}`;
}

// ---------------------------------------------------------------- leitura e migração

export type ParseError = 'too-large' | 'invalid-json' | 'not-a-board' | 'newer-version' | 'too-many-elements';
export type ParseResult = { ok: true; board: Board; migrated: boolean; dropped: number } | { ok: false; error: ParseError };

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

// Cada passo leva a versão N para N+1. Arquivos sem "version" vêm das versões de desenvolvimento
// anteriores à 1: setas ligavam formas por "from"/"to" (ids) e não havia "view".
const MIGRATIONS: Record<number, (doc: Raw) => Raw> = {
  0: (doc) => ({
    ...doc,
    version: 1,
    view: doc.view ?? { x: 0, y: 0, zoom: 1 },
    elements: (Array.isArray(doc.elements) ? doc.elements : []).map((element: unknown) => {
      if (!isObject(element) || element.kind !== 'arrow' || 'start' in element) return element;
      const point = (value: unknown) => (typeof value === 'string' ? { shape: value } : value);
      const { from, to, ...rest } = element;
      return { ...rest, start: point(from), end: point(to) };
    }),
  }),
  // 1 → 2: só acrescenta tipos e propriedades opcionais; os elementos da v1 continuam válidos.
  1: (doc) => ({ ...doc, version: 2 }),
};

export function migrate(doc: Raw): { doc: Raw; migrated: boolean } | ParseError {
  if (doc.format !== BOARD_FORMAT) return 'not-a-board';
  let version = doc.version === undefined ? 0 : doc.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return 'not-a-board';
  if (version > BOARD_VERSION) return 'newer-version';
  const migrated = version < BOARD_VERSION;
  while (version < BOARD_VERSION) {
    doc = MIGRATIONS[version](doc);
    version++;
  }
  return { doc, migrated };
}

/** Lê o texto de um arquivo de quadro. Arquivo vazio vira quadro vazio (recém-criado). */
export function parseBoard(text: string): ParseResult {
  if (text.length > MAX_BOARD_BYTES) return { ok: false, error: 'too-large' };
  if (!text.trim()) return { ok: true, board: emptyBoard(), migrated: false, dropped: 0 };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (!isObject(raw)) return { ok: false, error: 'not-a-board' };
  const result = migrate(raw);
  if (typeof result === 'string') return { ok: false, error: result };
  const list = Array.isArray(result.doc.elements) ? result.doc.elements : [];
  if (list.length > MAX_ELEMENTS) return { ok: false, error: 'too-many-elements' };
  const elements = sanitizeElements(list);
  const board: Board = { ...emptyBoard(), elements, view: sanitizeView(result.doc.view) };
  if (result.doc.sample === true) board.sample = true;
  return { ok: true, board, migrated: result.migrated, dropped: list.length - elements.length };
}

export const serializeBoard = (board: Board) => `${JSON.stringify(board, null, 2)}\n`;

const ID = /^[\w-]{1,64}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

const finite = (value: unknown, limit = COORD_LIMIT): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : null;

export const sanitizeColor = (value: unknown, fallback: string) =>
  value === 'transparent' || (typeof value === 'string' && COLOR.test(value)) ? (value as string).toLowerCase() : fallback;

/** Remove caracteres de controle (menos quebra de linha e tab) e corta no limite. */
export const sanitizeText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, MAX_TEXT) : '';

/** Link aceito: http(s) ou uma nota do vault (caminho relativo ou nome, com ou sem [[ ]]). Vazio se inválido. */
export function sanitizeLink(value: unknown): string {
  if (typeof value !== 'string') return '';
  const link = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_LINK);
  if (!link) return '';
  if (/^https?:\/\/[^\s"'<>`]+$/i.test(link)) return link;
  // Qualquer outro esquema (javascript:, file:, C:\…) fica de fora.
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return '';
  const note = link
    .replace(/^\[\[(.*)\]\]$/, '$1')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!note || note.split('/').some((part) => part === '..')) return '';
  return note;
}

const IMAGE_SRC = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Só data URLs raster em base64: nada de SVG (pode ter script), http ou arquivo local. */
export const sanitizeImageSrc = (value: unknown) => (typeof value === 'string' && value.length <= MAX_IMAGE_CHARS && IMAGE_SRC.test(value) ? value : '');

const oneOf = <T extends string | number>(list: readonly T[], value: unknown): T | undefined => list.find((item) => item === value);

/** Estilo comum. Só fica o que difere do padrão, para o arquivo continuar enxuto. */
export function sanitizeStyle(value: Raw): Style {
  const style: Style = {};
  const width = oneOf(STROKE_WIDTHS, value.strokeWidth);
  if (width && width !== DEFAULT_STROKE_WIDTH) style.strokeWidth = width;
  const dash = oneOf(STROKE_STYLES, value.strokeStyle);
  if (dash && dash !== 'solid') style.strokeStyle = dash;
  const opacity = finite(value.opacity, 100);
  if (opacity !== null && opacity < 100) style.opacity = Math.max(10, Math.round(opacity));
  if (typeof value.group === 'string' && ID.test(value.group)) style.group = value.group;
  if (value.locked === true) style.locked = true;
  const link = sanitizeLink(value.link);
  if (link) style.link = link;
  return style;
}

function sanitizeView(value: unknown): View {
  if (!isObject(value)) return { x: 0, y: 0, zoom: 1 };
  return { x: finite(value.x) ?? 0, y: finite(value.y) ?? 0, zoom: clampZoom(finite(value.zoom) ?? 1) };
}

function sanitizeRect(value: Raw): Rect | null {
  const [x, y] = [finite(value.x), finite(value.y)];
  const [w, h] = [finite(value.w, MAX_SIZE), finite(value.h, MAX_SIZE)];
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  return { x, y, w: Math.max(MIN_SIZE, w), h: Math.max(MIN_SIZE, h) };
}

function sanitizeShape(value: Raw): Shape | null {
  const kind = SHAPE_KINDS.find((k) => k === value.kind);
  const rect = sanitizeRect(value);
  if (!kind || !rect) return null;
  const shape: Shape = {
    id: value.id as string,
    kind,
    ...rect,
    text: sanitizeText(value.text),
    stroke: sanitizeColor(value.stroke, INK),
    fill: sanitizeColor(value.fill, 'transparent'),
    ...sanitizeStyle(value),
  };
  const size = oneOf(FONT_SIZES, value.fontSize);
  if (size) shape.fontSize = size;
  if (value.font === 'mono') shape.font = 'mono';
  return shape;
}

const round4 = (value: number) => Math.round(value * 10000) / 10000;

function sanitizeDrawing(value: Raw): Drawing | null {
  const rect = sanitizeRect(value);
  if (!rect || !Array.isArray(value.points)) return null;
  const raw = value.points.slice(0, MAX_POINTS * 2);
  if (raw.length < 4 || raw.length % 2 || !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const points = (raw as number[]).map((n) => round4(Math.max(0, Math.min(1, n))));
  return { id: value.id as string, kind: 'draw', ...rect, points, stroke: sanitizeColor(value.stroke, INK), ...sanitizeStyle(value) };
}

function sanitizePicture(value: Raw): Picture | null {
  const rect = sanitizeRect(value);
  const src = sanitizeImageSrc(value.src);
  if (!rect || !src) return null;
  return { id: value.id as string, kind: 'image', ...rect, src, ...sanitizeStyle(value) };
}

function sanitizeEndpoint(value: unknown): Endpoint | null {
  if (!isObject(value)) return null;
  if (typeof value.shape === 'string') return ID.test(value.shape) ? { shape: value.shape } : null;
  const [x, y] = [finite(value.x), finite(value.y)];
  return x === null || y === null ? null : { x, y };
}

/**
 * Valida elementos vindos de fora (arquivo, área de transferência). Descarta o que não se encaixa:
 * tipo desconhecido, número inválido, id repetido, seta presa a uma forma que não existe.
 */
export function sanitizeElements(list: unknown[]): BoardElement[] {
  const seen = new Set<string>();
  const boxes: Box[] = [];
  const arrows: Arrow[] = [];
  // Caixas entram direto; setas entram pelo índice e só são checadas no fim (podem citar formas posteriores).
  const order: (Box | number)[] = [];
  for (const value of list.slice(0, MAX_ELEMENTS)) {
    if (!isObject(value) || typeof value.id !== 'string' || !ID.test(value.id) || seen.has(value.id)) continue;
    if (value.kind === 'arrow') {
      const [start, end] = [sanitizeEndpoint(value.start), sanitizeEndpoint(value.end)];
      if (!start || !end) continue;
      seen.add(value.id);
      const arrow: Arrow = { id: value.id, kind: 'arrow', start, end, stroke: sanitizeColor(value.stroke, INK), ...sanitizeStyle(value) };
      if (value.head === 'both' || value.head === 'none') arrow.head = value.head;
      arrows.push(arrow);
      order.push(arrows.length - 1);
    } else {
      const box = value.kind === 'draw' ? sanitizeDrawing(value) : value.kind === 'image' ? sanitizePicture(value) : sanitizeShape(value);
      if (!box) continue;
      seen.add(box.id);
      boxes.push(box);
      order.push(box);
    }
  }
  // Setas só se prendem a formas (não a traços de lápis nem a imagens).
  const shapeIds = new Set(boxes.filter(isShape).map((s) => s.id));
  const valid = (endpoint: Endpoint) => !isBound(endpoint) || shapeIds.has(endpoint.shape);
  return order.flatMap((item): BoardElement[] => {
    if (typeof item !== 'number') return [item];
    const arrow = arrows[item];
    const bothSame = isBound(arrow.start) && isBound(arrow.end) && arrow.start.shape === arrow.end.shape;
    return valid(arrow.start) && valid(arrow.end) && !bothSame ? [arrow] : [];
  });
}

// ---------------------------------------------------------------- geometria

export const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

export const findShape = (board: Board, id: string) => {
  const element = board.elements.find((e) => e.id === id);
  return isShape(element) ? element : undefined;
};

export const findElement = (board: Board, id: string) => board.elements.find((e) => e.id === id);

export const center = (shape: Rect): Point => ({ x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 });

/** Retângulo com largura e altura positivas a partir de dois cantos quaisquer. */
export const normalizeRect = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});

export function containsPoint(shape: Shape, p: Point, tolerance = 0): boolean {
  const c = center(shape);
  const hw = shape.w / 2 + tolerance;
  const hh = shape.h / 2 + tolerance;
  const dx = Math.abs(p.x - c.x);
  const dy = Math.abs(p.y - c.y);
  if (shape.kind === 'ellipse') return (dx / hw) ** 2 + (dy / hh) ** 2 <= 1;
  if (shape.kind === 'diamond') return dx / hw + dy / hh <= 1;
  return dx <= hw && dy <= hh;
}

/** Onde a reta do centro da forma até `toward` cruza a borda. Se `toward` está dentro, devolve o centro. */
export function borderPoint(shape: Shape, toward: Point): Point {
  const c = center(shape);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const hw = shape.w / 2;
  const hh = shape.h / 2;
  let t: number;
  if (shape.kind === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  else if (shape.kind === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  if (t >= 1) return c;
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Segmento desenhado de uma seta: pontas presas param na borda das formas. */
export function arrowSegment(board: Board, arrow: Arrow): { a: Point; b: Point } | null {
  const shapeOf = (endpoint: Endpoint) => (isBound(endpoint) ? findShape(board, endpoint.shape) : undefined);
  const startShape = shapeOf(arrow.start);
  const endShape = shapeOf(arrow.end);
  if ((isBound(arrow.start) && !startShape) || (isBound(arrow.end) && !endShape)) return null;
  const anchor = (endpoint: Endpoint, shape?: Shape): Point => (shape ? center(shape) : (endpoint as Point));
  const startAnchor = anchor(arrow.start, startShape);
  const endAnchor = anchor(arrow.end, endShape);
  return {
    a: startShape ? borderPoint(startShape, endAnchor) : startAnchor,
    b: endShape ? borderPoint(endShape, startAnchor) : endAnchor,
  };
}

/** Pontos de um traço de lápis em coordenadas do quadro. */
export const drawingPoints = (drawing: Drawing): Point[] => {
  const points: Point[] = [];
  for (let i = 0; i + 1 < drawing.points.length; i += 2) points.push({ x: drawing.x + drawing.points[i] * drawing.w, y: drawing.y + drawing.points[i + 1] * drawing.h });
  return points;
};

/**
 * Traço de lápis a partir dos pontos do gesto: descarta pontos muito próximos, limita a quantidade
 * e normaliza na caixa. Um traço quase reto ganha a altura (ou largura) mínima, centrado nela.
 */
export function drawingFromPoints(input: Point[], minStep = 1.5): Pick<Drawing, 'x' | 'y' | 'w' | 'h' | 'points'> | null {
  const kept: Point[] = [];
  for (const p of input) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = kept.at(-1);
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minStep) kept.push(p);
  }
  const last = input.at(-1);
  if (last && kept.length && kept.at(-1) !== last && Number.isFinite(last.x) && Number.isFinite(last.y)) kept.push(last);
  if (!kept.length) return null;
  if (kept.length === 1) kept.push({ x: kept[0].x + 0.5, y: kept[0].y + 0.5 });
  // Muitos pontos: fica um a cada `stride`, mantendo o último.
  const stride = Math.ceil(kept.length / MAX_POINTS);
  const sampled = stride > 1 ? kept.filter((_, i) => i % stride === 0 || i === kept.length - 1) : kept;
  const xs = sampled.map((p) => p.x);
  const ys = sampled.map((p) => p.y);
  let [x, y] = [Math.min(...xs), Math.min(...ys)];
  let [w, h] = [Math.max(...xs) - x, Math.max(...ys) - y];
  if (w < MIN_SIZE) [x, w] = [x - (MIN_SIZE - w) / 2, MIN_SIZE];
  if (h < MIN_SIZE) [y, h] = [y - (MIN_SIZE - h) / 2, MIN_SIZE];
  return { x, y, w, h, points: sampled.flatMap((p) => [round4((p.x - x) / w), round4((p.y - y) / h)]) };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const strokeWidthOf = (element: BoardElement) => element.strokeWidth ?? DEFAULT_STROKE_WIDTH;

/** O elemento passa pelo ponto? Formas e imagens pela área; setas e traços pela linha, com margem. */
export function elementContains(board: Board, element: BoardElement, p: Point, tolerance = 6): boolean {
  if (isShape(element)) return containsPoint(element, p, tolerance / 2);
  if (isPicture(element)) return p.x >= element.x && p.x <= element.x + element.w && p.y >= element.y && p.y <= element.y + element.h;
  const reach = tolerance + strokeWidthOf(element) / 2;
  if (isDrawing(element)) {
    if (p.x < element.x - reach || p.x > element.x + element.w + reach || p.y < element.y - reach || p.y > element.y + element.h + reach) return false;
    const points = drawingPoints(element);
    for (let i = 1; i < points.length; i++) if (distanceToSegment(p, points[i - 1], points[i]) <= reach) return true;
    return false;
  }
  const segment = arrowSegment(board, element);
  return Boolean(segment) && distanceToSegment(p, segment!.a, segment!.b) <= reach;
}

/** Elemento de cima sob o ponto (setas e traços têm uma margem para facilitar o clique). */
export function hitTest(board: Board, p: Point, tolerance = 6): string | null {
  for (let i = board.elements.length - 1; i >= 0; i--) {
    if (elementContains(board, board.elements[i], p, tolerance)) return board.elements[i].id;
  }
  return null;
}

/** Forma (retângulo, elipse, losango ou texto) sob o ponto: é onde uma seta pode se prender. */
export function shapeAt(board: Board, p: Point, except?: string): Shape | undefined {
  for (let i = board.elements.length - 1; i >= 0; i--) {
    const element = board.elements[i];
    if (isShape(element) && element.id !== except && containsPoint(element, p, 4)) return element;
  }
  return undefined;
}

export function elementBounds(board: Board, element: BoardElement): Rect | null {
  if (isBox(element)) return { x: element.x, y: element.y, w: element.w, h: element.h };
  const segment = arrowSegment(board, element);
  return segment ? normalizeRect(segment.a, segment.b) : null;
}

export function boardBounds(board: Board, ids?: Iterable<string>): Rect | null {
  const wanted = ids ? new Set(ids) : null;
  let box: { x1: number; y1: number; x2: number; y2: number } | null = null;
  for (const element of board.elements) {
    if (wanted && !wanted.has(element.id)) continue;
    const r = elementBounds(board, element);
    if (!r) continue;
    box = box
      ? { x1: Math.min(box.x1, r.x), y1: Math.min(box.y1, r.y), x2: Math.max(box.x2, r.x + r.w), y2: Math.max(box.y2, r.y + r.h) }
      : { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h };
  }
  return box && { x: box.x1, y: box.y1, w: box.x2 - box.x1, h: box.y2 - box.y1 };
}

/** Ids dos elementos inteiramente dentro do retângulo (seleção por área). */
export function elementsInRect(board: Board, rect: Rect): string[] {
  return board.elements.flatMap((element) => {
    const r = elementBounds(board, element);
    return r && r.x >= rect.x && r.y >= rect.y && r.x + r.w <= rect.x + rect.w && r.y + r.h <= rect.y + rect.h ? [element.id] : [];
  });
}

/** Encosta o valor na grade mais próxima. */
export const snapToGrid = (value: number, grid: number) => (grid > 0 ? Math.round(value / grid) * grid : value);

/** Segunda ponta de um arraste com Shift: quadrado (mesma largura e altura), no sentido do gesto. */
export function constrainSquare(start: Point, point: Point): Point {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + (dx < 0 ? -side : side), y: start.y + (dy < 0 ? -side : side) };
}

/** Linha com Shift: o ângulo anda de 15 em 15 graus, mantendo o comprimento. */
export function constrainAngle(start: Point, point: Point, step = Math.PI / 12): Point {
  const length = Math.hypot(point.x - start.x, point.y - start.y);
  const angle = Math.round(Math.atan2(point.y - start.y, point.x - start.x) / step) * step;
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
}

/** Canto oposto ao fixo, mantendo a proporção largura/altura (redimensionar com Shift). */
export function constrainRatio(fixed: Point, point: Point, ratio: number): Point {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return point;
  const dx = point.x - fixed.x;
  const dy = point.y - fixed.y;
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  if (h * ratio < w) h = w / ratio;
  else w = h * ratio;
  return { x: fixed.x + (dx < 0 ? -w : w), y: fixed.y + (dy < 0 ? -h : h) };
}

/** Movimento com Shift: só no eixo dominante. */
export const constrainAxis = (dx: number, dy: number) => (Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy });

// ---------------------------------------------------------------- operações

const replace = (board: Board, elements: BoardElement[]): Board => ({ ...board, elements });

export function addShape(board: Board, kind: ShapeKind, rect: Rect, props: Partial<Pick<Shape, 'text' | 'stroke' | 'fill'>> & Style & { fontSize?: number; font?: string } = {}): { board: Board; id: string } {
  const id = newId();
  const shape = sanitizeShape({ ...props, id, kind, x: rect.x, y: rect.y, w: Math.max(MIN_SIZE, rect.w), h: Math.max(MIN_SIZE, rect.h) })!;
  return { board: replace(board, [...board.elements, shape]), id };
}

/** Traço de lápis a partir dos pontos do gesto. Null se não houver pontos válidos. */
export function addDrawing(board: Board, points: Point[], props: { stroke?: string } & Style = {}): { board: Board; id: string } | null {
  const geometry = drawingFromPoints(points);
  if (!geometry) return null;
  const id = newId();
  const drawing = sanitizeDrawing({ ...props, ...geometry, id, kind: 'draw' });
  return drawing ? { board: replace(board, [...board.elements, drawing]), id } : null;
}

/** Imagem embutida. Null se a data URL não for aceita. */
export function addPicture(board: Board, src: string, rect: Rect): { board: Board; id: string } | null {
  const id = newId();
  const picture = sanitizePicture({ id, kind: 'image', src, ...rect });
  return picture ? { board: replace(board, [...board.elements, picture]), id } : null;
}

/** Cria uma seta. Não liga uma forma a ela mesma; devolve null nesse caso. */
export function addArrow(board: Board, start: Endpoint, end: Endpoint, stroke = INK, props: Style & { head?: ArrowHead } = {}): { board: Board; id: string } | null {
  if (isBound(start) && isBound(end) && start.shape === end.shape) return null;
  for (const endpoint of [start, end]) if (isBound(endpoint) && !findShape(board, endpoint.shape)) return null;
  const id = newId();
  const arrow: Arrow = { id, kind: 'arrow', start, end, stroke: sanitizeColor(stroke, INK), ...sanitizeStyle(props) };
  if (props.head === 'both' || props.head === 'none') arrow.head = props.head;
  return { board: replace(board, [...board.elements, arrow]), id };
}

/** Liga duas formas com uma seta, se ainda não houver uma no mesmo sentido. */
export function connect(board: Board, from: string, to: string): { board: Board; id: string } | null {
  const existing = board.elements.find(
    (e) => isArrow(e) && isBound(e.start) && isBound(e.end) && e.start.shape === from && e.end.shape === to,
  );
  if (existing) return { board, id: existing.id };
  return addArrow(board, { shape: from }, { shape: to });
}

/** Troca uma ponta da seta (arrastar a ponta para outra forma ou para um ponto livre). */
export function setArrowEnd(board: Board, id: string, which: 'start' | 'end', endpoint: Endpoint): Board {
  const arrow = board.elements.find((e) => e.id === id);
  if (!isArrow(arrow)) return board;
  const other = which === 'start' ? arrow.end : arrow.start;
  if (isBound(endpoint) && (!findShape(board, endpoint.shape) || (isBound(other) && other.shape === endpoint.shape))) return board;
  if (JSON.stringify(arrow[which]) === JSON.stringify(endpoint)) return board;
  return replace(
    board,
    board.elements.map((e) => (e.id === id ? { ...arrow, [which]: endpoint } : e)),
  );
}

/** Move caixas e as pontas soltas das setas selecionadas. Pontas presas acompanham a forma sozinhas. */
export function moveElements(board: Board, ids: Iterable<string>, dx: number, dy: number): Board {
  const wanted = new Set(ids);
  if (!wanted.size || (!dx && !dy)) return board;
  const shift = (endpoint: Endpoint): Endpoint => (isBound(endpoint) ? endpoint : { x: endpoint.x + dx, y: endpoint.y + dy });
  return replace(
    board,
    board.elements.map((element) => {
      if (!wanted.has(element.id)) return element;
      if (isBox(element)) return { ...element, x: element.x + dx, y: element.y + dy };
      return { ...element, start: shift(element.start), end: shift(element.end) };
    }),
  );
}

/** Nova caixa de uma forma, traço ou imagem (o traço escala junto). */
export function resizeShape(board: Board, id: string, rect: Rect): Board {
  return replace(
    board,
    board.elements.map((element) =>
      element.id === id && isBox(element)
        ? { ...element, x: rect.x, y: rect.y, w: Math.max(MIN_SIZE, rect.w), h: Math.max(MIN_SIZE, rect.h) }
        : element,
    ),
  );
}

export type Patch = {
  text?: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  opacity?: number;
  fontSize?: number | null;
  font?: Font;
  head?: ArrowHead;
  link?: string;
  locked?: boolean;
};

/** Aplica o que cabe em cada tipo; valores padrão saem do elemento (o arquivo não guarda padrões). */
function patched(element: BoardElement, patch: Patch): BoardElement {
  const next: Record<string, unknown> = { ...element };
  const set = (key: string, value: unknown, isDefault: boolean) => {
    if (isDefault) delete next[key];
    else next[key] = value;
  };
  if (patch.stroke !== undefined && !isPicture(element)) next.stroke = sanitizeColor(patch.stroke, (element as Shape).stroke);
  if (isShape(element)) {
    if (patch.text !== undefined) next.text = sanitizeText(patch.text);
    if (patch.fill !== undefined) next.fill = sanitizeColor(patch.fill, element.fill);
    if (patch.fontSize !== undefined) {
      const size = oneOf(FONT_SIZES, patch.fontSize);
      if (size || patch.fontSize === null) set('fontSize', size, !size);
    }
    if (patch.font !== undefined && oneOf(FONTS, patch.font)) set('font', 'mono', patch.font !== 'mono');
  }
  if (isArrow(element) && patch.head !== undefined && oneOf(ARROW_HEADS, patch.head)) set('head', patch.head, patch.head === 'end');
  if (!isPicture(element)) {
    if (patch.strokeWidth !== undefined && oneOf(STROKE_WIDTHS, patch.strokeWidth)) set('strokeWidth', patch.strokeWidth, patch.strokeWidth === DEFAULT_STROKE_WIDTH);
    if (patch.strokeStyle !== undefined && oneOf(STROKE_STYLES, patch.strokeStyle)) set('strokeStyle', patch.strokeStyle, patch.strokeStyle === 'solid');
  }
  if (patch.opacity !== undefined && Number.isFinite(patch.opacity)) {
    const opacity = Math.max(10, Math.min(100, Math.round(patch.opacity)));
    set('opacity', opacity, opacity >= 100);
  }
  if (patch.link !== undefined) {
    const link = sanitizeLink(patch.link);
    set('link', link, !link);
  }
  if (patch.locked !== undefined) set('locked', true, !patch.locked);
  return next as BoardElement;
}

/** Altera texto, cores e estilo de vários elementos. Cada tipo só recebe o que faz sentido para ele. */
export function updateElements(board: Board, ids: Iterable<string>, patch: Patch): Board {
  const wanted = new Set(ids);
  let changed = false;
  const elements = board.elements.map((element) => {
    if (!wanted.has(element.id)) return element;
    const next = patched(element, patch);
    if (JSON.stringify(next) === JSON.stringify(element)) return element;
    changed = true;
    return next;
  });
  return changed ? replace(board, elements) : board;
}

/**
 * Apaga elementos. Setas presas a uma forma apagada continuam no quadro, com a ponta solta
 * onde a forma estava (como no Excalidraw); se as duas pontas sumirem junto, a seta também some.
 */
export function deleteElements(board: Board, ids: Iterable<string>): Board {
  const wanted = new Set(ids);
  if (!board.elements.some((e) => wanted.has(e.id))) return board;
  const elements = board.elements.flatMap((element): BoardElement[] => {
    if (wanted.has(element.id)) return [];
    if (!isArrow(element)) return [element];
    const startGone = isBound(element.start) && wanted.has(element.start.shape);
    const endGone = isBound(element.end) && wanted.has(element.end.shape);
    if (!startGone && !endGone) return [element];
    if (startGone && endGone) return [];
    const segment = arrowSegment(board, element);
    if (!segment) return [];
    return [{ ...element, start: startGone ? segment.a : element.start, end: endGone ? segment.b : element.end }];
  });
  return replace(board, elements);
}

/**
 * Copia elementos com ids novos, deslocados. Setas entre formas copiadas passam a ligar as cópias;
 * uma seta copiada sem a forma de uma ponta fica com essa ponta solta. Grupos copiados viram grupos
 * novos, e a cópia sai destravada.
 */
export function cloneElements(board: Board, source: BoardElement[], dx: number, dy: number): { elements: BoardElement[]; ids: string[] } {
  const remap = new Map(source.map((e) => [e.id, newId()]));
  const groups = new Map<string, string>();
  const regroup = (element: BoardElement): BoardElement => {
    const { locked: _locked, ...rest } = element;
    if (!rest.group) return rest as BoardElement;
    if (!groups.has(rest.group)) groups.set(rest.group, newId());
    return { ...rest, group: groups.get(rest.group) } as BoardElement;
  };
  const elements = source.flatMap((element): BoardElement[] => {
    const id = remap.get(element.id)!;
    if (isBox(element)) return [regroup({ ...element, id, x: element.x + dx, y: element.y + dy })];
    const segment = arrowSegment(board, element);
    const point = (endpoint: Endpoint, fallback: Point | undefined): Endpoint | null => {
      if (isBound(endpoint)) {
        const copy = remap.get(endpoint.shape);
        if (copy) return { shape: copy };
        return fallback ? { x: fallback.x + dx, y: fallback.y + dy } : null;
      }
      return { x: endpoint.x + dx, y: endpoint.y + dy };
    };
    const start = point(element.start, segment?.a);
    const end = point(element.end, segment?.b);
    return start && end ? [regroup({ ...element, id, start, end })] : [];
  });
  return { elements, ids: elements.map((e) => e.id) };
}

export function duplicateElements(board: Board, ids: Iterable<string>, offset = 24): { board: Board; ids: string[] } {
  const wanted = new Set(ids);
  const source = board.elements.filter((e) => wanted.has(e.id));
  if (!source.length) return { board, ids: [] };
  const room = MAX_ELEMENTS - board.elements.length;
  if (room <= 0) return { board, ids: [] };
  const copy = cloneElements(board, source.slice(0, room), offset, offset);
  return { board: replace(board, [...board.elements, ...copy.elements]), ids: copy.ids };
}

/** Insere elementos vindos de outro quadro (colar, importar): ids novos e posição deslocada. */
export function insertElements(board: Board, incoming: BoardElement[], dx: number, dy: number): { board: Board; ids: string[] } {
  const room = MAX_ELEMENTS - board.elements.length;
  if (room <= 0 || !incoming.length) return { board, ids: [] };
  const source = { ...board, elements: incoming };
  const copy = cloneElements(source, incoming.slice(0, room), dx, dy);
  return { board: replace(board, [...board.elements, ...copy.elements]), ids: copy.ids };
}

export const clipboardText = (board: Board, ids: Iterable<string>) => {
  const wanted = new Set(ids);
  return JSON.stringify({ type: CLIPBOARD_FORMAT, elements: board.elements.filter((e) => wanted.has(e.id)) });
};

/** Elementos de um texto colado, se ele vier do próprio quadro; null se for texto comum. */
export function parseClipboard(text: string): BoardElement[] | null {
  if (text.length > MAX_BOARD_BYTES || !text.trimStart().startsWith('{')) return null;
  try {
    const raw = JSON.parse(text);
    if (!isObject(raw) || raw.type !== CLIPBOARD_FORMAT || !Array.isArray(raw.elements)) return null;
    return sanitizeElements(raw.elements);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- grupos, travas e camadas

/** Os ids pedidos mais todos os membros dos grupos deles, na ordem de desenho. */
export function withGroups(board: Board, ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  const groups = new Set(board.elements.flatMap((e) => (wanted.has(e.id) && e.group ? [e.group] : [])));
  return board.elements.filter((e) => wanted.has(e.id) || (e.group && groups.has(e.group))).map((e) => e.id);
}

/** Junta os elementos num grupo novo (pelo menos dois). Grupos anteriores deles são desfeitos. */
export function groupElements(board: Board, ids: Iterable<string>): { board: Board; group: string | null } {
  const wanted = new Set(withGroups(board, ids));
  if (wanted.size < 2) return { board, group: null };
  const group = newId();
  return { board: replace(board, board.elements.map((e) => (wanted.has(e.id) ? { ...e, group } : e))), group };
}

/** Desfaz os grupos dos elementos pedidos (todos os membros desses grupos ficam soltos). */
export function ungroupElements(board: Board, ids: Iterable<string>): Board {
  const wanted = new Set(withGroups(board, ids));
  if (!board.elements.some((e) => wanted.has(e.id) && e.group)) return board;
  return replace(
    board,
    board.elements.map((e) => {
      if (!wanted.has(e.id) || !e.group) return e;
      const { group: _group, ...rest } = e;
      return rest as BoardElement;
    }),
  );
}

/** Só os ids de elementos destravados (os travados não se movem, não mudam e não são apagados). */
export const unlockedIds = (board: Board, ids: Iterable<string>) => {
  const wanted = new Set(ids);
  return board.elements.filter((e) => wanted.has(e.id) && !e.locked).map((e) => e.id);
};

export type Layer = 'front' | 'back' | 'forward' | 'backward';

/** Muda a ordem de desenho: um passo para cima/baixo ou direto para o topo/fundo. */
export function reorder(board: Board, ids: Iterable<string>, where: Layer): Board {
  const wanted = new Set(ids);
  if (!wanted.size) return board;
  const list = [...board.elements];
  const picked = (i: number) => wanted.has(list[i].id);
  if (where === 'front' || where === 'back') {
    const chosen = list.filter((e) => wanted.has(e.id));
    const others = list.filter((e) => !wanted.has(e.id));
    const next = where === 'front' ? [...others, ...chosen] : [...chosen, ...others];
    return next.every((e, i) => e === board.elements[i]) ? board : replace(board, next);
  }
  let changed = false;
  if (where === 'forward') {
    for (let i = list.length - 2; i >= 0; i--)
      if (picked(i) && !picked(i + 1)) {
        [list[i], list[i + 1]] = [list[i + 1], list[i]];
        changed = true;
      }
  } else {
    for (let i = 1; i < list.length; i++)
      if (picked(i) && !picked(i - 1)) {
        [list[i], list[i - 1]] = [list[i - 1], list[i]];
        changed = true;
      }
  }
  return changed ? replace(board, list) : board;
}

// ---------------------------------------------------------------- alinhar e distribuir

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Cada grupo conta como um bloco só; elemento sem grupo é um bloco sozinho. */
function units(board: Board, ids: Iterable<string>): { ids: string[]; rect: Rect }[] {
  const wanted = new Set(withGroups(board, ids));
  const byKey = new Map<string, string[]>();
  for (const e of board.elements) {
    if (!wanted.has(e.id)) continue;
    const key = e.group ? `g:${e.group}` : `e:${e.id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), e.id]);
  }
  return [...byKey.values()].flatMap((list) => {
    const rect = boardBounds(board, list);
    return rect ? [{ ids: list, rect }] : [];
  });
}

export function alignElements(board: Board, ids: Iterable<string>, how: Align): Board {
  const blocks = units(board, ids);
  if (blocks.length < 2) return board;
  const all = boardBounds(board, blocks.flatMap((b) => b.ids))!;
  let next = board;
  for (const { ids: members, rect } of blocks) {
    const dx =
      how === 'left' ? all.x - rect.x : how === 'right' ? all.x + all.w - (rect.x + rect.w) : how === 'hcenter' ? all.x + all.w / 2 - (rect.x + rect.w / 2) : 0;
    const dy =
      how === 'top' ? all.y - rect.y : how === 'bottom' ? all.y + all.h - (rect.y + rect.h) : how === 'vcenter' ? all.y + all.h / 2 - (rect.y + rect.h / 2) : 0;
    next = moveElements(next, members, dx, dy);
  }
  return next;
}

/** Espaços iguais entre os blocos (pelo menos três), mantendo os das pontas no lugar. */
export function distributeElements(board: Board, ids: Iterable<string>, axis: 'horizontal' | 'vertical'): Board {
  const blocks = units(board, ids);
  if (blocks.length < 3) return board;
  const [pos, size] = axis === 'horizontal' ? (['x', 'w'] as const) : (['y', 'h'] as const);
  blocks.sort((a, b) => a.rect[pos] - b.rect[pos]);
  const first = blocks[0].rect[pos];
  const end = Math.max(...blocks.map((b) => b.rect[pos] + b.rect[size]));
  const total = blocks.reduce((sum, b) => sum + b.rect[size], 0);
  const gap = (end - first - total) / (blocks.length - 1);
  let cursor = first;
  let next = board;
  for (const block of blocks) {
    const delta = cursor - block.rect[pos];
    next = axis === 'horizontal' ? moveElements(next, block.ids, delta, 0) : moveElements(next, block.ids, 0, delta);
    cursor += block.rect[size] + gap;
  }
  return next;
}

// ---------------------------------------------------------------- busca e links

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Elementos cujo texto ou link contém a busca (sem diferenciar caixa nem acentos), na ordem de desenho. */
export function searchElements(board: Board, query: string): string[] {
  const wanted = fold(query.trim());
  if (!wanted) return [];
  return board.elements.filter((e) => fold(`${isShape(e) ? e.text : ''}\n${e.link ?? ''}`).includes(wanted)).map((e) => e.id);
}

export type LinkTarget = { type: 'url'; url: string } | { type: 'note'; path: string } | null;

/** Para onde um link aponta: endereço http(s) ou uma nota existente (por caminho ou nome). */
export function resolveLink(link: string | undefined, notes: readonly { path: string; name: string }[]): LinkTarget {
  const clean = sanitizeLink(link);
  if (!clean) return null;
  if (/^https?:\/\//i.test(clean)) return { type: 'url', url: clean };
  const target = clean.split('#')[0].trim();
  const lower = target.toLowerCase();
  const withExt = /\.md$/i.test(lower) ? lower : `${lower}.md`;
  const note =
    notes.find((n) => n.path === target) ??
    notes.find((n) => n.path.toLowerCase() === withExt) ??
    notes.find((n) => n.name.toLowerCase() === lower.replace(/\.md$/i, '')) ??
    notes.find((n) => n.path.toLowerCase().endsWith(`/${withExt}`));
  return note ? { type: 'note', path: note.path } : null;
}

/** Zoom em torno de um ponto da tela: o ponto do quadro sob ele não sai do lugar. */
export function zoomAt(view: View, zoom: number, screen: Point): View {
  const next = clampZoom(zoom);
  const worldX = (screen.x - view.x) / view.zoom;
  const worldY = (screen.y - view.y) / view.zoom;
  return { zoom: next, x: screen.x - worldX * next, y: screen.y - worldY * next };
}

/** Enquadra um retângulo do quadro numa área da tela, com margem; nunca amplia além de `maxZoom`. */
export function fitView(rect: Rect | null, width: number, height: number, padding = 48, maxZoom = 1): View {
  if (!rect || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = clampZoom(Math.min(maxZoom, (width - padding * 2) / Math.max(rect.w, 1), (height - padding * 2) / Math.max(rect.h, 1)));
  return { zoom, x: (width - rect.w * zoom) / 2 - rect.x * zoom, y: (height - rect.h * zoom) / 2 - rect.y * zoom };
}
