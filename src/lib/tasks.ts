import { splitFrontmatter } from './links.ts';

// Tarefas do vault: itens `- [ ]` / `- [x]` de todas as notas. Os metadados seguem o formato de
// emojis usado por plugins de tarefas do Obsidian (📅 vence, ⏳ agendada, 🛫 início, ✅ concluída,
// ➕ criada, 🔁 repetição, 🔺⏫🔼🔽⏬ prioridade), para que as notas continuem portáveis.

export type Priority = 'highest' | 'high' | 'medium' | 'none' | 'low' | 'lowest';
export const PRIORITIES: Priority[] = ['highest', 'high', 'medium', 'none', 'low', 'lowest'];
const PRIORITY_MARK: Record<Exclude<Priority, 'none'>, string> = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };

export type DateField = 'due' | 'scheduled' | 'start' | 'completion' | 'created';
export const DATE_FIELDS: DateField[] = ['due', 'scheduled', 'start', 'completion', 'created'];
const DATE_MARK: Record<DateField, string> = { due: '📅', scheduled: '⏳', start: '🛫', completion: '✅', created: '➕' };

export type TaskMeta = {
  /** Texto sem os metadados (tags e links continuam). */
  title: string;
  priority: Priority;
  recurrence?: string;
  tags: string[];
} & Partial<Record<DateField, string>>;

// `line` é o índice (base 0) da linha no arquivo inteiro, contando o frontmatter;
// `index` é a posição da tarefa entre as tarefas da nota; `parent` é a linha da tarefa-mãe.
export type Task = TaskMeta & { path: string; line: number; index: number; text: string; done: boolean; depth: number; parent: number | null };

// Item de lista (`-`, `*`, `+` ou numerado) seguido da caixa: `- [ ] texto`, `  * [x] feito`.
const taskLine = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\](?:\s+(.*))?)$/;
const listLine = /^(\s*)(?:[-*+]|\d+[.)])\s/;
const fence = /^\s*(`{3,}|~{3,})/;
const isoPattern = /^\d{4}-\d{2}-\d{2}$/;

const withoutCr = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);
const indentWidth = (space: string) => [...space].reduce((sum, char) => sum + (char === '\t' ? 4 : 1), 0);

// Pedaços de metadados: marca (com ou sem seletor de variação) e o valor. A repetição vai até a próxima marca.
const VS = '\\uFE0F?';
const dateSegment = new RegExp(`(📅|🗓${VS}|⏳|🛫|✅|➕)${VS}\\s*(\\d{4}-\\d{2}-\\d{2})`, 'gu');
const prioritySegment = new RegExp(`(🔺|⏫|🔼|🔽|⏬)${VS}`, 'gu');
const recurrenceSegment = new RegExp(`🔁${VS}\\s*([^📅🗓⏳🛫✅➕🔺⏫🔼🔽⏬#]*)`, 'gu');
const tagPattern = /(?:^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

const MARK_FIELD: Record<string, DateField> = { '📅': 'due', '🗓': 'due', '⏳': 'scheduled', '🛫': 'start', '✅': 'completion', '➕': 'created' };
const MARK_PRIORITY: Record<string, Priority> = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' };

/** Data ISO válida (o dia existe no calendário). */
export function isIsoDate(value: string): boolean {
  if (!isoPattern.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Separa os metadados do texto de uma tarefa. Datas inválidas ficam no título, como texto. */
export function parseTaskMeta(text: string): TaskMeta {
  const meta: TaskMeta = { title: text, priority: 'none', tags: [] };
  let rest = text.replace(dateSegment, (whole, mark: string, date: string) => {
    const field = MARK_FIELD[mark.replace('️', '')];
    if (!isIsoDate(date)) return whole;
    meta[field] = date;
    return ' ';
  });
  rest = rest.replace(recurrenceSegment, (_whole, rule: string) => {
    if (rule.trim()) meta.recurrence = rule.trim();
    return ' ';
  });
  rest = rest.replace(prioritySegment, (_whole, mark: string) => {
    if (meta.priority === 'none') meta.priority = MARK_PRIORITY[mark];
    return ' ';
  });
  meta.title = rest.replace(/\s+/g, ' ').trim();
  meta.tags = [...new Set([...meta.title.matchAll(tagPattern)].map((match) => match[1].toLowerCase()))];
  return meta;
}

/** Monta o texto de uma tarefa a partir do título e dos metadados, numa ordem fixa. */
export function formatTaskText(meta: Omit<TaskMeta, 'tags'>): string {
  const parts = [meta.title.trim()];
  if (meta.priority !== 'none') parts.push(PRIORITY_MARK[meta.priority]);
  if (meta.recurrence) parts.push(`🔁 ${meta.recurrence}`);
  for (const field of ['created', 'start', 'scheduled', 'due', 'completion'] as DateField[]) {
    const value = meta[field];
    if (value) parts.push(`${DATE_MARK[field]} ${value}`);
  }
  return parts.filter(Boolean).join(' ');
}

// Tarefas de uma nota, na ordem do arquivo. Frontmatter YAML e blocos de código cercados ficam de fora.
export function extractTasks(path: string, content: string): Task[] {
  const [front] = splitFrontmatter(content);
  const lines = content.split('\n');
  const tasks: Task[] = [];
  // Pilha de itens de lista abertos (recuo e linha da tarefa, ou -1 se o item não é tarefa).
  let stack: { indent: number; line: number }[] = [];
  let open = '';
  for (let line = front ? front.split('\n').length - (front.endsWith('\n') ? 1 : 0) : 0; line < lines.length; line++) {
    const text = withoutCr(lines[line]);
    const fenced = fence.exec(text);
    // Crases depois da marca significam código inline na mesma linha, não a abertura de um bloco.
    const marker = fenced && !(fenced[1][0] === '`' && text.slice(fenced[0].length).includes('`')) ? fenced[1] : undefined;
    if (open) {
      // Só fecha com a mesma marca, em quantidade igual ou maior, sozinha na linha.
      if (marker && marker[0] === open[0] && marker.length >= open.length && text.trim() === marker) open = '';
      continue;
    }
    if (marker) {
      open = marker;
      continue;
    }
    const list = listLine.exec(text);
    if (!list) {
      // Linha de texto sem recuo encerra a lista; linhas em branco ou de continuação não.
      if (text.trim() && !/^\s/.test(text)) stack = [];
      continue;
    }
    const indent = indentWidth(list[1]);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const match = taskLine.exec(text);
    const label = match?.[4]?.trim();
    const isTask = Boolean(match && label);
    if (isTask) {
      const parent = [...stack].reverse().find((item) => item.line >= 0)?.line ?? null;
      const depth = stack.filter((item) => item.line >= 0).length;
      tasks.push({ path, line, index: tasks.length, text: label!, done: match![2] !== ' ', depth, parent, ...parseTaskMeta(label!) });
    }
    stack.push({ indent, line: isTask ? line : -1 });
  }
  return tasks;
}

/** Troca o texto da tarefa na linha indicada, mantendo marcador, recuo e caixa. Devolve o conteúdo igual se a linha não for tarefa. */
export function rewriteTaskLine(content: string, line: number, change: (text: string, done: boolean) => { text?: string; done?: boolean }): string {
  const lines = content.split('\n');
  const target = lines[line];
  if (target === undefined) return content;
  const cr = target.endsWith('\r') ? '\r' : '';
  const match = taskLine.exec(withoutCr(target));
  if (!match) return content;
  const done = match[2] !== ' ';
  const next = change(match[4]?.trim() ?? '', done);
  const box = next.done === undefined ? match[2] : next.done ? 'x' : ' ';
  const tail = next.text === undefined ? match[3].slice(1) : next.text.trim() ? ` ${next.text.trim()}` : '';
  lines[line] = `${match[1]}${box}]${tail}${cr}`;
  return lines.join('\n');
}

// Alterna `[ ]` e `[x]` na linha indicada; todo o resto do arquivo volta igual, byte a byte.
export function toggleTaskLine(content: string, line: number): string {
  return rewriteTaskLine(content, line, (_text, done) => ({ done: !done }));
}

/** Muda um campo dos metadados da tarefa (data, prioridade, título) preservando o resto. */
export function updateTaskMeta(text: string, change: Partial<Omit<TaskMeta, 'tags'>>): string {
  const meta = parseTaskMeta(text);
  return formatTaskText({ ...meta, ...change });
}

export type CompleteOptions = { today: string; stampDone: boolean };

/**
 * Conclui ou reabre a tarefa da linha. Ao concluir, grava ✅ com a data (se pedido) e, se a tarefa
 * se repete, insere logo acima a próxima ocorrência, com as datas avançadas. Ao reabrir, tira o ✅.
 */
export function completeTaskLine(content: string, line: number, options: CompleteOptions): string {
  const lines = content.split('\n');
  const target = lines[line];
  const match = target === undefined ? null : taskLine.exec(withoutCr(target));
  if (!match || !match[4]?.trim()) return content;
  const text = match[4].trim();
  const meta = parseTaskMeta(text);
  const closing = match[2] === ' ';
  if (!closing) return rewriteTaskLine(content, line, () => ({ done: false, text: meta.completion ? formatTaskText({ ...meta, completion: undefined }) : text }));
  const doneText = options.stampDone ? formatTaskText({ ...meta, completion: options.today }) : text;
  let next = rewriteTaskLine(content, line, () => ({ done: true, text: doneText }));
  const rule = meta.recurrence ? parseRecurrence(meta.recurrence) : null;
  if (rule) {
    const following: Omit<TaskMeta, 'tags'> = { ...meta, completion: undefined };
    const base = meta.due ?? meta.scheduled ?? meta.start;
    for (const field of ['due', 'scheduled', 'start'] as DateField[]) {
      const value = meta[field];
      if (value) following[field] = nextOccurrence(value, rule);
    }
    // Sem nenhuma data, a próxima vence a partir de hoje.
    if (!base) following.due = nextOccurrence(options.today, rule);
    const cr = target!.endsWith('\r') ? '\r' : '';
    const copy = `${match[1]} ]${` ${formatTaskText(following)}`}${cr}`;
    const all = next.split('\n');
    all.splice(line, 0, copy);
    next = all.join('\n');
  }
  return next;
}

/** Remove a linha da tarefa (e só ela). */
export function deleteTaskLine(content: string, line: number): string {
  const lines = content.split('\n');
  if (lines[line] === undefined || !taskLine.test(withoutCr(lines[line]))) return content;
  lines.splice(line, 1);
  return lines.join('\n');
}

/** Acrescenta uma tarefa aberta no fim da nota, separada do texto anterior por uma quebra de linha. */
export function appendTask(content: string, text: string): string {
  const clean = text.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return content;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const body = content.replace(/(\r?\n)+$/, '');
  return `${body}${body ? eol : ''}- [ ] ${clean}${eol}`;
}

// ---------------------------------------------------------------------------------------------
// Datas

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUtc = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

/** Soma meses mantendo o dia, ou o último dia do mês quando ele não existe (31/01 + 1 mês = 28 ou 29/02). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return fromUtc(first);
}

/** Dias de `from` até `to` (negativo se `to` já passou). */
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);

export type Recurrence = { unit: 'day' | 'week' | 'month' | 'year'; every: number } | { unit: 'weekday'; every: 1 };

const UNIT_WORDS: [RegExp, 'day' | 'week' | 'month' | 'year'][] = [
  [/^(?:days?|dias?)$/, 'day'],
  [/^(?:weeks?|semanas?)$/, 'week'],
  [/^(?:months?|m[eê]s|meses)$/, 'month'],
  [/^(?:years?|anos?)$/, 'year'],
];

/** Lê regras como "every week", "every 3 days", "every weekday", "a cada 2 semanas", "todo mês", "dias úteis". */
export function parseRecurrence(input: string): Recurrence | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:every weekday|(?:todo )?dias? [úu]t(?:eis|il))$/.test(text)) return { unit: 'weekday', every: 1 };
  const match = /^(?:every|a cada|tod[oa]s? (?:os |as )?|tod[oa])\s*(\d+)?\s*(\S+)/.exec(text);
  if (!match) return null;
  const every = match[1] ? Number(match[1]) : 1;
  if (!Number.isInteger(every) || every < 1 || every > 999) return null;
  const unit = UNIT_WORDS.find(([pattern]) => pattern.test(match[2]))?.[1];
  return unit ? { unit, every } : null;
}

export function nextOccurrence(iso: string, rule: Recurrence): string {
  switch (rule.unit) {
    case 'day':
      return addDays(iso, rule.every);
    case 'week':
      return addDays(iso, rule.every * 7);
    case 'month':
      return addMonths(iso, rule.every);
    case 'year':
      return addMonths(iso, rule.every * 12);
    case 'weekday': {
      let next = addDays(iso, 1);
      while ([0, 6].includes(toUtc(next).getUTCDay())) next = addDays(next, 1);
      return next;
    }
  }
}

export type Bucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';
export const BUCKETS: Bucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'];

/** Faixa de prazo da tarefa: a data de vencimento, ou a agendada quando não há vencimento. */
export function taskDate(task: Pick<Task, 'due' | 'scheduled'>): string | undefined {
  return task.due ?? task.scheduled;
}

export function dueBucket(task: Pick<Task, 'due' | 'scheduled'>, today: string): Bucket {
  const date = taskDate(task);
  if (!date) return 'none';
  const diff = daysBetween(today, date);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= 7) return 'week';
  return 'later';
}

// ---------------------------------------------------------------------------------------------
// Adição rápida: "Ligar para Ana amanhã !2 #trabalho" vira "Ligar para Ana #trabalho ⏫ 📅 <amanhã>".

const QUICK_DATES: [RegExp, (today: string) => string][] = [
  [/^(?:hoje|today)$/i, (today) => today],
  [/^(?:amanh[ãa]|tomorrow|tmr)$/i, (today) => addDays(today, 1)],
  [/^(?:depois-de-amanh[ãa])$/i, (today) => addDays(today, 2)],
];
const QUICK_PRIORITY: Record<string, Priority> = { '!1': 'highest', '!2': 'high', '!3': 'medium', '!4': 'low' };
const WEEKDAYS = [
  ['domingo', 'sunday', 'sun', 'dom'],
  ['segunda', 'monday', 'mon', 'seg'],
  ['terça', 'tuesday', 'tue', 'ter', 'terca'],
  ['quarta', 'wednesday', 'wed', 'qua'],
  ['quinta', 'thursday', 'thu', 'qui'],
  ['sexta', 'friday', 'fri', 'sex'],
  ['sábado', 'saturday', 'sat', 'sab', 'sabado'],
];

/** Converte as palavras de data e prioridade do campo de adição rápida em metadados. */
export function parseQuickAdd(input: string, today: string): string {
  const words = input.replace(/[\r\n]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let due: string | undefined;
  let priority: Priority = 'none';
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lower = word.toLowerCase();
    const quick = QUICK_DATES.find(([pattern]) => pattern.test(word));
    // "próxima semana" / "next week" ocupam duas palavras.
    const pair = `${lower} ${words[i + 1]?.toLowerCase() ?? ''}`;
    if (!due && /^(?:pr[óo]xima semana|next week)$/.test(pair)) {
      due = addDays(today, 7);
      i++;
    } else if (!due && quick) due = quick[1](today);
    // Data logo após um marcador (📅, ⏳...) já é metadado: fica no texto para parseTaskMeta.
    else if (!due && isIsoDate(word) && !MARK_FIELD[words[i - 1]?.replace('️', '') ?? '']) due = word;
    else if (!due && WEEKDAYS.some((names) => names.includes(lower))) {
      const target = WEEKDAYS.findIndex((names) => names.includes(lower));
      const diff = (target - toUtc(today).getUTCDay() + 7) % 7 || 7;
      due = addDays(today, diff);
    } else if (priority === 'none' && QUICK_PRIORITY[lower]) priority = QUICK_PRIORITY[lower];
    else kept.push(word);
  }
  const base = parseTaskMeta(kept.join(' '));
  return formatTaskText({ ...base, priority: priority !== 'none' ? priority : base.priority, due: due ?? base.due });
}

// ---------------------------------------------------------------------------------------------
// Consulta: palavras livres, #tag, path:, due:, priority:, is:, com "-" para negar.

export type TaskTerm = { field: 'text' | 'tag' | 'path' | 'due' | 'priority' | 'is'; value: string; negate: boolean };

const TERM_FIELDS = ['tag', 'path', 'due', 'priority', 'is'] as const;

export function parseTaskQuery(input: string): TaskTerm[] {
  const terms: TaskTerm[] = [];
  for (const match of input.matchAll(/-?(?:\w+:)?"[^"]*"?|\S+/g)) {
    let token = match[0];
    const negate = token.startsWith('-') && token.length > 1;
    if (negate) token = token.slice(1);
    let field: TaskTerm['field'] = 'text';
    const colon = token.indexOf(':');
    if (colon > 0 && (TERM_FIELDS as readonly string[]).includes(token.slice(0, colon).toLowerCase())) {
      field = token.slice(0, colon).toLowerCase() as TaskTerm['field'];
      token = token.slice(colon + 1);
    } else if (token.startsWith('#') && token.length > 1) {
      field = 'tag';
      token = token.slice(1);
    }
    const value = token.replace(/^"|"$/g, '').toLowerCase();
    if (value) terms.push({ field, value, negate });
  }
  return terms;
}

function termMatches(term: TaskTerm, task: Task, today: string): boolean {
  switch (term.field) {
    case 'tag':
      return task.tags.some((tag) => tag === term.value || tag.startsWith(`${term.value}/`));
    case 'path':
      return task.path.toLowerCase().includes(term.value);
    case 'priority':
      return task.priority === term.value || (term.value === 'high+' && ['highest', 'high'].includes(task.priority));
    case 'due': {
      const date = taskDate(task);
      if (term.value === 'none') return !date;
      if (term.value === 'any') return Boolean(date);
      if ((BUCKETS as string[]).includes(term.value)) return dueBucket(task, today) === term.value;
      const range = /^(before|after|<|>)(\d{4}-\d{2}-\d{2})$/.exec(term.value);
      if (range && date) return range[1] === 'before' || range[1] === '<' ? date < range[2] : date > range[2];
      return date === term.value;
    }
    case 'is':
      if (term.value === 'open') return !task.done;
      if (term.value === 'done') return task.done;
      if (term.value === 'recurring') return Boolean(task.recurrence);
      if (term.value === 'overdue') return !task.done && dueBucket(task, today) === 'overdue';
      if (term.value === 'subtask') return task.parent !== null;
      return false;
    default:
      return task.text.toLowerCase().includes(term.value) || task.path.toLowerCase().includes(term.value);
  }
}

export function matchTask(terms: TaskTerm[], task: Task, today: string): boolean {
  return terms.every((term) => termMatches(term, task, today) !== term.negate);
}

// ---------------------------------------------------------------------------------------------
// Visões: filtro rápido, agrupamento e ordenação.

export const VIEWS = ['open', 'today', 'upcoming', 'done', 'all'] as const;
export type View = (typeof VIEWS)[number];
export const GROUPS = ['note', 'folder', 'due', 'priority', 'tag', 'none'] as const;
export type GroupBy = (typeof GROUPS)[number];
export const SORTS = ['file', 'due', 'priority', 'alpha'] as const;
export type SortBy = (typeof SORTS)[number];

export function inView(view: View, task: Task, today: string): boolean {
  switch (view) {
    case 'open':
      return !task.done;
    case 'done':
      return task.done;
    case 'today': {
      const bucket = dueBucket(task, today);
      return !task.done && (bucket === 'today' || bucket === 'overdue');
    }
    case 'upcoming': {
      const date = taskDate(task);
      return !task.done && !!date && daysBetween(today, date) >= 1 && daysBetween(today, date) <= 7;
    }
    default:
      return true;
  }
}

const priorityRank = (priority: Priority) => PRIORITIES.indexOf(priority);
const byFile = (a: Task, b: Task) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path));

export function sortTasks(tasks: Task[], by: SortBy): Task[] {
  const list = [...tasks];
  if (by === 'file') return list;
  const compare: Record<Exclude<SortBy, 'file'>, (a: Task, b: Task) => number> = {
    // Sem data vai para o fim; empate cai na prioridade.
    due: (a, b) => (taskDate(a) ?? '9999').localeCompare(taskDate(b) ?? '9999') || priorityRank(a.priority) - priorityRank(b.priority),
    priority: (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (taskDate(a) ?? '9999').localeCompare(taskDate(b) ?? '9999'),
    alpha: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  };
  return list.sort((a, b) => compare[by](a, b) || byFile(a, b));
}

export type TaskGroup = { key: string; kind: GroupBy; tasks: Task[] };

const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Agrupa as tarefas (já filtradas e ordenadas). As chaves dos grupos seguem uma ordem útil para cada tipo. */
export function groupTasks(tasks: Task[], by: GroupBy, today: string): TaskGroup[] {
  if (by === 'none') return tasks.length ? [{ key: '', kind: by, tasks }] : [];
  const map = new Map<string, Task[]>();
  const push = (key: string, task: Task) => {
    const list = map.get(key);
    if (list) list.push(task);
    else map.set(key, [task]);
  };
  for (const task of tasks) {
    if (by === 'note') push(task.path, task);
    else if (by === 'folder') push(folderOf(task.path), task);
    else if (by === 'due') push(dueBucket(task, today), task);
    else if (by === 'priority') push(task.priority, task);
    else if (task.tags.length) task.tags.forEach((tag) => push(tag, task));
    else push('', task);
  }
  const keys = [...map.keys()];
  if (by === 'due') keys.sort((a, b) => BUCKETS.indexOf(a as Bucket) - BUCKETS.indexOf(b as Bucket));
  else if (by === 'priority') keys.sort((a, b) => priorityRank(a as Priority) - priorityRank(b as Priority));
  else if (by === 'folder' || by === 'tag') keys.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  return keys.map((key) => ({ key, kind: by, tasks: map.get(key)! }));
}

/** Tarefas em Markdown (para copiar), uma por linha, com a nota de origem como link. */
export function tasksToMarkdown(tasks: Task[]): string {
  return tasks
    .map((task) => {
      const name = task.path.replace(/\.md$/i, '');
      return `- [${task.done ? 'x' : ' '}] ${task.text} ([[${name}]])`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// Preferências guardadas: o que vem do localStorage passa por aqui antes de valer.

export type TaskPrefs = { view: View; groupBy: GroupBy; sortBy: SortBy; stampDone: boolean; collapsed: string[]; target: string };
export const DEFAULT_TASK_PREFS: TaskPrefs = { view: 'open', groupBy: 'note', sortBy: 'file', stampDone: true, collapsed: [], target: '' };
const MAX_COLLAPSED = 200;

export function sanitizeTaskPrefs(raw: unknown): TaskPrefs {
  const prefs: TaskPrefs = { ...DEFAULT_TASK_PREFS, collapsed: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return prefs;
  const input = raw as Record<string, unknown>;
  if ((VIEWS as readonly unknown[]).includes(input.view)) prefs.view = input.view as View;
  if ((GROUPS as readonly unknown[]).includes(input.groupBy)) prefs.groupBy = input.groupBy as GroupBy;
  if ((SORTS as readonly unknown[]).includes(input.sortBy)) prefs.sortBy = input.sortBy as SortBy;
  if (typeof input.stampDone === 'boolean') prefs.stampDone = input.stampDone;
  if (typeof input.target === 'string' && input.target.length <= 500) prefs.target = input.target;
  if (Array.isArray(input.collapsed)) {
    prefs.collapsed = [...new Set(input.collapsed.filter((key): key is string => typeof key === 'string' && key.length <= 500))].slice(0, MAX_COLLAPSED);
  }
  return prefs;
}

/** Pedaços do título para exibir: texto, #tags e [[links]] (estes viram botões na tela). */
export type TitlePart = { kind: 'text' | 'tag' | 'link'; value: string; label?: string };

export function titleParts(title: string): TitlePart[] {
  const parts: TitlePart[] = [];
  const pattern = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]|(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
  let last = 0;
  for (const match of title.matchAll(pattern)) {
    const start = match.index! + (match[3]?.length ?? 0);
    if (start > last) parts.push({ kind: 'text', value: title.slice(last, start) });
    if (match[1] !== undefined) parts.push({ kind: 'link', value: match[1].trim(), label: (match[2] ?? match[1]).trim() });
    else parts.push({ kind: 'tag', value: match[4] });
    last = match.index! + match[0].length;
  }
  if (last < title.length) parts.push({ kind: 'text', value: title.slice(last) });
  return parts;
}
