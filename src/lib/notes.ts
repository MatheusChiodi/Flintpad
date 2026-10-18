// Lógica pura da tela de notas: nomes, títulos, contagens, tags, menções, busca e modelos.
// Nada aqui toca o DOM nem o disco; os testes (tests/notes.test.mjs) importam este arquivo direto.

import { fuzzyMatch } from './fuzzy.ts';
import { baseName, dirName, splitFrontmatter } from './links.ts';
import type { Note } from '../types';

// Caracteres que o Windows recusa em nomes de arquivo e os que quebram um [[wikilink]].
const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Nome de página seguro para arquivo e para link; vazio se não sobrar nada. */
export function sanitizeNoteName(raw: string): string {
  // Espaços (tab, quebra de linha) viram um espaço antes de apagar os controles, senão as palavras grudam.
  const name = raw.replace(/\s+/g, ' ').replace(FORBIDDEN_NAME_CHARS, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return RESERVED_WINDOWS_NAMES.test(name) ? `${name}_` : name;
}

/** Como sanitizeNoteName, mas aceita subpastas ("Projetos/Casa"): cada parte é limpa e as vazias somem. */
export function sanitizeNotePath(raw: string): string {
  return raw
    .split(/[\\/]+/)
    .map((part) => (part === '..' || part === '.' ? '' : sanitizeNoteName(part)))
    .filter(Boolean)
    .join('/');
}

// ---------------------------------------------------------------------------------------------
// Wikilinks com seção: [[Alvo#Seção|apelido]]. O regex de links.ts descarta a seção; aqui ela fica.

const DETAILED_LINK = String.raw`\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]`;
export const detailedLinkRegex = () => new RegExp(DETAILED_LINK, 'g');

export type LinkParts = { target: string; section: string; alias: string };

export function parseLinkTarget(raw: string): LinkParts {
  const match = new RegExp(`^${DETAILED_LINK}$`).exec(`[[${raw}]]`);
  if (!match) return { target: raw.trim(), section: '', alias: '' };
  return { target: match[1].trim(), section: (match[2] ?? '').trim(), alias: (match[3] ?? '').trim() };
}

export const linkMarkdown = ({ target, section, alias }: LinkParts) =>
  `[[${target}${section ? `#${section}` : ''}${alias ? `|${alias}` : ''}]]`;

// ---------------------------------------------------------------------------------------------
// Texto sem a sintaxe: base para contar palavras, buscar menções e mostrar trechos.

// Troca blocos de código cercados por linhas vazias, mantendo a contagem de linhas.
function withoutFences(markdown: string): string {
  let inside = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inside = !inside;
        return '';
      }
      return inside ? '' : line;
    })
    .join('\n');
}

/** Markdown → texto corrido: sem frontmatter, marcas, links (fica o apelido ou o alvo) nem código cercado. */
export function plainText(markdown: string): string {
  const [, body] = splitFrontmatter(markdown);
  return withoutFences(body)
    .replace(detailedLinkRegex(), (_all, target: string, _section, alias?: string) => (alias ?? target).trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/<[^>]+>/g, '');
}

/**
 * Página → arquivo .txt para ler fora do app: título no topo, listas com marcadores, tarefas com [ ]/[x],
 * links com o endereço entre parênteses e o código dos blocos preservado (só as cercas saem).
 */
export function noteToText(markdown: string, title: string): string {
  const [, body] = splitFrontmatter(markdown);
  let fenced = false;
  const lines = body.replace(/\r\n/g, '\n').split('\n').flatMap((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return [];
    }
    if (fenced) return [line];
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return ['----------'];
    return [
      line
        .replace(detailedLinkRegex(), (_all, target: string, _section, alias?: string) => (alias ?? target).trim())
        .replace(/!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_all, alt: string, url: string) => (alt ? `${alt} (${url})` : url))
        .replace(/\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_all, text: string, url: string) => (!text || text === url ? url : `${text} (${url})`))
        .replace(/^(\s*)#{1,6}\s+/, '$1')
        .replace(/^(\s*)>\s?/, '$1')
        .replace(/^(\s*)[-*+]\s+\[([ xX])\]\s+/, (_all, indent: string, mark: string) => `${indent}[${mark.trim() ? 'x' : ' '}] `)
        .replace(/^(\s*)[-*+]\s+/, '$1• ')
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
        .replace(/(^|[^\w*])([*_])(?=\S)([^*_]*?\S)\2(?![\w*])/g, '$1$3')
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/<\/?[a-zA-Z][^>]*>/g, ''),
    ];
  });
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const heading = title.trim();
  return `${heading && !text.startsWith(heading) ? `${heading}\n${'='.repeat(Math.min(heading.length, 60))}\n\n` : ''}${text}\n`;
}

export type TextStats = { words: number; characters: number; minutes: number };

const WORDS_PER_MINUTE = 200;

export function textStats(markdown: string): TextStats {
  const text = plainText(markdown);
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0;
  const characters = text.replace(/\s+/g, '').length;
  return { words, characters, minutes: words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0 };
}

// ---------------------------------------------------------------------------------------------
// Títulos (Sumário)

export type Heading = { level: number; text: string };

export function extractHeadings(markdown: string): Heading[] {
  const [, body] = splitFrontmatter(markdown);
  const out: Heading[] = [];
  for (const line of withoutFences(body).split('\n')) {
    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) out.push({ level: match[1].length, text: plainText(match[2]).trim() });
  }
  return out.filter((heading) => heading.text);
}

/** Compara títulos ignorando maiúsculas, acentos e espaços extras, como o link [[Nota#Título]] precisa. */
export const headingKey = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// ---------------------------------------------------------------------------------------------
// Prévia de link

export type PreviewLine = { kind: 'heading' | 'item' | 'text'; text: string };

/** Linhas para a prévia de um link: a partir da seção (se houver), sem marcas, no máximo `max`. */
export function previewLines(markdown: string, section = '', max = 16): PreviewLine[] {
  const [, body] = splitFrontmatter(markdown);
  let lines = body.split('\n');
  if (section) {
    const wanted = headingKey(section);
    const start = lines.findIndex((line) => /^\s{0,3}#{1,6}\s/.test(line) && headingKey(plainText(line)) === wanted);
    if (start >= 0) lines = lines.slice(start);
  }
  const out: PreviewLine[] = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const text = fenced ? line : plainText(line).trim();
    if (!text) continue;
    out.push({ kind: /^\s{0,3}#{1,6}\s/.test(line) && !fenced ? 'heading' : /^\s*([-*+]|\d+[.)])\s/.test(line) ? 'item' : 'text', text });
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tags: #tag no texto e "tags:" no frontmatter.

// Pelo menos uma letra ou "_": "#123" e "#--" não são tags.
const TAG_BODY = String.raw`[\p{L}\p{N}_\-/]*[\p{L}_][\p{L}\p{N}_\-/]*`;

function frontmatterTags(front: string): string[] {
  const lines = front.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(tags?)\s*:\s*(.*)$/i.exec(lines[i]);
    if (!match) continue;
    const inline = match[2].trim();
    if (inline) {
      out.push(...inline.replace(/^\[|\]$/g, '').split(','));
      continue;
    }
    for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) out.push(lines[j].replace(/^\s*-\s*/, ''));
  }
  return out.map((tag) => tag.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter((tag) => new RegExp(`^${TAG_BODY}$`, 'u').test(tag));
}

/** Tags da nota, sem "#", em minúsculas e sem repetir, na ordem em que aparecem. */
export function extractTags(markdown: string): string[] {
  const [front, body] = splitFrontmatter(markdown);
  const tags = frontmatterTags(front);
  // Fora de código (cercado ou em linha) e de links; o "#" precisa vir depois de espaço ou do início da linha.
  const text = withoutFences(body).replace(/`[^`\n]*`/g, ' ').replace(detailedLinkRegex(), ' ').replace(/\]\([^)]*\)/g, ' ');
  for (const match of text.matchAll(new RegExp(String.raw`(^|[\s(])#(${TAG_BODY})`, 'gu'))) tags.push(match[2]);
  return [...new Set(tags.map((tag) => tag.toLowerCase().replace(/\/+$/, '')).filter(Boolean))];
}

/** Tag → páginas, ordenadas por quantidade e depois pelo nome. Uma tag "a/b" também conta para "a". */
export function tagIndex(notes: Note[], contents: Record<string, string>): { tag: string; paths: string[] }[] {
  const index = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const tag of extractTags(contents[note.path] ?? '')) {
      const parts = tag.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const key = parts.slice(0, i).join('/');
        if (!index.has(key)) index.set(key, new Set());
        index.get(key)!.add(note.path);
      }
    }
  }
  return [...index]
    .map(([tag, paths]) => ({ tag, paths: [...paths] }))
    .sort((a, b) => b.paths.length - a.paths.length || a.tag.localeCompare(b.tag));
}

export const hasTag = (markdown: string, wanted: string) => {
  const key = wanted.toLowerCase().replace(/^#/, '');
  return extractTags(markdown).some((tag) => tag === key || tag.startsWith(`${key}/`));
};

// ---------------------------------------------------------------------------------------------
// Trechos: backlinks com contexto e menções sem link.

export type Excerpt = { before: string; match: string; after: string };

const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 80;

export function excerptAround(text: string, at: number, length: number, before = EXCERPT_BEFORE, after = EXCERPT_AFTER): Excerpt {
  const start = Math.max(0, at - before);
  const end = Math.min(text.length, at + length + after);
  const flat = (part: string) => part.replace(/\s+/g, ' ');
  return {
    before: (start > 0 ? '…' : '') + flat(text.slice(start, at)).trimStart(),
    match: flat(text.slice(at, at + length)),
    after: flat(text.slice(at + length, end)).trimEnd() + (end < text.length ? '…' : ''),
  };
}

const sameTarget = (target: string, note: Note) => {
  const wanted = target.trim().toLowerCase();
  return wanted === note.name.toLowerCase() || `${wanted}.md` === note.path.toLowerCase();
};

/** Trechos da página `source` em volta de cada link para `note` (no máximo `limit`). */
export function linkContexts(source: string, note: Note, limit = 3): Excerpt[] {
  const [, body] = splitFrontmatter(source);
  const out: Excerpt[] = [];
  for (const match of body.matchAll(detailedLinkRegex())) {
    if (!sameTarget(match[1], note)) continue;
    const shown = (match[3] ?? match[1]).trim();
    // O trecho mostra o texto como o leitor vê: o link vira o apelido ou o nome.
    const lineStart = body.lastIndexOf('\n', match.index) + 1;
    const lineEnd = body.indexOf('\n', match.index + match[0].length);
    const line = body.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    const offset = match.index - lineStart;
    const before = plainText(line.slice(0, offset));
    const after = plainText(line.slice(offset + match[0].length));
    out.push(excerptAround(before + shown + after, before.length, shown.length));
    if (out.length >= limit) break;
  }
  return out;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// O nome como palavra inteira: não casa "Casa" dentro de "Casamento".
const mentionRegex = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(name)}(?![\\p{L}\\p{N}_])`, 'giu');

// Partes do corpo onde uma menção não conta: código, links e URLs. Devolve [início, fim) de cada uma.
function protectedRanges(body: string): [number, number][] {
  const ranges: [number, number][] = [];
  const add = (regex: RegExp) => {
    for (const match of body.matchAll(regex)) ranges.push([match.index, match.index + match[0].length]);
  };
  add(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm);
  add(/`[^`\n]*`/g);
  add(detailedLinkRegex());
  add(/\[[^\]]*\]\([^)]*\)/g);
  add(/https?:\/\/\S+/g);
  add(/^\s{0,3}#{1,6}\s.*$/gm);
  return ranges;
}

const inside = (ranges: [number, number][], at: number, end: number) => ranges.some(([from, to]) => at < to && end > from);

export type Mention = { path: string; name: string; excerpt: Excerpt; count: number };

/** Páginas que citam o nome da nota sem link (nem a própria nota nem as que já ligam para ela). */
export function unlinkedMentions(note: Note, notes: Note[], contents: Record<string, string>, linked: Set<string>): Mention[] {
  if (note.name.trim().length < 3) return [];
  const out: Mention[] = [];
  for (const other of notes) {
    if (other.path === note.path || linked.has(other.path)) continue;
    const [, body] = splitFrontmatter(contents[other.path] ?? '');
    const ranges = protectedRanges(body);
    let first: Excerpt | undefined;
    let count = 0;
    for (const match of body.matchAll(mentionRegex(note.name))) {
      if (inside(ranges, match.index, match.index + match[0].length)) continue;
      count++;
      if (!first) {
        const lineStart = body.lastIndexOf('\n', match.index) + 1;
        const lineEnd = body.indexOf('\n', match.index);
        const line = body.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
        first = excerptAround(line, match.index - lineStart, match[0].length);
      }
    }
    if (first) out.push({ path: other.path, name: other.name, excerpt: first, count });
  }
  return out;
}

/** Troca as menções do nome (fora de código e links) por [[nome]]; o frontmatter fica intacto. */
export function linkMentions(markdown: string, name: string): string {
  const [front, body] = splitFrontmatter(markdown);
  const ranges = protectedRanges(body);
  const replaced = body.replace(mentionRegex(name), (all: string, at: number) => {
    if (inside(ranges, at, at + all.length)) return all;
    return all === name ? `[[${name}]]` : `[[${name}|${all}]]`;
  });
  return front + replaced;
}

// ---------------------------------------------------------------------------------------------
// Busca rápida: operadores e ordem por relevância.

export type SearchQuery = { text: string; tags: string[]; paths: string[] };

/** "tag:casa path:Projetos plano" → filtros e o texto livre que sobra. */
export function parseSearchQuery(raw: string): SearchQuery {
  const tags: string[] = [];
  const paths: string[] = [];
  const rest: string[] = [];
  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const match = /^(tag|path):(.+)$/i.exec(token);
    if (match?.[1].toLowerCase() === 'tag') tags.push(match[2].replace(/^#/, '').toLowerCase());
    else if (match) paths.push(match[2].toLowerCase());
    else if (/^#./.test(token) && !/^#+$/.test(token)) tags.push(token.slice(1).toLowerCase());
    else rest.push(token);
  }
  return { text: rest.join(' '), tags, paths };
}

export type NoteHit = { note: Note; positions: number[]; excerpt?: Excerpt };

const MIN_CONTENT_QUERY = 2;

/**
 * Páginas para a busca rápida: primeiro as que casam pelo nome (aproximado, como no VS Code),
 * depois as que têm o texto no conteúdo. Filtros de tag e pasta valem para as duas listas.
 */
export function searchNotes(raw: string, notes: Note[], contents: Record<string, string>, limit = 40): NoteHit[] {
  const query = parseSearchQuery(raw);
  const pool = notes.filter(
    (note) =>
      query.tags.every((tag) => hasTag(contents[note.path] ?? '', tag)) &&
      query.paths.every((part) => note.path.toLowerCase().includes(part)),
  );
  const wanted = query.text.toLowerCase();
  if (!wanted) return pool.slice(0, limit).map((note) => ({ note, positions: [] }));
  const byName = pool
    .flatMap((note) => {
      const match = fuzzyMatch(query.text, note.name);
      return match ? [{ note, positions: match.positions, score: match.score + (note.name.toLowerCase() === wanted ? 100 : 0) }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ note, positions }): NoteHit => ({ note, positions }));
  if (wanted.length < MIN_CONTENT_QUERY) return byName.slice(0, limit);
  const named = new Set(byName.map((hit) => hit.note.path));
  const byContent: NoteHit[] = [];
  for (const note of pool) {
    if (byName.length + byContent.length >= limit) break;
    if (named.has(note.path)) continue;
    const text = contents[note.path] ?? '';
    const at = text.toLowerCase().indexOf(wanted);
    if (at >= 0) byContent.push({ note, positions: [], excerpt: excerptAround(text, at, wanted.length, 36, 90) });
  }
  return [...byName, ...byContent].slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Modelos e notas diárias

const pad = (value: number) => String(value).padStart(2, '0');

export const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Formata com YYYY, MM, DD, HH e mm (o resto do texto passa igual). */
export function formatDate(date: Date, format: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
  };
  return format.replace(/YYYY|MM|DD|HH|mm/g, (token) => tokens[token]);
}

/** Variáveis do modelo: {{title}}, {{date}}, {{time}} e {{date:FORMATO}}. Chaves desconhecidas ficam como estão. */
export function applyTemplate(template: string, values: { title: string; date: Date }): string {
  return template.replace(/\{\{\s*(title|date|time)(?::([^}]+))?\s*\}\}/gi, (_all, name: string, format?: string) => {
    const key = name.toLowerCase();
    if (key === 'title') return values.title;
    if (format) return formatDate(values.date, format.trim());
    return key === 'date' ? isoDate(values.date) : formatDate(values.date, 'HH:mm');
  });
}

/** Modelos: as páginas dentro da pasta de modelos (em qualquer nível). */
export const templatesIn = (notes: Note[], folder: string) => notes.filter((note) => note.path.startsWith(`${folder}/`));

const DAILY_NAME = /^\d{4}-\d{2}-\d{2}$/;

/** Página anterior e seguinte entre as notas diárias da pasta (pela data no nome). */
export function dailyNeighbors(path: string, notes: Note[], folder: string): { previous?: string; next?: string } {
  if (!path.startsWith(`${folder}/`) || !DAILY_NAME.test(baseName(path))) return {};
  const days = notes
    .filter((note) => dirName(note.path) === `${folder}/` && DAILY_NAME.test(note.name))
    .map((note) => note.path)
    .sort();
  const index = days.indexOf(path);
  return { previous: index > 0 ? days[index - 1] : undefined, next: index >= 0 ? days[index + 1] : undefined };
}

export const isDailyNote = (path: string, folder: string) => path.startsWith(`${folder}/`) && DAILY_NAME.test(baseName(path));

// ---------------------------------------------------------------------------------------------
// Pastas

/** Todas as pastas do vault ("" é a raiz), ordenadas. */
export function folderList(notes: Note[]): string[] {
  const folders = new Set<string>(['']);
  for (const note of notes) {
    const parts = note.path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.add(`${parts.slice(0, i).join('/')}/`);
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}

/** Pastas que contêm o caminho (para expandir a árvore até a página aberta). */
export const ancestorFolders = (path: string) => {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_part, i) => `${parts.slice(0, i + 1).join('/')}/`);
};

/** Filtra páginas pelo nome ou caminho, sem distinguir maiúsculas nem acentos. */
export function filterNotes(notes: Note[], query: string): Note[] {
  const wanted = headingKey(query);
  if (!wanted) return notes;
  return notes.filter((note) => headingKey(note.path.replace(/\.md$/i, '')).includes(wanted));
}
