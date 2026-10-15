// Busca e substituição em arquivos da aba Código: lógica pura, usada pelo processo principal
// (varre o disco), pelo renderer (substitui em arquivos abertos no editor) e pelos testes.
// A busca é por linha, como a do VS Code sem quebra de linha na expressão.

export const SEARCH_LIMITS = Object.freeze({ maxResults: 2000, maxFileBytes: 1024 * 1024, maxPreview: 220, previewLead: 50 });

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Monta a expressão da busca. Lança Error com mensagem legível se a expressão for inválida.
 * Palavra inteira respeita letras acentuadas (ação, café), não só [A-Za-z0-9_].
 */
export function buildMatcher({ query, isRegex = false, matchCase = false, wholeWord = false }) {
  if (typeof query !== 'string' || !query) throw new Error('empty query');
  const source = isRegex ? query : escapeRegExp(query);
  const flags = `g${matchCase ? '' : 'i'}`;
  if (wholeWord) {
    try {
      return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, `${flags}u`);
    } catch {
      // expressão do usuário que só vale fora do modo unicode
    }
    return new RegExp(`\\b(?:${source})\\b`, flags);
  }
  return new RegExp(source, flags);
}

const LINE_BREAK = /\r\n|\n|\r/;

/**
 * Ocorrências por linha: linha e coluna a partir de 1 (colunas em unidades UTF-16, como o Monaco),
 * mais um trecho da linha para mostrar, com a posição do achado dentro dele.
 */
export function findMatches(text, matcher, limit = SEARCH_LIMITS.maxResults) {
  const out = [];
  const lines = text.split(LINE_BREAK);
  for (let index = 0; index < lines.length && out.length < limit; index++) {
    const line = lines[index];
    matcher.lastIndex = 0;
    let match;
    while ((match = matcher.exec(line)) && out.length < limit) {
      if (!match[0].length) {
        // achado vazio (ex.: ^): avança para não ficar preso
        matcher.lastIndex++;
        continue;
      }
      out.push({ line: index + 1, column: match.index + 1, length: match[0].length, ...preview(line, match.index, match[0].length) });
    }
  }
  matcher.lastIndex = 0;
  return out;
}

function preview(line, start, length) {
  const { maxPreview, previewLead } = SEARCH_LIMITS;
  // Recuo inicial não ajuda a ler; trechos longos antes do achado viram "…".
  let from = line.length - line.trimStart().length;
  if (from > start) from = start;
  let prefix = '';
  if (start - from > previewLead) {
    from = start - previewLead;
    prefix = '…';
  }
  const text = prefix + line.slice(from, from + maxPreview);
  return { preview: text, previewStart: prefix.length + start - from, previewLength: Math.min(length, text.length - (prefix.length + start - from)) };
}

/**
 * Substitui todas as ocorrências, linha a linha (mesma regra da busca). Com expressão regular,
 * $1, $& e $<nome> valem como no JavaScript; sem ela, o texto entra literalmente.
 */
export function replaceInText(text, matcher, replacement, isRegex = false) {
  let count = 0;
  const parts = text.split(/(\r\n|\n|\r)/);
  for (let index = 0; index < parts.length; index += 2) {
    matcher.lastIndex = 0;
    parts[index] = parts[index].replace(matcher, (...args) => {
      const matched = args[0];
      if (!matched.length) return matched;
      count++;
      return isRegex ? expand(replacement, args) : replacement;
    });
  }
  matcher.lastIndex = 0;
  return { text: parts.join(''), count };
}

// Expande $&, $1..$99, $<nome>, $`, $' e $$ como String.replace, a partir dos argumentos do callback.
function expand(template, args) {
  const named = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null ? args[args.length - 1] : null;
  const tail = named ? 3 : 2;
  const source = args[args.length - tail + 1];
  const offset = args[args.length - tail];
  const matched = args[0];
  const groups = args.slice(1, args.length - tail);
  return template.replace(/\$(\$|&|`|'|<([^>]*)>|(\d{1,2}))/g, (whole, token, name, digits) => {
    if (token === '$') return '$';
    if (token === '&') return matched;
    if (token === '`') return source.slice(0, offset);
    if (token === "'") return source.slice(offset + matched.length);
    if (name !== undefined) return named ? (named[name] ?? '') : whole;
    let index = Number(digits);
    // "$10" com só 1 grupo vira o grupo 1 seguido de "0", como no JavaScript.
    if (index > groups.length && digits.length === 2) {
      index = Number(digits[0]);
      return index >= 1 && index <= groups.length ? (groups[index - 1] ?? '') + digits[1] : whole;
    }
    return index >= 1 && index <= groups.length ? (groups[index - 1] ?? '') : whole;
  });
}

// Divide "a, b, {c,d}" em padrões, sem cortar dentro das chaves.
function splitPatterns(input) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const char of input) {
    if (char === '{') depth++;
    else if (char === '}') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += char;
  }
  out.push(current);
  return out.map((item) => item.trim()).filter(Boolean);
}

function globSource(glob) {
  let out = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        // "**/" casa zero ou mais pastas; "**" no fim casa tudo
        const slash = glob[index + 2] === '/';
        out += slash ? '(?:.*/)?' : '.*';
        index += slash ? 2 : 1;
      } else out += '[^/]*';
    } else if (char === '?') out += '[^/]';
    else if (char === '{') {
      const end = glob.indexOf('}', index);
      if (end < 0) out += '\\{';
      else {
        out += `(?:${glob.slice(index + 1, end).split(',').map(globSource).join('|')})`;
        index = end;
      }
    } else out += escapeRegExp(char);
  }
  return out;
}

/**
 * Filtro de arquivos por glob (lista separada por vírgulas), aplicado ao caminho relativo com "/".
 * Padrão sem "/" casa em qualquer pasta (*.ts, node_modules); "./src" ou "src/lib" casa a pasta e o que há dentro.
 * Devolve null quando não há padrão.
 */
export function globMatcher(input) {
  const patterns = splitPatterns(typeof input === 'string' ? input : '');
  if (!patterns.length) return null;
  const regexes = patterns.map((raw) => {
    let glob = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!glob.startsWith('/') && !glob.startsWith('**/') && !glob.includes('/')) glob = `**/${glob}`;
    glob = glob.replace(/^\//, '');
    return new RegExp(`^${globSource(glob)}(?:/.*)?$`, 'i');
  });
  return (relPath) => {
    const path = relPath.replace(/\\/g, '/');
    return regexes.some((regex) => regex.test(path));
  };
}

/** Marcadores de tarefa no código (TODO, FIXME...) e o texto que vem depois. */
export const TODO_TAGS = Object.freeze(['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'NOTE']);
export const TODO_QUERY = `\\b(?:${TODO_TAGS.join('|')})\\b`;

export function parseTodo(preview) {
  const match = new RegExp(`\\b(${TODO_TAGS.join('|')})\\b[\\s:\\-]*(?:\\([^)]*\\)[\\s:]*)?(.*)$`).exec(preview);
  if (!match) return null;
  // Fim de comentário de bloco/HTML não faz parte do texto.
  const text = match[2].replace(/\s*(\*\/|-->|#\})\s*$/, '').trim();
  return { tag: match[1], text };
}
