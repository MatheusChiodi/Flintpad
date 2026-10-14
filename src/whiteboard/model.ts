// Modelo do quadro branco: formato do arquivo, migração, validação e operações puras.
// Nada aqui toca o DOM nem o disco: as funções recebem um quadro e devolvem outro
// (o mesmo objeto quando nada muda), o que facilita desfazer e os testes.

export const BOARD_FORMAT = 'obnotion-whiteboard';
export const BOARD_VERSION = 1;
export const CLIPBOARD_FORMAT = 'obnotion-whiteboard/clipboard';

// Limites para arquivos importados e conteúdo colado.
export const MAX_BOARD_BYTES = 5 * 1024 * 1024;
export const MAX_ELEMENTS = 5000;
export const MAX_TEXT = 2000;
const COORD_LIMIT = 1_000_000;
const MAX_SIZE = 100_000;
export const MIN_SIZE = 8;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const SHAPE_KINDS = ['rectangle', 'ellipse', 'diamond', 'text'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export type Shape = {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  stroke: string;
  fill: string;
};

// A ponta de uma seta fica presa a uma forma (acompanha quando ela se move) ou solta num ponto.
export type Endpoint = { shape: string } | { x: number; y: number };

export type Arrow = { id: string; kind: 'arrow'; start: Endpoint; end: Endpoint; stroke: string };

export type BoardElement = Shape | Arrow;

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

export const isShape = (element: BoardElement | undefined): element is Shape => Boolean(element) && element!.kind !== 'arrow';
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

function sanitizeView(value: unknown): View {
  if (!isObject(value)) return { x: 0, y: 0, zoom: 1 };
  return { x: finite(value.x) ?? 0, y: finite(value.y) ?? 0, zoom: clampZoom(finite(value.zoom) ?? 1) };
}

function sanitizeShape(value: Raw): Shape | null {
  const kind = SHAPE_KINDS.find((k) => k === value.kind);
  const [x, y] = [finite(value.x), finite(value.y)];
  const [w, h] = [finite(value.w, MAX_SIZE), finite(value.h, MAX_SIZE)];
  if (!kind || x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  return {
    id: value.id as string,
    kind,
    x,
    y,
    w: Math.max(MIN_SIZE, w),
    h: Math.max(MIN_SIZE, h),
    text: sanitizeText(value.text),
    stroke: sanitizeColor(value.stroke, INK),
    fill: sanitizeColor(value.fill, 'transparent'),
  };
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
  const shapes: Shape[] = [];
  const arrows: Arrow[] = [];
  // Formas entram direto; setas entram pelo índice e só são checadas no fim (podem citar formas posteriores).
  const order: (Shape | number)[] = [];
  for (const value of list.slice(0, MAX_ELEMENTS)) {
    if (!isObject(value) || typeof value.id !== 'string' || !ID.test(value.id) || seen.has(value.id)) continue;
    if (value.kind === 'arrow') {
      const [start, end] = [sanitizeEndpoint(value.start), sanitizeEndpoint(value.end)];
      if (!start || !end) continue;
      seen.add(value.id);
      arrows.push({ id: value.id, kind: 'arrow', start, end, stroke: sanitizeColor(value.stroke, INK) });
      order.push(arrows.length - 1);
    } else {
      const shape = sanitizeShape(value);
      if (!shape) continue;
      seen.add(shape.id);
      shapes.push(shape);
      order.push(shape);
    }
  }
  const shapeIds = new Set(shapes.map((s) => s.id));
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

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Elemento de cima sob o ponto (setas têm uma margem para facilitar o clique). */
export function hitTest(board: Board, p: Point, tolerance = 6): string | null {
  for (let i = board.elements.length - 1; i >= 0; i--) {
    const element = board.elements[i];
    if (isShape(element)) {
      if (containsPoint(element, p, tolerance / 2)) return element.id;
    } else {
      const segment = arrowSegment(board, element);
      if (segment && distanceToSegment(p, segment.a, segment.b) <= tolerance) return element.id;
    }
  }
  return null;
}

/** Forma (não texto solto) sob o ponto: é onde uma seta pode se prender. */
export function shapeAt(board: Board, p: Point, except?: string): Shape | undefined {
  for (let i = board.elements.length - 1; i >= 0; i--) {
    const element = board.elements[i];
    if (isShape(element) && element.id !== except && containsPoint(element, p, 4)) return element;
  }
  return undefined;
}

export function elementBounds(board: Board, element: BoardElement): Rect | null {
  if (isShape(element)) return { x: element.x, y: element.y, w: element.w, h: element.h };
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

// ---------------------------------------------------------------- operações

const replace = (board: Board, elements: BoardElement[]): Board => ({ ...board, elements });

export function addShape(board: Board, kind: ShapeKind, rect: Rect, props: Partial<Pick<Shape, 'text' | 'stroke' | 'fill'>> = {}): { board: Board; id: string } {
  const id = newId();
  const shape: Shape = {
    id,
    kind,
    x: rect.x,
    y: rect.y,
    w: Math.max(MIN_SIZE, rect.w),
    h: Math.max(MIN_SIZE, rect.h),
    text: sanitizeText(props.text ?? ''),
    stroke: sanitizeColor(props.stroke, INK),
    fill: sanitizeColor(props.fill, 'transparent'),
  };
  return { board: replace(board, [...board.elements, shape]), id };
}

/** Cria uma seta. Não liga uma forma a ela mesma; devolve null nesse caso. */
export function addArrow(board: Board, start: Endpoint, end: Endpoint, stroke = INK): { board: Board; id: string } | null {
  if (isBound(start) && isBound(end) && start.shape === end.shape) return null;
  for (const endpoint of [start, end]) if (isBound(endpoint) && !findShape(board, endpoint.shape)) return null;
  const id = newId();
  return { board: replace(board, [...board.elements, { id, kind: 'arrow', start, end, stroke: sanitizeColor(stroke, INK) }]), id };
}

/** Liga duas formas com uma seta, se ainda não houver uma no mesmo sentido. */
export function connect(board: Board, from: string, to: string): { board: Board; id: string } | null {
  const existing = board.elements.find(
    (e) => isArrow(e) && isBound(e.start) && isBound(e.end) && e.start.shape === from && e.end.shape === to,
  );
  if (existing) return { board, id: existing.id };
  return addArrow(board, { shape: from }, { shape: to });
}

/** Move formas e as pontas soltas das setas selecionadas. Pontas presas acompanham a forma sozinhas. */
export function moveElements(board: Board, ids: Iterable<string>, dx: number, dy: number): Board {
  const wanted = new Set(ids);
  if (!wanted.size || (!dx && !dy)) return board;
  const shift = (endpoint: Endpoint): Endpoint => (isBound(endpoint) ? endpoint : { x: endpoint.x + dx, y: endpoint.y + dy });
  return replace(
    board,
    board.elements.map((element) => {
      if (!wanted.has(element.id)) return element;
      if (isShape(element)) return { ...element, x: element.x + dx, y: element.y + dy };
      return { ...element, start: shift(element.start), end: shift(element.end) };
    }),
  );
}

export function resizeShape(board: Board, id: string, rect: Rect): Board {
  return replace(
    board,
    board.elements.map((element) =>
      element.id === id && isShape(element)
        ? { ...element, x: rect.x, y: rect.y, w: Math.max(MIN_SIZE, rect.w), h: Math.max(MIN_SIZE, rect.h) }
        : element,
    ),
  );
}

/** Altera texto e cores de vários elementos. Setas só têm cor de traço. */
export function updateElements(board: Board, ids: Iterable<string>, patch: { text?: string; stroke?: string; fill?: string }): Board {
  const wanted = new Set(ids);
  let changed = false;
  const elements = board.elements.map((element) => {
    if (!wanted.has(element.id)) return element;
    const next = isShape(element)
      ? {
          ...element,
          ...(patch.text !== undefined && { text: sanitizeText(patch.text) }),
          ...(patch.stroke !== undefined && { stroke: sanitizeColor(patch.stroke, element.stroke) }),
          ...(patch.fill !== undefined && { fill: sanitizeColor(patch.fill, element.fill) }),
        }
      : { ...element, ...(patch.stroke !== undefined && { stroke: sanitizeColor(patch.stroke, element.stroke) }) };
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
    if (isShape(element)) return [element];
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
 * uma seta copiada sem a forma de uma ponta fica com essa ponta solta.
 */
export function cloneElements(board: Board, source: BoardElement[], dx: number, dy: number): { elements: BoardElement[]; ids: string[] } {
  const remap = new Map(source.map((e) => [e.id, newId()]));
  const elements = source.flatMap((element): BoardElement[] => {
    const id = remap.get(element.id)!;
    if (isShape(element)) return [{ ...element, id, x: element.x + dx, y: element.y + dy }];
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
    return start && end ? [{ ...element, id, start, end }] : [];
  });
  return { elements, ids: elements.map((e) => e.id) };
}

export function duplicateElements(board: Board, ids: Iterable<string>, offset = 24): { board: Board; ids: string[] } {
  const wanted = new Set(ids);
  const source = board.elements.filter((e) => wanted.has(e.id));
  if (!source.length) return { board, ids: [] };
  const copy = cloneElements(board, source, offset, offset);
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

/** Zoom em torno de um ponto da tela: o ponto do quadro sob ele não sai do lugar. */
export function zoomAt(view: View, zoom: number, screen: Point): View {
  const next = clampZoom(zoom);
  const worldX = (screen.x - view.x) / view.zoom;
  const worldY = (screen.y - view.y) / view.zoom;
  return { zoom: next, x: screen.x - worldX * next, y: screen.y - worldY * next };
}

/** Enquadra um retângulo do quadro numa área da tela, com margem; nunca amplia além de 100%. */
export function fitView(rect: Rect | null, width: number, height: number, padding = 48): View {
  if (!rect || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = clampZoom(Math.min(1, (width - padding * 2) / Math.max(rect.w, 1), (height - padding * 2) / Math.max(rect.h, 1)));
  return { zoom, x: (width - rect.w * zoom) / 2 - rect.x * zoom, y: (height - rect.h * zoom) / 2 - rect.y * zoom };
}
