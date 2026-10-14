import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { sanitizeName } from './files.ts';
import type { WbKey, WbTranslate } from './i18n.ts';
import {
  ArrowIcon,
  CopyIcon,
  DiamondIcon,
  DownloadIcon,
  EllipseIcon,
  FitIcon,
  KeyboardIcon,
  LinkIcon,
  PointerIcon,
  RectangleIcon,
  RedoIcon,
  TextIcon,
  UndoIcon,
} from './icons';
import {
  addArrow,
  addShape,
  arrowSegment,
  boardBounds,
  borderPoint,
  center,
  clipboardText,
  connect,
  deleteElements,
  duplicateElements,
  elementBounds,
  elementsInRect,
  FILLS,
  findShape,
  fitView,
  hitTest,
  insertElements,
  isArrow,
  isBound,
  isShape,
  MAX_TEXT,
  moveElements,
  normalizeRect,
  parseClipboard,
  resizeShape,
  sanitizeText,
  serializeBoard,
  shapeAt,
  STROKES,
  updateElements,
  zoomAt,
  type Board,
  type BoardElement,
  type Endpoint,
  type Point,
  type Rect,
  type ShapeKind,
  type View,
} from './model.ts';
import { arrowHead, boardToSvg, elementPrimitives, FONT_FAMILY, fontSize, LINE_HEIGHT, STROKE_WIDTH, TEXT_SIZE, type Primitive } from './render.ts';
import { createAutosave, downloadBlob, measureText, svgToPng } from './storage.ts';

export type Saver = { flush(): Promise<void>; dispose(): void };

type Tool = 'select' | ShapeKind | 'arrow';

const TOOLS: { tool: Tool; key: string; digit: string; icon: (props: { size?: number }) => ReactNode }[] = [
  { tool: 'select', key: 'v', digit: '1', icon: PointerIcon },
  { tool: 'rectangle', key: 'r', digit: '2', icon: RectangleIcon },
  { tool: 'ellipse', key: 'o', digit: '3', icon: EllipseIcon },
  { tool: 'diamond', key: 'd', digit: '4', icon: DiamondIcon },
  { tool: 'arrow', key: 'a', digit: '5', icon: ArrowIcon },
  { tool: 'text', key: 't', digit: '6', icon: TextIcon },
];

const DEFAULT_SIZE: Record<ShapeKind, { w: number; h: number }> = {
  rectangle: { w: 160, h: 80 },
  ellipse: { w: 160, h: 90 },
  diamond: { w: 160, h: 110 },
  text: { w: 40, h: 28 },
};

const HISTORY_LIMIT = 100;
const HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
type Handle = (typeof HANDLES)[number];

type Doc = { board: Board; past: Board[]; future: Board[] };

type Drag =
  | { type: 'pan'; client: Point; view: View }
  | { type: 'move'; start: Point; snapshot: Board; ids: string[]; moved: boolean }
  | { type: 'resize'; id: string; handle: Handle; snapshot: Board; rect: Rect }
  | { type: 'marquee'; start: Point; base: string[] }
  | { type: 'create'; kind: ShapeKind; start: Point }
  | { type: 'arrow'; start: Endpoint; point: Point };

type Draft =
  | { type: 'marquee'; rect: Rect }
  | { type: 'create'; kind: ShapeKind; rect: Rect }
  | { type: 'arrow'; a: Point; b: Point; target?: string };

type Editing = { id: string; snapshot: Board; created: boolean; value: string };

type Props = {
  path: string;
  name: string;
  initial: Board;
  t: WbTranslate;
  saver: MutableRefObject<Saver | null>;
  banner?: ReactNode;
  onRename: (name: string) => void;
};

const sameView = (a: View, b: View) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');

export function BoardEditor({ path, name, initial, t, saver, banner, onRename }: Props) {
  const [doc, setDoc] = useState<Doc>({ board: initial, past: [], future: [] });
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [help, setHelp] = useState(false);
  const [title, setTitle] = useState(name);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [panning, setPanning] = useState<'ready' | 'active' | null>(null);

  const board = doc.board;
  const wrapper = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointerDown = useRef(false);
  const space = useRef(false);
  const latest = useRef({ board, selection, tool, editing });
  latest.current = { board, selection, tool, editing };

  useEffect(() => setTitle(name), [name]);

  // ------------------------------------------------------------ gravação automática

  const autosave = useMemo(() => createAutosave(path, setStatus), [path]);
  useEffect(() => {
    saver.current = autosave;
    const onUnload = () => void autosave.flush();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      void autosave.flush();
      if (saver.current === autosave) saver.current = null;
    };
  }, [autosave, saver]);

  useEffect(() => {
    if (board !== initial) autosave.schedule(board);
  }, [board, initial, autosave]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.kind === 'error' ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // ------------------------------------------------------------ histórico

  const setBoard = useCallback((next: Board) => setDoc((d) => (d.board === next ? d : { ...d, board: next })), []);
  /** Grava `next` no histórico; `before` é o estado que o desfazer devolve. A vista atual é mantida. */
  const commit = useCallback(
    (next: Board, before?: Board) =>
      setDoc((d) => {
        const prior = before ?? d.board;
        if (next === prior) return d;
        return { board: { ...next, view: d.board.view }, past: [...d.past, prior].slice(-HISTORY_LIMIT), future: [] };
      }),
    [],
  );
  const setView = useCallback((view: View) => setDoc((d) => (sameView(d.board.view, view) ? d : { ...d, board: { ...d.board, view } })), []);

  const undo = () =>
    setDoc((d) => {
      const previous = d.past.at(-1);
      if (!previous) return d;
      return { board: { ...previous, view: d.board.view }, past: d.past.slice(0, -1), future: [d.board, ...d.future] };
    });
  const redo = () =>
    setDoc((d) => {
      const next = d.future[0];
      if (!next) return d;
      return { board: { ...next, view: d.board.view }, past: [...d.past, d.board], future: d.future.slice(1) };
    });

  // Seleção nunca aponta para elemento que sumiu (desfazer, apagar).
  useEffect(() => {
    setSelection((current) => {
      const kept = current.filter((id) => board.elements.some((e) => e.id === id));
      return kept.length === current.length ? current : kept;
    });
  }, [board.elements]);

  // ------------------------------------------------------------ vista

  useLayoutEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Quadro com a vista padrão (novo, exemplo, importado): enquadra o conteúdo na primeira abertura.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !size.w) return;
    fitted.current = true;
    const { view, elements } = latest.current.board;
    if (elements.length && sameView(view, { x: 0, y: 0, zoom: 1 })) setView(fitView(boardBounds(latest.current.board), size.w, size.h));
  }, [size, setView]);

  const zoomBy = (factor: number, at?: Point) => {
    const view = latest.current.board.view;
    setView(zoomAt(view, view.zoom * factor, at ?? { x: size.w / 2, y: size.h / 2 }));
  };
  const fitAll = () => setView(fitView(boardBounds(latest.current.board), size.w, size.h));
  const resetZoom = () => zoomBy(1 / latest.current.board.view.zoom);

  const toWorld = (clientX: number, clientY: number): Point => {
    const box = svg.current!.getBoundingClientRect();
    const { view } = latest.current.board;
    return { x: (clientX - box.left - view.x) / view.zoom, y: (clientY - box.top - view.y) / view.zoom };
  };
  // Foco pelo teclado num elemento fora da vista: a vista vai até ele.
  const revealElement = (element: BoardElement) => {
    const rect = elementBounds(latest.current.board, element);
    const { view } = latest.current.board;
    if (!rect || !size.w) return;
    const left = rect.x * view.zoom + view.x;
    const top = rect.y * view.zoom + view.y;
    const inside = left >= 0 && top >= 0 && left + rect.w * view.zoom <= size.w && top + rect.h * view.zoom <= size.h;
    if (!inside) setView({ ...view, x: size.w / 2 - (rect.x + rect.w / 2) * view.zoom, y: size.h / 2 - (rect.y + rect.h / 2) * view.zoom });
  };
  const toScreen = (p: Point): Point => ({ x: p.x * board.view.zoom + board.view.x, y: p.y * board.view.zoom + board.view.y });

  // A roda precisa de preventDefault, que o React não permite (ouvinte passivo).
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const view = latest.current.board.view;
      if (event.ctrlKey || event.metaKey) {
        setView(zoomAt(view, view.zoom * Math.exp(-event.deltaY * 0.0015), { x: event.clientX - box.left, y: event.clientY - box.top }));
      } else {
        const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        setView({ ...view, x: view.x - dx, y: view.y - dy });
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [setView]);

  // ------------------------------------------------------------ edição de texto

  const startEditing = (id: string, snapshot?: Board, created = false) => {
    // Uma edição aberta é concluída antes; o histórico da nova parte do resultado dela.
    if (latest.current.editing) finishEditing();
    // Um texto recém-criado ainda não está no quadro desta renderização.
    const shape = findShape(latest.current.board, id);
    if (!shape && !created) return;
    setSelection([id]);
    setEditing({ id, snapshot: snapshot ?? latest.current.board, created, value: created ? '' : shape!.text });
  };

  const finishEditing = () => {
    const current = latest.current.editing;
    if (!current) return;
    // Blur e clique podem chegar no mesmo gesto: só o primeiro conclui.
    latest.current.editing = null;
    setEditing(null);
    const now = latest.current.board;
    const shape = findShape(now, current.id);
    if (!shape) return;
    // Quem vier logo depois, no mesmo gesto, já lê o quadro com o texto concluído.
    const settle = (next: Board, history: boolean) => {
      latest.current.board = { ...next, view: now.view };
      if (history) commit(next, current.snapshot);
      else setBoard(latest.current.board);
    };
    const value = sanitizeText(current.value);
    if (shape.kind === 'text' && !value.trim()) {
      // Texto vazio não fica no quadro; se acabou de ser criado, nem entra no histórico.
      if (current.created) settle(current.snapshot, false);
      else settle(deleteElements(now, [shape.id]), true);
      return;
    }
    let next = updateElements(now, [shape.id], { text: value });
    if (shape.kind === 'text') {
      const measured = measureText(value, fontSize(shape), FONT_FAMILY, LINE_HEIGHT);
      next = resizeShape(next, shape.id, { x: shape.x, y: shape.y, ...measured });
    }
    if (current.created || next !== now) settle(next, true);
    wrapper.current?.focus({ preventScroll: true });
  };

  // ------------------------------------------------------------ ações

  const selectAll = () => setSelection(latest.current.board.elements.map((e) => e.id));
  const removeSelection = () => {
    const { board, selection } = latest.current;
    if (selection.length) commit(deleteElements(board, selection));
  };
  const duplicate = () => {
    const { board, selection } = latest.current;
    const result = duplicateElements(board, selection);
    if (!result.ids.length) return;
    commit(result.board);
    setSelection(result.ids);
  };
  const connectSelection = () => {
    const { board, selection } = latest.current;
    const shapes = selection.filter((id) => findShape(board, id) && findShape(board, id)!.kind !== 'text');
    if (shapes.length !== 2) return;
    const result = connect(board, shapes[0], shapes[1]);
    if (!result) return;
    commit(result.board);
    setSelection([result.id]);
  };
  const nudge = (dx: number, dy: number) => {
    const { board, selection } = latest.current;
    if (selection.length) commit(moveElements(board, selection, dx, dy));
  };
  const restyle = (patch: { stroke?: string; fill?: string }) => {
    const { board, selection } = latest.current;
    commit(updateElements(board, selection, patch));
  };

  const viewCenter = () => toWorldFromScreen({ x: size.w / 2, y: size.h / 2 });
  const toWorldFromScreen = (p: Point): Point => {
    const { view } = latest.current.board;
    return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
  };

  const copy = async (cut: boolean) => {
    const { board, selection } = latest.current;
    if (!selection.length) return;
    try {
      await navigator.clipboard.writeText(clipboardText(board, selection));
      if (cut) commit(deleteElements(latest.current.board, selection));
    } catch (error) {
      setNotice({ kind: 'error', text: t('error.action', { detail: error instanceof Error ? error.message : String(error) }) });
    }
  };

  /** Cola elementos do próprio quadro ou, se for texto comum, cria um texto no centro da vista. */
  const pasteText = (text: string) => {
    const { board } = latest.current;
    const elements = parseClipboard(text);
    if (elements) {
      const bounds = boardBounds({ ...board, elements });
      const target = viewCenter();
      const dx = bounds ? target.x - (bounds.x + bounds.w / 2) : 0;
      const dy = bounds ? target.y - (bounds.y + bounds.h / 2) : 0;
      const result = insertElements(board, elements, dx, dy);
      if (!result.ids.length) return;
      commit(result.board);
      setSelection(result.ids);
      return;
    }
    const clean = sanitizeText(text).slice(0, MAX_TEXT);
    if (!clean.trim()) return;
    const measured = measureText(clean, TEXT_SIZE, FONT_FAMILY, LINE_HEIGHT);
    const at = viewCenter();
    const result = addShape(board, 'text', { x: at.x - measured.w / 2, y: at.y - measured.h / 2, ...measured }, { text: clean });
    commit(result.board);
    setSelection([result.id]);
  };
  const paste = async () => {
    try {
      pasteText(await navigator.clipboard.readText());
    } catch (error) {
      setNotice({ kind: 'error', text: t('error.action', { detail: error instanceof Error ? error.message : String(error) }) });
    }
  };

  // Colar pelo menu Editar (sem tecla): chega como evento de colagem no documento.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!wrapper.current?.contains(document.activeElement) || isTyping(document.activeElement)) return;
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return;
      event.preventDefault();
      pasteText(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const exportAs = async (format: 'svg' | 'png' | 'json') => {
    const current = latest.current.board;
    if (!current.elements.length && format !== 'json') return setNotice({ kind: 'error', text: t('exportEmpty') });
    const file = sanitizeName(name) || 'whiteboard';
    try {
      if (format === 'json') {
        downloadBlob(new Blob([serializeBoard(current)], { type: 'application/json' }), `${file}.whiteboard.json`);
      } else {
        const { svg: markup, width, height } = boardToSvg(current);
        const blob = format === 'svg' ? new Blob([markup], { type: 'image/svg+xml' }) : await svgToPng(markup, width, height);
        downloadBlob(blob, `${file}.${format}`);
      }
    } catch (error) {
      setNotice({ kind: 'error', text: t('exportFailed', { detail: error instanceof Error ? error.message : String(error) }) });
    }
  };

  // ------------------------------------------------------------ teclado

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (isTyping(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (ctrl) {
      if (key === 'z' && !event.shiftKey) return handled(), undo();
      if ((key === 'z' && event.shiftKey) || key === 'y') return handled(), redo();
      if (key === 'a') return handled(), selectAll();
      if (key === 'd') return handled(), duplicate();
      if (key === 'c') return handled(), void copy(false);
      if (key === 'x') return handled(), void copy(true);
      if (key === 'v') return handled(), void paste();
      return;
    }
    if (event.altKey) return;

    if (key === ' ') {
      handled();
      space.current = true;
      if (!drag.current) setPanning('ready');
      return;
    }
    if (key === 'escape') {
      handled();
      if (help) setHelp(false);
      else if (latest.current.tool !== 'select') setTool('select');
      else setSelection([]);
      wrapper.current?.focus({ preventScroll: true });
      return;
    }
    if (key === 'delete' || key === 'backspace') return handled(), removeSelection();
    if (key === 'enter') {
      const [only] = latest.current.selection;
      if (latest.current.selection.length === 1 && findShape(latest.current.board, only)) return handled(), startEditing(only);
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    if (key === 'arrowleft') return handled(), nudge(-step, 0);
    if (key === 'arrowright') return handled(), nudge(step, 0);
    if (key === 'arrowup') return handled(), nudge(0, -step);
    if (key === 'arrowdown') return handled(), nudge(0, step);
    if (key === '+' || key === '=') return handled(), zoomBy(1.2);
    if (key === '-' || key === '_') return handled(), zoomBy(1 / 1.2);
    if (key === '0') return handled(), resetZoom();
    if (event.code === 'Digit1' && event.shiftKey) return handled(), fitAll();
    if (key === '?') return handled(), setHelp((open) => !open);
    if (key === 'c') return handled(), connectSelection();
    const match = TOOLS.find((entry) => entry.key === key || (!event.shiftKey && entry.digit === key));
    if (match) return handled(), setTool(match.tool);
  };

  const onKeyUp = (event: ReactKeyboardEvent) => {
    if (event.key === ' ') {
      space.current = false;
      if (drag.current?.type !== 'pan') setPanning(null);
    }
  };

  // ------------------------------------------------------------ ponteiro

  const endpointAt = (p: Point, except?: string): { endpoint: Endpoint; shape?: string } => {
    const target = shapeAt(latest.current.board, p, except);
    return target ? { endpoint: { shape: target.id }, shape: target.id } : { endpoint: { x: p.x, y: p.y } };
  };
  const endpointPoint = (endpoint: Endpoint, toward: Point): Point => {
    if (!isBound(endpoint)) return endpoint;
    const shape = findShape(latest.current.board, endpoint.shape);
    return shape ? borderPoint(shape, toward) : toward;
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    if (latest.current.editing) finishEditing();
    const target = event.target as Element;
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as Handle | null;
    if (!handle && target.closest('[data-ui]')) return;
    wrapper.current?.focus({ preventScroll: true });
    pointerDown.current = true;
    const world = toWorld(event.clientX, event.clientY);
    const { board, selection, tool } = latest.current;

    if (event.button === 1 || (event.button === 0 && space.current)) {
      event.preventDefault();
      drag.current = { type: 'pan', client: { x: event.clientX, y: event.clientY }, view: board.view };
      setPanning('active');
      return;
    }
    if (event.button !== 0) return;

    if (handle && selection.length === 1) {
      const shape = findShape(board, selection[0]);
      if (shape) {
        drag.current = { type: 'resize', id: shape.id, handle, snapshot: board, rect: { x: shape.x, y: shape.y, w: shape.w, h: shape.h } };
        return;
      }
    }

    if (tool === 'arrow') {
      const { endpoint } = endpointAt(world);
      drag.current = { type: 'arrow', start: endpoint, point: world };
      return;
    }
    if (tool !== 'select') {
      drag.current = { type: 'create', kind: tool, start: world };
      return;
    }

    const hit = hitTest(board, world, 6 / board.view.zoom);
    if (hit) {
      let ids = selection;
      if (event.shiftKey) ids = selection.includes(hit) ? selection.filter((id) => id !== hit) : [...selection, hit];
      else if (!selection.includes(hit)) ids = [hit];
      setSelection(ids);
      if (ids.includes(hit)) drag.current = { type: 'move', start: world, snapshot: board, ids, moved: false };
      return;
    }
    drag.current = { type: 'marquee', start: world, base: event.shiftKey ? selection : [] };
    if (!event.shiftKey) setSelection([]);
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      if (current.type === 'pan') {
        setView({ ...current.view, x: current.view.x + event.clientX - current.client.x, y: current.view.y + event.clientY - current.client.y });
        return;
      }
      const world = toWorld(event.clientX, event.clientY);
      if (current.type === 'move') {
        const dx = world.x - current.start.x;
        const dy = world.y - current.start.y;
        if (!current.moved && Math.hypot(dx, dy) * latest.current.board.view.zoom < 2) return;
        current.moved = true;
        setBoard({ ...moveElements(current.snapshot, current.ids, dx, dy), view: latest.current.board.view });
      } else if (current.type === 'resize') {
        const { rect, handle } = current;
        const fixed = { x: handle.includes('w') ? rect.x + rect.w : rect.x, y: handle.includes('n') ? rect.y + rect.h : rect.y };
        setBoard({ ...resizeShape(current.snapshot, current.id, normalizeRect(fixed, world)), view: latest.current.board.view });
      } else if (current.type === 'marquee') {
        setDraft({ type: 'marquee', rect: normalizeRect(current.start, world) });
      } else if (current.type === 'create') {
        setDraft({ type: 'create', kind: current.kind, rect: normalizeRect(current.start, world) });
      } else if (current.type === 'arrow') {
        const except = isBound(current.start) ? current.start.shape : undefined;
        const { shape } = endpointAt(world, except);
        const target = shape ? findShape(latest.current.board, shape) : undefined;
        const b = target ? borderPoint(target, endpointPoint(current.start, center(target))) : world;
        const a = endpointPoint(current.start, target ? center(target) : world);
        setDraft({ type: 'arrow', a, b, target: shape });
      }
    };

    const onUp = (event: PointerEvent) => {
      const current = drag.current;
      pointerDown.current = false;
      if (!current) return;
      drag.current = null;
      setDraft(null);
      const { board } = latest.current;
      if (current.type === 'pan') {
        setPanning(space.current ? 'ready' : null);
        return;
      }
      const world = toWorld(event.clientX, event.clientY);
      if (current.type === 'move' || current.type === 'resize') {
        if (board !== current.snapshot) commit(board, current.snapshot);
        return;
      }
      if (current.type === 'marquee') {
        const rect = normalizeRect(current.start, world);
        if (rect.w * board.view.zoom > 3 || rect.h * board.view.zoom > 3) setSelection([...new Set([...current.base, ...elementsInRect(board, rect)])]);
        return;
      }
      if (current.type === 'create') {
        let rect = normalizeRect(current.start, world);
        const tiny = rect.w * board.view.zoom < 6 && rect.h * board.view.zoom < 6;
        if (tiny) {
          const size = DEFAULT_SIZE[current.kind];
          rect = current.kind === 'text' ? { x: current.start.x, y: current.start.y - size.h / 2, ...size } : { x: current.start.x - size.w / 2, y: current.start.y - size.h / 2, ...size };
        }
        const result = addShape(board, current.kind, rect);
        setTool('select');
        if (current.kind === 'text') {
          setBoard(result.board);
          startEditing(result.id, board, true);
        } else {
          commit(result.board, board);
          setSelection([result.id]);
        }
        return;
      }
      if (current.type === 'arrow') {
        const except = isBound(current.start) ? current.start.shape : undefined;
        const { endpoint } = endpointAt(world, except);
        const startPoint = endpointPoint(current.start, world);
        const endPoint = endpointPoint(endpoint, startPoint);
        setTool('select');
        if (Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y) * board.view.zoom < 10 && !(isBound(current.start) && isBound(endpoint))) return;
        const result = addArrow(board, current.start, endpoint);
        if (!result) return;
        commit(result.board, board);
        setSelection([result.id]);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // Os ouvintes leem o estado por `latest`; só as funções estáveis entram nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, setBoard, setView]);

  const onDoubleClick = (event: ReactMouseEvent) => {
    if ((event.target as Element).closest('[data-ui]')) return;
    const { board } = latest.current;
    const world = toWorld(event.clientX, event.clientY);
    const hit = hitTest(board, world, 6 / board.view.zoom);
    const shape = hit ? findShape(board, hit) : undefined;
    if (shape) return startEditing(shape.id);
    if (hit) return;
    const result = addShape(board, 'text', { x: world.x, y: world.y - DEFAULT_SIZE.text.h / 2, ...DEFAULT_SIZE.text });
    setBoard(result.board);
    startEditing(result.id, board, true);
  };

  // ------------------------------------------------------------ desenho

  const selected = useMemo(() => new Set(selection), [selection]);
  const single = selection.length === 1 ? board.elements.find((e) => e.id === selection[0]) : undefined;
  const selectedShapes = selection.filter((id) => findShape(board, id)?.kind && findShape(board, id)!.kind !== 'text');
  const zoom = board.view.zoom;
  const cursor = panning ? (panning === 'active' ? 'grabbing' : 'grab') : tool === 'select' ? 'default' : 'crosshair';
  const editingShape = editing ? findShape(board, editing.id) : undefined;
  const editingBox = editingShape && (() => {
    const p = toScreen({ x: editingShape.x, y: editingShape.y });
    const lineCount = Math.max(1, editing!.value.split('\n').length);
    const fs = fontSize(editingShape) * zoom;
    if (editingShape.kind === 'text') {
      const measured = measureText(editing!.value || ' ', fontSize(editingShape), FONT_FAMILY, LINE_HEIGHT);
      return { left: p.x, top: p.y, width: Math.max(measured.w + 40, 120) * zoom, height: (measured.h + 8) * zoom, fs, align: 'left' as const };
    }
    const height = lineCount * fs * LINE_HEIGHT;
    return { left: p.x, top: p.y + (editingShape.h * zoom - height) / 2, width: editingShape.w * zoom, height: height + 4, fs, align: 'center' as const };
  })();

  const describe = (element: BoardElement) => {
    if (isShape(element)) return `${t(`kind.${element.kind}` as WbKey)}${element.text ? `: ${element.text.split('\n')[0]}` : ''}`;
    const label = (endpoint: Endpoint) => (isBound(endpoint) ? findShape(board, endpoint.shape)?.text.split('\n')[0] || t(`kind.${findShape(board, endpoint.shape)?.kind ?? 'rectangle'}` as WbKey) : '·');
    return `${t('kind.arrow')}: ${label(element.start)} → ${label(element.end)}`;
  };

  const statusText = status === 'saving' ? t('saving') : status === 'saved' ? t('saved') : status === 'error' ? t('saveError') : '';
  const button = 'icon-button h-7 w-7 disabled:pointer-events-none disabled:opacity-35';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-2 pt-3">
        <input
          className="min-w-32 max-w-[min(560px,60%)] flex-1 truncate rounded-md bg-transparent px-1.5 py-0.5 font-display text-[19px] font-semibold tracking-tight text-frost-100 outline-none hover:bg-[var(--hover)] focus:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-sheen-400"
          aria-label={t('nameLabel')}
          value={title}
          spellCheck={false}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => (sanitizeName(title) && title !== name ? onRename(title) : setTitle(name))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setTitle(name);
              wrapper.current?.focus();
            }
          }}
        />
        <span className={`text-[12px] ${status === 'error' ? 'text-danger' : 'text-frost-500'}`} role="status" aria-live="polite" data-testid="wb-status">
          {statusText}
        </span>
        {status === 'error' && (
          <button className="rounded-md px-2 py-0.5 text-[12px] text-frost-300 hover:bg-[var(--hover)]" onClick={() => void autosave.flush()}>
            {t('saveRetry')}
          </button>
        )}
        <span className="flex-1" />
        <button className={button} title={`${t('undo')} (Ctrl+Z)`} aria-label={t('undo')} disabled={!doc.past.length} onClick={undo}>
          <UndoIcon />
        </button>
        <button className={button} title={`${t('redo')} (Ctrl+Shift+Z)`} aria-label={t('redo')} disabled={!doc.future.length} onClick={redo}>
          <RedoIcon />
        </button>
        <span className="mx-1 h-4 w-px bg-[var(--hairline-strong)]" aria-hidden="true" />
        <div className="flex items-center gap-0.5" role="group" aria-label={t('export')}>
          <DownloadIcon className="mr-1 text-frost-500" />
          {(['svg', 'png', 'json'] as const).map((format) => (
            <button
              key={format}
              className="rounded-md px-2 py-1 font-mono text-[11.5px] text-frost-300 hover:bg-[var(--hover)] hover:text-frost-100"
              data-testid={`wb-export-${format}`}
              title={`${t('export')} ${format.toUpperCase()}`}
              onClick={() => void exportAs(format)}
            >
              {t(format === 'svg' ? 'exportSvg' : format === 'png' ? 'exportPng' : 'exportJson')}
            </button>
          ))}
        </div>
        <span className="mx-1 h-4 w-px bg-[var(--hairline-strong)]" aria-hidden="true" />
        <button className={button} title={`${t('shortcuts')} (?)`} aria-label={t('shortcuts')} aria-expanded={help} onClick={() => setHelp((open) => !open)}>
          <KeyboardIcon />
        </button>
      </header>

      {banner}
      {notice && (
        <p className={`mx-4 mb-2 text-[12.5px] ${notice.kind === 'error' ? 'text-danger' : 'text-sheen-300'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}

      <div
        ref={wrapper}
        className="sheet wb-canvas relative mx-2 mb-2 min-h-0 flex-1 overflow-hidden outline-none"
        style={{
          cursor,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${board.view.x}px ${board.view.y}px`,
        }}
        tabIndex={0}
        role="application"
        aria-roledescription="whiteboard"
        aria-label={t('canvasLabel', { name })}
        data-testid="wb-canvas"
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            space.current = false;
            setPanning(null);
          }
        }}
      >
        <svg ref={svg} className="absolute inset-0 h-full w-full touch-none select-none" style={{ fontFamily: FONT_FAMILY }}>
          <g transform={`translate(${board.view.x} ${board.view.y}) scale(${zoom})`}>
            {board.elements.map((element) => (
              <g
                key={element.id}
                tabIndex={0}
                role="button"
                aria-label={describe(element)}
                aria-pressed={selected.has(element.id)}
                data-element-id={element.id}
                data-kind={element.kind}
                data-x={isShape(element) ? Math.round(element.x) : undefined}
                data-y={isShape(element) ? Math.round(element.y) : undefined}
                className="wb-element"
                onFocus={() => {
                  if (pointerDown.current) return;
                  if (!selected.has(element.id)) setSelection([element.id]);
                  revealElement(element);
                }}
              >
                {elementPrimitives(board, element, { hideText: editing?.id === element.id }).map((primitive, index) => (
                  <PrimitiveView key={index} primitive={primitive} />
                ))}
              </g>
            ))}

            {draft?.type === 'create' && (
              <g opacity={0.6} pointerEvents="none">
                {elementPrimitives(board, { id: 'draft', kind: draft.kind, ...draft.rect, w: Math.max(draft.rect.w, 1), h: Math.max(draft.rect.h, 1), text: '', stroke: '#0c6c64', fill: 'transparent' }).map((primitive, index) => (
                  <PrimitiveView key={index} primitive={primitive} />
                ))}
              </g>
            )}
            {draft?.type === 'arrow' && (
              <g pointerEvents="none" opacity={0.7}>
                {draft.target && <SelectionBox rect={elementBounds(board, findShape(board, draft.target)!)!} zoom={zoom} />}
                <PrimitiveView primitive={{ type: 'line', a: draft.a, b: draft.b, stroke: '#0c6c64' }} />
                <PrimitiveView primitive={{ type: 'polygon', points: arrowHead(draft.a, draft.b), stroke: '#0c6c64', fill: '#0c6c64' }} />
              </g>
            )}

            {selection.map((id) => {
              const element = board.elements.find((e) => e.id === id);
              const rect = element && elementBounds(board, element);
              return rect ? <SelectionBox key={id} rect={rect} zoom={zoom} /> : null;
            })}
            {single && isShape(single) && !editing && !drag.current && (
              <g>
                {HANDLES.map((handle) => {
                  const size = 9 / zoom;
                  const x = handle.includes('w') ? single.x : single.x + single.w;
                  const y = handle.includes('n') ? single.y : single.y + single.h;
                  return (
                    <rect
                      key={handle}
                      data-handle={handle}
                      x={x - size / 2}
                      y={y - size / 2}
                      width={size}
                      height={size}
                      rx={2 / zoom}
                      fill="#ffffff"
                      stroke="#0c6c64"
                      strokeWidth={1.5 / zoom}
                      style={{ cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize' }}
                    />
                  );
                })}
              </g>
            )}
            {single && isArrow(single) && (() => {
              const segment = arrowSegment(board, single);
              return segment ? (
                <g pointerEvents="none">
                  {[segment.a, segment.b].map((p, index) => (
                    <circle key={index} cx={p.x} cy={p.y} r={4 / zoom} fill="#ffffff" stroke="#0c6c64" strokeWidth={1.5 / zoom} />
                  ))}
                </g>
              ) : null;
            })()}
            {draft?.type === 'marquee' && (
              <rect
                x={draft.rect.x}
                y={draft.rect.y}
                width={draft.rect.w}
                height={draft.rect.h}
                fill="rgb(79 191 180 / 0.08)"
                stroke="#0c6c64"
                strokeWidth={1 / zoom}
                strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                pointerEvents="none"
              />
            )}
          </g>
        </svg>

        {editing && editingBox && (
          <textarea
            className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 text-ink outline-none"
            style={{
              left: editingBox.left,
              top: editingBox.top,
              width: editingBox.width,
              height: editingBox.height,
              fontSize: editingBox.fs,
              lineHeight: LINE_HEIGHT,
              fontFamily: FONT_FAMILY,
              textAlign: editingBox.align,
              color: editingShape!.stroke,
              whiteSpace: 'pre',
            }}
            data-ui="text"
            aria-label={t('textLabel')}
            maxLength={MAX_TEXT}
            autoFocus
            value={editing.value}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setEditing({ ...editing, value: event.target.value })}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
                event.preventDefault();
                finishEditing();
              }
            }}
          />
        )}

        {!board.elements.length && !draft && !editing && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-[14px] text-ink-faint">{t('emptyCanvas')}</p>
        )}

        <div
          data-ui="tools"
          role="toolbar"
          aria-label={t('tools')}
          className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-0.5 rounded-lg bg-paper-raised p-1 shadow-[0_0_0_1px_var(--color-paper-line),0_6px_18px_-8px_rgb(0_0_0_/_0.35)]"
        >
          {TOOLS.map(({ tool: id, key, digit, icon: Icon }) => (
            <button
              key={id}
              className="sheet-button relative grid h-8 w-8 place-items-center rounded-md data-[on=true]:bg-[#d7f0ec]"
              data-on={tool === id}
              aria-pressed={tool === id}
              title={`${t(`tool.${id}` as WbKey)} (${key.toUpperCase()} / ${digit})`}
              aria-label={t(`tool.${id}` as WbKey)}
              aria-keyshortcuts={`${key.toUpperCase()} ${digit}`}
              data-testid={`wb-tool-${id}`}
              onClick={() => {
                setTool(id);
                wrapper.current?.focus({ preventScroll: true });
              }}
            >
              <Icon size={16} />
              <span className="absolute bottom-0 right-0.5 font-mono text-[8.5px] text-ink-faint" aria-hidden="true">
                {digit}
              </span>
            </button>
          ))}
        </div>

        {selection.length > 0 && !editing && (
          <div
            data-ui="style"
            className="absolute left-3 top-14 flex w-[164px] flex-col gap-2.5 rounded-lg bg-paper-raised p-2.5 text-[11.5px] text-ink-soft shadow-[0_0_0_1px_var(--color-paper-line),0_6px_18px_-8px_rgb(0_0_0_/_0.35)]"
          >
            <Swatches label={t('stroke')} colors={STROKES} t={t} onPick={(stroke) => restyle({ stroke })} current={single?.stroke} />
            {selection.some((id) => findShape(board, id)) && (
              <Swatches label={t('fill')} colors={FILLS} t={t} onPick={(fill) => restyle({ fill })} current={single && isShape(single) ? single.fill : undefined} />
            )}
            <div className="flex gap-1 border-t border-paper-line pt-2">
              {single && isShape(single) && (
                <button className="sheet-button grid h-7 w-7 place-items-center rounded-md" title={`${t('editText')} (Enter)`} aria-label={t('editText')} onClick={() => startEditing(single.id)}>
                  <TextIcon size={14} />
                </button>
              )}
              {selectedShapes.length === 2 && (
                <button className="sheet-button grid h-7 w-7 place-items-center rounded-md" title={`${t('connect')} (C)`} aria-label={t('connect')} data-testid="wb-connect" onClick={connectSelection}>
                  <LinkIcon size={14} />
                </button>
              )}
              <button className="sheet-button grid h-7 w-7 place-items-center rounded-md" title={`${t('duplicate')} (Ctrl+D)`} aria-label={t('duplicate')} onClick={duplicate}>
                <CopyIcon size={14} />
              </button>
              <button className="sheet-button grid h-7 w-7 place-items-center rounded-md hover:!text-[#b91c1c]" title={`${t('delete')} (Delete)`} aria-label={t('delete')} onClick={removeSelection}>
                <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.4c.05.66.6 1.1 1.25 1.1h4.3c.65 0 1.2-.44 1.25-1.1l.6-8.4" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div
          data-ui="zoom"
          className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg bg-paper-raised p-1 text-[12px] text-ink-soft shadow-[0_0_0_1px_var(--color-paper-line),0_6px_18px_-8px_rgb(0_0_0_/_0.35)]"
        >
          <button className="sheet-button grid h-7 w-7 place-items-center rounded-md" title={`${t('zoomOut')} (−)`} aria-label={t('zoomOut')} onClick={() => zoomBy(1 / 1.2)}>
            −
          </button>
          <button className="sheet-button h-7 min-w-12 rounded-md px-1 font-mono tabular-nums" title={`${t('zoomReset')} (0)`} aria-label={t('zoomReset')} onClick={resetZoom}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="sheet-button grid h-7 w-7 place-items-center rounded-md" title={`${t('zoomIn')} (+)`} aria-label={t('zoomIn')} onClick={() => zoomBy(1.2)}>
            +
          </button>
          <button className="sheet-button grid h-7 w-7 place-items-center rounded-md" title={`${t('zoomFit')} (Shift+1)`} aria-label={t('zoomFit')} onClick={fitAll}>
            <FitIcon size={14} />
          </button>
        </div>

        {help && (
          <div
            data-ui="help"
            role="dialog"
            aria-label={t('shortcuts')}
            className="absolute bottom-3 left-3 max-w-[min(420px,calc(100%-24px))] rounded-lg bg-obsidian-700 p-3.5 text-[12.5px] leading-relaxed text-frost-300 shadow-[0_0_0_1px_var(--hairline-strong),0_12px_30px_-10px_rgb(0_0_0_/_0.7)]"
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="section-label">{t('shortcuts')}</span>
              <button className="icon-button" aria-label={t('close')} onClick={() => setHelp(false)}>
                ×
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {(['help.tools', 'help.move', 'help.select', 'help.edit', 'help.connect', 'help.clipboard', 'help.delete', 'help.history', 'help.view', 'help.pan'] as const).map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function SelectionBox({ rect, zoom }: { rect: Rect; zoom: number }) {
  const pad = 5 / zoom;
  return (
    <rect
      x={rect.x - pad}
      y={rect.y - pad}
      width={rect.w + pad * 2}
      height={rect.h + pad * 2}
      rx={3 / zoom}
      fill="none"
      stroke="#0c6c64"
      strokeWidth={1.25 / zoom}
      strokeDasharray={`${5 / zoom} ${3 / zoom}`}
      pointerEvents="none"
    />
  );
}

function Swatches({ label, colors, current, t, onPick }: { label: string; colors: readonly string[]; current?: string; t: WbTranslate; onPick: (color: string) => void }) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      <div className="flex flex-wrap gap-1">
        {colors.map((color) => (
          <button
            key={color}
            className="h-5 w-5 rounded-[5px] ring-1 ring-paper-line transition-[box-shadow] hover:ring-ink-faint data-[on=true]:ring-2 data-[on=true]:ring-sheen-700"
            style={{
              background:
                color === 'transparent' ? 'linear-gradient(135deg, #ffffff 45%, #b91c1c 45%, #b91c1c 55%, #ffffff 55%)' : color,
            }}
            data-on={current === color}
            aria-pressed={current === color}
            title={t(`color.${color}` as WbKey)}
            aria-label={t(`color.${color}` as WbKey)}
            onClick={() => onPick(color)}
          />
        ))}
      </div>
    </div>
  );
}

function PrimitiveView({ primitive: p }: { primitive: Primitive }) {
  const paint = (stroke: string, fill: string) => ({ stroke, strokeWidth: STROKE_WIDTH, fill: fill === 'transparent' ? 'none' : fill });
  switch (p.type) {
    case 'rect':
      return <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx} {...paint(p.stroke, p.fill)} />;
    case 'ellipse':
      return <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} {...paint(p.stroke, p.fill)} />;
    case 'polygon':
      return <polygon points={p.points.map((q) => `${q.x},${q.y}`).join(' ')} strokeLinejoin="round" {...paint(p.stroke, p.fill)} />;
    case 'line':
      return <line x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke={p.stroke} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />;
    case 'text':
      return (
        <text fontSize={p.size} fill={p.color} textAnchor={p.anchor} style={{ whiteSpace: 'pre' }}>
          {p.lines.map((line, index) => (
            <tspan key={index} x={p.x} y={p.y + index * p.size * LINE_HEIGHT}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      );
  }
}
