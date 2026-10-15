import { useEffect, useRef, useState } from 'react';

import { PlusIcon, TrashIcon } from '../components/Icons';
import { BoardEditor, type Saver } from './BoardEditor';
import { importedName } from './files.ts';
import { useWbT, type WbKey } from './i18n.ts';
import { PencilIcon, UploadIcon } from './icons';
import { emptyBoard, MAX_BOARD_BYTES, parseBoard, resolveLink, type Board, type ParseResult } from './model.ts';
import { sampleBoard } from './sample.ts';
import { createBoard, deleteBoard, listBoards, readBoard, renameBoard, type BoardEntry } from './storage.ts';

// O último quadro aberto continua escolhido quando a guia é fechada e reaberta.
let lastOpened: string | null = null;

type Loaded = { path: string; result: ParseResult | { ok: false; error: 'unreadable' } };
type Message = { kind: 'ok' | 'error'; text: string };

export type WhiteboardsProps = {
  /** Notas do vault: sugestões e destino dos links dos elementos. */
  notes?: readonly { path: string; name: string }[];
  /** Abre uma nota do vault (link de um elemento). */
  onOpenNote?: (path: string) => void;
};

export default function Whiteboards({ notes = [], onOpenNote }: WhiteboardsProps = {}) {
  const t = useWbT();
  const [boards, setBoards] = useState<BoardEntry[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const saver = useRef<Saver | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const latestBoards = useRef<BoardEntry[]>([]);
  latestBoards.current = boards ?? [];

  const fail = (error: unknown) => setMessage({ kind: 'error', text: t('error.action', { detail: error instanceof Error ? error.message : String(error) }) });

  const refresh = async () => {
    try {
      const list = await listBoards();
      setBoards(list);
      setListFailed(false);
      return list;
    } catch (error) {
      console.error('whiteboard:list', error instanceof Error ? error.message : error);
      setListFailed(true);
      setBoards((current) => current ?? []);
      return latestBoards.current;
    }
  };

  const open = async (path: string) => {
    await saver.current?.flush();
    lastOpened = path;
    setSelected(path);
    setLoaded(null);
    try {
      setLoaded({ path, result: await readBoard(path) });
    } catch {
      setLoaded({ path, result: { ok: false, error: 'unreadable' } });
    }
  };

  useEffect(() => {
    void refresh().then((list) => {
      if (lastOpened && list.some((b) => b.path === lastOpened)) void open(lastOpened);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), message.kind === 'error' ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const create = async (name: string, board: Board) => {
    try {
      await saver.current?.flush();
      const path = await createBoard(name, board, latestBoards.current);
      await refresh();
      await open(path);
      return path;
    } catch (error) {
      fail(error);
      return null;
    }
  };

  const createSample = () =>
    create(
      t('sampleName'),
      sampleBoard({
        note: t('sample.note'),
        draft: t('sample.draft'),
        review: t('sample.review'),
        approved: t('sample.approved'),
        publish: t('sample.publish'),
        fix: t('sample.fix'),
      }),
    );

  const rename = async (path: string, name: string) => {
    setRenaming(null);
    try {
      if (path === selected) await saver.current?.flush();
      const renamed = await renameBoard(path, name, latestBoards.current);
      if (renamed === path) return;
      await refresh();
      if (path === selected) await open(renamed);
    } catch (error) {
      fail(error);
    }
  };

  const remove = async (entry: BoardEntry) => {
    try {
      if (entry.path === selected) {
        // Nada pendente pode regravar o arquivo depois que ele for para a lixeira.
        saver.current?.dispose();
        setSelected(null);
        setLoaded(null);
        lastOpened = null;
      }
      await deleteBoard(entry.path);
      await refresh();
      setMessage({ kind: 'ok', text: t('trashed', { name: entry.name }) });
    } catch (error) {
      fail(error);
    }
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_BOARD_BYTES) return setMessage({ kind: 'error', text: t('error.too-large') });
    const result = parseBoard(await file.text());
    if (!result.ok) return setMessage({ kind: 'error', text: t(`error.${result.error}` as WbKey) });
    const path = await create(importedName(file.name) || t('untitled'), { ...result.board, sample: undefined });
    if (path) setMessage({ kind: 'ok', text: result.dropped ? `${t('imported')} ${t('dropped', { count: result.dropped })}` : t('imported') });
  };

  /** Link de um elemento: site abre no navegador do sistema; nota abre numa guia do app. */
  const openLink = async (link: string) => {
    const target = resolveLink(link, notes);
    if (!target) return setMessage({ kind: 'error', text: /^https?:/i.test(link) ? t('linkInvalid') : t('linkNotFound', { link }) });
    if (target.type === 'url') {
      window.open(target.url, '_blank', 'noopener');
      return;
    }
    await saver.current?.flush();
    onOpenNote?.(target.path);
  };

  const current = boards?.find((b) => b.path === selected);
  const sideButton = 'flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-frost-300 hover:bg-[var(--hover)] hover:text-frost-100';

  return (
    <div className="relative flex h-full min-h-0 text-[13px]">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--hairline)] max-[1100px]:w-52 max-[820px]:w-44">
        <div className="flex items-center gap-1 px-3 pb-2 pt-3">
          <h1 className="flex-1 truncate font-display text-[17px] font-semibold tracking-tight text-frost-100">{t('title')}</h1>
          <button className="icon-button h-7 w-7" title={t('importTitle')} aria-label={t('import')} onClick={() => fileInput.current?.click()}>
            <UploadIcon />
          </button>
          <button className="icon-button h-7 w-7" title={t('new')} aria-label={t('new')} data-testid="wb-new" onClick={() => void create(t('untitled'), emptyBoard())}>
            <PlusIcon />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file).catch(fail);
            }}
          />
        </div>

        {message && (
          <p className={`mx-3 mb-2 text-[12px] leading-snug ${message.kind === 'error' ? 'text-danger' : 'text-sheen-300'}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-testid="wb-list">
          {boards === null ? (
            <p className="px-2 py-1 text-frost-500" role="status">
              {t('loading')}
            </p>
          ) : listFailed ? (
            <div className="px-2 py-1" role="alert">
              <p className="text-danger">{t('listError')}</p>
              <button className={`${sideButton} mt-2 -ml-2`} onClick={() => void refresh()}>
                {t('retry')}
              </button>
            </div>
          ) : boards.length ? (
            boards.map((entry) =>
              renaming === entry.path ? (
                <input
                  key={entry.path}
                  className="my-0.5 w-full rounded-md bg-obsidian-950/60 px-2 py-1 text-[13px] text-frost-100 outline-none ring-1 ring-sheen-400"
                  aria-label={t('nameLabel')}
                  defaultValue={entry.name}
                  autoFocus
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => void rename(entry.path, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <div key={entry.path} className="row group pr-1" data-active={entry.path === selected}>
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 self-stretch pl-2 text-left"
                    title={entry.path}
                    aria-current={entry.path === selected ? 'page' : undefined}
                    onClick={() => void open(entry.path)}
                    onDoubleClick={() => setRenaming(entry.path)}
                    onKeyDown={(event) => {
                      if (event.key === 'F2') {
                        event.preventDefault();
                        setRenaming(entry.path);
                      }
                    }}
                  >
                    <WhiteboardGlyph />
                    <span className="truncate">{entry.name}</span>
                  </button>
                  <button className="icon-button reveal" title={t('rename')} aria-label={t('renameNamed', { name: entry.name })} onClick={() => setRenaming(entry.path)}>
                    <PencilIcon size={13} />
                  </button>
                  <button className="icon-button reveal" data-danger="true" title={t('trashNamed', { name: entry.name })} aria-label={t('trashNamed', { name: entry.name })} onClick={() => void remove(entry)}>
                    <TrashIcon size={14} />
                  </button>
                </div>
              ),
            )
          ) : (
            <div className="mx-1 mt-1 rounded-lg border border-dashed border-(--hairline-strong) px-3 py-4 leading-relaxed">
              <p className="font-medium text-frost-100">{t('emptyTitle')}</p>
              <p className="mt-1 text-[12.5px] text-frost-500">{t('emptyBody')}</p>
              <div className="mt-3 flex flex-col items-start gap-0.5">
                <button className={`${sideButton} -ml-2`} onClick={() => void create(t('untitled'), emptyBoard())}>
                  <PlusIcon size={14} />
                  {t('new')}
                </button>
                <button className={`${sideButton} -ml-2`} data-testid="wb-sample" onClick={() => void createSample()}>
                  <WhiteboardGlyph />
                  {t('sample')}
                </button>
                <button className={`${sideButton} -ml-2`} onClick={() => fileInput.current?.click()}>
                  <UploadIcon size={14} />
                  {t('import')}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-frost-500">{t('noneSelected')}</p>
            <button className="button-primary" onClick={() => void create(t('untitled'), emptyBoard())}>
              <PlusIcon />
              {t('new')}
            </button>
          </div>
        ) : !loaded || loaded.path !== selected ? (
          <p className="p-5 text-frost-500" role="status">
            {t('opening')}
          </p>
        ) : !loaded.result.ok ? (
          <div className="p-6" role="alert">
            <p className="font-medium text-frost-100">{current?.name ?? selected}</p>
            <p className="mt-1 text-danger">{t(`error.${loaded.result.error}` as WbKey)}</p>
            <p className="mt-1 text-frost-500">
              {t('error.untouched')} <span className="font-mono text-[12px]">{selected}</span>
            </p>
          </div>
        ) : (
          <BoardEditor
            key={selected}
            path={selected}
            name={current?.name ?? ''}
            initial={loaded.result.board}
            t={t}
            saver={saver}
            notes={notes}
            onOpenLink={(link) => void openLink(link)}
            onRename={(name) => void rename(selected, name)}
            banner={
              <>
                {loaded.result.board.sample && current && (
                  <div className="mx-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[rgb(124_58_237_/_0.14)] px-3 py-1.5 text-[12.5px] text-frost-100">
                    <span className="rounded bg-[rgb(124_58_237_/_0.35)] px-1.5 py-px font-mono text-[10.5px] uppercase tracking-wider">{t('sampleBadge')}</span>
                    <span className="flex-1">{t('sampleBanner')}</span>
                    <button className="rounded px-1.5 py-0.5 text-frost-300 underline-offset-2 hover:text-frost-100 hover:underline" onClick={() => void remove(current)}>
                      {t('sampleDelete')}
                    </button>
                  </div>
                )}
                {(loaded.result.migrated || loaded.result.dropped > 0) && (
                  <p className="mx-4 mb-2 text-[12.5px] text-frost-500" role="status">
                    {[loaded.result.migrated && t('migrated'), loaded.result.dropped > 0 && t('dropped', { count: loaded.result.dropped })].filter(Boolean).join(' ')}
                  </p>
                )}
              </>
            }
          />
        )}
      </section>
    </div>
  );
}

function WhiteboardGlyph() {
  return (
    <svg className="row-icon" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.75" y="2.75" width="5.5" height="4" rx="1" />
      <circle cx="11.5" cy="11.25" r="2.5" />
      <path d="M7.25 4.75h2.5a1.75 1.75 0 0 1 1.75 1.75v2.25" />
    </svg>
  );
}
