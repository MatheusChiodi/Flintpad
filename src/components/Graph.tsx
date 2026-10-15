import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { ContextMenu, isMenuKey, type MenuItem, type MenuRequest } from './ContextMenu';
import { CloseIcon, DownloadIcon, FitIcon, HelpIcon, Kbd, PauseIcon, PlayIcon, ZoomInIcon, ZoomOutIcon } from './Icons';
import { fuzzyMatch } from '../lib/fuzzy';
import {
  buildGraph,
  degrees,
  filterGraph,
  fitCamera,
  folderColor,
  GRAPH_PALETTE_SIZE,
  graphStats,
  groupIndex,
  MAX_GROUPS,
  nearestInDirection,
  sanitizeOptions,
  sanitizeViews,
  upsertView,
  type Direction,
  type GraphData,
  type GraphItem,
  type GraphOptions,
  type SavedView,
  type SizeBy,
} from '../lib/graph';
import { useT } from '../lib/i18n';
import type { Note } from '../types';

// Mesmas regras do grafo do Obsidian (sim.js + renderizador em app.js, v1.12.7):
// física d3-force, tamanho do nó pelo número de links, zoom no cursor, rótulos que
// somem ao afastar e vizinhança destacada ao passar o mouse.

const MAX_NODES = 3000;
const MIN_SCALE = 1 / 128;
const MAX_SCALE = 8;
const WHEEL_ZOOM_BASE = 1.5;
const BUTTON_ZOOM = 1.4;
const VELOCITY_DECAY = 0.4; // o worker multiplica a velocidade por 0,6 a cada passo
const DRAG_ALPHA = 0.3;
const CLICK_SLOP_PX = 5;
const FADED_ALPHA = 0.2;
const HOVER_TEXT_SHIFT = 15;
const SMOOTHING = 0.15;
const GLOW_NODE_LIMIT = 250;
// Enquadra sozinho quando a simulação esfria abaixo disto (se ninguém mexeu na câmera).
const AUTO_FIT_ALPHA = 0.3;
const STORAGE_KEY = 'obnotion:graph';
const VIEWS_KEY = 'obnotion:graph:views';

// Curva dos controles de força do Obsidian: SJ leva força a posição, MJ faz o inverso.
const SLIDER_BASE = 0.01;
const strengthToSlider = (strength: number) => 1 - Math.log(strength * (1 - SLIDER_BASE) + SLIDER_BASE) / Math.log(SLIDER_BASE);
const sliderToStrength = (slider: number) => (Math.pow(SLIDER_BASE, 1 - slider) - SLIDER_BASE) / (1 - SLIDER_BASE);

type Options = GraphOptions;

const DEFAULTS: Options = {
  search: '',
  showOrphans: true,
  showTags: false,
  showUnresolved: false,
  showArrow: false,
  colorByFolder: false,
  sizeBy: 'links',
  textFade: 0,
  nodeSize: 1,
  lineSize: 1,
  center: strengthToSlider(0.1),
  repel: 10,
  link: strengthToSlider(1),
  linkDistance: 250,
  localDepth: 1,
  groups: [],
};

// O localStorage pode faltar ou recusar gravação: o grafo segue com os padrões.
function readStored(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem espaço ou sem permissão: as preferências valem só nesta sessão.
  }
}

const loadOptions = (): Options => ({ ...sanitizeOptions(readStored(STORAGE_KEY), DEFAULTS), search: '' });

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type GNode = SimulationNodeDatum & {
  id: string;
  item: GraphItem;
  weight: number;
  incoming: number;
  related: Set<GNode>;
  fade: number;
  textShift: number;
  color: number;
  pinned: boolean;
};
type GLink = SimulationLinkDatum<GNode> & { source: GNode; target: GNode; forward: boolean; backward: boolean };

type EngineEvents = {
  open: (id: string, newTab: boolean) => void;
  context: (id: string, x: number, y: number) => void;
  hover: (id: string | null) => void;
  select: (id: string | null, fromKeyboard: boolean) => void;
  count: (nodes: number, links: number) => void;
  pins: (count: number) => void;
};

type Engine = {
  setData: (data: GraphData, options: Options, colors: Map<string, number>, fit: boolean) => void;
  setOptions: (options: Options) => void;
  setColors: (colors: Map<string, number>) => void;
  zoomBy: (factor: number) => void;
  fit: () => void;
  centerOn: (id: string) => void;
  select: (id: string | null, fromKeyboard?: boolean) => void;
  selected: () => string | null;
  move: (direction: Direction) => void;
  setPaused: (paused: boolean) => void;
  togglePin: (id: string) => void;
  isPinned: (id: string) => boolean;
  unpinAll: () => void;
  screenPoint: (id: string) => { x: number; y: number } | null;
  toBlob: () => Promise<Blob | null>;
  destroy: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const approach = (current: number, target: number) => (Math.abs(target - current) < 0.002 ? target : current + (target - current) * SMOOTHING);

function createEngine(canvas: HTMLCanvasElement, events: EngineEvents): Engine {
  const ctx = canvas.getContext('2d')!;
  let options = DEFAULTS;
  let nodes: GNode[] = [];
  let links: GLink[] = [];
  const known = new Map<string, GNode>();

  // Tela = mundo * scale + pan, em pixels CSS.
  let scale = 1;
  let targetScale = 1;
  let panX = 0;
  let panY = 0;
  let zoomCenter: { x: number; y: number } | null = null;
  // Destino animado da câmera (enquadrar, centralizar num nó).
  let camera: { scale: number; panX: number; panY: number } | null = null;
  let autoFit = false;
  let width = 0;
  let height = 0;
  let pixelRatio = devicePixelRatio;

  let hovered: GNode | null = null;
  let selected: GNode | null = null;
  let dragNode: GNode | null = null;
  let panning = false;
  let paused = false;
  let pointerStart = { x: 0, y: 0 };
  let moved = false;
  let dirty = true;
  let raf = 0;

  // As cores vêm dos tokens de styles.css; o canvas não enxerga classes.
  const css = getComputedStyle(canvas);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const paint = {
    sheen: token('--color-sheen-400'),
    sheenLit: token('--color-sheen-300'),
    orphan: token('--color-obsidian-500'),
    line: token('--color-frost-500'),
    label: token('--color-frost-300'),
    labelLit: token('--color-frost-100'),
    halo: token('--color-obsidian-900'),
    background: token('--color-obsidian-900'),
    tag: token('--graph-tag'),
    font: token('--font-sans'),
    palette: Array.from({ length: GRAPH_PALETTE_SIZE }, (_, index) => token(`--graph-${index + 1}`)),
  };

  const sizeWeight = (node: GNode) => (options.sizeBy === 'uniform' ? 0 : options.sizeBy === 'incoming' ? node.incoming : node.weight);
  const nodeSize = (node: GNode) => options.nodeSize * Math.max(8, Math.min(3 * Math.sqrt(sizeWeight(node) + 1), 30));
  const nodeColor = (node: GNode) => {
    if (node.color >= 0) return paint.palette[node.color] || paint.sheenLit;
    if (node.item.kind === 'tag') return paint.tag || paint.sheenLit;
    if (node.item.kind === 'unresolved') return paint.orphan;
    return node.weight ? paint.sheenLit : paint.orphan;
  };

  const linkForce: ForceLink<GNode, GLink> = forceLink<GNode, GLink>([]);
  const simulation: Simulation<GNode, GLink> = forceSimulation<GNode, GLink>([])
    .velocityDecay(VELOCITY_DECAY)
    .force('x', forceX<GNode>(0))
    .force('y', forceY<GNode>(0))
    .force('link', linkForce)
    .force('charge', forceManyBody<GNode>())
    .on('tick', () => {
      dirty = true;
      if (autoFit && simulation.alpha() < AUTO_FIT_ALPHA) {
        autoFit = false;
        fit();
      }
    });

  const applyForces = () => {
    const center = sliderToStrength(options.center);
    const linkStrength = sliderToStrength(options.link);
    const repel = options.repel ** 3;
    (simulation.force('x') as ReturnType<typeof forceX<GNode>>).strength(center);
    (simulation.force('y') as ReturnType<typeof forceY<GNode>>).strength(center);
    // Força padrão do d3 (1 / menor grau das pontas), escalada pelo controle.
    linkForce.distance(options.linkDistance).strength((link) => linkStrength / Math.max(1, Math.min(link.source.weight, link.target.weight)));
    (simulation.force('charge') as ReturnType<typeof forceManyBody<GNode>>).strength(-Math.max(1, repel));
  };

  const reheat = (alpha: number) => {
    if (paused) return;
    if (simulation.alpha() < alpha) simulation.alpha(alpha);
    simulation.restart();
  };

  const toWorld = (x: number, y: number) => ({ x: (x - panX) / scale, y: (y - panY) / scale });

  const nodeAt = (x: number, y: number) => {
    const world = toWorld(x, y);
    const nodeScale = Math.sqrt(1 / scale);
    let best: GNode | null = null;
    let bestDistance = Infinity;
    for (const node of nodes) {
      const distance = Math.hypot(node.x! - world.x, node.y! - world.y);
      if (distance <= nodeSize(node) * nodeScale + 3 / scale && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  };

  // Mexer na câmera à mão cancela o enquadramento automático e as animações de câmera.
  const takeCamera = () => {
    autoFit = false;
    camera = null;
  };

  const animateTo = (next: { scale: number; panX: number; panY: number }) => {
    if (prefersReducedMotion()) {
      ({ scale, panX, panY } = next);
      targetScale = scale;
      camera = null;
    } else {
      camera = next;
      targetScale = next.scale;
    }
    dirty = true;
  };

  function fit() {
    if (!nodes.length || !width) return;
    animateTo(fitCamera(nodes.map((node) => ({ x: node.x!, y: node.y!, r: nodeSize(node) + 20 })), width, height, 56, MIN_SCALE, 1.5));
  }

  const updateZoom = () => {
    if (camera) {
      const done = Math.abs(camera.scale - scale) / camera.scale < 0.002 && Math.abs(camera.panX - panX) < 0.5 && Math.abs(camera.panY - panY) < 0.5;
      if (done) ({ scale, panX, panY } = camera);
      else {
        scale += (camera.scale - scale) * SMOOTHING;
        panX += (camera.panX - panX) * SMOOTHING;
        panY += (camera.panY - panY) * SMOOTHING;
      }
      targetScale = scale;
      if (done) camera = null;
      dirty = true;
      return;
    }
    targetScale = clamp(targetScale, MIN_SCALE, MAX_SCALE);
    const ratio = scale > targetScale ? scale / targetScale : targetScale / scale;
    if (ratio - 1 < 0.01) return;
    const anchor = zoomCenter ?? { x: width / 2, y: height / 2 };
    const world = toWorld(anchor.x, anchor.y);
    scale += (targetScale - scale) * SMOOTHING;
    panX = anchor.x - world.x * scale;
    panY = anchor.y - world.y * scale;
    dirty = true;
  };

  const draw = (target = ctx, ratio = pixelRatio, clear = true) => {
    const nodeScale = Math.sqrt(1 / scale);
    const textAlpha = clamp(Math.log2(scale) + 1 - options.textFade, 0, 1);
    const focus = dragNode ?? hovered ?? selected;
    const glow = nodes.length <= GLOW_NODE_LIMIT;
    let animating = false;

    for (const node of nodes) {
      const lit = !focus || node === focus || focus.related.has(node);
      const fade = approach(node.fade, lit ? 1 : FADED_ALPHA);
      const shift = approach(node.textShift, node === focus ? HOVER_TEXT_SHIFT : 0);
      if (fade !== node.fade || shift !== node.textShift) animating = true;
      node.fade = fade;
      node.textShift = shift;
    }

    target.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (clear) target.clearRect(0, 0, width, height);

    const sx = (node: GNode) => node.x! * scale + panX;
    const sy = (node: GNode) => node.y! * scale + panY;
    const radius = (node: GNode) => nodeSize(node) * nodeScale * scale;

    target.lineWidth = options.lineSize;
    for (const link of links) {
      const { source, target: to } = link;
      const lit = focus && (source === focus || to === focus);
      target.globalAlpha = lit ? 0.9 : Math.min(source.fade, to.fade) * 0.3;
      target.strokeStyle = target.fillStyle = lit ? paint.sheenLit : paint.line;
      const ax = sx(source);
      const ay = sy(source);
      const bx = sx(to);
      const by = sy(to);
      target.beginPath();
      target.moveTo(ax, ay);
      target.lineTo(bx, by);
      target.stroke();
      if (!options.showArrow) continue;
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const ux = (bx - ax) / length;
      const uy = (by - ay) / length;
      const head = 4 + 2 * options.lineSize;
      const arrow = (tipX: number, tipY: number, dx: number, dy: number) => {
        target.beginPath();
        target.moveTo(tipX, tipY);
        target.lineTo(tipX - dx * head * 1.8 - dy * head, tipY - dy * head * 1.8 + dx * head);
        target.lineTo(tipX - dx * head * 1.8 + dy * head, tipY - dy * head * 1.8 - dx * head);
        target.fill();
      };
      if (link.forward) arrow(bx - ux * radius(to), by - uy * radius(to), ux, uy);
      if (link.backward) arrow(ax + ux * radius(source), ay + uy * radius(source), -ux, -uy);
    }

    for (const node of nodes) {
      const x = sx(node);
      const y = sy(node);
      const r = radius(node);
      if (x + r * 4 < 0 || x - r * 4 > width || y + r * 4 < 0 || y - r * 4 > height) continue;
      const isFocus = node === focus;
      const color = nodeColor(node);
      const ghost = node.item.kind === 'unresolved';
      // Páginas ligadas brilham; as soltas ficam como pedra apagada.
      if (glow && !ghost && (node.weight || isFocus)) {
        const reach = r * 2.4 + 6;
        const gradient = target.createRadialGradient(x, y, r * 0.5, x, y, reach);
        gradient.addColorStop(0, node.color >= 0 || node.item.kind === 'tag' ? color : paint.sheen);
        gradient.addColorStop(1, 'transparent');
        target.globalAlpha = (isFocus ? 0.55 : 0.28) * node.fade;
        target.fillStyle = gradient;
        target.beginPath();
        target.arc(x, y, reach, 0, Math.PI * 2);
        target.fill();
      }
      target.globalAlpha = node.fade;
      target.beginPath();
      target.arc(x, y, r, 0, Math.PI * 2);
      if (ghost) {
        // Link sem página: só o contorno tracejado.
        target.setLineDash([3, 3]);
        target.lineWidth = 1.25;
        target.strokeStyle = isFocus ? paint.labelLit : paint.line;
        target.stroke();
        target.setLineDash([]);
      } else {
        target.fillStyle = isFocus ? paint.labelLit : color;
        target.fill();
      }
      if (isFocus || node === selected) {
        target.globalAlpha = 1;
        target.lineWidth = 1.5;
        target.strokeStyle = node === selected ? paint.labelLit : paint.sheenLit;
        target.beginPath();
        target.arc(x, y, r + 2.5, 0, Math.PI * 2);
        target.stroke();
      }
      if (node.pinned) {
        // Fixado: um ponto no alto, à direita.
        target.globalAlpha = node.fade;
        target.fillStyle = paint.labelLit;
        target.beginPath();
        target.arc(x + r * 0.75, y - r * 0.75, Math.max(2, r * 0.28), 0, Math.PI * 2);
        target.fill();
      }
      target.lineWidth = options.lineSize;
    }

    target.textAlign = 'center';
    target.textBaseline = 'top';
    target.lineJoin = 'round';
    target.strokeStyle = paint.halo;
    for (const node of nodes) {
      const isFocus = node === focus || node === selected;
      const alpha = isFocus ? 1 : textAlpha * node.fade;
      if (alpha <= 0.001) continue;
      const x = sx(node);
      const size = nodeSize(node);
      // O rótulo em foco mantém o tamanho mesmo com o grafo afastado.
      const textScale = isFocus && scale < 1 ? 1 : nodeScale * scale;
      const y = sy(node) + (size + 5) * nodeScale * scale + node.textShift;
      if (x < -200 || x > width + 200 || y < -40 || y > height + 40) continue;
      target.font = `500 ${(14 + size / 4) * textScale}px ${paint.font}`;
      target.globalAlpha = alpha * (node.item.kind === 'unresolved' ? 0.7 : 1);
      target.lineWidth = 3.5;
      target.strokeText(node.item.label, x, y);
      target.fillStyle = isFocus ? paint.labelLit : paint.label;
      target.fillText(node.item.label, x, y);
    }
    target.globalAlpha = 1;
    return animating;
  };

  const frame = () => {
    if (devicePixelRatio !== pixelRatio) resize();
    updateZoom();
    if (dirty) {
      dirty = false;
      if (draw()) dirty = true;
    }
    raf = requestAnimationFrame(frame);
  };

  const local = (event: PointerEvent | WheelEvent | MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const select = (node: GNode | null, fromKeyboard = false) => {
    if (node === selected) return;
    selected = node;
    dirty = true;
    events.select(node?.id ?? null, fromKeyboard);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    takeCamera();
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 40;
    else if (event.deltaMode === 2) delta *= 800;
    targetScale *= Math.pow(WHEEL_ZOOM_BASE, -delta / 120);
    // Aproximar mira o cursor; afastar recua a partir do centro da tela.
    zoomCenter = targetScale < scale ? null : local(event);
    dirty = true;
  };

  const onPointerDown = (event: PointerEvent) => {
    // Clique do meio num nó: abre em outra guia (e não liga a rolagem automática).
    if (event.button === 1) {
      event.preventDefault();
      const point = local(event);
      const node = nodeAt(point.x, point.y);
      if (node) events.open(node.id, true);
      return;
    }
    if (event.button !== 0) return;
    const point = local(event);
    pointerStart = point;
    moved = false;
    dragNode = nodeAt(point.x, point.y);
    panning = !dragNode;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  };

  const onPointerMove = (event: PointerEvent) => {
    const point = local(event);
    if (dragNode || panning) {
      if (Math.hypot(point.x - pointerStart.x, point.y - pointerStart.y) > CLICK_SLOP_PX) moved = true;
    }
    if (dragNode) {
      if (!moved) return;
      const world = toWorld(point.x, point.y);
      dragNode.fx = world.x;
      dragNode.fy = world.y;
      if (paused) {
        dragNode.x = world.x;
        dragNode.y = world.y;
      } else {
        simulation.alphaTarget(DRAG_ALPHA);
        reheat(DRAG_ALPHA);
      }
    } else if (panning) {
      if (!moved) return;
      takeCamera();
      panX += event.movementX;
      panY += event.movementY;
    } else {
      const found = nodeAt(point.x, point.y);
      if (found === hovered) return;
      hovered = found;
      canvas.style.cursor = found ? 'pointer' : 'default';
      events.hover(found?.id ?? null);
    }
    dirty = true;
  };

  const endPointer = (event: PointerEvent, cancelled: boolean) => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (dragNode) {
      const node = dragNode;
      // Nó fixado fica onde foi solto; os outros voltam para a física.
      if (!node.pinned) {
        node.fx = null;
        node.fy = null;
      }
      simulation.alphaTarget(0);
      dragNode = null;
      if (!moved && !cancelled) {
        select(node);
        events.open(node.id, event.ctrlKey || event.metaKey);
      }
    } else if (panning && !moved && !cancelled) select(null);
    panning = false;
    canvas.style.cursor = hovered ? 'pointer' : 'default';
    dirty = true;
  };

  const onPointerUp = (event: PointerEvent) => endPointer(event, false);
  // Toque cancelado ou janela perdendo o ponteiro: solta o nó sem abrir nada.
  const onPointerCancel = (event: PointerEvent) => endPointer(event, true);

  const onPointerLeave = () => {
    if (dragNode || panning) return;
    hovered = null;
    events.hover(null);
    dirty = true;
  };

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const point = local(event);
    const node = nodeAt(point.x, point.y);
    if (!node) return;
    select(node);
    events.context(node.id, event.clientX, event.clientY);
  };

  // Duplo clique no vazio enquadra tudo.
  const onDoubleClick = (event: MouseEvent) => {
    const point = local(event);
    if (!nodeAt(point.x, point.y)) fit();
  };

  function resize() {
    const nextWidth = canvas.clientWidth;
    const nextHeight = canvas.clientHeight;
    // Na primeira medida o mundo é centrado; depois o centro acompanha a janela.
    panX += width ? (nextWidth - width) / 2 : nextWidth / 2;
    panY += height ? (nextHeight - height) / 2 : nextHeight / 2;
    if (camera) {
      camera.panX += (nextWidth - width) / 2;
      camera.panY += (nextHeight - height) / 2;
    }
    width = nextWidth;
    height = nextHeight;
    pixelRatio = devicePixelRatio;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    dirty = true;
  }

  const centerOn = (node: GNode) => {
    autoFit = false;
    const nextScale = Math.max(scale, 0.8);
    animateTo({ scale: nextScale, panX: width / 2 - node.x! * nextScale, panY: height / 2 - node.y! * nextScale });
  };

  // Seleção pelo teclado: se o nó sair da tela, a câmera vai atrás.
  const reveal = (node: GNode) => {
    const x = node.x! * scale + panX;
    const y = node.y! * scale + panY;
    const margin = 60;
    if (x < margin || x > width - margin || y < margin || y > height - margin) centerOn(node);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('dblclick', onDoubleClick);
  raf = requestAnimationFrame(frame);

  const applyColors = (colors: Map<string, number>) => {
    for (const node of nodes) node.color = colors.get(node.id) ?? -1;
    dirty = true;
  };

  return {
    setData(data, nextOptions, colors, fitAfter) {
      options = nextOptions;
      const shown = data.items.slice(0, MAX_NODES);

      // Nós que já existiam mantêm a posição; os novos nascem perto do centro.
      const next = new Map<string, GNode>();
      let added = 0;
      shown.forEach((item, index) => {
        const previous = known.get(item.id);
        if (!previous) added++;
        const angle = index * 2.399963;
        const distance = 12 * Math.sqrt(index + 0.5);
        const node: GNode = previous ?? {
          id: item.id,
          item,
          weight: 0,
          incoming: 0,
          related: new Set(),
          fade: 1,
          textShift: 0,
          color: -1,
          pinned: false,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
        };
        node.item = item;
        node.weight = 0;
        node.incoming = 0;
        node.related = new Set();
        next.set(item.id, node);
      });
      known.clear();
      next.forEach((node, id) => known.set(id, node));

      const pairs = new Map<string, GLink>();
      for (const [from, to] of data.edges) {
        const source = next.get(from);
        const target = next.get(to);
        if (!source || !target) continue;
        target.incoming++;
        const flipped = from > to;
        const key = flipped ? `${to}\n${from}` : `${from}\n${to}`;
        let link = pairs.get(key);
        if (!link) {
          // O peso conta vizinhos, não arestas: ida e volta entre duas páginas vale um.
          source.weight++;
          target.weight++;
          source.related.add(target);
          target.related.add(source);
          link = { source: flipped ? target : source, target: flipped ? source : target, forward: false, backward: false };
          pairs.set(key, link);
        }
        if (flipped) link.backward = true;
        else link.forward = true;
      }

      nodes = [...next.values()];
      links = [...pairs.values()];
      if (hovered && !next.has(hovered.id)) {
        hovered = null;
        events.hover(null);
      }
      if (selected && !next.has(selected.id)) select(null);
      if (dragNode && !next.has(dragNode.id)) dragNode = null;
      applyColors(colors);
      simulation.nodes(nodes);
      linkForce.links(links);
      applyForces();
      if (fitAfter) autoFit = true;
      // Gravar uma página não deve sacudir o grafo inteiro: só um empurrão quando nada nasceu.
      if (paused) {
        simulation.alpha(added ? 1 : 0.3);
        simulation.tick(added ? 120 : 20);
        if (autoFit) {
          autoFit = false;
          fit();
        }
      } else simulation.alpha(added || fitAfter ? 1 : 0.3).restart();
      events.count(nodes.length, links.length);
      events.pins(nodes.filter((node) => node.pinned).length);
      dirty = true;
    },
    setOptions(nextOptions) {
      const forcesChanged =
        nextOptions.center !== options.center || nextOptions.repel !== options.repel || nextOptions.link !== options.link || nextOptions.linkDistance !== options.linkDistance;
      options = nextOptions;
      if (forcesChanged) {
        applyForces();
        reheat(DRAG_ALPHA);
      }
      dirty = true;
    },
    setColors: applyColors,
    zoomBy(factor) {
      takeCamera();
      targetScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
      zoomCenter = null;
      if (prefersReducedMotion()) {
        const world = toWorld(width / 2, height / 2);
        scale = targetScale;
        panX = width / 2 - world.x * scale;
        panY = height / 2 - world.y * scale;
      }
      dirty = true;
    },
    fit,
    centerOn(id) {
      const node = known.get(id);
      if (node) centerOn(node);
    },
    select(id, fromKeyboard = false) {
      const node = id ? known.get(id) ?? null : null;
      select(node, fromKeyboard);
      if (node && fromKeyboard) reveal(node);
    },
    selected: () => selected?.id ?? null,
    move(direction) {
      if (!nodes.length) return;
      let next: GNode | undefined;
      if (!selected) {
        // Sem seleção: começa pelo nó mais perto do centro da tela.
        const center = toWorld(width / 2, height / 2);
        next = nodes.reduce((best, node) => (Math.hypot(node.x! - center.x, node.y! - center.y) < Math.hypot(best.x! - center.x, best.y! - center.y) ? node : best));
      } else {
        const id = nearestInDirection(
          { id: selected.id, x: selected.x!, y: selected.y! },
          nodes.map((node) => ({ id: node.id, x: node.x!, y: node.y! })),
          direction,
        );
        next = id ? known.get(id) : undefined;
      }
      if (!next) return;
      select(next, true);
      reveal(next);
    },
    setPaused(next) {
      paused = next;
      if (paused) simulation.stop();
      else reheat(DRAG_ALPHA);
    },
    togglePin(id) {
      const node = known.get(id);
      if (!node) return;
      node.pinned = !node.pinned;
      node.fx = node.pinned ? node.x : null;
      node.fy = node.pinned ? node.y : null;
      if (!node.pinned) reheat(0.1);
      events.pins(nodes.filter((other) => other.pinned).length);
      dirty = true;
    },
    isPinned: (id) => known.get(id)?.pinned ?? false,
    unpinAll() {
      for (const node of nodes) {
        node.pinned = false;
        node.fx = null;
        node.fy = null;
      }
      events.pins(0);
      reheat(0.1);
      dirty = true;
    },
    screenPoint(id) {
      const node = known.get(id);
      if (!node) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + node.x! * scale + panX, y: rect.top + node.y! * scale + panY };
    },
    toBlob() {
      // A imagem sai com o fundo do app: o canvas da tela é transparente.
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const target = out.getContext('2d')!;
      target.fillStyle = paint.background;
      target.fillRect(0, 0, out.width, out.height);
      draw(target, pixelRatio, false);
      return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    },
    destroy() {
      cancelAnimationFrame(raf);
      simulation.stop();
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('dblclick', onDoubleClick);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Controles do painel.

const fieldClass =
  'w-full rounded-md bg-obsidian-950/60 px-2.5 py-1.5 text-[12.5px] text-frost-100 outline-none ring-1 ring-[var(--hairline-strong)] placeholder:text-frost-500 focus:ring-sheen-400';
const ghostButton =
  'rounded-md px-2 py-1 text-[12px] text-frost-300 ring-1 ring-[var(--hairline-strong)] hover:bg-[var(--hover)] hover:text-frost-100 focus-visible:outline-none focus-visible:ring-sheen-400';
const iconButton =
  'grid size-8 place-items-center rounded-md text-frost-300 hover:bg-[var(--hover)] hover:text-frost-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sheen-400 aria-pressed:text-sheen-300';

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] text-frost-300">
      {label}
      <input type="range" className="accent-[#4fbfb4]" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[12.5px] text-frost-300">
      {label}
      <input type="checkbox" className="size-3.5 accent-[#4fbfb4]" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

const swatch = (color: number) => ({ background: `var(--graph-${color + 1})` });

type Props = {
  notes: Note[];
  contents: Record<string, string>;
  onOpen: (path: string, newTab?: boolean) => void;
  /** Cria a página de um link que ainda não tem página (clique no nó tracejado). */
  onCreate?: (name: string) => void;
};

const JUMP_LIMIT = 8;

export function Graph({ notes, contents, onOpen, onCreate }: Props) {
  const t = useT();
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const jumpRef = useRef<HTMLInputElement>(null);
  const engine = useRef<Engine | null>(null);
  const [options, setOptions] = useState(loadOptions);
  const [panel, setPanel] = useState(false);
  const [help, setHelp] = useState(false);
  const [count, setCount] = useState({ nodes: 0, links: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [localId, setLocalId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [pinned, setPinned] = useState(0);
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [views, setViews] = useState<SavedView[]>(() => sanitizeViews(readStored(VIEWS_KEY), DEFAULTS));
  const [viewName, setViewName] = useState('');
  const [jump, setJump] = useState('');
  const [jumpIndex, setJumpIndex] = useState(0);
  const [jumpOpen, setJumpOpen] = useState(false);

  const change = (patch: Partial<Options>) => setOptions((current) => ({ ...current, ...patch }));

  const data = useMemo(() => buildGraph(notes, contents, { tags: options.showTags, unresolved: options.showUnresolved }), [notes, contents, options.showTags, options.showUnresolved]);
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data]);
  const filtered = useMemo(
    () => filterGraph(data, { query: options.search, showOrphans: options.showOrphans, hidden, local: localId ? { id: localId, depth: options.localDepth } : null }),
    [data, options.search, options.showOrphans, hidden, localId, options.localDepth],
  );
  const degree = useMemo(() => degrees(filtered.edges), [filtered]);
  const stats = useMemo(() => graphStats(buildGraph(notes, contents, { tags: true, unresolved: true })), [notes, contents]);
  const colors = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of filtered.items) {
      const group = groupIndex(options.groups, item);
      const color = group >= 0 ? options.groups[group].color : options.colorByFolder && item.kind === 'note' ? folderColor(item.folder, GRAPH_PALETTE_SIZE) : -1;
      if (color >= 0) result.set(item.id, color);
    }
    return result;
  }, [filtered, options.groups, options.colorByFolder]);

  // O motor guarda o que recebeu; as funções de abrir mudam a cada render do App.
  const latest = useRef({ items, onOpen, onCreate, t });
  latest.current = { items, onOpen, onCreate, t };
  const degreeRef = useRef(degree);
  degreeRef.current = degree;

  const openNode = useCallback((id: string, newTab = false) => {
    const item = latest.current.items.get(id);
    if (!item) return;
    // Tag: o clique vira filtro por ela. Link sem página: cria a página, como no Obsidian.
    if (item.kind === 'tag') setOptions((current) => ({ ...current, search: `tag:${item.tags[0]}` }));
    else if (item.kind === 'note') latest.current.onOpen(id, newTab);
    else if (item.target) latest.current.onCreate?.(item.target);
  }, []);

  const openMenuRef = useRef<(id: string, x: number, y: number) => void>(() => {});

  useEffect(() => {
    engine.current = createEngine(canvasRef.current!, {
      open: (id, newTab) => openNode(id, newTab),
      context: (id, x, y) => openMenuRef.current(id, x, y),
      hover: setHoverId,
      select: (id, fromKeyboard) => {
        setSelectedId(id);
        if (!fromKeyboard || !id) return;
        const item = latest.current.items.get(id);
        const links = degreeRef.current.get(id);
        if (item) setAnnounce(latest.current.t('graph.announce', { name: item.label, count: (links?.incoming ?? 0) + (links?.outgoing ?? 0) }));
      },
      count: (nodes, links) => setCount({ nodes, links }),
      pins: setPinned,
    });
    return () => engine.current?.destroy();
  }, [openNode]);

  // Primeira carga e troca do grafo local enquadram de novo quando a física assenta.
  const fitNext = useRef(true);
  useEffect(() => {
    fitNext.current = true;
  }, [localId]);

  useEffect(() => {
    const fit = fitNext.current && filtered.items.length > 0;
    if (fit) fitNext.current = false;
    engine.current?.setData(filtered, options, colors, fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  useEffect(() => {
    engine.current?.setColors(colors);
  }, [colors]);

  useEffect(() => {
    engine.current?.setOptions(options);
    const { search: _search, ...persisted } = options;
    writeStored(STORAGE_KEY, persisted);
  }, [options]);

  useEffect(() => writeStored(VIEWS_KEY, views), [views]);

  // Grafo local de um nó que sumiu (página apagada, oculta): volta ao grafo inteiro.
  useEffect(() => {
    if (localId && !items.has(localId)) setLocalId(null);
  }, [items, localId]);

  const focusCanvas = () => canvasRef.current?.focus();

  const toggleLocal = (id: string | null) => setLocalId((current) => (id && current !== id ? id : null));

  const hide = (id: string) => {
    setHidden((current) => new Set([...current, id]));
    if (localId === id) setLocalId(null);
  };

  const copyLink = (id: string) => {
    const item = items.get(id);
    if (item?.kind === 'note') void navigator.clipboard?.writeText(`[[${item.label}]]`).catch(() => {});
  };

  const openMenu = (id: string, x: number, y: number) => {
    const item = items.get(id);
    if (!item) return;
    const isPinned = engine.current?.isPinned(id) ?? false;
    const entries: MenuItem[] = [];
    if (item.kind === 'note') {
      entries.push({ label: t('graph.menu.open'), keys: 'Enter', run: () => openNode(id) });
      entries.push({ label: t('graph.menu.openTab'), keys: 'Ctrl Enter', run: () => openNode(id, true) });
      entries.push({ label: t('graph.menu.copyLink'), run: () => copyLink(id) });
      entries.push({ kind: 'separator' });
    } else if (item.kind === 'tag') {
      entries.push({ label: t('graph.menu.filterTag'), keys: 'Enter', run: () => openNode(id) });
      entries.push({ kind: 'separator' });
    } else if (onCreate) {
      entries.push({ label: t('graph.menu.create'), keys: 'Enter', run: () => openNode(id) });
      entries.push({ kind: 'separator' });
    }
    entries.push({ label: localId === id ? t('graph.exitLocal') : t('graph.menu.local'), keys: 'L', run: () => toggleLocal(id) });
    entries.push({ label: isPinned ? t('graph.menu.unpin') : t('graph.menu.pin'), keys: 'P', run: () => engine.current?.togglePin(id) });
    entries.push({ label: t('graph.menu.hide'), keys: 'H', run: () => hide(id) });
    setMenu({ x, y, items: entries, label: t('graph.menu', { name: item.label }) });
  };
  openMenuRef.current = openMenu;

  const exportPng = async () => {
    const blob = await engine.current?.toBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${t('nav.graph')}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const togglePause = () => {
    setPaused((current) => {
      engine.current?.setPaused(!current);
      return !current;
    });
  };

  const jumpResults = useMemo(() => {
    const query = jump.trim();
    if (!query) return [];
    return filtered.items
      .flatMap((item) => {
        const match = fuzzyMatch(query, item.label);
        return match ? [{ item, score: match.score }] : [];
      })
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
      .slice(0, JUMP_LIMIT)
      .map((result) => result.item);
  }, [jump, filtered]);

  const goTo = (id: string) => {
    engine.current?.centerOn(id);
    engine.current?.select(id, true);
    setJump('');
    setJumpOpen(false);
    focusCanvas();
  };

  const onCanvasKey = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const current = engine.current;
    if (!current) return;
    const id = current.selected();
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const arrows: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (arrows[event.key] && plain) current.move(arrows[event.key]);
    else if (event.key === 'Enter' && id) openNode(id, event.ctrlKey || event.metaKey || event.shiftKey);
    else if (isMenuKey(event) && id) {
      const point = current.screenPoint(id);
      if (point) openMenu(id, point.x, point.y);
    } else if (!plain) return;
    else if (event.key === '+' || event.key === '=') current.zoomBy(BUTTON_ZOOM);
    else if (event.key === '-' || event.key === '_') current.zoomBy(1 / BUTTON_ZOOM);
    else if (event.key === '0') current.fit();
    else if (event.key === ' ') togglePause();
    else if ((event.key === 'l' || event.key === 'L') && id) toggleLocal(id);
    else if ((event.key === 'p' || event.key === 'P') && id) current.togglePin(id);
    else if ((event.key === 'h' || event.key === 'H') && id) hide(id);
    else if (event.key === '/') jumpRef.current?.focus();
    else if (event.key === '?') setHelp(true);
    else if (event.key === 'Escape') {
      if (id) current.select(null);
      else if (localId) setLocalId(null);
      else return;
    } else return;
    event.preventDefault();
  };

  const onRootKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Ctrl+F dentro do grafo vai para "Ir para página" (o menu não usa Ctrl+F).
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      jumpRef.current?.focus();
      jumpRef.current?.select();
    } else if (event.key === 'Escape' && panel && rootRef.current?.querySelector('[data-graph-panel]')?.contains(event.target as Node)) {
      setPanel(false);
      focusCanvas();
    }
  };

  const infoId = hoverId ?? selectedId;
  const info = infoId ? items.get(infoId) : undefined;
  const infoDegree = infoId ? degree.get(infoId) : undefined;
  const localItem = localId ? items.get(localId) : undefined;

  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    setViews((current) => upsertView(current, name, options));
    setViewName('');
  };

  const clearFilters = () => {
    change({ search: '' });
    setLocalId(null);
    setHidden(new Set());
  };

  const sectionTitle = 'section-label mb-2 mt-4 first:mt-0';
  const jumpList = `${uid}-jump`;
  const empty = notes.length === 0;
  const noMatch = !empty && filtered.items.length === 0;

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden" onKeyDown={onRootKey}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-roledescription={t('nav.graph')}
        aria-label={t('graph.canvasLabel')}
        className="h-full w-full touch-none outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-sheen-400)]"
        onKeyDown={onCanvasKey}
      />
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      <div className="pointer-events-none absolute left-5 top-4 flex max-w-[calc(100%-22rem)] flex-col items-start gap-2">
        <div className="section-label">
          {t('graph.pages', { count: count.nodes })} · {t('graph.links', { count: count.links })}
        </div>
        {options.search.trim() && (
          <div className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-md bg-obsidian-800/85 py-1 pl-2.5 pr-1 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] backdrop-blur">
            <span className="shrink-0">{t('graph.activeFilter')}</span>
            <code className="truncate font-mono text-[12px] text-frost-100">{options.search}</code>
            <button
              className="grid size-6 shrink-0 place-items-center rounded text-frost-500 hover:bg-[var(--hover)] hover:text-frost-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sheen-400"
              aria-label={t('graph.clearFilter')}
              title={t('graph.clearFilter')}
              onClick={() => change({ search: '' })}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        )}
        {localItem && (
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-md bg-obsidian-800/85 px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] backdrop-blur">
            <span>
              {t('graph.local')}: <span className="text-frost-100">{localItem.label}</span>
            </span>
            <label className="flex items-center gap-1.5">
              {t('graph.depth')}
              <select
                className="rounded bg-obsidian-950/60 px-1 py-0.5 text-frost-100 ring-1 ring-[var(--hairline-strong)] focus:outline-none focus:ring-sheen-400"
                value={options.localDepth}
                onChange={(event) => change({ localDepth: Number(event.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((depth) => (
                  <option key={depth} value={depth}>
                    {depth}
                  </option>
                ))}
              </select>
            </label>
            <button className={ghostButton} onClick={() => setLocalId(null)}>
              {t('graph.exitLocal')}
            </button>
          </div>
        )}
        {(hidden.size > 0 || pinned > 0) && (
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 text-[12px] text-frost-500">
            {hidden.size > 0 && (
              <span className="flex items-center gap-1.5">
                {t('graph.hidden', { count: hidden.size })}
                <button className={ghostButton} onClick={() => setHidden(new Set())}>
                  {t('graph.showHidden')}
                </button>
              </span>
            )}
            {pinned > 0 && (
              <span className="flex items-center gap-1.5">
                {t('graph.pinned', { count: pinned })}
                <button className={ghostButton} onClick={() => engine.current?.unpinAll()}>
                  {t('graph.unpinAll')}
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {(empty || noMatch) && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
          <div className="pointer-events-auto max-w-sm">
            <p className="font-display text-[18px] font-semibold tracking-tight text-frost-100">{empty ? t('graph.emptyTitle') : t('graph.noMatch')}</p>
            {empty ? (
              <p className="mt-1.5 text-[13px] text-frost-500">{t('graph.emptyHint')}</p>
            ) : (
              <button className={`${ghostButton} mt-3`} onClick={clearFilters}>
                {t('graph.clearFilter')}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-[4.25rem] right-4 top-3 flex max-w-[calc(100%-2rem)] flex-col items-end gap-2">
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="relative">
            <input
              ref={jumpRef}
              className={`${fieldClass} w-44 min-w-0 bg-obsidian-800/80 backdrop-blur`}
              placeholder={t('graph.jump')}
              aria-label={t('graph.jumpLabel')}
              role="combobox"
              aria-expanded={jumpOpen && jump.trim() !== ''}
              aria-controls={jumpList}
              aria-autocomplete="list"
              aria-activedescendant={jumpOpen && jumpResults[jumpIndex] ? `${jumpList}-${jumpIndex}` : undefined}
              value={jump}
              spellCheck={false}
              onChange={(event) => {
                setJump(event.target.value);
                setJumpIndex(0);
                setJumpOpen(true);
              }}
              onBlur={() => setJumpOpen(false)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setJumpOpen(true);
                  const size = jumpResults.length || 1;
                  setJumpIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + size) % size);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const result = jumpResults[jumpIndex];
                  if (result) goTo(result.id);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setJump('');
                  focusCanvas();
                }
              }}
            />
            {jumpOpen && jump.trim() !== '' && (
              <ul
                id={jumpList}
                role="listbox"
                aria-label={t('graph.jumpLabel')}
                className="absolute right-0 top-full z-10 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg bg-obsidian-800/95 p-1 ring-1 ring-[var(--hairline-strong)] backdrop-blur"
              >
                {jumpResults.length === 0 && <li className="px-2 py-1.5 text-[12.5px] text-frost-500">{t('graph.jumpEmpty')}</li>}
                {jumpResults.map((item, index) => (
                  <li
                    key={item.id}
                    id={`${jumpList}-${index}`}
                    role="option"
                    aria-selected={index === jumpIndex}
                    className="cursor-pointer truncate rounded px-2 py-1.5 text-[12.5px] text-frost-300 aria-selected:bg-[var(--hover-strong)] aria-selected:text-frost-100"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => goTo(item.id)}
                  >
                    {item.label}
                    {item.path && item.folder && <span className="ml-1.5 text-frost-500">{item.folder}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            className="shrink-0 whitespace-nowrap rounded-md bg-obsidian-800/80 px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] backdrop-blur hover:text-frost-100 focus-visible:outline-none focus-visible:ring-sheen-400"
            aria-expanded={panel}
            onClick={() => setPanel((open) => !open)}
          >
            {panel ? t('graph.closeSettings') : t('graph.openSettings')}
          </button>
        </div>
        {panel && (
          <div
            data-graph-panel
            className="pointer-events-auto min-h-0 w-72 max-w-full overflow-y-auto rounded-lg bg-obsidian-800/90 p-4 ring-1 ring-[var(--hairline-strong)] backdrop-blur"
          >
            <div className={sectionTitle}>{t('graph.filters')}</div>
            <div className="flex flex-col gap-2.5">
              <input
                className={fieldClass}
                placeholder={t('graph.filterPlaceholder')}
                aria-label={t('graph.filterPlaceholder')}
                title={t('graph.queryHelp')}
                value={options.search}
                spellCheck={false}
                onChange={(event) => change({ search: event.target.value })}
              />
              <p className="text-[11.5px] leading-snug text-frost-500">{t('graph.queryHelp')}</p>
              <Toggle label={t('graph.showTags')} checked={options.showTags} onChange={(showTags) => change({ showTags })} />
              <Toggle label={t('graph.showUnresolved')} checked={options.showUnresolved} onChange={(showUnresolved) => change({ showUnresolved })} />
              <Toggle label={t('graph.orphans')} checked={options.showOrphans} onChange={(showOrphans) => change({ showOrphans })} />
            </div>

            <div className={sectionTitle}>{t('graph.groups')}</div>
            <div className="flex flex-col gap-2.5">
              {options.groups.map((group, index) => (
                <div key={index} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      className={fieldClass}
                      placeholder={t('graph.groupPlaceholder')}
                      aria-label={t('graph.groupQuery', { n: index + 1 })}
                      value={group.query}
                      spellCheck={false}
                      onChange={(event) => change({ groups: options.groups.map((other, at) => (at === index ? { ...other, query: event.target.value } : other)) })}
                    />
                    <button
                      className="grid size-7 shrink-0 place-items-center rounded-md text-frost-500 hover:bg-[var(--hover)] hover:text-frost-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sheen-400"
                      aria-label={t('graph.removeGroup', { n: index + 1 })}
                      title={t('graph.removeGroup', { n: index + 1 })}
                      onClick={() => change({ groups: options.groups.filter((_, at) => at !== index) })}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                  <div className="flex gap-1" role="radiogroup" aria-label={t('graph.groupQuery', { n: index + 1 })}>
                    {Array.from({ length: GRAPH_PALETTE_SIZE }, (_, color) => (
                      <button
                        key={color}
                        role="radio"
                        aria-checked={group.color === color}
                        aria-label={t('graph.groupColor', { n: color + 1 })}
                        className="size-4 rounded-full ring-offset-2 ring-offset-obsidian-800 aria-checked:ring-2 aria-checked:ring-frost-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sheen-400"
                        style={swatch(color)}
                        onClick={() => change({ groups: options.groups.map((other, at) => (at === index ? { ...other, color } : other)) })}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {options.groups.length > 0 && <p className="text-[11.5px] leading-snug text-frost-500">{t('graph.groupsHint')}</p>}
              <button
                className={`${ghostButton} self-start`}
                disabled={options.groups.length >= MAX_GROUPS}
                onClick={() => change({ groups: [...options.groups, { query: '', color: options.groups.length % GRAPH_PALETTE_SIZE }] })}
              >
                {t('graph.addGroup')}
              </button>
            </div>

            <div className={sectionTitle}>{t('graph.display')}</div>
            <div className="flex flex-col gap-2.5">
              <Toggle label={t('graph.arrows')} checked={options.showArrow} onChange={(showArrow) => change({ showArrow })} />
              <Toggle label={t('graph.colorByFolder')} checked={options.colorByFolder} onChange={(colorByFolder) => change({ colorByFolder })} />
              <label className="flex items-center justify-between gap-3 text-[12.5px] text-frost-300">
                {t('graph.sizeBy')}
                <select
                  className="rounded bg-obsidian-950/60 px-1.5 py-1 text-frost-100 ring-1 ring-[var(--hairline-strong)] focus:outline-none focus:ring-sheen-400"
                  value={options.sizeBy}
                  onChange={(event) => change({ sizeBy: event.target.value as SizeBy })}
                >
                  <option value="links">{t('graph.sizeBy.links')}</option>
                  <option value="incoming">{t('graph.sizeBy.incoming')}</option>
                  <option value="uniform">{t('graph.sizeBy.uniform')}</option>
                </select>
              </label>
              <Slider label={t('graph.textFade')} min={-3} max={3} step={0.1} value={options.textFade} onChange={(textFade) => change({ textFade })} />
              <Slider label={t('graph.nodeSize')} min={0.1} max={5} step={0.1} value={options.nodeSize} onChange={(nodeSize) => change({ nodeSize })} />
              <Slider label={t('graph.lineSize')} min={0.1} max={5} step={0.1} value={options.lineSize} onChange={(lineSize) => change({ lineSize })} />
            </div>

            <div className={sectionTitle}>{t('graph.forces')}</div>
            <div className="flex flex-col gap-2.5">
              <Slider label={t('graph.center')} min={0} max={1} step={0.01} value={options.center} onChange={(center) => change({ center })} />
              <Slider label={t('graph.repel')} min={0} max={20} step={0.1} value={options.repel} onChange={(repel) => change({ repel })} />
              <Slider label={t('graph.link')} min={0} max={1} step={0.01} value={options.link} onChange={(link) => change({ link })} />
              <Slider label={t('graph.linkDistance')} min={30} max={500} step={1} value={options.linkDistance} onChange={(linkDistance) => change({ linkDistance })} />
            </div>

            <div className={sectionTitle}>{t('graph.views')}</div>
            <div className="flex flex-col gap-2">
              <form
                className="flex gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveView();
                }}
              >
                <input className={fieldClass} placeholder={t('graph.viewName')} aria-label={t('graph.viewName')} value={viewName} maxLength={60} onChange={(event) => setViewName(event.target.value)} />
                <button type="submit" className={`${ghostButton} shrink-0`} disabled={!viewName.trim()}>
                  {t('graph.saveView')}
                </button>
              </form>
              {views.length === 0 ? (
                <p className="text-[11.5px] leading-snug text-frost-500">{t('graph.noViews')}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {views.map((view) => (
                    <li key={view.name} className="flex items-center gap-1">
                      <button
                        className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-[12.5px] text-frost-300 hover:bg-[var(--hover)] hover:text-frost-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sheen-400"
                        aria-label={t('graph.applyView', { name: view.name })}
                        onClick={() => setOptions(sanitizeOptions(view.options, DEFAULTS))}
                      >
                        {view.name}
                      </button>
                      <button
                        className="grid size-6 shrink-0 place-items-center rounded text-frost-500 hover:bg-[var(--hover)] hover:text-frost-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sheen-400"
                        aria-label={t('graph.deleteView', { name: view.name })}
                        title={t('graph.deleteView', { name: view.name })}
                        onClick={() => setViews((current) => current.filter((other) => other.name !== view.name))}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={sectionTitle}>{t('graph.stats')}</div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12.5px] text-frost-300">
              <dt>{t('graph.stats.notes')}</dt>
              <dd className="text-right tabular-nums text-frost-100">{stats.notes}</dd>
              <dt>{t('graph.stats.orphans')}</dt>
              <dd className="text-right tabular-nums text-frost-100">{stats.orphans}</dd>
              <dt>{t('graph.stats.unresolved')}</dt>
              <dd className="text-right tabular-nums text-frost-100">{stats.unresolved}</dd>
              <dt>{t('graph.stats.tags')}</dt>
              <dd className="text-right tabular-nums text-frost-100">{stats.tags}</dd>
            </dl>
            <div className="mt-2 text-[11.5px] text-frost-500">{t('graph.stats.hubs')}</div>
            {stats.hubs.length === 0 ? (
              <p className="mt-1 text-[11.5px] text-frost-500">{t('graph.stats.hubsEmpty')}</p>
            ) : (
              <ol className="mt-1 flex flex-col gap-0.5">
                {stats.hubs.map((hub) => (
                  <li key={hub.id}>
                    <button
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[12.5px] text-frost-300 hover:bg-[var(--hover)] hover:text-frost-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sheen-400 disabled:opacity-50"
                      disabled={!filtered.items.some((item) => item.id === hub.id)}
                      onClick={() => goTo(hub.id)}
                    >
                      <span className="truncate">{hub.label}</span>
                      <span className="tabular-nums text-frost-500">{hub.links}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <button
              className="mt-4 w-full rounded-md px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] hover:bg-[var(--hover)] hover:text-frost-100 focus-visible:outline-none focus-visible:ring-sheen-400"
              onClick={() => setOptions({ ...DEFAULTS, search: options.search })}
            >
              {t('graph.reset')}
            </button>
          </div>
        )}
      </div>

      {info && (
        <div className="pointer-events-none absolute bottom-4 left-5 max-w-[min(22rem,calc(100%-7rem))] rounded-lg bg-obsidian-800/85 px-3 py-2 ring-1 ring-[var(--hairline-strong)] backdrop-blur">
          <div className="truncate text-[13px] font-medium text-frost-100">{info.label}</div>
          <div className="truncate text-[11.5px] text-frost-500">
            {info.kind === 'note' ? info.path : info.kind === 'tag' ? t('graph.kind.tag') : t('graph.kind.unresolved')}
          </div>
          <div className="mt-1 flex gap-3 text-[11.5px] text-frost-300">
            <span>{t('graph.incoming', { count: infoDegree?.incoming ?? 0 })}</span>
            {info.kind === 'note' && <span>{t('graph.outgoing', { count: infoDegree?.outgoing ?? 0 })}</span>}
          </div>
        </div>
      )}

      <div
        role="toolbar"
        aria-label={t('graph.toolbar')}
        className="absolute bottom-4 right-4 flex gap-0.5 rounded-lg bg-obsidian-800/85 p-1 ring-1 ring-[var(--hairline-strong)] backdrop-blur"
      >
        <button className={iconButton} aria-label={t('graph.zoomIn')} title={`${t('graph.zoomIn')} (+)`} onClick={() => engine.current?.zoomBy(BUTTON_ZOOM)}>
          <ZoomInIcon />
        </button>
        <button className={iconButton} aria-label={t('graph.zoomOut')} title={`${t('graph.zoomOut')} (-)`} onClick={() => engine.current?.zoomBy(1 / BUTTON_ZOOM)}>
          <ZoomOutIcon />
        </button>
        <button className={iconButton} aria-label={t('graph.fit')} title={`${t('graph.fit')} (0)`} onClick={() => engine.current?.fit()}>
          <FitIcon />
        </button>
        <button className={iconButton} aria-pressed={paused} aria-label={paused ? t('graph.resume') : t('graph.pause')} title={`${paused ? t('graph.resume') : t('graph.pause')} (${t('graph.keySpace')})`} onClick={togglePause}>
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button className={iconButton} aria-label={t('graph.export')} title={t('graph.export')} onClick={() => void exportPng()}>
          <DownloadIcon />
        </button>
        <button className={iconButton} aria-label={t('graph.help')} title={`${t('graph.help')} (?)`} onClick={() => setHelp(true)}>
          <HelpIcon />
        </button>
      </div>

      {help && <ShortcutHelp onClose={() => { setHelp(false); focusCanvas(); }} />}
      {menu && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

const SHORTCUTS: [keys: string, label: Parameters<ReturnType<typeof useT>>[0]][] = [
  ['← ↑ → ↓', 'graph.keys.move'],
  ['Enter', 'graph.keys.open'],
  ['Ctrl Enter', 'graph.keys.openTab'],
  ['+  −', 'graph.keys.zoom'],
  ['0', 'graph.keys.fit'],
  ['graph.keySpace', 'graph.keys.pause'],
  ['L', 'graph.keys.local'],
  ['P', 'graph.keys.pin'],
  ['H', 'graph.keys.hide'],
  ['Shift F10', 'graph.keys.menu'],
  ['/  Ctrl F', 'graph.keys.find'],
  ['Esc', 'graph.keys.escape'],
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const t = useT();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center bg-obsidian-950/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-xl bg-obsidian-800 p-5 ring-1 ring-[var(--hairline-strong)]"
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            // Um único botão: Tab fica no diálogo, Esc fecha.
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') onClose();
          }
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-[15px] font-semibold text-frost-100">
            {t('graph.shortcuts')}
          </h2>
          <button ref={closeRef} className={iconButton} aria-label={t('graph.close')} onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[12.5px] text-frost-300">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={label} className="contents">
              <dt className="justify-self-start">
                <Kbd>{keys === 'graph.keySpace' ? t(keys) : keys}</Kbd>
              </dt>
              <dd>{t(label)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
