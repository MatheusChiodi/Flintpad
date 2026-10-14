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
import { useEffect, useRef, useState } from 'react';

import { useT } from '../lib/i18n';
import type { Note } from '../types';

// Mesmas regras do grafo do Obsidian (sim.js + renderizador em app.js, v1.12.7):
// física d3-force, tamanho do nó pelo número de links, zoom no cursor, rótulos que
// somem ao afastar e vizinhança destacada ao passar o mouse.

const MAX_NODES = 3000;
const MIN_SCALE = 1 / 128;
const MAX_SCALE = 8;
const WHEEL_ZOOM_BASE = 1.5;
const VELOCITY_DECAY = 0.4; // o worker multiplica a velocidade por 0,6 a cada passo
const DRAG_ALPHA = 0.3;
const CLICK_SLOP_PX = 5;
const FADED_ALPHA = 0.2;
const HOVER_TEXT_SHIFT = 15;
const SMOOTHING = 0.15;
const GLOW_NODE_LIMIT = 250;
const STORAGE_KEY = 'obnotion:graph';

type Options = {
  search: string;
  showOrphans: boolean;
  showArrow: boolean;
  textFade: number;
  nodeSize: number;
  lineSize: number;
  // Posições dos controles deslizantes, convertidas em força por `sliderToStrength`.
  center: number;
  repel: number;
  link: number;
  linkDistance: number;
};

// Curva dos controles de força do Obsidian: SJ leva força a posição, MJ faz o inverso.
const SLIDER_BASE = 0.01;
const strengthToSlider = (strength: number) => 1 - Math.log(strength * (1 - SLIDER_BASE) + SLIDER_BASE) / Math.log(SLIDER_BASE);
const sliderToStrength = (slider: number) => (Math.pow(SLIDER_BASE, 1 - slider) - SLIDER_BASE) / (1 - SLIDER_BASE);

const DEFAULTS: Options = {
  search: '',
  showOrphans: true,
  showArrow: false,
  textFade: 0,
  nodeSize: 1,
  lineSize: 1,
  center: strengthToSlider(0.1),
  repel: 10,
  link: strengthToSlider(1),
  linkDistance: 250,
};

function loadOptions(): Options {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'), search: '' };
  } catch {
    return DEFAULTS;
  }
}

type GNode = SimulationNodeDatum & {
  id: string;
  note: Note;
  weight: number;
  related: Set<GNode>;
  fade: number;
  textShift: number;
};
type GLink = SimulationLinkDatum<GNode> & { source: GNode; target: GNode; forward: boolean; backward: boolean };

type Engine = {
  setData: (notes: Note[], edges: [string, string][], options: Options) => void;
  setOptions: (options: Options) => void;
  destroy: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const approach = (current: number, target: number) => (Math.abs(target - current) < 0.002 ? target : current + (target - current) * SMOOTHING);

function createEngine(canvas: HTMLCanvasElement, onOpen: (path: string) => void, onCount: (nodes: number, links: number) => void): Engine {
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
  let width = 0;
  let height = 0;

  let hovered: GNode | null = null;
  let dragNode: GNode | null = null;
  let panning = false;
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
    font: token('--font-sans'),
  };

  const nodeSize = (node: GNode) => options.nodeSize * Math.max(8, Math.min(3 * Math.sqrt(node.weight + 1), 30));

  const linkForce: ForceLink<GNode, GLink> = forceLink<GNode, GLink>([]);
  const simulation: Simulation<GNode, GLink> = forceSimulation<GNode, GLink>([])
    .velocityDecay(VELOCITY_DECAY)
    .force('x', forceX<GNode>(0))
    .force('y', forceY<GNode>(0))
    .force('link', linkForce)
    .force('charge', forceManyBody<GNode>())
    .on('tick', () => {
      dirty = true;
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

  const updateZoom = () => {
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

  const draw = () => {
    const nodeScale = Math.sqrt(1 / scale);
    const textAlpha = clamp(Math.log2(scale) + 1 - options.textFade, 0, 1);
    const focus = dragNode ?? hovered;
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

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const sx = (node: GNode) => node.x! * scale + panX;
    const sy = (node: GNode) => node.y! * scale + panY;
    const radius = (node: GNode) => nodeSize(node) * nodeScale * scale;

    ctx.lineWidth = options.lineSize;
    for (const link of links) {
      const { source, target } = link;
      const lit = focus && (source === focus || target === focus);
      ctx.globalAlpha = lit ? 0.9 : Math.min(source.fade, target.fade) * 0.3;
      ctx.strokeStyle = ctx.fillStyle = lit ? paint.sheenLit : paint.line;
      const ax = sx(source);
      const ay = sy(source);
      const bx = sx(target);
      const by = sy(target);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      if (!options.showArrow) continue;
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const ux = (bx - ax) / length;
      const uy = (by - ay) / length;
      const head = 4 + 2 * options.lineSize;
      const arrow = (tipX: number, tipY: number, dx: number, dy: number) => {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - dx * head * 1.8 - dy * head, tipY - dy * head * 1.8 + dx * head);
        ctx.lineTo(tipX - dx * head * 1.8 + dy * head, tipY - dy * head * 1.8 - dx * head);
        ctx.fill();
      };
      if (link.forward) arrow(bx - ux * radius(target), by - uy * radius(target), ux, uy);
      if (link.backward) arrow(ax + ux * radius(source), ay + uy * radius(source), -ux, -uy);
    }

    for (const node of nodes) {
      const x = sx(node);
      const y = sy(node);
      const r = radius(node);
      if (x + r * 4 < 0 || x - r * 4 > width || y + r * 4 < 0 || y - r * 4 > height) continue;
      const isFocus = node === focus;
      // Páginas ligadas brilham; as soltas ficam como pedra apagada.
      if (glow && (node.weight || isFocus)) {
        const reach = r * 2.4 + 6;
        const gradient = ctx.createRadialGradient(x, y, r * 0.5, x, y, reach);
        gradient.addColorStop(0, paint.sheen);
        gradient.addColorStop(1, 'transparent');
        ctx.globalAlpha = (isFocus ? 0.55 : 0.28) * node.fade;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, reach, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = node.fade;
      ctx.fillStyle = isFocus ? paint.labelLit : node.weight ? paint.sheenLit : paint.orphan;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (isFocus) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = paint.sheenLit;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = options.lineSize;
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = paint.halo;
    for (const node of nodes) {
      const isFocus = node === focus;
      const alpha = isFocus ? 1 : textAlpha * node.fade;
      if (alpha <= 0.001) continue;
      const x = sx(node);
      const size = nodeSize(node);
      // O rótulo em foco mantém o tamanho mesmo com o grafo afastado.
      const textScale = isFocus && scale < 1 ? 1 : nodeScale * scale;
      const y = sy(node) + (size + 5) * nodeScale * scale + node.textShift;
      if (x < -200 || x > width + 200 || y < -40 || y > height + 40) continue;
      ctx.font = `500 ${(14 + size / 4) * textScale}px ${paint.font}`;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3.5;
      ctx.strokeText(node.note.name, x, y);
      ctx.fillStyle = isFocus ? paint.labelLit : paint.label;
      ctx.fillText(node.note.name, x, y);
    }
    ctx.globalAlpha = 1;
    return animating;
  };

  const frame = () => {
    updateZoom();
    if (dirty) {
      dirty = false;
      if (draw()) dirty = true;
    }
    raf = requestAnimationFrame(frame);
  };

  const local = (event: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 40;
    else if (event.deltaMode === 2) delta *= 800;
    targetScale *= Math.pow(WHEEL_ZOOM_BASE, -delta / 120);
    // Aproximar mira o cursor; afastar recua a partir do centro da tela.
    zoomCenter = targetScale < scale ? null : local(event);
    dirty = true;
  };

  const onPointerDown = (event: PointerEvent) => {
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
      const world = toWorld(point.x, point.y);
      dragNode.fx = world.x;
      dragNode.fy = world.y;
      simulation.alphaTarget(DRAG_ALPHA);
      reheat(DRAG_ALPHA);
    } else if (panning) {
      panX += event.movementX;
      panY += event.movementY;
    } else {
      const found = nodeAt(point.x, point.y);
      if (found === hovered) return;
      hovered = found;
      canvas.style.cursor = found ? 'pointer' : 'default';
    }
    dirty = true;
  };

  const onPointerUp = (event: PointerEvent) => {
    canvas.releasePointerCapture(event.pointerId);
    if (dragNode) {
      const node = dragNode;
      node.fx = null;
      node.fy = null;
      simulation.alphaTarget(0);
      dragNode = null;
      if (!moved) onOpen(node.note.path);
    }
    panning = false;
    canvas.style.cursor = hovered ? 'pointer' : 'default';
    dirty = true;
  };

  const onPointerLeave = () => {
    if (dragNode || panning) return;
    hovered = null;
    dirty = true;
  };

  const resize = () => {
    const nextWidth = canvas.clientWidth;
    const nextHeight = canvas.clientHeight;
    // Na primeira medida o mundo é centrado; depois o centro acompanha a janela.
    panX += width ? (nextWidth - width) / 2 : nextWidth / 2;
    panY += height ? (nextHeight - height) / 2 : nextHeight / 2;
    width = nextWidth;
    height = nextHeight;
    canvas.width = Math.round(width * devicePixelRatio);
    canvas.height = Math.round(height * devicePixelRatio);
    dirty = true;
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  raf = requestAnimationFrame(frame);

  return {
    setData(notes, edges, nextOptions) {
      options = nextOptions;
      const query = options.search.trim().toLowerCase();
      const linked = new Set(edges.flat());
      const shown = notes
        .filter((note) => (!query || note.path.toLowerCase().includes(query)) && (options.showOrphans || linked.has(note.path)))
        .slice(0, MAX_NODES);

      // Nós que já existiam mantêm a posição; os novos nascem perto do centro.
      const next = new Map<string, GNode>();
      shown.forEach((note, index) => {
        const previous = known.get(note.path);
        const angle = index * 2.399963;
        const distance = 12 * Math.sqrt(index + 0.5);
        const node: GNode = previous ?? { id: note.path, note, weight: 0, related: new Set(), fade: 1, textShift: 0, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
        node.note = note;
        node.weight = 0;
        node.related = new Set();
        next.set(note.path, node);
      });
      known.clear();
      next.forEach((node, id) => known.set(id, node));

      const pairs = new Map<string, GLink>();
      for (const [from, to] of edges) {
        const source = next.get(from);
        const target = next.get(to);
        if (!source || !target) continue;
        source.weight++;
        target.weight++;
        source.related.add(target);
        target.related.add(source);
        const flipped = from > to;
        const key = flipped ? `${to}\n${from}` : `${from}\n${to}`;
        const link = pairs.get(key) ?? { source: flipped ? target : source, target: flipped ? source : target, forward: false, backward: false };
        if (flipped) link.backward = true;
        else link.forward = true;
        pairs.set(key, link);
      }

      nodes = [...next.values()];
      links = [...pairs.values()];
      if (hovered && !next.has(hovered.id)) hovered = null;
      simulation.nodes(nodes);
      linkForce.links(links);
      applyForces();
      simulation.alpha(1).restart();
      onCount(nodes.length, links.length);
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
    destroy() {
      cancelAnimationFrame(raf);
      simulation.stop();
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}

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

type Props = {
  notes: Note[];
  edges: [from: string, to: string][];
  onOpen: (path: string) => void;
};

export function Graph({ notes, edges, onOpen }: Props) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const [options, setOptions] = useState(loadOptions);
  const [panel, setPanel] = useState(false);
  const [count, setCount] = useState({ nodes: 0, links: 0 });

  const change = (patch: Partial<Options>) => setOptions((current) => ({ ...current, ...patch }));

  useEffect(() => {
    engine.current = createEngine(canvasRef.current!, (path) => openRef.current(path), (nodes, links) => setCount({ nodes, links }));
    return () => engine.current?.destroy();
  }, []);

  // Dados e filtros refazem o conjunto de nós; o restante só ajusta desenho e forças.
  useEffect(() => {
    engine.current?.setData(notes, edges, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, edges, options.search, options.showOrphans]);

  useEffect(() => {
    engine.current?.setOptions(options);
    const { search: _search, ...persisted } = options;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [options]);

  const sectionTitle = 'section-label mb-2 mt-4 first:mt-0';

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="h-full w-full touch-none" />
      <div className="section-label pointer-events-none absolute left-5 top-4">
        {t('graph.pages', { count: count.nodes })} · {t('graph.links', { count: count.links })}
      </div>

      <div className="absolute right-4 top-3 flex w-64 flex-col items-end gap-2">
        <button
          className="rounded-md bg-obsidian-800/80 px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] backdrop-blur hover:text-frost-100"
          aria-expanded={panel}
          onClick={() => setPanel((open) => !open)}
        >
          {panel ? t('graph.closeSettings') : t('graph.openSettings')}
        </button>
        {panel && (
          <div className="max-h-[70vh] w-full overflow-y-auto rounded-lg bg-obsidian-800/90 p-4 ring-1 ring-[var(--hairline-strong)] backdrop-blur">
            <div className={sectionTitle}>{t('graph.filters')}</div>
            <div className="flex flex-col gap-2.5">
              <input
                className="w-full rounded-md bg-obsidian-950/60 px-2.5 py-1.5 text-[12.5px] text-frost-100 outline-none ring-1 ring-[var(--hairline-strong)] placeholder:text-frost-500 focus:ring-sheen-400"
                placeholder={t('graph.filterPlaceholder')}
                value={options.search}
                spellCheck={false}
                onChange={(event) => change({ search: event.target.value })}
              />
              <Toggle label={t('graph.orphans')} checked={options.showOrphans} onChange={(showOrphans) => change({ showOrphans })} />
            </div>

            <div className={sectionTitle}>{t('graph.display')}</div>
            <div className="flex flex-col gap-2.5">
              <Toggle label={t('graph.arrows')} checked={options.showArrow} onChange={(showArrow) => change({ showArrow })} />
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

            <button
              className="mt-4 w-full rounded-md px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] hover:bg-[var(--hover)] hover:text-frost-100"
              onClick={() => setOptions({ ...DEFAULTS, search: options.search })}
            >
              {t('graph.reset')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
