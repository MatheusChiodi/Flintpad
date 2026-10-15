import { useMemo, useState, type ReactNode } from 'react';

import { greetingFor, tipIndex, vaultStats } from '../lib/home';
import { useLanguage, useT, type Key } from '../lib/i18n';
import type { Note } from '../types';
import { CalendarIcon, CloseIcon, GraphIcon, Kbd, Mark, NewPageIcon, PageIcon, SearchIcon, StarIcon, TasksIcon, WhiteboardIcon } from './Icons';

const TIP_COUNT = 10;
const MAX_LISTED = 6;

export type HomeActions = {
  search: () => void;
  create: () => void;
  daily: () => void;
  graph: () => void;
  tasks: () => void;
  whiteboards: () => void;
  random: () => void;
  template: () => void;
};

type Props = {
  notes: Note[];
  contents: Record<string, string>;
  tagCount: number;
  favorites: Note[];
  recents: Note[];
  actions: HomeActions;
  onOpen: (path: string, newTab: boolean) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecents: () => void;
  onStarter: () => void;
  showTips: boolean;
  onHideTips: () => void;
};

// Tela inicial (nenhuma página aberta): saudação, números do vault, atalhos de partida,
// favoritos, recentes e a dica do dia. Com o vault vazio, oferece páginas de exemplo.
export function Home(props: Props) {
  const { notes, contents, tagCount, favorites, recents, actions, onOpen } = props;
  const t = useT();
  const { language } = useLanguage();
  const [tipOffset, setTipOffset] = useState(0);
  const now = new Date();
  const stats = useMemo(() => vaultStats(notes, contents, tagCount), [notes, contents, tagCount]);
  const date = new Intl.DateTimeFormat(language, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const tip = `home.tip.${tipIndex(now, TIP_COUNT, tipOffset) + 1}` as Key;
  const number = new Intl.NumberFormat(language);
  // O número sai formatado na língua (1.234 / 1,234); o plural continua certo porque só "1" é singular.
  const count = (key: Key, value: number) => t(key, { count: number.format(value) });

  const tiles: [label: string, icon: ReactNode, keys: string | undefined, run: () => void, enabled?: boolean][] = [
    [t('empty.search'), <SearchIcon />, 'Ctrl P', actions.search],
    [t('empty.create'), <NewPageIcon />, 'Ctrl N', actions.create],
    [t('home.action.daily'), <CalendarIcon />, 'Ctrl D', actions.daily],
    [t('empty.graph'), <GraphIcon />, 'Ctrl G', actions.graph],
    [t('home.action.tasks'), <TasksIcon />, 'Ctrl Shift J', actions.tasks],
    [t('home.action.whiteboards'), <WhiteboardIcon />, 'Ctrl Shift B', actions.whiteboards],
    [t('home.action.template'), <PageIcon />, undefined, actions.template],
    [t('home.action.random'), <PageIcon />, undefined, actions.random, notes.length > 0],
  ];

  const list = (items: Note[], removable: boolean) =>
    items.slice(0, MAX_LISTED).map((note) => (
      <li key={note.path} className="home-item relative">
        <button className="row w-full px-2 pr-8 text-left text-[13px]" title={note.path} onClick={(event) => onOpen(note.path, event.ctrlKey || event.metaKey)}>
          <PageIcon size={14} className="row-icon" />
          <span className="truncate">{note.name}</span>
          {note.path.includes('/') && <span className="ml-auto truncate pl-2 font-mono text-[10.5px] text-frost-500">{note.path.slice(0, note.path.lastIndexOf('/'))}</span>}
        </button>
        {removable && (
          <button
            className="icon-button home-item-remove absolute right-1 top-1/2 -translate-y-1/2"
            title={t('home.recents.remove', { name: note.name })}
            aria-label={t('home.recents.remove', { name: note.name })}
            onClick={() => props.onRemoveRecent(note.path)}
          >
            <CloseIcon size={11} />
          </button>
        )}
      </li>
    ));

  return (
    <div className="home h-full overflow-y-auto px-6 py-10">
      <div className="stagger mx-auto flex w-full max-w-[680px] flex-col">
        <header className="flex items-center gap-4">
          <Mark size={36} className="shrink-0 opacity-90" />
          <div className="min-w-0">
            <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-frost-100">{t(`home.greeting.${greetingFor(now.getHours())}`)}</h1>
            <p className="mt-0.5 text-[13px] text-frost-500 first-letter:uppercase">{date}</p>
          </div>
        </header>

        <p className="home-stats mt-5" aria-label={t('home.stats.label')}>
          <span>{count('home.stats.pages', stats.pages)}</span>
          {stats.folders > 0 && <span>{count('home.stats.folders', stats.folders)}</span>}
          {stats.openTasks > 0 && (
            <button className="home-stat-link" onClick={actions.tasks}>
              {count('home.stats.tasks', stats.openTasks)}
            </button>
          )}
          {stats.tags > 0 && <span>{count('home.stats.tags', stats.tags)}</span>}
          {stats.words > 0 && <span>{count('home.stats.words', stats.words)}</span>}
        </p>

        {notes.length === 0 && (
          <section className="home-card mt-6" aria-labelledby="home-empty-title">
            <h2 id="home-empty-title" className="font-display text-[17px] font-semibold text-frost-100">
              {t('home.emptyVault.title')}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-frost-300">{t('home.emptyVault.body')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="button-primary h-9! text-[13px]" onClick={props.onStarter}>
                {t('home.emptyVault.starter')}
              </button>
              <button className="button-quiet h-9!" onClick={actions.create}>
                <NewPageIcon size={14} />
                {t('home.emptyVault.blank')}
              </button>
            </div>
          </section>
        )}

        <section className="mt-8" aria-labelledby="home-start">
          <h2 id="home-start" className="section-label pb-2.5">
            {t('home.start')}
          </h2>
          <div className="home-tiles">
            {tiles
              .filter(([, , , , enabled]) => enabled !== false)
              .map(([label, icon, keys, run]) => (
                <button key={label} className="home-tile" onClick={run}>
                  <span className="home-tile-icon">{icon}</span>
                  <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                  {keys && <Kbd>{keys}</Kbd>}
                </button>
              ))}
          </div>
        </section>

        {notes.length > 0 && (
          <div className="mt-8 grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
            <section aria-labelledby="home-favorites">
              <h2 id="home-favorites" className="section-label flex items-center gap-1.5 px-2 pb-1.5">
                <StarIcon size={11} filled />
                {t('favorites.title')}
              </h2>
              {favorites.length ? <ul className="flex flex-col gap-px">{list(favorites, false)}</ul> : <p className="px-2 py-1 text-[12.5px] text-frost-500">{t('home.favorites.empty')}</p>}
            </section>
            <section aria-labelledby="home-recents">
              <div className="flex items-center justify-between px-2 pb-1.5">
                <h2 id="home-recents" className="section-label">
                  {t('recents.title')}
                </h2>
                {recents.length > 0 && (
                  <button className="home-link" title={t('home.recents.clearLabel')} aria-label={t('home.recents.clearLabel')} onClick={props.onClearRecents}>
                    {t('home.recents.clear')}
                  </button>
                )}
              </div>
              {recents.length ? <ul className="flex flex-col gap-px">{list(recents, true)}</ul> : <p className="px-2 py-1 text-[12.5px] text-frost-500">{t('home.recents.empty')}</p>}
            </section>
          </div>
        )}

        {props.showTips && (
          <aside className="home-tip mt-9" aria-labelledby="home-tip-title">
            <div className="flex items-center gap-2">
              <h2 id="home-tip-title" className="section-label flex-1">
                {t('home.tip.title')}
              </h2>
              <button className="home-link" onClick={() => setTipOffset((value) => value + 1)}>
                {t('home.tip.next')}
              </button>
              <button className="icon-button" title={t('home.tip.hide')} aria-label={t('home.tip.hide')} onClick={props.onHideTips}>
                <CloseIcon size={11} />
              </button>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-frost-300" aria-live="polite">
              {t(tip)}
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
