import { useEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { Trans, useLanguage, useT, type Key } from '../lib/i18n';
import { isoDate } from '../lib/notes';
import {
  addDays,
  appendTask,
  completeTaskLine,
  daysBetween,
  deleteTaskLine,
  dueBucket,
  extractTasks,
  GROUPS,
  groupTasks,
  inView,
  matchTask,
  parseQuickAdd,
  parseTaskQuery,
  rewriteTaskLine,
  sanitizeTaskPrefs,
  SORTS,
  sortTasks,
  tasksToMarkdown,
  titleParts,
  updateTaskMeta,
  VIEWS,
  type Bucket,
  type GroupBy,
  type Priority,
  type SortBy,
  type Task,
  type TaskGroup,
  type TaskPrefs,
} from '../lib/tasks';
import type { Note } from '../types';
import { ContextMenu, isMenuKey, menuPosition, type MenuItem, type MenuRequest } from './ContextMenu';
import { pendingWrite, trackWrite } from './Editor';
import {
  CalendarIcon,
  ChevronIcon,
  CollapseAllIcon,
  CopyIcon,
  ExpandAllIcon,
  FlagIcon,
  FolderIcon,
  HelpIcon,
  Kbd,
  LocateIcon,
  PageIcon,
  PlusIcon,
  RepeatIcon,
  SearchIcon,
  TasksIcon,
} from './Icons';

/** Lista suspensa no vidro: a seta nativa dá lugar à do app, que segue os tokens. */
function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return (
    <span className={`task-select-wrap ${className}`}>
      <select className="task-select" {...props} />
      <ChevronIcon size={11} className="task-select-caret" aria-hidden="true" />
    </span>
  );
}

/** O que o App precisa para abrir a nota já na tarefa. */
export type TaskJump = { path: string; index: number; text: string };

type Props = {
  notes: Note[];
  contents: Record<string, string>;
  onOpen: (path: string, newTab: boolean) => void;
  onOpenTask: (jump: TaskJump, newTab: boolean) => void;
  onOpenTarget: (target: string) => void;
  onEnsureDaily: () => Promise<string>;
  onSaved: (path: string, content: string) => void;
};

const PREFS_KEY = 'obnotion:tasks';
const SEP = '\u0001';

const loadPrefs = (): TaskPrefs => {
  try {
    return sanitizeTaskPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'));
  } catch {
    return sanitizeTaskPrefs(null);
  }
};

const noteName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
const rowId = (group: TaskGroup, task: Task) => `${group.kind}:${group.key}${SEP}${task.path}${SEP}${task.line}`;
const groupId = (group: TaskGroup) => `${group.kind}:${group.key}`;
// Texto como o editor mostra: links pelo nome, sem a sintaxe Markdown.
const plainTitle = (title: string) => titleParts(title).map((part) => (part.kind === 'link' ? part.label : part.kind === 'tag' ? `#${part.value}` : part.value)).join('');
const isField = (target: EventTarget) => target instanceof HTMLElement && (target.matches('input:not([type="checkbox"]), select, textarea') || target.isContentEditable);

// Teclas de prioridade na lista (e no menu), da mais alta à normal.
const PRIORITY_ORDER: [string, Priority][] = [
  ['1', 'highest'],
  ['2', 'high'],
  ['3', 'medium'],
  ['4', 'low'],
  ['0', 'none'],
];
const PRIORITY_KEYS: Record<string, Priority> = Object.fromEntries(PRIORITY_ORDER);

type Status = { text: string; error?: boolean; undo?: boolean } | null;
type Change = { path: string; before: string; after: string };

export function Tasks({ notes, contents, onOpen, onOpenTask, onOpenTarget, onEnsureDaily, onSaved }: Props) {
  const t = useT();
  const { language } = useLanguage();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [help, setHelp] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Uma gravação por vez: dois cliques seguidos na mesma nota não leem o arquivo no meio da outra.
  const queue = useRef(Promise.resolve());
  const lastChange = useRef<Change | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const today = isoDate(new Date());

  const update = (change: Partial<TaskPrefs>) => setPrefs((current) => ({ ...current, ...change }));
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Sem localStorage (cota cheia): as preferências valem só nesta sessão.
    }
  }, [prefs]);

  const all = useMemo(() => notes.flatMap((note) => extractTasks(note.path, contents[note.path] ?? '')), [notes, contents]);
  const progress = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const task of all) {
      const entry = map.get(task.path) ?? { done: 0, total: 0 };
      entry.total++;
      if (task.done) entry.done++;
      map.set(task.path, entry);
    }
    return map;
  }, [all]);
  const stats = useMemo(() => {
    let open = 0;
    let overdue = 0;
    let dueToday = 0;
    for (const task of all) {
      if (task.done) continue;
      open++;
      const bucket = dueBucket(task, today);
      if (bucket === 'overdue') overdue++;
      else if (bucket === 'today') dueToday++;
    }
    return { open, overdue, dueToday };
  }, [all, today]);

  const terms = useMemo(() => parseTaskQuery(query), [query]);
  const visible = useMemo(
    () => sortTasks(all.filter((task) => inView(prefs.view, task, today) && matchTask(terms, task, today)), prefs.sortBy),
    [all, prefs.view, prefs.sortBy, terms, today],
  );
  const groups = useMemo(() => groupTasks(visible, prefs.groupBy, today), [visible, prefs.groupBy, today]);
  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed]);
  const nested = prefs.groupBy === 'note' && prefs.sortBy === 'file';
  const rows = useMemo(
    () => groups.flatMap((group) => (collapsed.has(groupId(group)) ? [] : group.tasks.map((task) => ({ id: rowId(group, task), task, group })))),
    [groups, collapsed],
  );
  // Uma só parada de Tab na lista: a linha focada por último, ou a primeira.
  const activeRow = rows.some((row) => row.id === focusId) ? focusId : rows[0]?.id;
  // Campo de edição ou de data fechado por Enter/Esc: o blur que vem depois não grava de novo.
  const settled = useRef(false);
  const backToRow = (id: string) => requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus());

  // Foco que sobrevive às gravações: a linha focada volta a receber o foco quando a lista é refeita.
  useEffect(() => {
    if (!focusId || editing || picking || menu) return;
    const element = list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(focusId)}"]`);
    const active = document.activeElement;
    if (element && active !== element && (list.current?.contains(active) || active === document.body)) element.focus();
  }, [rows, focusId, editing, picking, menu]);

  const run = (job: () => Promise<void>) => {
    queue.current = queue.current.then(job).catch(() => undefined);
  };

  /** Lê a nota do disco, confere se a tarefa ainda é a mesma e grava a alteração. */
  const change = (task: Task, edit: (disk: string) => string, message: Key) =>
    run(async () => {
      try {
        await pendingWrite(task.path);
        const disk = await window.api.read(task.path);
        const same = extractTasks(task.path, disk).some((now) => now.line === task.line && now.text === task.text && now.done === task.done);
        if (!same) {
          // A nota mudou fora daqui: a lista é atualizada e o pedido não vale; avisa em vez de calar.
          onSaved(task.path, disk);
          setStatus({ text: t('tasks.stale', { path: task.path }), error: true });
          return;
        }
        const next = edit(disk);
        if (next === disk) return;
        await trackWrite(task.path, window.api.write(task.path, next));
        onSaved(task.path, next);
        lastChange.current = { path: task.path, before: disk, after: next };
        setStatus({ text: t(message, { name: noteName(task.path) }), undo: true });
      } catch {
        setStatus({ text: t('tasks.error', { path: task.path }), error: true });
      }
    });

  const undo = () => {
    const last = lastChange.current;
    if (!last) return;
    run(async () => {
      try {
        await pendingWrite(last.path);
        const disk = await window.api.read(last.path);
        if (disk !== last.after) {
          lastChange.current = null;
          setStatus({ text: t('tasks.undoStale', { path: last.path }), error: true });
          return;
        }
        await trackWrite(last.path, window.api.write(last.path, last.before));
        onSaved(last.path, last.before);
        lastChange.current = null;
        setStatus({ text: t('tasks.undone') });
      } catch {
        setStatus({ text: t('tasks.error', { path: last.path }), error: true });
      }
    });
  };

  const toggle = (task: Task) => change(task, (disk) => completeTaskLine(disk, task.line, { today, stampDone: prefs.stampDone }), 'tasks.changed');
  const setMeta = (task: Task, meta: { due?: string | undefined; priority?: Priority }) =>
    change(task, (disk) => rewriteTaskLine(disk, task.line, (text) => ({ text: updateTaskMeta(text, meta) })), 'tasks.changed');
  const setText = (task: Task, value: string) => {
    const text = value.replace(/[\r\n]+/g, ' ').trim();
    if (text && text !== task.text) change(task, (disk) => rewriteTaskLine(disk, task.line, () => ({ text })), 'tasks.changed');
  };
  const remove = (task: Task, id: string) => {
    // O foco vai para a vizinha: a linha excluída some da lista.
    const index = rows.findIndex((row) => row.id === id);
    const neighbor = rows[index + 1] ?? rows[index - 1];
    setFocusId(neighbor?.id ?? null);
    change(task, (disk) => deleteTaskLine(disk, task.line), 'tasks.deleted');
  };
  const jump = (task: Task, newTab: boolean) => onOpenTask({ path: task.path, index: task.index, text: plainTitle(task.title) }, newTab);

  const target = notes.some((note) => note.path === prefs.target) ? prefs.target : '';
  const add = (event: FormEvent) => {
    event.preventDefault();
    const original = draft;
    const text = parseQuickAdd(draft, today);
    if (!text) return;
    setDraft('');
    run(async () => {
      let path = target;
      try {
        path ||= await onEnsureDaily();
        await pendingWrite(path);
        const disk = await window.api.read(path);
        const next = appendTask(disk, text);
        await trackWrite(path, window.api.write(path, next));
        onSaved(path, next);
        lastChange.current = { path, before: disk, after: next };
        setStatus({ text: t('tasks.added', { name: noteName(path) }), undo: true });
      } catch {
        setDraft((current) => current || original);
        setStatus({ text: t('tasks.error', { path: path || t('tasks.add.daily') }), error: true });
      }
    });
  };

  const copyVisible = () => {
    const unique = [...new Map(visible.map((task) => [`${task.path}${SEP}${task.line}`, task])).values()];
    if (!unique.length) return;
    void navigator.clipboard.writeText(tasksToMarkdown(unique)).then(
      () => setStatus({ text: t('tasks.copied', { count: unique.length }) }),
      () => setStatus({ text: t('tasks.error', { path: '' }), error: true }),
    );
  };

  const toggleGroup = (group: TaskGroup) => {
    const id = groupId(group);
    update({ collapsed: collapsed.has(id) ? prefs.collapsed.filter((key) => key !== id) : [...prefs.collapsed, id] });
  };
  const setAllCollapsed = (value: boolean) => {
    const ids = groups.map(groupId);
    update({ collapsed: value ? [...new Set([...prefs.collapsed, ...ids])] : prefs.collapsed.filter((key) => !ids.includes(key)) });
  };

  const menuFor = (task: Task, id: string): MenuItem[] => [
    { label: t('tasks.menu.goto'), keys: 'Enter', run: () => jump(task, false) },
    { label: t('tasks.menu.gotoTab'), keys: 'Ctrl Enter', run: () => jump(task, true) },
    { label: t('tasks.menu.edit'), keys: 'F2', run: () => setEditing({ id, value: task.text }) },
    { kind: 'separator' },
    { label: t('tasks.menu.dueToday'), keys: 'T', run: () => setMeta(task, { due: today }) },
    { label: t('tasks.menu.dueTomorrow'), keys: 'M', run: () => setMeta(task, { due: addDays(today, 1) }) },
    { label: t('tasks.menu.dueWeek'), keys: 'W', run: () => setMeta(task, { due: addDays(today, 7) }) },
    { label: t('tasks.menu.duePick'), keys: 'D', run: () => setPicking(id) },
    { label: t('tasks.menu.dueClear'), disabled: !task.due, run: () => setMeta(task, { due: undefined }) },
    { kind: 'separator' },
    ...PRIORITY_ORDER.map(
      ([keys, priority]): MenuItem => ({
        label: t('tasks.menu.priority', { name: t(`tasks.priority.${priority}`) }),
        keys,
        disabled: task.priority === priority,
        run: () => setMeta(task, { priority }),
      }),
    ),
    { kind: 'separator' },
    { label: t('tasks.menu.copy'), run: () => void navigator.clipboard.writeText(task.text) },
    { label: t('tasks.menu.delete'), keys: 'Del', danger: true, run: () => remove(task, id) },
  ];

  const openMenu = (event: { clientX?: number; clientY?: number; currentTarget: EventTarget; preventDefault: () => void }, task: Task, id: string) => {
    event.preventDefault();
    setFocusId(id);
    setMenu({ ...menuPosition(event), items: menuFor(task, id), label: t('tasks.menu') });
  };

  const focusRow = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    setFocusId(row.id);
    list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(row.id)}"]`)?.focus();
  };

  const onRowKey = (event: ReactKeyboardEvent<HTMLInputElement>, task: Task, id: string, group: TaskGroup) => {
    const index = rows.findIndex((row) => row.id === id);
    const key = event.key;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    let handled = true;
    if (isMenuKey(event)) openMenu(event, task, id);
    else if (key === 'ArrowDown' || (plain && key === 'j')) focusRow(index + 1);
    else if (key === 'ArrowUp' || (plain && key === 'k')) focusRow(index - 1);
    else if (key === 'Home') focusRow(0);
    else if (key === 'End') focusRow(rows.length - 1);
    else if (key === 'Enter') jump(task, event.ctrlKey || event.metaKey);
    else if (key === 'F2' || (plain && key === 'e')) setEditing({ id, value: task.text });
    else if (plain && key === 'x') toggle(task);
    else if (plain && key === 't') setMeta(task, { due: today });
    else if (plain && key === 'm') setMeta(task, { due: addDays(today, 1) });
    else if (plain && key === 'w') setMeta(task, { due: addDays(today, 7) });
    else if (plain && key === 'd') setPicking(id);
    else if (plain && PRIORITY_KEYS[key]) setMeta(task, { priority: PRIORITY_KEYS[key] });
    else if (key === 'Delete') remove(task, id);
    else if ((plain && key === 'u') || ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'z')) undo();
    else if (key === 'ArrowLeft' && group.kind !== 'none') {
      toggleGroup(group);
      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-group="${CSS.escape(groupId(group))}"]`)?.focus());
    } else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // Teclas da tela inteira (fora dos campos): "/" busca, "n" nova tarefa, "?" atalhos.
  const onScreenKey = (event: ReactKeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || isField(event.target)) return;
    if (event.key === '/') searchRef.current?.focus();
    else if (event.key === 'n') addRef.current?.focus();
    else if (event.key === '?') setHelp((open) => !open);
    else if (event.key === 'Escape' && help) setHelp(false);
    else return;
    event.preventDefault();
  };

  const rtf = useMemo(() => new Intl.RelativeTimeFormat(language, { numeric: 'auto' }), [language]);
  const short = useMemo(() => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', timeZone: 'UTC' }), [language]);
  const long = useMemo(() => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), [language]);
  const friendly = (iso: string) => {
    const diff = daysBetween(today, iso);
    if (Math.abs(diff) <= 6) return rtf.format(diff, 'day');
    return (iso.slice(0, 4) === today.slice(0, 4) ? short : long).format(new Date(`${iso}T00:00:00Z`));
  };

  const groupLabel = (group: TaskGroup) => {
    switch (group.kind) {
      case 'note':
        return noteName(group.key);
      case 'folder':
        return group.key || t('tasks.folderRoot');
      case 'due':
        return t(`tasks.bucket.${group.key as Bucket}`);
      case 'priority':
        return t(`tasks.priority.${group.key as Priority}`);
      case 'tag':
        return group.key ? `#${group.key}` : t('tasks.noTag');
      default:
        return t('tasks.everything');
    }
  };

  const GroupIcon = ({ group }: { group: TaskGroup }) => {
    if (group.kind === 'note') return <PageIcon size={14} className="row-icon" />;
    if (group.kind === 'folder') return <FolderIcon size={14} className="row-icon" />;
    if (group.kind === 'due') return <CalendarIcon size={14} className="row-icon" data-bucket={group.key} />;
    if (group.kind === 'priority') return <FlagIcon size={14} className="row-icon task-priority-icon" data-priority={group.key} />;
    return null;
  };

  const emptyText = () => {
    const slash = { key: <Kbd>/</Kbd> };
    if (!all.length) return <Trans k="tasks.emptyAll" values={slash} />;
    if (query.trim()) return t('tasks.noMatch');
    if (prefs.view === 'open') return <Trans k="tasks.emptyOpen" values={slash} />;
    if (prefs.view === 'today') return t('tasks.emptyToday');
    if (prefs.view === 'upcoming') return t('tasks.emptyUpcoming');
    if (prefs.view === 'done') return t('tasks.emptyDone');
    return <Trans k="tasks.emptyAll" values={slash} />;
  };

  const anyCollapsed = groups.some((group) => collapsed.has(groupId(group)));
  // Notas listadas mas conteúdo ainda não lido: mostra linhas-fantasma em vez de "nenhuma tarefa".
  const loading = notes.length > 0 && notes.every((note) => !(note.path in contents));

  return (
    <div className="tasks-screen mx-auto w-full max-w-[820px] px-4 pb-24 pt-8 text-[13px] sm:px-6 sm:pt-10" onKeyDown={onScreenKey}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-frost-100">{t('nav.tasks')}</h1>
        <p className="flex flex-wrap items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
          <span className="task-pill" data-tone="sheen">
            {t('tasks.openCount', { count: stats.open })}
          </span>
          {stats.overdue > 0 && (
            <button className="task-pill task-stat" data-tone="danger" onClick={() => update({ view: 'today' })}>
              {t('tasks.stats.overdue', { count: stats.overdue })}
            </button>
          )}
          {stats.dueToday > 0 && (
            <button className="task-pill task-stat" onClick={() => update({ view: 'today' })}>
              {t('tasks.stats.today', { count: stats.dueToday })}
            </button>
          )}
        </p>
        <div className="ml-auto flex items-center gap-1">
          <button className="icon-button task-tool" title={t('tasks.copy')} aria-label={t('tasks.copy')} disabled={!visible.length} onClick={copyVisible}>
            <CopyIcon size={15} />
          </button>
          {prefs.groupBy !== 'none' &&
            (anyCollapsed ? (
              <button className="icon-button task-tool" title={t('tasks.expandAll')} aria-label={t('tasks.expandAll')} onClick={() => setAllCollapsed(false)}>
                <ExpandAllIcon size={15} />
              </button>
            ) : (
              <button
                className="icon-button task-tool"
                title={t('tasks.collapseAll')}
                aria-label={t('tasks.collapseAll')}
                disabled={!groups.length}
                onClick={() => setAllCollapsed(true)}
              >
                <CollapseAllIcon size={15} />
              </button>
            ))}
          <button
            className="icon-button task-tool"
            title={`${t('tasks.help')} (?)`}
            aria-label={t('tasks.help')}
            aria-expanded={help}
            aria-controls="tasks-help"
            data-on={help}
            onClick={() => setHelp((open) => !open)}
          >
            <HelpIcon size={15} />
          </button>
        </div>
      </header>

      {help && (
        <div id="tasks-help" className="task-help mt-3">
          <dl className="task-keys" aria-label={t('tasks.help')}>
            {(
              [
                ['↑ ↓ / J K', 'tasks.keys.move'],
                ['Space / X', 'tasks.keys.toggle'],
                ['Enter', 'tasks.keys.open'],
                ['F2 / E', 'tasks.keys.edit'],
                ['T / M / W', 'tasks.keys.due'],
                ['D', 'tasks.keys.pick'],
                ['1–4 / 0', 'tasks.keys.priority'],
                ['Del', 'tasks.keys.delete'],
                ['U', 'tasks.keys.undo'],
                ['←', 'tasks.keys.collapse'],
                ['Shift F10', 'tasks.keys.menu'],
                ['/', 'tasks.keys.search'],
                ['N', 'tasks.keys.add'],
              ] as [string, Key][]
            ).map(([keys, label]) => (
              <div key={label} className="contents">
                <dt>
                  <Kbd>{keys}</Kbd>
                </dt>
                <dd>{t(label)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 border-t border-(--hairline) pt-2.5 leading-relaxed text-frost-500">{t('tasks.queryHelp')}</p>
        </div>
      )}

      <form className="task-add mt-5" onSubmit={add}>
        <span className="task-add-field">
          <PlusIcon size={14} className="shrink-0 text-sheen-400" />
          <input
            ref={addRef}
            className="min-w-0 flex-1 bg-transparent py-2.5 text-[13px] text-frost-100 caret-sheen-400 outline-none placeholder:text-frost-500"
            placeholder={t('tasks.add.placeholder')}
            aria-label={t('tasks.add.label')}
            value={draft}
            spellCheck={false}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && (setDraft(''), event.currentTarget.blur())}
          />
        </span>
        <span className="task-add-tail">
          <Select className="min-w-0 flex-1" aria-label={t('tasks.add.target')} title={t('tasks.add.target')} value={target} onChange={(event) => update({ target: event.target.value })}>
            <option value="">{t('tasks.add.daily')}</option>
            {[...notes]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((note) => (
                <option key={note.path} value={note.path}>
                  {note.path.replace(/\.md$/i, '')}
                </option>
              ))}
          </Select>
          <button type="submit" className="task-add-button" disabled={!draft.trim()}>
            {t('tasks.add.button')}
          </button>
        </span>
      </form>

      <div className="task-bar -mx-4 mt-4 px-4 sm:-mx-6 sm:px-6">
        <div className="task-bar-row">
          <div className="task-views" role="group" aria-label={t('tasks.filter')}>
            {VIEWS.map((key) => (
              <button key={key} aria-pressed={key === prefs.view} onClick={() => update({ view: key })}>
                {t(`tasks.filter.${key}`)}
              </button>
            ))}
          </div>
          <label className="task-search">
            <SearchIcon size={14} className="shrink-0 text-frost-500" />
            <input
              ref={searchRef}
              className="w-full min-w-0 bg-transparent py-1.5 text-[12.5px] text-frost-100 caret-sheen-400 outline-none placeholder:text-frost-500"
              placeholder={t('tasks.searchPlaceholder')}
              aria-label={t('tasks.searchLabel')}
              value={query}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.stopPropagation();
                  setQuery('');
                } else if (event.key === 'ArrowDown' && rows.length) {
                  event.preventDefault();
                  focusRow(0);
                }
              }}
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-frost-500">
          <label className="flex items-center gap-1.5">
            {t('tasks.groupBy')}
            <Select value={prefs.groupBy} onChange={(event) => update({ groupBy: event.target.value as GroupBy })}>
              {GROUPS.map((key) => (
                <option key={key} value={key}>
                  {t(`tasks.group.${key}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1.5">
            {t('tasks.sortBy')}
            <Select value={prefs.sortBy} onChange={(event) => update({ sortBy: event.target.value as SortBy })}>
              {SORTS.map((key) => (
                <option key={key} value={key}>
                  {t(`tasks.sort.${key}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 hover:text-frost-300">
            <input type="checkbox" className="task-check" checked={prefs.stampDone} onChange={(event) => update({ stampDone: event.target.checked })} />
            {t('tasks.stampDone')}
          </label>
        </div>
      </div>

      <div ref={list} aria-label={t('tasks.list')} role="region">
        {groups.map((group) => {
          const id = groupId(group);
          const isCollapsed = collapsed.has(id);
          const label = groupLabel(group);
          const stat = group.kind === 'note' ? progress.get(group.key) : undefined;
          return (
            <section key={id} className="mt-4" data-bucket={group.kind === 'due' ? group.key : undefined}>
              {group.kind !== 'none' && (
                <h2 className="task-group-head">
                  <button
                    className="icon-button"
                    data-group={id}
                    aria-expanded={!isCollapsed}
                    aria-label={t('tasks.toggleGroup', { name: label })}
                    title={t('tasks.toggleGroup', { name: label })}
                    onClick={() => toggleGroup(group)}
                  >
                    <ChevronIcon size={12} className={`chevron ${isCollapsed ? '' : 'rotate-90'}`} />
                  </button>
                  {group.kind === 'note' ? (
                    <button
                      className="row min-w-0 flex-1 px-1.5 text-left"
                      title={group.key}
                      aria-label={t('tasks.openNote', { name: label })}
                      onClick={(event) => onOpen(group.key, event.ctrlKey || event.metaKey)}
                      onAuxClick={(event) => event.button === 1 && onOpen(group.key, true)}
                    >
                      <GroupIcon group={group} />
                      <span className="truncate font-medium text-frost-100">{label}</span>
                    </button>
                  ) : group.kind === 'tag' && group.key ? (
                    <button className="row min-w-0 flex-1 px-1.5 text-left" onClick={() => setQuery(`#${group.key}`)}>
                      <span className="truncate font-medium text-[var(--graph-tag)]">{label}</span>
                    </button>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-2 px-1.5" data-bucket={group.kind === 'due' ? group.key : undefined}>
                      <GroupIcon group={group} />
                      <span className="task-group-title truncate font-medium text-frost-100">{label}</span>
                    </span>
                  )}
                  {stat && (
                    <span className="task-progress" title={t('tasks.progress', { done: stat.done, total: stat.total })}>
                      <span className="task-progress-bar" aria-hidden="true">
                        <span style={{ width: `${(stat.done / stat.total) * 100}%` }} />
                      </span>
                      <span className="sr-only">{t('tasks.progress', { done: stat.done, total: stat.total })}</span>
                    </span>
                  )}
                  <span className="task-count" aria-hidden={Boolean(stat)}>
                    {group.tasks.length}
                  </span>
                </h2>
              )}
              {!isCollapsed && (
                <ul className={group.kind === 'none' ? '' : 'ml-[10px] mt-0.5 border-l border-(--hairline) pl-2'}>
                  {group.tasks.map((task) => {
                    const id = rowId(group, task);
                    const bucket = task.done ? 'none' : dueBucket(task, today);
                    const isEditing = editing?.id === id;
                    const tabbable = activeRow === id;
                    return (
                      <li
                        key={id}
                        className="task-row group"
                        data-done={task.done}
                        style={nested && task.depth ? { marginLeft: Math.min(task.depth, 6) * 18 } : undefined}
                        onContextMenu={(event) => openMenu(event, task, id)}
                      >
                        <input
                          type="checkbox"
                          className="task-check mt-[2px]"
                          data-row={id}
                          data-priority={task.done ? undefined : task.priority}
                          tabIndex={tabbable ? 0 : -1}
                          checked={task.done}
                          aria-label={plainTitle(task.title) || task.text}
                          aria-describedby={`${id}-meta`}
                          onFocus={() => setFocusId(id)}
                          onChange={() => toggle(task)}
                          onKeyDown={(event) => onRowKey(event, task, id, group)}
                        />
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <input
                              className="task-edit"
                              aria-label={t('tasks.edit.label')}
                              value={editing.value}
                              autoFocus
                              spellCheck={false}
                              maxLength={2000}
                              onFocus={() => (settled.current = false)}
                              onChange={(event) => setEditing({ id, value: event.target.value })}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key !== 'Enter' && event.key !== 'Escape') return;
                                event.preventDefault();
                                if (event.key === 'Enter') setText(task, editing.value);
                                settled.current = true;
                                setEditing(null);
                                backToRow(id);
                              }}
                              onBlur={() => {
                                if (!settled.current) setText(task, editing.value);
                                settled.current = true;
                                setEditing(null);
                              }}
                            />
                          ) : (
                            <span className="task-title" onDoubleClick={() => setEditing({ id, value: task.text })}>
                              {titleParts(task.title).map((part, index) =>
                                part.kind === 'text' ? (
                                  <span key={index}>{part.value}</span>
                                ) : (
                                  <button
                                    key={index}
                                    tabIndex={-1}
                                    className={part.kind === 'tag' ? 'task-tag' : 'task-wikilink'}
                                    onClick={() => (part.kind === 'tag' ? setQuery(`#${part.value}`) : onOpenTarget(part.value))}
                                  >
                                    {part.kind === 'tag' ? `#${part.value}` : part.label}
                                  </button>
                                ),
                              )}
                            </span>
                          )}
                          <span id={`${id}-meta`} className="task-meta">
                            {task.priority !== 'none' && (
                              <span className="task-chip" data-priority={task.priority} title={t('tasks.chip.priority', { name: t(`tasks.priority.${task.priority}`) })}>
                                <FlagIcon size={11} />
                                {t(`tasks.priority.${task.priority}`)}
                              </span>
                            )}
                            {task.due && (
                              <span className="task-chip" data-bucket={bucket} title={t('tasks.chip.due', { date: task.due })}>
                                <CalendarIcon size={11} />
                                <span className="sr-only">{t('tasks.chip.due', { date: '' })}</span>
                                {friendly(task.due)}
                              </span>
                            )}
                            {task.scheduled && (
                              <span className="task-chip" data-bucket={task.due ? 'none' : bucket} title={t('tasks.chip.scheduled', { date: task.scheduled })}>
                                {t('tasks.chip.scheduled', { date: friendly(task.scheduled) })}
                              </span>
                            )}
                            {task.start && (
                              <span className="task-chip" title={t('tasks.chip.start', { date: task.start })}>
                                {t('tasks.chip.start', { date: friendly(task.start) })}
                              </span>
                            )}
                            {task.recurrence && (
                              <span className="task-chip" title={t('tasks.chip.repeat', { rule: task.recurrence })}>
                                <RepeatIcon size={11} />
                                {task.recurrence}
                              </span>
                            )}
                            {task.completion && (
                              <span className="task-chip" title={t('tasks.chip.completion', { date: task.completion })}>
                                {t('tasks.chip.completion', { date: friendly(task.completion) })}
                              </span>
                            )}
                            {group.kind !== 'note' && (
                              <button tabIndex={-1} className="task-chip task-source" title={task.path} onClick={(event) => onOpen(task.path, event.ctrlKey || event.metaKey)}>
                                <PageIcon size={11} />
                                {noteName(task.path)}
                              </button>
                            )}
                          </span>
                          {picking === id && (
                            <input
                              type="date"
                              className="task-date mt-1"
                              aria-label={t('tasks.date.label')}
                              defaultValue={task.due ?? today}
                              autoFocus
                              onFocus={() => (settled.current = false)}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key !== 'Enter' && event.key !== 'Escape') return;
                                event.preventDefault();
                                const value = event.currentTarget.value;
                                if (event.key === 'Enter' && value && value !== task.due) setMeta(task, { due: value });
                                settled.current = true;
                                setPicking(null);
                                backToRow(id);
                              }}
                              onBlur={(event) => {
                                const value = event.currentTarget.value;
                                if (!settled.current && value && value !== task.due) setMeta(task, { due: value });
                                settled.current = true;
                                setPicking(null);
                              }}
                            />
                          )}
                        </div>
                        <button
                          tabIndex={-1}
                          className="icon-button task-row-action"
                          title={t('tasks.goto', { name: noteName(task.path) })}
                          aria-label={t('tasks.goto', { name: noteName(task.path) })}
                          onClick={(event) => jump(task, event.ctrlKey || event.metaKey)}
                        >
                          <LocateIcon size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {loading ? (
        <div className="mt-6 flex flex-col gap-3 px-2" aria-hidden="true">
          {[72, 54, 64].map((width) => (
            <span key={width} className="flex items-center gap-2.5">
              <span className="board-skeleton w-[15px] shrink-0" />
              <span className="board-skeleton" style={{ width: `${width}%` }} />
            </span>
          ))}
        </div>
      ) : (
        !groups.length && (
          <div className="task-empty">
            <span className="board-seal" aria-hidden="true">
              <TasksIcon size={24} />
            </span>
            <p className="max-w-80 text-balance leading-relaxed text-frost-300">{emptyText()}</p>
          </div>
        )
      )}

      {/* Aviso flutuante: preso ao pé da área visível, perto de onde se clicou, sem empurrar a lista. */}
      <div className="task-toast-slot" role="status" aria-live="polite">
        {status && (
          <div key={status.text} className="task-toast" data-kind={status.error ? 'error' : undefined}>
            <span className="min-w-0">{status.text}</span>
            {status.undo && lastChange.current && (
              <button className="task-link" onClick={undo}>
                {t('tasks.undo')}
              </button>
            )}
          </div>
        )}
      </div>

      {menu && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
