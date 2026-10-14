import { useMemo, useRef, useState } from 'react';

import { Trans, useT } from '../lib/i18n';
import { extractTasks, toggleTaskLine, type Task } from '../lib/tasks';
import type { Note } from '../types';
import { pendingWrite, trackWrite } from './Editor';
import { Kbd, PageIcon, SearchIcon } from './Icons';

const FILTERS = ['open', 'done', 'all'] as const;
type Filter = (typeof FILTERS)[number];

type Props = {
  notes: Note[];
  contents: Record<string, string>;
  onOpen: (path: string, newTab: boolean) => void;
  onSaved: (path: string, content: string) => void;
};

export function Tasks({ notes, contents, onOpen, onSaved }: Props) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState('');
  // Uma gravação por vez: dois cliques seguidos na mesma nota não leem o arquivo no meio da outra.
  const queue = useRef(Promise.resolve());

  const all = useMemo(
    () => notes.map((note) => ({ note, tasks: extractTasks(note.path, contents[note.path] ?? '') })).filter((group) => group.tasks.length),
    [notes, contents],
  );
  const openCount = useMemo(() => all.reduce((sum, group) => sum + group.tasks.filter((task) => !task.done).length, 0), [all]);

  const groups = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const shown = (task: Task) => (filter === 'all' || task.done === (filter === 'done')) && task.text.toLowerCase().includes(wanted);
    return all.map((group) => ({ ...group, tasks: group.tasks.filter(shown) })).filter((group) => group.tasks.length);
  }, [all, filter, query]);

  const toggle = (task: Task) => {
    queue.current = queue.current.then(async () => {
      try {
        await pendingWrite(task.path);
        const disk = await window.api.read(task.path);
        // A nota pode ter mudado desde a listagem: só grava se a linha ainda for esta tarefa; senão, só relê.
        const same = extractTasks(task.path, disk).some((now) => now.line === task.line && now.text === task.text && now.done === task.done);
        const next = same ? toggleTaskLine(disk, task.line) : disk;
        if (same) await trackWrite(task.path, window.api.write(task.path, next));
        onSaved(task.path, next);
        setProblem('');
      } catch {
        setProblem(t('tasks.error', { path: task.path }));
      }
    });
  };

  const slash = { key: <Kbd>/</Kbd> };

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 pb-24 pt-10 text-[13px]">
      <header className="flex items-baseline gap-3">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-frost-100">{t('nav.tasks')}</h1>
        <span className="font-mono text-[12px] tabular-nums text-sheen-300">{t('tasks.openCount', { count: openCount })}</span>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex gap-1" role="group" aria-label={t('tasks.filter')}>
          {FILTERS.map((key) => (
            <button
              key={key}
              className={`rounded-md px-2.5 py-1 text-[12.5px] ${
                key === filter ? 'bg-[var(--hover-strong)] text-frost-100' : 'text-frost-500 hover:bg-[var(--hover)] hover:text-frost-300'
              }`}
              aria-pressed={key === filter}
              onClick={() => setFilter(key)}
            >
              {t(`tasks.filter.${key}`)}
            </button>
          ))}
        </div>
        <label className="flex min-w-40 flex-1 items-center gap-2 rounded-md bg-obsidian-950/60 px-2.5 ring-1 ring-[var(--hairline-strong)] focus-within:ring-sheen-400">
          <SearchIcon size={14} className="shrink-0 text-frost-500" />
          <input
            className="w-full bg-transparent py-1.5 text-[12.5px] text-frost-100 caret-sheen-400 outline-none placeholder:text-frost-500"
            placeholder={t('tasks.searchPlaceholder')}
            aria-label={t('tasks.searchPlaceholder')}
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {problem && (
        <p className="mt-3 text-[12.5px] text-danger" role="alert">
          {problem}
        </p>
      )}

      {groups.map(({ note, tasks }) => (
        <section key={note.path} className="mt-6">
          <h2>
            <button
              className="row w-full px-2 text-left"
              title={note.path}
              aria-label={t('tasks.openNote', { name: note.name })}
              onClick={(event) => onOpen(note.path, event.ctrlKey || event.metaKey)}
              onAuxClick={(event) => event.button === 1 && onOpen(note.path, true)}
            >
              <PageIcon size={14} className="row-icon" />
              <span className="truncate font-medium text-frost-100">{note.name}</span>
              <span className="section-label ml-auto tabular-nums">{tasks.length}</span>
            </button>
          </h2>
          <ul className="ml-[14px] mt-0.5 border-l border-(--hairline) pl-2">
            {tasks.map((task) => (
              <li key={task.line}>
                <label className="row cursor-pointer items-start px-2 py-1.5">
                  <input type="checkbox" className="mt-[3px] size-3.5 shrink-0 accent-[#4fbfb4]" checked={task.done} onChange={() => toggle(task)} />
                  <span className={`min-w-0 break-words leading-snug ${task.done ? 'text-frost-500 line-through' : ''}`}>{task.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {!groups.length && (
        <p className="mt-8 px-2 leading-relaxed text-frost-500">
          {query.trim() ? (
            t('tasks.noMatch')
          ) : filter === 'done' ? (
            t('tasks.emptyDone')
          ) : (
            <Trans k={filter === 'open' ? 'tasks.emptyOpen' : 'tasks.emptyAll'} values={slash} />
          )}
        </p>
      )}
    </div>
  );
}
