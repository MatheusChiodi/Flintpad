import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
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
  ChevronIcon,
  CloseIcon,
  DiamondIcon,
  DownloadIcon,
  DrawIcon,
  EllipseIcon,
  EraserIcon,
  FitIcon,
  GridIcon,
  HandIcon,
  ImageIcon,
  KeyboardIcon,
  LineIcon,
  LockIcon,
  MoonIcon,
  PointerIcon,
  RectangleIcon,
  RedoIcon,
  SearchIcon,
  TextIcon,
  UndoIcon,
} from './icons';
import { ContextMenu, type MenuEntry } from './Menu';
import {
  addArrow,
  addDrawing,
  addPicture,
  addShape,
  alignElements,
  arrowSegment,
  boardBounds,
  borderPoint,
  center,
  clipboardText,
  connect,
  constrainAngle,
  constrainAxis,
  constrainRatio,
  constrainSquare,
  deleteElements,
  distributeElements,
  duplicateElements,
  elementBounds,
  elementsInRect,
  findElement,
  findShape,
  fitView,
  groupElements,
  hitTest,
  insertElements,
  isArrow,
  isBound,
  isBox,
  isShape,
  MAX_BOARD_BYTES,
  MAX_ELEMENTS,
  MAX_LINK,
  MAX_TEXT,
  moveElements,
  normalizeRect,
  parseClipboard,
  reorder,
  resizeShape,
  sanitizeLink,
  sanitizeText,
  searchElements,
  serializeBoard,
  setArrowEnd,
  shapeAt,
  snapToGrid,
  ungroupElements,
  unlockedIds,
  updateElements,
  withGroups,
  zoomAt,
  type Align,
  type Board,
  type BoardElement,
  type Endpoint,
  type Layer,
  type Patch,
  type Point,
  type Rect,
  type ShapeKind,
  type View,
} from './model.ts';
import { arrowHead, boardToSvg, elementPrimitives, FONT_FAMILY, fontFamily, fontSize, LINE_HEIGHT, MONO_FAMILY, pathData, TEXT_SIZE, type Primitive } from './render.ts';
import { copyPng, createAutosave, downloadBlob, IMAGE_TYPES, measureText, readImage, svgToPng } from './storage.ts';
import { StylePanel } from './StylePanel';

export type Saver = { flush(): Promise<void>; dispose(): void };

type Tool = 'select' | 'hand' | ShapeKind | 'arrow' | 'line' | 'draw' | 'eraser';
type ToolEntry = { tool: Tool; key: string; digit?: string; icon: (props: { size?: number }) => ReactNode };

// Os dígitos 1–6 continuam os de antes; as ferramentas novas vêm depois.
const TOOLS: ToolEntry[] = [
  { tool: 'select', key: 'v', digit: '1', icon: PointerIcon },
  { tool: 'rectangle', key: 'r', digit: '2', icon: RectangleIcon },
  { tool: 'ellipse', key: 'o', digit: '3', icon: EllipseIcon },
  { tool: 'diamond', key: 'd', digit: '4', icon: DiamondIcon },
  { tool: 'arrow', key: 'a', digit: '5', icon: ArrowIcon },
  { tool: 'text', key: 't', digit: '6', icon: TextIcon },
  { tool: 'draw', key: 'p', digit: '7', icon: DrawIcon },
  { tool: 'line', key: 'l', digit: '8', icon: LineIcon },
];
const EXTRA_TOOLS: ToolEntry[] = [
  { tool: 'hand', key: 'h', icon: HandIcon },
  { tool: 'eraser', key: 'e', icon: EraserIcon },
];

const DEFAULT_SIZE: Record<ShapeKind, { w: number; h: number }> = {
  rectangle: { w: 160, h: 80 },
  ellipse: { w: 160, h: 90 },
  diamond: { w: 160, h: 110 },
  text: { w: 40, h: 28 },
};

const GRID = 24;
const HISTORY_LIMIT = 100;
const HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
type Handle = (typeof HANDLES)[number];
type End = 'start' | 'end';

type Doc = { board: Board; past: Board[]; future: Board[] };

type Drag =
  | { type: 'pan'; client: Point; view: View }
  | { type: 'move'; start: Point; snapshot: Board; before: Board; ids: string[]; moved: boolean; origin: Rect | null }
  | { type: 'resize'; id: string; handle: Handle; snapshot: Board; rect: Rect }
  | { type: 'endpoint'; id: string; which: End; snapshot: Board }
  | { type: 'marquee'; start: Point; base: string[] }
  | { type: 'create'; kind: ShapeKind; start: Point }
  | { type: 'arrow'; start: Endpoint; point: Point; head: 'end' | 'none' }
  | { type: 'draw'; points: Point[] }
  | { type: 'erase'; ids: Set<string> };

type Draft =
  | { type: 'marquee'; rect: Rect }
  | { type: 'create'; kind: ShapeKind; rect: Rect }
  | { type: 'arrow'; a: Point; b: Point; target?: string; head: 'end' | 'none' }
  | { type: 'draw'; points: Point[] }
  | { type: 'endpoint'; target?: string };

type Editing = { id: string; snapshot: Board; created: boolean; value: string };

type Props = {
  path: string;
  name: string;
  initial: Board;
  t: WbTranslate;
  saver: MutableRefObject<Saver | null>;
  banner?: ReactNode;
  /** Notas do vault, para sugerir links. */
  notes?: readonly { path: string; name: string }[];
  onRename: (name: string) => void;
  /** Abre o link de um elemento (nota ou site). */
  onOpenLink?: (link: string) => void;
};

const sameView = (a: View, b: View) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');
// Botões dentro do quadro (ferramentas, cores, zoom) precisam de Espaço e Enter para funcionar pelo teclado.
const isControl = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.tagName === 'SELECT');

// Preferências do quadro (grade, tema, exportação) ficam neste computador, não no arquivo.
const PREF = 'obnotion.whiteboard.';
function readPref(name: string): boolean {
  try {
    return localStorage.getItem(PREF + name) === '1';
  } catch {
    return false;
  }
}
function writePref(name: string, value: boolean) {
  try {
    localStorage.setItem(PREF + name, value ? '1' : '0');
  } catch {
    // Sem armazenamento (janela de captura, dados bloqueados): a preferência vale só nesta sessão.
  }
}
function usePref(name: string) {
  const [value, setValue] = useState(() => readPref(name));
  const set = useCallback(
    (next: boolean | ((current: boolean) => boolean)) =>
      setValue((current) => {
        const resolved = typeof next === 'function' ? next(current) : next;
        writePref(name, resolved);
        return resolved;
      }),
    [name],
  );
  return [value, set] as const;
}

export function BoardEditor({ path, name, initial, t, saver, banner, notes = [], onRename, onOpenLink }: Props) {
  const [doc, setDoc] = useState<Doc>({ board: initial, past: [], future: [] });
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [toolLock, setToolLock] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [help, setHelp] = useState(false);
  const [title, setTitle] = useState(name);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [panning, setPanning] = useState<'ready' | 'active' | null>(null);
  const [menu, setMenu] = useState<Point | null>(null);
  const [find, setFind] = useState<{ query: string; index: number } | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [erasing, setErasing] = useState<string[]>([]);
  const [snap, setSnap] = usePref('snap');
  const [dark, setDark] = usePref('dark');
  const [transparent, setTransparent] = usePref('transparent');

  const board = doc.board;
  const wrapper = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointerDown = useRef(false);
  const rightClick = useRef(0);
  const space = useRef(false);
  const latest = useRef({ board, selection, tool, editing, snap, toolLock });
  latest.current = { board, selection, tool, editing, snap, toolLock };

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

  const fail = (error: unknown, key: WbKey = 'error.action') =>
    setNotice({ kind: 'error', text: t(key, { detail: error instanceof Error ? error.message : String(error) }) });

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

  // A edição de link vale para a seleção em que foi aberta.
  useEffect(() => setLinkDraft(null), [selection]);

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
  const fitSelection = () => {
    const { board, selection } = latest.current;
    if (selection.length) setView(fitView(boardBounds(board, selection), size.w, size.h, 64, 2));
  };
  const resetZoom = () => zoomBy(1 / latest.current.board.view.zoom);

  const toWorld = (clientX: number, clientY: number): Point => {
    const box = svg.current!.getBoundingClientRect();
    const { view } = latest.current.board;
    return { x: (clientX - box.left - view.x) / view.zoom, y: (clientY - box.top - view.y) / view.zoom };
  };
  // Foco pelo teclado (ou busca) num elemento fora da vista: a vista vai até ele.
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
  const viewCenter = () => toWorldFromScreen({ x: size.w / 2, y: size.h / 2 });
  const toWorldFromScreen = (p: Point): Point => {
    const { view } = latest.current.board;
    return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
  };
  const snapPoint = (p: Point): Point => (latest.current.snap ? { x: snapToGrid(p.x, GRID), y: snapToGrid(p.y, GRID) } : p);

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

  const focusCanvas = () => wrapper.current?.focus({ preventScroll: true });

  // ------------------------------------------------------------ edição de texto

  const startEditing = (id: string, snapshot?: Board, created = false) => {
    // Uma edição aberta é concluída antes; o histórico da nova parte do resultado dela.
    if (latest.current.editing) finishEditing();
    // Um texto recém-criado ainda não está no quadro desta renderização.
    const shape = findShape(latest.current.board, id);
    if (!shape && !created) return;
    if (shape?.locked) return setNotice({ kind: 'error', text: t('lockedNotice') });
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
    if (shape.kind === 'text') next = fitText(next, [shape.id]);
    if (current.created || next !== now) settle(next, true);
    focusCanvas();
  };

  /** Texto solto acompanha o tamanho do conteúdo (depois de editar ou mudar fonte e tamanho). */
  const fitText = (input: Board, ids: string[]) => {
    let next = input;
    for (const id of ids) {
      const shape = findShape(next, id);
      if (!shape || shape.kind !== 'text') continue;
      const measured = measureText(shape.text || ' ', fontSize(shape), fontFamily(shape), LINE_HEIGHT);
      next = resizeShape(next, id, { x: shape.x, y: shape.y, ...measured });
    }
    return next;
  };

  // ------------------------------------------------------------ ações

  const select = (ids: string[]) => setSelection(withGroups(latest.current.board, ids));
  const selectAll = () => setSelection(latest.current.board.elements.map((e) => e.id));
  /** Ids da seleção que podem mudar; avisa quando tudo está travado. */
  const editable = () => {
    const { board, selection } = latest.current;
    const ids = unlockedIds(board, selection);
    if (selection.length && !ids.length) setNotice({ kind: 'error', text: t('lockedNotice') });
    return ids;
  };
  const removeSelection = () => {
    const ids = editable();
    if (ids.length) commit(deleteElements(latest.current.board, ids));
  };
  const duplicate = () => {
    const { board, selection } = latest.current;
    const result = duplicateElements(board, selection);
    if (!result.ids.length) return;
    commit(result.board);
    setSelection(result.ids);
  };
  const connectableShapes = (board: Board, ids: string[]) => ids.filter((id) => findShape(board, id) && findShape(board, id)!.kind !== 'text');
  const connectSelection = () => {
    const { board, selection } = latest.current;
    const shapes = connectableShapes(board, selection);
    if (shapes.length !== 2) return;
    const result = connect(board, shapes[0], shapes[1]);
    if (!result) return;
    commit(result.board);
    setSelection([result.id]);
  };
  const nudge = (dx: number, dy: number) => {
    const ids = editable();
    if (ids.length) commit(moveElements(latest.current.board, ids, dx, dy));
  };
  const restyle = (patch: Patch) => {
    const ids = editable();
    if (!ids.length) return;
    let next = updateElements(latest.current.board, ids, patch);
    if (patch.fontSize !== undefined || patch.font !== undefined) next = fitText(next, ids);
    commit(next);
  };
  const layer = (where: Layer) => {
    const ids = editable();
    if (ids.length) commit(reorder(latest.current.board, ids, where));
  };
  const align = (how: Align) => {
    const ids = editable();
    if (ids.length) commit(alignElements(latest.current.board, ids, how));
  };
  const distribute = (axis: 'horizontal' | 'vertical') => {
    const ids = editable();
    if (ids.length) commit(distributeElements(latest.current.board, ids, axis));
  };
  const group = () => {
    const { board, selection } = latest.current;
    const result = groupElements(board, selection);
    if (result.group) commit(result.board);
  };
  const ungroup = () => {
    const { board, selection } = latest.current;
    commit(ungroupElements(board, selection));
  };
  const toggleLock = () => {
    const { board, selection } = latest.current;
    if (!selection.length) return;
    const allLocked = selection.every((id) => findElement(board, id)?.locked);
    commit(updateElements(board, selection, { locked: !allLocked }));
  };
  const openLinkEditor = () => {
    const { board, selection } = latest.current;
    if (!selection.length) return;
    const links = new Set(selection.map((id) => findElement(board, id)?.link ?? ''));
    setLinkDraft(links.size === 1 ? [...links][0] : '');
  };
  const saveLink = (value: string) => {
    const clean = sanitizeLink(value);
    if (value.trim() && !clean) return setNotice({ kind: 'error', text: t('linkInvalid') });
    const ids = editable();
    if (ids.length) commit(updateElements(latest.current.board, ids, { link: clean }));
    setLinkDraft(null);
    focusCanvas();
  };
  const openLink = (id?: string) => {
    const { board, selection } = latest.current;
    const element = findElement(board, id ?? (selection.length === 1 ? selection[0] : ''));
    if (element?.link) onOpenLink?.(element.link);
  };

  const copy = async (cut: boolean) => {
    const { board, selection } = latest.current;
    if (!selection.length) return;
    try {
      await navigator.clipboard.writeText(clipboardText(board, selection));
      if (cut) {
        const ids = unlockedIds(latest.current.board, selection);
        if (ids.length) commit(deleteElements(latest.current.board, ids));
      }
    } catch (error) {
      fail(error);
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
      if (!result.ids.length) return board.elements.length >= MAX_ELEMENTS && setNotice({ kind: 'error', text: t('elementsFull') });
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
      // Imagem na área de transferência (captura de tela, imagem copiada) vira elemento de imagem.
      const items = await navigator.clipboard.read().catch(() => [] as ClipboardItem[]);
      for (const item of items) {
        const type = item.types.find((kind) => IMAGE_TYPES.includes(kind));
        if (type) return void (await insertImage(await item.getType(type)));
      }
      pasteText(await navigator.clipboard.readText());
    } catch (error) {
      fail(error);
    }
  };

  /** Embute uma imagem no quadro, centrada em `at` (ou no meio da vista) e cabendo na tela. */
  const insertImage = async (blob: Blob, at?: Point, offset = 0) => {
    if (!IMAGE_TYPES.includes(blob.type)) return setNotice({ kind: 'error', text: t('imageUnsupported') });
    let image: { src: string; w: number; h: number };
    try {
      image = await readImage(blob);
    } catch {
      return setNotice({ kind: 'error', text: t('imageFailed') });
    }
    const { board } = latest.current;
    if (board.elements.length >= MAX_ELEMENTS) return setNotice({ kind: 'error', text: t('elementsFull') });
    // O arquivo do quadro precisa continuar abaixo do limite de leitura, com folga.
    if (serializeBoard(board).length + image.src.length + 4096 > MAX_BOARD_BYTES) return setNotice({ kind: 'error', text: t('imageTooLarge') });
    const zoom = board.view.zoom;
    const scale = Math.min(1, (size.w * 0.6) / zoom / image.w, (size.h * 0.6) / zoom / image.h);
    const w = image.w * scale;
    const h = image.h * scale;
    const middle = at ?? viewCenter();
    const result = addPicture(board, image.src, { x: middle.x - w / 2 + offset, y: middle.y - h / 2 + offset, w, h });
    if (!result) return setNotice({ kind: 'error', text: t('imageUnsupported') });
    latest.current.board = result.board;
    commit(result.board, board);
    setSelection([result.id]);
  };
  const insertImages = async (files: File[], at?: Point) => {
    let offset = 0;
    for (const file of files) {
      await insertImage(file, at, offset);
      offset += 24;
    }
  };

  // Colar pelo menu Editar (sem tecla): chega como evento de colagem no documento.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!wrapper.current?.contains(document.activeElement) || isTyping(document.activeElement)) return;
      const images = [...(event.clipboardData?.files ?? [])].filter((file) => IMAGE_TYPES.includes(file.type));
      if (images.length) {
        event.preventDefault();
        void insertImages(images);
        return;
      }
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return;
      event.preventDefault();
      pasteText(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const renderSvg = (onlySelection: boolean) => {
    const { board, selection } = latest.current;
    return boardToSvg(board, { ids: onlySelection && selection.length ? selection : undefined, background: transparent ? null : '#ffffff' });
  };

  const exportAs = async (format: 'svg' | 'png' | 'json', onlySelection = false) => {
    const current = latest.current.board;
    if (!current.elements.length && format !== 'json') return setNotice({ kind: 'error', text: t('exportEmpty') });
    const file = sanitizeName(name) || 'whiteboard';
    try {
      if (format === 'json') {
        downloadBlob(new Blob([serializeBoard(current)], { type: 'application/json' }), `${file}.whiteboard.json`);
      } else {
        const { svg: markup, width, height } = renderSvg(onlySelection);
        const blob = format === 'svg' ? new Blob([markup], { type: 'image/svg+xml' }) : await svgToPng(markup, width, height);
        downloadBlob(blob, `${file}.${format}`);
      }
    } catch (error) {
      fail(error, 'exportFailed');
    }
  };

  const copyAsPng = async () => {
    if (!latest.current.board.elements.length) return setNotice({ kind: 'error', text: t('exportEmpty') });
    try {
      const { svg: markup, width, height } = renderSvg(true);
      await copyPng(await svgToPng(markup, width, height));
      setNotice({ kind: 'ok', text: t('copiedPng') });
    } catch (error) {
      fail(error, 'exportFailed');
    }
  };

  const pickTool = (next: Tool) => {
    setTool(next);
    setMenu(null);
  };
  /** Depois de desenhar, a ferramenta volta para Selecionar, a menos que esteja mantida (Q). */
  const toolDone = () => {
    if (!latest.current.toolLock) setTool('select');
  };

  // ------------------------------------------------------------ busca

  const results = useMemo(() => (find ? searchElements(board, find.query) : []), [board, find]);
  const goToResult = (index: number) => {
    const list = searchElements(latest.current.board, find?.query ?? '');
    if (!list.length || !find) return setFind((f) => f && { ...f, index: 0 });
    const wrapped = ((index % list.length) + list.length) % list.length;
    setFind({ ...find, index: wrapped });
    setSelection([list[wrapped]]);
    const element = findElement(latest.current.board, list[wrapped]);
    if (element) revealElement(element);
  };
  const openFind = () => {
    setFind((f) => f ?? { query: '', index: 0 });
    requestAnimationFrame(() => findInput.current?.select());
  };
  const closeFind = () => {
    setFind(null);
    focusCanvas();
  };

  // ------------------------------------------------------------ teclado

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (isTyping(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (!ctrl && (key === ' ' || key === 'enter') && isControl(event.target)) return;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (event.altKey && event.shiftKey && !ctrl && event.code === 'KeyC') return handled(), void copyAsPng();
    if (ctrl) {
      if (event.shiftKey && key === 'g') return handled(), group();
      if (event.shiftKey && key === 'u') return handled(), ungroup();
      if (event.shiftKey && key === 'l') return handled(), toggleLock();
      if (key === 'z' && !event.shiftKey) return handled(), undo();
      if ((key === 'z' && event.shiftKey) || key === 'y') return handled(), redo();
      if (key === 'a') return handled(), selectAll();
      if (key === 'd') return handled(), duplicate();
      if (key === 'c') return handled(), void copy(false);
      if (key === 'x') return handled(), void copy(true);
      if (key === 'v') return handled(), void paste();
      if (key === 'f' && !event.shiftKey) return handled(), openFind();
      if (key === 'k' && !event.shiftKey) return handled(), openLinkEditor();
      if ((event.key === "'" || event.code === 'Quote') && !event.shiftKey) return handled(), setSnap((on) => !on);
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
      if (menu) setMenu(null);
      else if (linkDraft !== null) setLinkDraft(null);
      else if (help) setHelp(false);
      else if (latest.current.tool !== 'select') setTool('select');
      else setSelection([]);
      focusCanvas();
      return;
    }
    if (key === 'delete' || key === 'backspace') return handled(), removeSelection();
    if (key === 'enter') {
      const [only] = latest.current.selection;
      if (latest.current.selection.length === 1 && findShape(latest.current.board, only)) return handled(), startEditing(only);
      return;
    }
    if (key === 'pageup') return handled(), layer(event.shiftKey ? 'front' : 'forward');
    if (key === 'pagedown') return handled(), layer(event.shiftKey ? 'back' : 'backward');
    const step = event.shiftKey ? 10 : 1;
    if (key === 'arrowleft') return handled(), nudge(-step, 0);
    if (key === 'arrowright') return handled(), nudge(step, 0);
    if (key === 'arrowup') return handled(), nudge(0, -step);
    if (key === 'arrowdown') return handled(), nudge(0, step);
    if (key === '+' || key === '=') return handled(), zoomBy(1.2);
    if (key === '-' || key === '_') return handled(), zoomBy(1 / 1.2);
    if (key === '0') return handled(), resetZoom();
    if (event.code === 'Digit1' && event.shiftKey) return handled(), fitAll();
    if (event.code === 'Digit2' && event.shiftKey) return handled(), fitSelection();
    if (key === '?') return handled(), setHelp((open) => !open);
    if (key === 'c') return handled(), connectSelection();
    if (key === 'q') return handled(), setToolLock((on) => !on);
    if (key === 'i') return handled(), imageInput.current?.click();
    const match = [...TOOLS, ...EXTRA_TOOLS].find((entry) => entry.key === key || (!event.shiftKey && entry.digit === key));
    if (match) return handled(), pickTool(match.tool);
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
    if (!target.closest('[data-ui=menu]')) setMenu(null);
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as Handle | End | null;
    if (!handle && target.closest('[data-ui]')) return;
    focusCanvas();
    pointerDown.current = true;
    const world = toWorld(event.clientX, event.clientY);
    const { board, selection, tool } = latest.current;

    if (event.button === 1 || (event.button === 0 && (space.current || tool === 'hand'))) {
      event.preventDefault();
      drag.current = { type: 'pan', client: { x: event.clientX, y: event.clientY }, view: board.view };
      setPanning('active');
      return;
    }
    if (event.button === 2) {
      // Botão direito: escolhe o que está sob o ponteiro; o menu abre no evento contextmenu.
      rightClick.current = Date.now();
      const hit = hitTest(board, world, 6 / board.view.zoom);
      if (hit && !selection.includes(hit)) select([hit]);
      else if (!hit) setSelection([]);
      return;
    }
    if (event.button !== 0) return;

    if (handle === 'start' || handle === 'end') {
      const arrow = findElement(board, selection[0]);
      if (selection.length === 1 && isArrow(arrow) && !arrow.locked) drag.current = { type: 'endpoint', id: arrow.id, which: handle, snapshot: board };
      return;
    }
    if (handle && selection.length === 1) {
      const box = findElement(board, selection[0]);
      if (isBox(box) && !box.locked) {
        drag.current = { type: 'resize', id: box.id, handle, snapshot: board, rect: { x: box.x, y: box.y, w: box.w, h: box.h } };
        return;
      }
    }

    if (tool === 'arrow' || tool === 'line') {
      const { endpoint } = endpointAt(world);
      drag.current = { type: 'arrow', start: isBound(endpoint) ? endpoint : snapPoint(world), point: world, head: tool === 'line' ? 'none' : 'end' };
      return;
    }
    if (tool === 'draw') {
      drag.current = { type: 'draw', points: [world] };
      setDraft({ type: 'draw', points: [world] });
      return;
    }
    if (tool === 'eraser') {
      const hit = hitTest(board, world, 6 / board.view.zoom);
      const ids = new Set(hit && !findElement(board, hit)?.locked ? [hit] : []);
      drag.current = { type: 'erase', ids };
      setErasing([...ids]);
      return;
    }
    if (tool !== 'select' && tool !== 'hand') {
      drag.current = { type: 'create', kind: tool, start: snapPoint(world) };
      return;
    }

    const hit = hitTest(board, world, 6 / board.view.zoom);
    if (hit) {
      const element = findElement(board, hit);
      // Ctrl+clique abre o link do elemento.
      if ((event.ctrlKey || event.metaKey) && element?.link) {
        openLink(hit);
        return;
      }
      const members = withGroups(board, [hit]);
      let ids = selection;
      if (event.shiftKey) ids = selection.includes(hit) ? selection.filter((id) => !members.includes(id)) : [...new Set([...selection, ...members])];
      else if (!selection.includes(hit)) ids = members;
      setSelection(ids);
      if (!ids.includes(hit)) return;
      let movable = unlockedIds(board, ids);
      if (!movable.length) return;
      let current = board;
      // Alt+arrastar: arrasta uma cópia e deixa o original no lugar.
      if (event.altKey) {
        const copy = duplicateElements(board, ids, 0);
        if (copy.ids.length) {
          current = copy.board;
          movable = copy.ids;
          setBoard(current);
          latest.current.board = current;
          setSelection(copy.ids);
        }
      }
      drag.current = { type: 'move', start: world, snapshot: current, before: board, ids: movable, moved: current !== board, origin: boardBounds(current, movable) };
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
      const { board } = latest.current;
      if (current.type === 'move') {
        let dx = world.x - current.start.x;
        let dy = world.y - current.start.y;
        if (!current.moved && Math.hypot(dx, dy) * board.view.zoom < 2) return;
        current.moved = true;
        if (event.shiftKey) ({ dx, dy } = constrainAxis(dx, dy));
        if (latest.current.snap && current.origin) {
          dx = snapToGrid(current.origin.x + dx, GRID) - current.origin.x;
          dy = snapToGrid(current.origin.y + dy, GRID) - current.origin.y;
          if (event.shiftKey) ({ dx, dy } = constrainAxis(dx, dy));
        }
        setBoard({ ...moveElements(current.snapshot, current.ids, dx, dy), view: board.view });
      } else if (current.type === 'resize') {
        const { rect, handle } = current;
        const fixed = { x: handle.includes('w') ? rect.x + rect.w : rect.x, y: handle.includes('n') ? rect.y + rect.h : rect.y };
        const point = event.shiftKey ? constrainRatio(fixed, world, rect.w / rect.h) : snapPoint(world);
        setBoard({ ...resizeShape(current.snapshot, current.id, normalizeRect(fixed, point)), view: board.view });
      } else if (current.type === 'endpoint') {
        const arrow = findElement(current.snapshot, current.id);
        if (!isArrow(arrow)) return;
        const other = current.which === 'start' ? arrow.end : arrow.start;
        const { endpoint, shape } = endpointAt(world, isBound(other) ? other.shape : undefined);
        setBoard({ ...setArrowEnd(current.snapshot, current.id, current.which, isBound(endpoint) ? endpoint : snapPoint(world)), view: board.view });
        setDraft({ type: 'endpoint', target: shape });
      } else if (current.type === 'marquee') {
        setDraft({ type: 'marquee', rect: normalizeRect(current.start, world) });
      } else if (current.type === 'create') {
        const end = event.shiftKey ? constrainSquare(current.start, world) : snapPoint(world);
        setDraft({ type: 'create', kind: current.kind, rect: normalizeRect(current.start, end) });
      } else if (current.type === 'arrow') {
        const except = isBound(current.start) ? current.start.shape : undefined;
        const { shape } = endpointAt(world, except);
        const target = shape ? findShape(board, shape) : undefined;
        const origin = endpointPoint(current.start, target ? center(target) : world);
        const free = event.shiftKey ? constrainAngle(origin, world) : snapPoint(world);
        const b = target ? borderPoint(target, endpointPoint(current.start, center(target))) : free;
        const a = endpointPoint(current.start, target ? center(target) : free);
        current.point = free;
        setDraft({ type: 'arrow', a, b, target: shape, head: current.head });
      } else if (current.type === 'draw') {
        current.points.push(world);
        setDraft({ type: 'draw', points: [...current.points] });
      } else if (current.type === 'erase') {
        const hit = hitTest(board, world, 8 / board.view.zoom);
        if (hit && !current.ids.has(hit) && !findElement(board, hit)?.locked) {
          current.ids.add(hit);
          setErasing([...current.ids]);
        }
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
      if (current.type === 'move') {
        if (board !== current.before) commit(board, current.before);
        return;
      }
      if (current.type === 'resize' || current.type === 'endpoint') {
        if (board !== current.snapshot) commit(board, current.snapshot);
        return;
      }
      if (current.type === 'marquee') {
        const rect = normalizeRect(current.start, world);
        if (rect.w * board.view.zoom > 3 || rect.h * board.view.zoom > 3) setSelection(withGroups(board, [...new Set([...current.base, ...elementsInRect(board, rect)])]));
        return;
      }
      if (current.type === 'erase') {
        setErasing([]);
        if (current.ids.size) commit(deleteElements(board, current.ids));
        return;
      }
      if (current.type === 'draw') {
        current.points.push(world);
        const result = addDrawing(board, current.points);
        toolDone();
        if (!result) return;
        commit(result.board, board);
        if (!latest.current.toolLock) setSelection([result.id]);
        return;
      }
      if (current.type === 'create') {
        const end = event.shiftKey ? constrainSquare(current.start, world) : snapPoint(world);
        let rect = normalizeRect(current.start, end);
        const tiny = rect.w * board.view.zoom < 6 && rect.h * board.view.zoom < 6;
        if (tiny) {
          const size = DEFAULT_SIZE[current.kind];
          rect = current.kind === 'text' ? { x: current.start.x, y: current.start.y - size.h / 2, ...size } : { x: current.start.x - size.w / 2, y: current.start.y - size.h / 2, ...size };
        }
        const result = addShape(board, current.kind, rect);
        toolDone();
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
        const found = endpointAt(world, except);
        const endpoint = isBound(found.endpoint) ? found.endpoint : current.point;
        const startPoint = endpointPoint(current.start, isBound(endpoint) ? world : endpoint);
        const endPoint = endpointPoint(endpoint, startPoint);
        toolDone();
        if (Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y) * board.view.zoom < 10 && !(isBound(current.start) && isBound(endpoint))) return;
        const result = addArrow(board, current.start, endpoint, undefined, { head: current.head });
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
    const { board, tool } = latest.current;
    if (tool !== 'select') return;
    const world = toWorld(event.clientX, event.clientY);
    const hit = hitTest(board, world, 6 / board.view.zoom);
    const shape = hit ? findShape(board, hit) : undefined;
    if (shape) return startEditing(shape.id);
    if (hit) return;
    const result = addShape(board, 'text', { x: world.x, y: world.y - DEFAULT_SIZE.text.h / 2, ...DEFAULT_SIZE.text });
    setBoard(result.board);
    startEditing(result.id, board, true);
  };

  const onContextMenu = (event: ReactMouseEvent) => {
    const target = event.target as Element;
    if (target.closest('[data-ui]') && !target.closest('[data-ui=canvas]')) return;
    event.preventDefault();
    if (latest.current.editing) finishEditing();
    const box = wrapper.current!.getBoundingClientRect();
    const fromMouse = Date.now() - rightClick.current < 1500;
    if (fromMouse) return setMenu({ x: event.clientX - box.left, y: event.clientY - box.top });
    // Pelo teclado (Shift+F10, tecla de menu): ao lado da seleção ou no meio do quadro.
    const { board, selection } = latest.current;
    const rect = selection.length ? boardBounds(board, selection) : null;
    const anchor = rect ? toScreen({ x: rect.x + rect.w, y: rect.y }) : { x: size.w / 2, y: size.h / 3 };
    setMenu({ x: Math.max(8, Math.min(anchor.x + 8, size.w - 8)), y: Math.max(8, Math.min(anchor.y, size.h - 8)) });
  };

  const onDragOver = (event: ReactDragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event: ReactDragEvent) => {
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
    if (!images.length) return setNotice({ kind: 'error', text: t('imageUnsupported') });
    void insertImages(images, toWorld(event.clientX, event.clientY));
  };

  // ------------------------------------------------------------ desenho

  const selected = useMemo(() => new Set(selection), [selection]);
  const erased = useMemo(() => new Set(erasing), [erasing]);
  const selectedElements = useMemo(() => selection.map((id) => findElement(board, id)).filter((e): e is BoardElement => Boolean(e)), [board, selection]);
  const single = selectedElements.length === 1 ? selectedElements[0] : undefined;
  const unitCount = new Set(selectedElements.map((e) => (e.group ? `g:${e.group}` : e.id))).size;
  const zoom = board.view.zoom;
  const cursor = panning ? (panning === 'active' ? 'grabbing' : 'grab') : tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  const editingShape = editing ? findShape(board, editing.id) : undefined;
  const editingBox =
    editingShape &&
    (() => {
      const p = toScreen({ x: editingShape.x, y: editingShape.y });
      const lineCount = Math.max(1, editing!.value.split('\n').length);
      const fs = fontSize(editingShape) * zoom;
      if (editingShape.kind === 'text') {
        const measured = measureText(editing!.value || ' ', fontSize(editingShape), fontFamily(editingShape), LINE_HEIGHT);
        return { left: p.x, top: p.y, width: Math.max(measured.w + 40, 120) * zoom, height: (measured.h + 8) * zoom, fs, align: 'left' as const };
      }
      const height = lineCount * fs * LINE_HEIGHT;
      return { left: p.x, top: p.y + (editingShape.h * zoom - height) / 2, width: editingShape.w * zoom, height: height + 4, fs, align: 'center' as const };
    })();

  const describe = (element: BoardElement) => {
    let text: string;
    if (isShape(element)) text = `${t(`kind.${element.kind}` as WbKey)}${element.text ? `: ${element.text.split('\n')[0]}` : ''}`;
    else if (!isArrow(element)) text = t(`kind.${element.kind}` as WbKey);
    else {
      const label = (endpoint: Endpoint) =>
        isBound(endpoint) ? findShape(board, endpoint.shape)?.text.split('\n')[0] || t(`kind.${findShape(board, endpoint.shape)?.kind ?? 'rectangle'}` as WbKey) : '·';
      text = `${t(element.head === 'none' ? 'tool.line' : 'kind.arrow')}: ${label(element.start)} → ${label(element.end)}`;
    }
    if (element.link) text += ` · ${t('link')}: ${element.link}`;
    if (element.locked) text += ` · ${t('lock')}`;
    return text;
  };

  const menuEntries = (): MenuEntry[] => {
    const has = selection.length > 0;
    const allLocked = has && selectedElements.every((e) => e.locked);
    const entries: (MenuEntry | false | '' | undefined)[] = has
      ? [
          { id: 'cut', label: t('cut'), shortcut: 'Ctrl+X', onSelect: () => void copy(true) },
          { id: 'copy', label: t('copy'), shortcut: 'Ctrl+C', onSelect: () => void copy(false) },
          { id: 'paste', label: t('paste'), shortcut: 'Ctrl+V', onSelect: () => void paste() },
          { id: 'duplicate', label: t('duplicate'), shortcut: 'Ctrl+D', onSelect: duplicate },
          'separator',
          { id: 'front', label: t('layer.front'), shortcut: 'Shift+PgUp', onSelect: () => layer('front') },
          { id: 'forward', label: t('layer.forward'), shortcut: 'PgUp', onSelect: () => layer('forward') },
          { id: 'backward', label: t('layer.backward'), shortcut: 'PgDn', onSelect: () => layer('backward') },
          { id: 'back', label: t('layer.back'), shortcut: 'Shift+PgDn', onSelect: () => layer('back') },
          'separator',
          unitCount >= 2 && { id: 'group', label: t('group'), shortcut: 'Ctrl+Shift+G', onSelect: group },
          selectedElements.some((e) => e.group) && { id: 'ungroup', label: t('ungroup'), shortcut: 'Ctrl+Shift+U', onSelect: ungroup },
          { id: 'lock', label: allLocked ? t('unlock') : t('lock'), shortcut: 'Ctrl+Shift+L', onSelect: toggleLock },
          { id: 'link', label: t('link'), shortcut: 'Ctrl+K', onSelect: openLinkEditor },
          single?.link && { id: 'open-link', label: t('openLink'), shortcut: 'Ctrl+Click', onSelect: () => openLink() },
          'separator',
          { id: 'copy-png', label: t('copyPng'), shortcut: 'Shift+Alt+C', onSelect: () => void copyAsPng() },
          { id: 'export-svg', label: t('exportSelectionSvg'), onSelect: () => void exportAs('svg', true) },
          { id: 'export-png', label: t('exportSelectionPng'), onSelect: () => void exportAs('png', true) },
          { id: 'zoom-selection', label: t('zoomSelection'), shortcut: 'Shift+2', onSelect: fitSelection },
          !allLocked && 'separator',
          !allLocked && { id: 'delete', label: t('delete'), shortcut: 'Delete', onSelect: removeSelection, danger: true },
        ]
      : [
          { id: 'paste', label: t('paste'), shortcut: 'Ctrl+V', onSelect: () => void paste() },
          { id: 'select-all', label: t('selectAll'), shortcut: 'Ctrl+A', onSelect: selectAll },
          { id: 'image', label: t('tool.image'), shortcut: 'I', onSelect: () => imageInput.current?.click() },
          'separator',
          { id: 'copy-png', label: t('copyPng'), shortcut: 'Shift+Alt+C', onSelect: () => void copyAsPng() },
          { id: 'fit', label: t('zoomFit'), shortcut: 'Shift+1', onSelect: fitAll },
          { id: 'snap', label: `${t('snap')}${snap ? ' ✓' : ''}`, shortcut: "Ctrl+'", onSelect: () => setSnap((on) => !on) },
          { id: 'dark', label: `${t('dark')}${dark ? ' ✓' : ''}`, onSelect: () => setDark((on) => !on) },
          { id: 'find', label: t('find'), shortcut: 'Ctrl+F', onSelect: openFind },
        ];
    return entries.filter((entry): entry is MenuEntry => Boolean(entry));
  };

  const statusText = status === 'saving' ? t('saving') : status === 'saved' ? t('saved') : status === 'error' ? t('saveError') : '';
  const button = 'icon-button h-7 w-7 disabled:pointer-events-none disabled:opacity-35 aria-expanded:bg-[var(--hover-strong)] aria-expanded:text-frost-100';
  const floating = 'bg-paper-raised shadow-[0_0_0_1px_var(--color-paper-line),0_6px_18px_-8px_rgb(0_0_0_/_0.35)]';
  const toggle = 'sheet-button board-tool grid h-7 w-7 place-items-center rounded-md';

  const toolButton = ({ tool: id, key, digit, icon: Icon }: ToolEntry) => (
    <button
      key={id}
      className="sheet-button board-tool relative grid h-8 w-8 shrink-0 place-items-center rounded-md"
      data-on={tool === id}
      aria-pressed={tool === id}
      title={`${t(`tool.${id}` as WbKey)} (${key.toUpperCase()}${digit ? ` / ${digit}` : ''})`}
      aria-label={t(`tool.${id}` as WbKey)}
      aria-keyshortcuts={digit ? `${key.toUpperCase()} ${digit}` : key.toUpperCase()}
      data-testid={`wb-tool-${id}`}
      onClick={() => {
        pickTool(id);
        focusCanvas();
      }}
    >
      <Icon size={16} />
      {digit && (
        <span className="absolute bottom-0 right-0.5 font-mono text-[8.5px] text-ink-soft/70" aria-hidden="true">
          {digit}
        </span>
      )}
    </button>
  );

  const linkEditor =
    linkDraft !== null ? (
      <form
        className="flex flex-col gap-1.5 border-t border-paper-line pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          saveLink(linkDraft);
        }}
      >
        <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft" htmlFor="wb-link-input">
          {t('link')}
        </label>
        <input
          id="wb-link-input"
          className="w-full rounded-md bg-white px-1.5 py-1 text-[12px] text-ink outline-none ring-1 ring-paper-line focus:ring-2 focus:ring-sheen-700"
          value={linkDraft}
          maxLength={MAX_LINK}
          placeholder={t('linkPlaceholder')}
          aria-label={t('linkLabel')}
          title={t('linkLabel')}
          list="wb-link-notes"
          spellCheck={false}
          autoFocus
          data-testid="wb-link-input"
          onChange={(event) => setLinkDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setLinkDraft(null);
              focusCanvas();
            }
          }}
        />
        <datalist id="wb-link-notes">
          {notes.slice(0, 500).map((note) => (
            <option key={note.path} value={note.path.replace(/\.md$/i, '')} />
          ))}
        </datalist>
        <div className="flex gap-1">
          <button type="submit" className="sheet-button flex-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ink" data-testid="wb-link-save">
            {t('linkSave')}
          </button>
          <button type="button" className="sheet-button rounded-md px-1.5 py-1 text-[11.5px]" onClick={() => saveLink('')}>
            {t('linkRemove')}
          </button>
        </div>
      </form>
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="board-head flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-2 pt-3">
        <input
          className="board-title min-w-32 max-w-[min(560px,60%)] truncate rounded-md bg-transparent px-1.5 py-0.5 font-display text-[19px] font-semibold tracking-tight text-frost-100 outline-none transition-colors hover:bg-[var(--hover)] focus:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-sheen-400"
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
        <span className="board-status" data-state={statusText ? status : ''} role="status" aria-live="polite" data-testid="wb-status">
          {statusText}
        </span>
        {status === 'error' && (
          <button className="rounded-md px-2 py-0.5 text-[12px] text-frost-300 underline-offset-2 hover:bg-[var(--hover)] hover:text-frost-100 hover:underline" onClick={() => void autosave.flush()}>
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
        <button className={button} title={`${t('find')} (Ctrl+F)`} aria-label={t('find')} aria-expanded={Boolean(find)} onClick={openFind}>
          <SearchIcon />
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
          <button
            className={`${button} aria-pressed:bg-[var(--hover)] aria-pressed:text-frost-100`}
            title={t('exportTransparent')}
            aria-label={t('exportTransparent')}
            aria-pressed={transparent}
            data-testid="wb-transparent"
            onClick={() => setTransparent((on) => !on)}
          >
            <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth={1.4} />
              <path d="M2.7 2.7h4.3V7H2.7zM9 9h4.3v4.3H9z" fill="currentColor" opacity={0.55} />
            </svg>
          </button>
        </div>
        <span className="mx-1 h-4 w-px bg-[var(--hairline-strong)]" aria-hidden="true" />
        <button className={button} title={`${t('shortcuts')} (?)`} aria-label={t('shortcuts')} aria-expanded={help} onClick={() => setHelp((open) => !open)}>
          <KeyboardIcon />
        </button>
      </header>

      {banner}
      {notice && (
        <p key={notice.text} className="board-msg mx-4 mb-2 text-[12.5px]" data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}

      <div
        ref={wrapper}
        className={`sheet wb-canvas relative mx-2 mb-2 min-h-0 flex-1 overflow-hidden outline-none ${dark ? 'wb-dark' : ''}`}
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
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            space.current = false;
            setPanning(null);
          }
        }}
      >
        <svg ref={svg} className="wb-scene absolute inset-0 h-full w-full touch-none select-none" style={{ fontFamily: FONT_FAMILY }}>
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
                data-x={isBox(element) ? Math.round(element.x) : undefined}
                data-y={isBox(element) ? Math.round(element.y) : undefined}
                className="wb-element"
                opacity={erased.has(element.id) ? 0.25 : element.opacity !== undefined ? element.opacity / 100 : undefined}
                onFocus={() => {
                  if (pointerDown.current) return;
                  if (!selected.has(element.id)) select([element.id]);
                  revealElement(element);
                }}
              >
                {elementPrimitives(board, element, { hideText: editing?.id === element.id }).map((primitive, index) => (
                  <PrimitiveView key={index} primitive={primitive} />
                ))}
              </g>
            ))}

            {board.elements.map((element) => {
              if (!element.link) return null;
              const rect = elementBounds(board, element);
              if (!rect) return null;
              const r = 9 / zoom;
              return (
                <g
                  key={`link-${element.id}`}
                  data-ui="link"
                  className="cursor-pointer"
                  transform={`translate(${rect.x + rect.w + r * 0.4} ${rect.y - r * 0.4})`}
                  onClick={() => openLink(element.id)}
                >
                  <title>{t('openLinkNamed', { link: element.link })}</title>
                  <circle r={r} fill="#ffffff" stroke="#0c6c64" strokeWidth={1.25 / zoom} />
                  <path
                    d="M-2.5 1.5 1.5-2.5M-1 -2.5h2.5V0"
                    transform={`scale(${1.4 / zoom})`}
                    fill="none"
                    stroke="#0c6c64"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

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
                <PrimitiveView primitive={{ type: 'line', a: draft.a, b: draft.b, stroke: '#0c6c64', width: 2, dash: '' }} />
                {draft.head !== 'none' && <PrimitiveView primitive={{ type: 'polygon', points: arrowHead(draft.a, draft.b), stroke: '#0c6c64', fill: '#0c6c64', width: 2, dash: '' }} />}
              </g>
            )}
            {draft?.type === 'draw' && (
              <path d={pathData(draft.points)} fill="none" stroke="#1a1f26" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
            )}
            {draft?.type === 'endpoint' && draft.target && findShape(board, draft.target) && (
              <g pointerEvents="none" opacity={0.7}>
                <SelectionBox rect={elementBounds(board, findShape(board, draft.target)!)!} zoom={zoom} />
              </g>
            )}

            {selection.map((id) => {
              const element = board.elements.find((e) => e.id === id);
              const rect = element && elementBounds(board, element);
              return rect ? <SelectionBox key={id} rect={rect} zoom={zoom} locked={element.locked} /> : null;
            })}
            {single && isBox(single) && !single.locked && !editing && !drag.current && (
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
            {single &&
              isArrow(single) &&
              (() => {
                const segment = arrowSegment(board, single);
                if (!segment) return null;
                const interactive = !single.locked && !drag.current;
                return (
                  <g pointerEvents={interactive ? undefined : 'none'}>
                    {([
                      ['start', segment.a],
                      ['end', segment.b],
                    ] as const).map(([which, p]) => (
                      <circle
                        key={which}
                        data-handle={interactive ? which : undefined}
                        cx={p.x}
                        cy={p.y}
                        r={(interactive ? 5 : 4) / zoom}
                        fill="#ffffff"
                        stroke="#0c6c64"
                        strokeWidth={1.5 / zoom}
                        style={{ cursor: interactive ? 'move' : undefined }}
                      />
                    ))}
                  </g>
                );
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
              fontFamily: editingShape!.font === 'mono' ? MONO_FAMILY : FONT_FAMILY,
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
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 px-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl border border-dashed border-ink-faint/60 text-ink-faint" aria-hidden="true">
              <DrawIcon size={18} />
            </span>
            <p className="max-w-80 text-balance text-[14px] leading-relaxed text-ink-soft">{t('emptyCanvas')}</p>
          </div>
        )}

        <div
          data-ui="tools"
          role="toolbar"
          aria-label={t('tools')}
          className={`absolute left-1/2 top-3 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-lg p-1 ${floating}`}
        >
          {TOOLS.map(toolButton)}
          <span className="mx-0.5 h-5 w-px shrink-0 bg-paper-line" aria-hidden="true" />
          {EXTRA_TOOLS.map(toolButton)}
          <button
            className="sheet-button grid h-8 w-8 shrink-0 place-items-center rounded-md"
            title={`${t('tool.image')} (I)`}
            aria-label={t('tool.image')}
            aria-keyshortcuts="I"
            data-testid="wb-tool-image"
            onClick={() => imageInput.current?.click()}
          >
            <ImageIcon size={16} />
          </button>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-paper-line" aria-hidden="true" />
          <button
            className="sheet-button board-tool grid h-8 w-8 shrink-0 place-items-center rounded-md"
            data-on={toolLock}
            aria-pressed={toolLock}
            title={`${t('toolLock')} (Q)`}
            aria-label={t('toolLock')}
            aria-keyshortcuts="Q"
            data-testid="wb-tool-lock"
            onClick={() => {
              setToolLock((on) => !on);
              focusCanvas();
            }}
          >
            <LockIcon size={14} />
          </button>
        </div>
        <input
          ref={imageInput}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length) void insertImages(files);
            focusCanvas();
          }}
        />

        {selectedElements.length > 0 && !editing && (
          <StylePanel
            elements={selectedElements}
            units={unitCount}
            canConnect={connectableShapes(board, selection).length === 2}
            t={t}
            linkEditor={linkEditor}
            actions={{
              patch: restyle,
              layer,
              align,
              distribute,
              group,
              ungroup,
              toggleLock,
              editLink: openLinkEditor,
              openLink: () => openLink(),
              editText: () => single && startEditing(single.id),
              connect: connectSelection,
              duplicate,
              remove: removeSelection,
            }}
          />
        )}

        {find && (
          <div data-ui="find" role="search" aria-label={t('find')} className={`board-pop absolute right-3 top-14 z-10 flex max-w-[calc(100%-24px)] items-center gap-1 rounded-lg p-1 text-[12px] text-ink-soft ${floating}`}>
            <SearchIcon size={14} className="ml-1 text-ink-faint" />
            <input
              ref={findInput}
              className="w-40 bg-transparent px-1 py-1 text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
              value={find.query}
              placeholder={t('findPlaceholder')}
              aria-label={t('find')}
              autoFocus
              spellCheck={false}
              data-testid="wb-find"
              onChange={(event) => {
                const query = event.target.value;
                setFind({ query, index: 0 });
                const list = searchElements(latest.current.board, query);
                setSelection(list.length ? [list[0]] : []);
                const element = list.length ? findElement(latest.current.board, list[0]) : undefined;
                if (element) revealElement(element);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  goToResult(find.index + (event.shiftKey ? -1 : 1));
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeFind();
                }
              }}
            />
            <span className="min-w-14 text-center font-mono text-[11px] tabular-nums text-ink-soft" aria-live="polite" data-testid="wb-find-count">
              {find.query.trim() ? (results.length ? t('findCount', { current: Math.min(find.index + 1, results.length), total: results.length }) : t('findNone')) : ''}
            </span>
            <button className="sheet-button grid h-6 w-6 place-items-center rounded-md disabled:opacity-35" title={t('findPrev')} aria-label={t('findPrev')} disabled={!results.length} onClick={() => goToResult(find.index - 1)}>
              <ChevronIcon up size={14} />
            </button>
            <button className="sheet-button grid h-6 w-6 place-items-center rounded-md disabled:opacity-35" title={t('findNext')} aria-label={t('findNext')} disabled={!results.length} onClick={() => goToResult(find.index + 1)}>
              <ChevronIcon size={14} />
            </button>
            <button className="sheet-button grid h-6 w-6 place-items-center rounded-md" title={`${t('close')} (Esc)`} aria-label={t('close')} onClick={closeFind}>
              <CloseIcon size={13} />
            </button>
          </div>
        )}

        <div data-ui="zoom" className={`absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg p-1 text-[12px] text-ink-soft ${floating}`}>
          <button className={toggle} data-on={snap} aria-pressed={snap} title={`${t('snap')} (Ctrl+')`} aria-label={t('snap')} data-testid="wb-snap" onClick={() => setSnap((on) => !on)}>
            <GridIcon size={14} />
          </button>
          <button className={toggle} data-on={dark} aria-pressed={dark} title={t('dark')} aria-label={t('dark')} data-testid="wb-dark" onClick={() => setDark((on) => !on)}>
            <MoonIcon size={14} />
          </button>
          <span className="mx-0.5 h-4 w-px bg-paper-line" aria-hidden="true" />
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

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            bounds={size}
            label={t('menu')}
            entries={menuEntries()}
            onClose={(refocus) => {
              setMenu(null);
              if (refocus) focusCanvas();
            }}
          />
        )}

        {help && (
          <div
            data-ui="help"
            role="dialog"
            aria-label={t('shortcuts')}
            className="board-pop absolute bottom-3 left-3 z-10 max-h-[calc(100%-24px)] max-w-[min(480px,calc(100%-24px))] overflow-y-auto rounded-lg bg-obsidian-700 p-3.5 text-[12.5px] leading-relaxed text-frost-300 shadow-[0_0_0_1px_var(--hairline-strong),0_12px_30px_-10px_rgb(0_0_0_/_0.7)]"
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="section-label">{t('shortcuts')}</span>
              <button className="icon-button" title={t('close')} aria-label={t('close')} onClick={() => setHelp(false)}>
                <CloseIcon size={13} />
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {(
                [
                  'help.tools',
                  'help.tools2',
                  'help.shift',
                  'help.move',
                  'help.select',
                  'help.edit',
                  'help.connect',
                  'help.clipboard',
                  'help.delete',
                  'help.history',
                  'help.layers',
                  'help.group',
                  'help.link',
                  'help.find',
                  'help.menu',
                  'help.view',
                  'help.pan',
                ] as const
              ).map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function SelectionBox({ rect, zoom, locked }: { rect: Rect; zoom: number; locked?: boolean }) {
  const pad = 5 / zoom;
  return (
    <rect
      x={rect.x - pad}
      y={rect.y - pad}
      width={rect.w + pad * 2}
      height={rect.h + pad * 2}
      rx={3 / zoom}
      fill="none"
      stroke={locked ? '#8a8f98' : '#0c6c64'}
      strokeWidth={1.25 / zoom}
      strokeDasharray={`${5 / zoom} ${3 / zoom}`}
      pointerEvents="none"
    />
  );
}

function PrimitiveView({ primitive: p }: { primitive: Primitive }) {
  const paint = (stroke: string, fill: string, width: number, dash: string) => ({
    stroke,
    strokeWidth: width,
    strokeDasharray: dash || undefined,
    strokeLinecap: dash ? ('round' as const) : undefined,
    fill: fill === 'transparent' ? 'none' : fill,
  });
  switch (p.type) {
    case 'rect':
      return <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx} {...paint(p.stroke, p.fill, p.width, p.dash)} />;
    case 'ellipse':
      return <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} {...paint(p.stroke, p.fill, p.width, p.dash)} />;
    case 'polygon':
      return <polygon points={p.points.map((q) => `${q.x},${q.y}`).join(' ')} strokeLinejoin="round" {...paint(p.stroke, p.fill, p.width, p.dash)} />;
    case 'line':
      return <line x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke={p.stroke} strokeWidth={p.width} strokeDasharray={p.dash || undefined} strokeLinecap="round" />;
    case 'path':
      return <path d={pathData(p.points)} fill="none" stroke={p.stroke} strokeWidth={p.width} strokeDasharray={p.dash || undefined} strokeLinecap="round" strokeLinejoin="round" />;
    case 'image':
      return <image x={p.x} y={p.y} width={p.w} height={p.h} href={p.src} preserveAspectRatio="none" />;
    case 'text':
      return (
        <text fontSize={p.size} fill={p.color} textAnchor={p.anchor} style={{ whiteSpace: 'pre', fontFamily: p.mono ? MONO_FAMILY : undefined }}>
          {p.lines.map((line, index) => (
            <tspan key={index} x={p.x} y={p.y + index * p.size * LINE_HEIGHT}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      );
  }
}
