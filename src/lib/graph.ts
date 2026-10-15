// Lógica pura da tela do grafo: montar nós e arestas a partir das notas, filtrar pela consulta,
// grafo local, estatísticas, navegação pelo teclado e enquadramento da câmera.
// Nada aqui toca o DOM; os testes (tests/graph.test.mjs) importam este arquivo direto.

import { baseName, dirName, isRequestTarget, outgoingTargets, resolveLink } from './links.ts';
import { extractTags } from './notes.ts';
import type { Note } from '../types';

export type NodeKind = 'note' | 'tag' | 'unresolved';

export type GraphItem = {
  id: string;
  kind: NodeKind;
  label: string;
  /** Caminho da nota (só notas). */
  path?: string;
  /** Pasta da nota com barra no fim, "" na raiz. */
  folder: string;
  tags: string[];
  /** Texto da nota em minúsculas, para `content:`. */
  text: string;
};

export type GraphData = { items: GraphItem[]; edges: [from: string, to: string][] };

export const tagId = (tag: string) => `#${tag}`;
export const unresolvedId = (target: string) => `?${target.trim().toLowerCase()}`;

/**
 * Nós e arestas do vault. Arestas repetidas (dois links para a mesma página, com grafias
 * diferentes) viram uma só; links para requests (.bru) ficam de fora, como anexos.
 */
export function buildGraph(notes: Note[], contents: Record<string, string>, options: { tags?: boolean; unresolved?: boolean } = {}): GraphData {
  const items = new Map<string, GraphItem>();
  const edges: [string, string][] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string) => {
    const key = `${from}\n${to}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    edges.push([from, to]);
  };

  for (const note of notes) {
    const content = contents[note.path] ?? '';
    items.set(note.path, { id: note.path, kind: 'note', label: note.name, path: note.path, folder: dirName(note.path), tags: extractTags(content), text: content.toLowerCase() });
  }
  for (const note of notes) {
    const item = items.get(note.path)!;
    for (const target of outgoingTargets(contents[note.path] ?? '')) {
      if (isRequestTarget(target)) continue;
      const to = resolveLink(target, notes);
      if (to) add(note.path, to);
      else if (options.unresolved) {
        const id = unresolvedId(target);
        if (!items.has(id)) items.set(id, { id, kind: 'unresolved', label: baseName(target.trim()), folder: '', tags: [], text: '' });
        add(note.path, id);
      }
    }
    if (options.tags) {
      for (const tag of item.tags) {
        const id = tagId(tag);
        if (!items.has(id)) items.set(id, { id, kind: 'tag', label: `#${tag}`, folder: '', tags: [tag], text: '' });
        add(note.path, id);
      }
    }
  }
  return { items: [...items.values()], edges };
}

// ---------------------------------------------------------------------------------------------
// Consulta: termos separados por espaço (todos precisam bater), "OR" separa alternativas,
// "-" nega, aspas juntam palavras, e os prefixos path:, file:, tag: e content: escolhem o campo.

export type QueryField = 'any' | 'path' | 'file' | 'tag' | 'content';
export type QueryTerm = { field: QueryField; value: string; negate: boolean };
export type Query = QueryTerm[][];

const FIELDS: QueryField[] = ['path', 'file', 'tag', 'content'];

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  for (const match of input.matchAll(/-?(?:\w+:)?"[^"]*"?|\S+/g)) tokens.push(match[0]);
  return tokens;
}

export function parseQuery(input: string): Query {
  const groups: Query = [[]];
  for (const token of tokenize(input)) {
    if (token === 'OR') {
      if (groups[groups.length - 1].length) groups.push([]);
      continue;
    }
    if (token === '-') continue;
    let rest = token;
    const negate = rest.startsWith('-') && rest.length > 1;
    if (negate) rest = rest.slice(1);
    let field: QueryField = 'any';
    const colon = rest.indexOf(':');
    if (colon > 0) {
      const name = rest.slice(0, colon).toLowerCase() as QueryField;
      if (FIELDS.includes(name)) {
        field = name;
        rest = rest.slice(colon + 1);
      }
    }
    let value = rest.replace(/^"|"$/g, '').toLowerCase();
    if (field === 'tag') value = value.replace(/^#/, '');
    if (!value) continue;
    groups[groups.length - 1].push({ field, value, negate });
  }
  return groups.filter((group) => group.length);
}

function termMatches(term: QueryTerm, item: GraphItem): boolean {
  const label = item.label.toLowerCase();
  const path = (item.path ?? item.label).toLowerCase();
  switch (term.field) {
    case 'path':
      return path.includes(term.value);
    case 'file':
      return label.includes(term.value);
    case 'tag':
      return item.tags.some((tag) => tag === term.value || tag.startsWith(`${term.value}/`));
    case 'content':
      return item.text.includes(term.value);
    default:
      return path.includes(term.value) || label.includes(term.value);
  }
}

export function matchQuery(query: Query, item: GraphItem): boolean {
  if (!query.length) return true;
  return query.some((group) => group.every((term) => termMatches(term, item) !== term.negate));
}

// ---------------------------------------------------------------------------------------------
// Filtro e grafo local.

/** Ids a até `depth` passos de `id`, contando as arestas nos dois sentidos (inclui o próprio id). */
export function neighborsWithin(edges: [string, string][], id: string, depth: number): Set<string> {
  const adjacent = new Map<string, string[]>();
  for (const [a, b] of edges) {
    (adjacent.get(a) ?? adjacent.set(a, []).get(a)!).push(b);
    (adjacent.get(b) ?? adjacent.set(b, []).get(b)!).push(a);
  }
  const found = new Set([id]);
  let frontier = [id];
  for (let step = 0; step < depth && frontier.length; step++) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const other of adjacent.get(current) ?? []) {
        if (found.has(other)) continue;
        found.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return found;
}

export type FilterOptions = {
  query: string;
  showOrphans: boolean;
  hidden?: ReadonlySet<string>;
  local?: { id: string; depth: number } | null;
};

/**
 * Aplica consulta, nós ocultos, grafo local e órfãos, nessa ordem. Tags e links sem página
 * pertencem às notas: ficam só se alguma nota que sobrou aponta para eles.
 */
export function filterGraph(data: GraphData, options: FilterOptions): GraphData {
  const query = parseQuery(options.query);
  const hidden = options.hidden ?? new Set<string>();
  const notes = new Set(data.items.filter((item) => item.kind === 'note' && !hidden.has(item.id) && matchQuery(query, item)).map((item) => item.id));
  const attached = new Set<string>();
  for (const [from, to] of data.edges) if (notes.has(from) && !hidden.has(to)) attached.add(to);
  let kept = new Set(data.items.filter((item) => notes.has(item.id) || (item.kind !== 'note' && attached.has(item.id))).map((item) => item.id));
  let edges = data.edges.filter(([from, to]) => kept.has(from) && kept.has(to));

  const local = options.local && kept.has(options.local.id) ? options.local : null;
  if (local) {
    kept = neighborsWithin(edges, local.id, local.depth);
    edges = edges.filter(([from, to]) => kept.has(from) && kept.has(to));
  }
  if (!options.showOrphans) {
    const linked = new Set(edges.flat());
    if (local) linked.add(local.id);
    kept = new Set([...kept].filter((id) => linked.has(id)));
  }
  return { items: data.items.filter((item) => kept.has(item.id)), edges };
}

// ---------------------------------------------------------------------------------------------
// Estatísticas.

export type Degree = { incoming: number; outgoing: number };

export function degrees(edges: [string, string][]): Map<string, Degree> {
  const result = new Map<string, Degree>();
  const get = (id: string) => result.get(id) ?? result.set(id, { incoming: 0, outgoing: 0 }).get(id)!;
  for (const [from, to] of edges) {
    get(from).outgoing++;
    get(to).incoming++;
  }
  return result;
}

export type GraphStats = { notes: number; orphans: number; unresolved: number; tags: number; hubs: { id: string; label: string; links: number }[] };

/** Contagens do grafo inteiro (sem filtro) e as páginas mais ligadas. */
export function graphStats(data: GraphData, hubCount = 5): GraphStats {
  // Tags não contam como links: uma página só com tags continua órfã e fora dos destaques.
  const degree = degrees(data.edges.filter(([, to]) => !to.startsWith('#')));
  const notes = data.items.filter((item) => item.kind === 'note');
  const linked = new Set<string>();
  for (const [from, to] of data.edges) {
    if (to.startsWith('#')) continue;
    linked.add(from);
    linked.add(to);
  }
  const links = (id: string) => (degree.get(id)?.incoming ?? 0) + (degree.get(id)?.outgoing ?? 0);
  return {
    notes: notes.length,
    orphans: notes.filter((item) => !linked.has(item.id)).length,
    unresolved: data.items.filter((item) => item.kind === 'unresolved').length,
    tags: data.items.filter((item) => item.kind === 'tag').length,
    hubs: notes
      .map((item) => ({ id: item.id, label: item.label, links: links(item.id) }))
      .filter((hub) => hub.links > 0)
      .sort((a, b) => b.links - a.links || a.label.localeCompare(b.label))
      .slice(0, hubCount),
  };
}

// ---------------------------------------------------------------------------------------------
// Teclado e câmera.

export type Direction = 'up' | 'down' | 'left' | 'right';
type Point = { id: string; x: number; y: number };

/**
 * O vizinho mais próximo na direção da seta, dentro de um cone de 45° para cada lado.
 * O desvio lateral pesa o dobro, para a seta seguir a linha que o olho espera.
 */
export function nearestInDirection(from: Point, candidates: Point[], direction: Direction): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    if (candidate.id === from.id) continue;
    const dx = candidate.x - from.x;
    const dy = candidate.y - from.y;
    const primary = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    const lateral = Math.abs(direction === 'left' || direction === 'right' ? dy : dx);
    if (primary <= 0 || lateral > primary) continue;
    const score = primary + lateral * 2;
    if (score < bestScore) {
      bestScore = score;
      best = candidate.id;
    }
  }
  return best;
}

export type Camera = { scale: number; panX: number; panY: number };

/** Escala e deslocamento que mostram todos os pontos com margem, dentro dos limites de zoom. */
export function fitCamera(points: { x: number; y: number; r?: number }[], width: number, height: number, padding = 48, minScale = 1 / 128, maxScale = 2): Camera {
  if (!points.length || width <= 0 || height <= 0) return { scale: 1, panX: width / 2, panY: height / 2 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const r = point.r ?? 0;
    minX = Math.min(minX, point.x - r);
    minY = Math.min(minY, point.y - r);
    maxX = Math.max(maxX, point.x + r);
    maxY = Math.max(maxY, point.y + r);
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min(maxScale, Math.max(minScale, Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)));
  return { scale, panX: width / 2 - ((minX + maxX) / 2) * scale, panY: height / 2 - ((minY + maxY) / 2) * scale };
}

/** Índice estável na paleta para uma pasta (a raiz fica sem cor própria: -1). */
export function folderColor(folder: string, size: number): number {
  if (!folder || size <= 0) return -1;
  let hash = 0;
  for (const char of folder.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % size;
}

/** Primeiro grupo cuja consulta bate com o nó, ou -1. Grupos com consulta vazia são ignorados. */
export function groupIndex(groups: { query: string }[], item: GraphItem): number {
  return groups.findIndex((group) => {
    const query = parseQuery(group.query);
    return query.length > 0 && matchQuery(query, item);
  });
}

// ---------------------------------------------------------------------------------------------
// Preferências guardadas: o que vem do localStorage passa por aqui antes de valer.

export const GRAPH_PALETTE_SIZE = 8;
export const MAX_GROUPS = 12;
export const MAX_VIEWS = 20;

export type SizeBy = 'links' | 'incoming' | 'uniform';
export type ColorGroup = { query: string; color: number };

export type GraphOptions = {
  search: string;
  showOrphans: boolean;
  showTags: boolean;
  showUnresolved: boolean;
  showArrow: boolean;
  colorByFolder: boolean;
  sizeBy: SizeBy;
  textFade: number;
  nodeSize: number;
  lineSize: number;
  center: number;
  repel: number;
  link: number;
  linkDistance: number;
  localDepth: number;
  groups: ColorGroup[];
};

const RANGES: Partial<Record<keyof GraphOptions, [number, number]>> = {
  textFade: [-3, 3],
  nodeSize: [0.1, 5],
  lineSize: [0.1, 5],
  center: [0, 1],
  repel: [0, 20],
  link: [0, 1],
  linkDistance: [30, 500],
  localDepth: [1, 5],
};

const SIZE_BY: SizeBy[] = ['links', 'incoming', 'uniform'];

/** Mescla o que foi lido com os padrões, descartando tipos errados e prendendo números às faixas. */
export function sanitizeOptions(raw: unknown, defaults: GraphOptions): GraphOptions {
  const result: GraphOptions = { ...defaults, groups: [...defaults.groups] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(defaults) as (keyof GraphOptions)[]) {
    const value = input[key];
    const fallback = defaults[key];
    if (key === 'groups') {
      if (!Array.isArray(value)) continue;
      result.groups = value
        .filter((group): group is ColorGroup => !!group && typeof group === 'object' && typeof group.query === 'string' && Number.isInteger(group.color))
        .slice(0, MAX_GROUPS)
        .map((group) => ({ query: group.query.slice(0, 200), color: ((group.color % GRAPH_PALETTE_SIZE) + GRAPH_PALETTE_SIZE) % GRAPH_PALETTE_SIZE }));
    } else if (key === 'sizeBy') {
      if (SIZE_BY.includes(value as SizeBy)) result.sizeBy = value as SizeBy;
    } else if (typeof fallback === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const [min, max] = RANGES[key] ?? [-Infinity, Infinity];
      (result[key] as number) = Math.min(max, Math.max(min, key === 'localDepth' ? Math.round(value) : value));
    } else if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') (result[key] as boolean) = value;
    } else if (typeof fallback === 'string') {
      if (typeof value === 'string') (result[key] as string) = value.slice(0, 500);
    }
  }
  return result;
}

export type SavedView = { name: string; options: GraphOptions };

export function sanitizeViews(raw: unknown, defaults: GraphOptions): SavedView[] {
  if (!Array.isArray(raw)) return [];
  const views: SavedView[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : '';
    if (!name || views.some((view) => view.name === name)) continue;
    views.push({ name, options: sanitizeOptions(entry.options, defaults) });
    if (views.length >= MAX_VIEWS) break;
  }
  return views;
}

/** Grava (ou substitui, pelo nome) uma visão; a mais recente fica no topo. */
export function upsertView(views: SavedView[], name: string, options: GraphOptions): SavedView[] {
  const clean = name.trim().slice(0, 60);
  if (!clean) return views;
  return [{ name: clean, options }, ...views.filter((view) => view.name !== clean)].slice(0, MAX_VIEWS);
}
