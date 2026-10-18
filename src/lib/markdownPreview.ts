// Markdown → árvore simples para a prévia da aba Código. Não gera HTML: o componente monta elementos
// React a partir da árvore, então nenhum texto do arquivo vira marcação (sem risco de injeção).
// Cobre o que aparece em READMEs e notas: títulos, parágrafos, listas (com tarefas), citações, código,
// tabelas, linhas horizontais, frontmatter e, no texto, ênfases, código, links, imagens e [[wikilinks]].

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'wikilink'; target: string; label: string }
  | { type: 'br' };

export type ListItem = { checked: boolean | null; blocks: Block[] };
export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { type: 'heading'; level: number; children: Inline[]; line: number; id: string }
  | { type: 'paragraph'; children: Inline[]; line: number }
  | { type: 'code'; lang: string; text: string; line: number }
  | { type: 'quote'; blocks: Block[]; line: number }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[]; line: number }
  | { type: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][]; line: number }
  | { type: 'hr'; line: number }
  | { type: 'frontmatter'; text: string; line: number };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BULLET = /^( {0,12})([-*+]|\d{1,9}[.)])(?:[ \t]+|$)(.*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const TABLE_SEPARATOR = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Âncora de um título, no estilo do GitHub: minúsculas, sem pontuação, espaços viram "-". */
export function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

export function plainText(inlines: Inline[]): string {
  return inlines
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.text;
      if (node.type === 'image') return node.alt;
      if (node.type === 'wikilink') return node.label;
      if (node.type === 'br') return ' ';
      return plainText(node.children);
    })
    .join('');
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let start = 0;
  // Frontmatter YAML só no começo do arquivo.
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      blocks.push({ type: 'frontmatter', text: lines.slice(1, end).join('\n'), line: 1 });
      start = end + 1;
    }
  }
  const slugs = new Map<string, number>();
  const used = new Set<string>();
  for (const block of parseBlocks(lines.slice(start), start)) {
    if (block.type === 'heading') {
      const base = slugify(plainText(block.children)) || 'secao';
      // Sufixo seguinte que ainda não foi usado: "Uso", "Uso", "Uso 1" não repetem "uso-1".
      let seen = slugs.get(base) ?? 0;
      let id = seen ? `${base}-${seen}` : base;
      while (used.has(id)) id = `${base}-${++seen}`;
      slugs.set(base, seen + 1);
      used.add(id);
      block.id = id;
    }
    blocks.push(block);
  }
  return blocks;
}

function splitRow(line: string) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      current += '|';
      i++;
    } else if (text[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else current += text[i];
  }
  cells.push(current.trim());
  return cells;
}

function parseBlocks(lines: string[], offset: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const lineNo = (index: number) => offset + index + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(lines[j])) body.push(lines[j++]);
      blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n'), line: lineNo(i) });
      i = j + 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2] ?? ''), line: lineNo(i), id: '' });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ type: 'hr', line: lineNo(i) });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      const first = i;
      // continuação preguiçosa não é suportada: a citação termina na primeira linha sem ">"
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(QUOTE.exec(lines[i++])![1]);
      blocks.push({ type: 'quote', blocks: parseBlocks(inner, offset + first), line: lineNo(first) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet && bullet[1].length <= 3) {
      const consumed = parseList(lines, i, offset);
      blocks.push(consumed.block);
      i = consumed.next;
      continue;
    }
    // Tabela: linha com "|" seguida da linha separadora.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((cell): Align => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null));
      const rows: Inline[][][] = [];
      const first = i;
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, c) => parseInline(cells[c] ?? '')));
        i++;
      }
      blocks.push({ type: 'table', align: head.map((_, c) => align[c] ?? null), head: head.map((cell) => parseInline(cell)), rows, line: lineNo(first) });
      continue;
    }
    // Parágrafo: até linha vazia ou início de outro bloco.
    const first = i;
    const text: string[] = [];
    while (i < lines.length && lines[i].trim() && (i === first || !(FENCE.test(lines[i]) || HEADING.test(lines[i]) || HR.test(lines[i]) || QUOTE.test(lines[i]) || (BULLET.exec(lines[i])?.[1].length ?? 99) <= 3))) {
      text.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(text.join('\n')), line: lineNo(first) });
  }
  return blocks;
}

function parseList(lines: string[], from: number, offset: number): { block: Block; next: number } {
  const first = BULLET.exec(lines[from])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: ListItem[] = [];
  let i = from;
  while (i < lines.length) {
    const match = BULLET.exec(lines[i]);
    if (!match || match[1].length !== indent || /\d/.test(match[2]) !== ordered) {
      if (!lines[i].trim()) {
        // linha vazia dentro da lista: continua se a próxima ainda for item ou conteúdo recuado
        const next = lines[i + 1];
        if (next !== undefined && (BULLET.exec(next)?.[1].length === indent || /^\s{2,}\S/.test(next))) {
          i++;
          continue;
        }
      }
      break;
    }
    // Conteúdo do item: a primeira linha e as seguintes mais recuadas que o marcador.
    const content: string[] = [match[3]];
    const contentIndent = indent + match[2].length + 1;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const nested = BULLET.exec(next);
      if (!next.trim()) {
        if (lines[j + 1] !== undefined && /^\s+\S/.test(lines[j + 1]) && (lines[j + 1].length - lines[j + 1].trimStart().length) > indent) {
          content.push('');
          j++;
          continue;
        }
        break;
      }
      if (nested && nested[1].length <= indent) break;
      const lead = next.length - next.trimStart().length;
      if (lead <= indent && !nested) {
        // continuação preguiçosa do parágrafo do item
        content.push(next.trim());
      } else content.push(next.slice(Math.min(lead, contentIndent)));
      j++;
    }
    let checked: boolean | null = null;
    const task = /^\[([ xX])\][ \t]+/.exec(content[0]);
    if (task) {
      checked = task[1] !== ' ';
      content[0] = content[0].slice(task[0].length);
    }
    items.push({ checked, blocks: parseBlocks(content, offset + i) });
    i = j;
  }
  return { block: { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items, line: offset + from + 1 }, next: i };
}

// ---------- Texto ----------

const ESCAPABLE = '\\`*_{}[]()#+-.!|~<>"\'';

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer });
    buffer = '';
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const rest = text.slice(i);
    if (char === '\\' && text[i + 1] === '\n') {
      // barra invertida no fim da linha: quebra de linha
      buffer = buffer.replace(/ +$/, '');
      flush();
      out.push({ type: 'br' });
      i += 2;
      continue;
    }
    if (char === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (char === '\n') {
      // dois espaços (ou \) no fim da linha: quebra; senão, a quebra vira espaço
      if (buffer.endsWith('  ')) {
        buffer = buffer.replace(/ +$/, '');
        flush();
        out.push({ type: 'br' });
      } else buffer = buffer.replace(/ +$/, '') + ' ';
      i++;
      continue;
    }
    if (char === '`') {
      const ticks = /^`+/.exec(rest)![0];
      // Fecha só com uma sequência de crases do mesmo tamanho (nem maior, nem parte de uma maior).
      const close = new RegExp('(?<!`)' + ticks + '(?!`)', 'g');
      close.lastIndex = i + ticks.length;
      const end = close.exec(text)?.index ?? -1;
      if (end > 0) {
        flush();
        let code = text.slice(i + ticks.length, end).replace(/\n/g, ' ');
        if (/^ .* $/.test(code)) code = code.slice(1, -1);
        out.push({ type: 'code', text: code });
        i = end + ticks.length;
        continue;
      }
      buffer += ticks;
      i += ticks.length;
      continue;
    }
    const wiki = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(rest);
    if (wiki) {
      flush();
      out.push({ type: 'wikilink', target: wiki[1].trim(), label: (wiki[2] ?? wiki[1]).trim() });
      i += wiki[0].length;
      continue;
    }
    if (char === '!' && text[i + 1] === '[') {
      const link = matchLink(text, i + 1);
      if (link) {
        flush();
        out.push({ type: 'image', src: link.href, alt: link.label });
        i = link.end;
        continue;
      }
    }
    if (char === '[') {
      const link = matchLink(text, i);
      if (link) {
        flush();
        out.push({ type: 'link', href: link.href, children: parseInline(link.label) });
        i = link.end;
        continue;
      }
    }
    const auto = /^<((?:https?|mailto):[^\s<>]+)>/i.exec(rest);
    if (auto) {
      flush();
      out.push({ type: 'link', href: auto[1], children: [{ type: 'text', text: auto[1] }] });
      i += auto[0].length;
      continue;
    }
    const emphasis = matchEmphasis(text, i);
    if (emphasis) {
      flush();
      out.push(emphasis.node);
      i = emphasis.end;
      continue;
    }
    buffer += char;
    i++;
  }
  flush();
  return out;
}

function matchLink(text: string, open: number): { label: string; href: string; end: number } | null {
  // [rótulo](destino "título") — colchetes do rótulo podem aninhar um nível.
  let depth = 0;
  let close = -1;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '\\') {
      j++;
      continue;
    }
    if (text[j] === '[') depth++;
    else if (text[j] === ']' && --depth === 0) {
      close = j;
      break;
    }
  }
  if (close < 0 || text[close + 1] !== '(') return null;
  const target = /^\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+("[^"]*"|'[^']*'))?\s*\)/.exec(text.slice(close + 1));
  if (!target) return null;
  const href = target[1].startsWith('<') ? target[1].slice(1, -1) : target[1];
  return { label: text.slice(open + 1, close), href, end: close + 1 + target[0].length };
}

function matchEmphasis(text: string, i: number): { node: Inline; end: number } | null {
  const rest = text.slice(i);
  const candidates: [RegExp, 'strong' | 'em' | 'del'][] = [
    [/^\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/, 'strong'],
    [/^__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/u, 'strong'],
    [/^~~(?=\S)([\s\S]*?\S)~~/, 'del'],
    [/^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/, 'em'],
    [/^_(?=[^\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}_])/u, 'em'],
  ];
  // "_" no meio de palavra (nome_de_variavel) não é ênfase.
  if (text[i] === '_' && i > 0 && /[\p{L}\p{N}]/u.test(text[i - 1])) return null;
  for (const [regex, type] of candidates) {
    const match = regex.exec(rest);
    if (match) return { node: { type, children: parseInline(match[1]) }, end: i + match[0].length };
  }
  return null;
}

/** Destino de um link da prévia: externo (http/mailto), âncora na própria página, arquivo relativo ou nada (bloqueado). */
export function linkTarget(href: string): { kind: 'external'; url: string } | { kind: 'anchor'; id: string } | { kind: 'file'; path: string; anchor: string } | null {
  const value = href.trim();
  if (!value) return null;
  if (/^(https?:|mailto:)/i.test(value)) return { kind: 'external', url: value };
  if (value.startsWith('#')) return { kind: 'anchor', id: decodeSafe(value.slice(1)) };
  // Qualquer outro esquema (javascript:, file:, data:...) não abre.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
  const [path, anchor = ''] = value.split('#');
  return { kind: 'file', path: decodeSafe(path), anchor: decodeSafe(anchor) };
}

function decodeSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
