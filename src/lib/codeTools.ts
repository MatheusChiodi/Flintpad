// Regras puras da aba Código (sem Monaco nem DOM), para poderem ser testadas com `npm test`.

import { baseName, extName } from './paths.ts';

// ---------- Arquivos ----------

/** Nome da cópia ao duplicar: "a.ts" → "a copy.ts", "a copy 2.ts"...; "Makefile" → "Makefile copy". */
export function duplicateName(name: string, taken: (candidate: string) => boolean): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n < 1000; n++) {
    const candidate = `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem} copy ${Date.now()}${ext}`;
}

// ---------- Quick Open ----------

/** "app.ts:12:4" → busca "app.ts", linha 12, coluna 4 (como o Ctrl+P do VS Code). */
export function parseQuickOpen(value: string): { query: string; line?: number; column?: number } {
  const match = /^(.*?)(?::(\d+)(?:[:,](\d+))?)?\s*$/.exec(value.trim());
  if (!match || !match[2] || !match[1]) return { query: value.trim() };
  return { query: match[1].trim(), line: Number(match[2]) || 1, column: match[3] ? Number(match[3]) || 1 : undefined };
}

// ---------- Guias ----------

export type TabLike = { path: string; preview: boolean; pinned?: boolean };
export type CloseKind = 'others' | 'right' | 'saved' | 'all';

const same = (a: string, b: string) => a.replace(/[\\/]+/g, '/').toLowerCase() === b.replace(/[\\/]+/g, '/').toLowerCase();

/** Guias que um "Fechar ..." do menu da guia fecha. Guias fixadas só saem em "Fechar todos". */
export function tabsToClose(tabs: TabLike[], kind: CloseKind, path: string, isDirty: (path: string) => boolean): string[] {
  const index = tabs.findIndex((tab) => same(tab.path, path));
  return tabs
    .filter((tab, i) => {
      if (kind === 'all') return true;
      if (tab.pinned) return false;
      if (kind === 'others') return i !== index;
      if (kind === 'right') return index >= 0 && i > index;
      return !isDirty(tab.path);
    })
    .map((tab) => tab.path);
}

/** Fixadas primeiro, na ordem em que estavam; as demais depois. */
export function sortPinned<T extends TabLike>(tabs: T[]): T[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];
}

/** Pilha de guias fechadas (Reabrir editor fechado): sem repetição, a mais recente no topo. */
export function pushClosed(stack: string[], path: string, max = 20): string[] {
  return [path, ...stack.filter((item) => !same(item, path))].slice(0, max);
}

// ---------- Navegação (voltar / avançar) ----------

export type Location = { path: string; line: number; column: number };

/**
 * Histórico de posições do editor, como o Alt+← / Alt+→ do VS Code: pular para longe (outro arquivo
 * ou mais de `distance` linhas) grava um ponto; movimentos curtos atualizam o ponto atual.
 */
export class NavHistory {
  private stack: Location[] = [];
  private index = -1;
  private readonly distance: number;
  private readonly max: number;
  constructor(distance = 10, max = 50) {
    this.distance = distance;
    this.max = max;
  }

  record(location: Location) {
    const current = this.stack[this.index];
    if (current && same(current.path, location.path) && Math.abs(current.line - location.line) < this.distance) {
      this.stack[this.index] = location;
      return;
    }
    this.stack = [...this.stack.slice(0, this.index + 1), location].slice(-this.max);
    this.index = this.stack.length - 1;
  }

  back(): Location | null {
    if (this.index <= 0) return null;
    return this.stack[--this.index];
  }

  forward(): Location | null {
    if (this.index >= this.stack.length - 1) return null;
    return this.stack[++this.index];
  }

  get canBack() {
    return this.index > 0;
  }
  get canForward() {
    return this.index < this.stack.length - 1;
  }

  /** Arquivo fechado ou apagado sai do histórico. */
  forget(path: string) {
    const before = this.stack.slice(0, this.index + 1).filter((item) => !same(item.path, path)).length;
    this.stack = this.stack.filter((item) => !same(item.path, path));
    this.index = Math.min(this.stack.length - 1, Math.max(before - 1, this.stack.length ? 0 : -1));
  }
}

// ---------- Salvar ----------

/** Intervalos (linha, colunas a partir de 1) com espaço no fim da linha, para apagar ao salvar. */
export function trailingWhitespace(lines: string[]): { line: number; startColumn: number; endColumn: number }[] {
  const out = [];
  for (const [index, text] of lines.entries()) {
    const match = /[ \t]+$/.exec(text);
    if (match) out.push({ line: index + 1, startColumn: match.index + 1, endColumn: text.length + 1 });
  }
  return out;
}

/** Precisa de uma quebra de linha no fim? (arquivo vazio não precisa) */
export const needsFinalNewline = (text: string) => text.length > 0 && !/[\r\n]$/.test(text);

// ---------- Copiar como Markdown ----------

/** Trecho de código como bloco Markdown, com o arquivo e as linhas — pronto para colar numa nota. */
export function markdownSnippet(input: { code: string; language: string; path: string; startLine: number; endLine: number }) {
  const code = input.code.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  // A cerca precisa ser maior que qualquer sequência de crases dentro do código.
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const lines = input.startLine === input.endLine ? `${input.startLine}` : `${input.startLine}-${input.endLine}`;
  const language = /^[\w+#.-]+$/.test(input.language) && input.language !== 'plaintext' ? input.language : '';
  return `\`${input.path}:${lines}\`\n\n${fence}${language}\n${code}\n${fence}\n`;
}

// ---------- Rodar no terminal ----------

const RUNNERS: Record<string, string> = {
  '.js': 'node',
  '.mjs': 'node',
  '.cjs': 'node',
  '.ts': 'node --experimental-strip-types',
  '.mts': 'node --experimental-strip-types',
  '.cts': 'node --experimental-strip-types',
  '.py': 'python',
  '.rb': 'ruby',
  '.php': 'php',
  '.go': 'go run',
  '.lua': 'lua',
  '.pl': 'perl',
  '.r': 'Rscript',
  '.dart': 'dart run',
  '.sh': 'bash',
  '.ps1': 'powershell -ExecutionPolicy Bypass -File',
};

/** Comando que roda o arquivo no terminal (PowerShell/bash), ou null se a linguagem não tem executor conhecido. */
export function runCommandFor(path: string, platform: 'win32' | 'posix' = 'win32'): string | null {
  const ext = extName(path);
  if (ext === '.bat' || ext === '.cmd') return platform === 'win32' ? `& ${quoteArg(path, platform)}` : null;
  const runner = RUNNERS[ext];
  if (!runner) return null;
  return `${runner} ${quoteArg(path, platform)}`;
}

/** Aspas para um caminho no shell do terminal (PowerShell no Windows, sh nos demais). */
export function quoteArg(value: string, platform: 'win32' | 'posix' = 'win32') {
  if (platform === 'win32') return `'${value.replace(/'/g, "''")}'`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------- Editores abertos entre sessões ----------

export type SavedEditors = { tabs: { path: string; pinned?: boolean }[]; active: string | null };

/** Lê o que foi salvo, descartando entradas inválidas (o armazenamento pode ter sido editado à mão). */
export function parseSavedEditors(raw: unknown): SavedEditors {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const tabs = Array.isArray(value.tabs)
    ? value.tabs
        .filter((tab): tab is { path: string; pinned?: unknown } => Boolean(tab) && typeof (tab as { path?: unknown }).path === 'string')
        .map((tab) => ({ path: tab.path, pinned: tab.pinned === true }))
        .slice(0, 50)
    : [];
  const active = typeof value.active === 'string' && tabs.some((tab) => same(tab.path, value.active as string)) ? value.active : (tabs[0]?.path ?? null);
  return { tabs, active };
}

/** Chave de armazenamento das guias de um workspace (as pastas abertas, sem diferenciar caixa). */
export const workspaceKey = (roots: string[]) => roots.map((root) => root.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()).join('|');

/** Rótulo curto do arquivo para listas (nome + pasta pai quando o nome se repete). */
export function tabLabel(path: string, all: string[]): string {
  const name = baseName(path);
  const clash = all.some((other) => !same(other, path) && baseName(other).toLowerCase() === name.toLowerCase());
  if (!clash) return name;
  const parts = path.split(/[\\/]+/);
  return `${name} · ${parts[parts.length - 2] ?? ''}`;
}
