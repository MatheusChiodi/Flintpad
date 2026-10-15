import { useEffect, useRef, useState } from 'react';

import { LANGUAGES, Trans, useLanguage, useT } from '../lib/i18n';
import type { RecentVault } from '../types';
import { CloseIcon, FolderIcon, GraphIcon, Kbd, Mark, PageIcon, PlusIcon, SettingsIcon } from './Icons';

type Props = {
  onChoose: () => void;
  onOpen: (folder: string) => void;
  onError: (detail?: string) => void;
  onSettings: () => void;
};

// Tela sem vault: escolher pasta, reabrir um vault recente ou soltar uma pasta na janela.
export function Welcome({ onChoose, onOpen, onError, onSettings }: Props) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const [recents, setRecents] = useState<RecentVault[]>([]);
  const [missing, setMissing] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Contagem de dragenter/dragleave: os filhos disparam os dois ao passar por cima.
  const depth = useRef(0);

  const load = () => {
    void window.api
      .recentVaults()
      .then(setRecents)
      .catch(() => setRecents([]));
    void window.api
      .missingVault()
      .then(setMissing)
      .catch(() => setMissing(null));
  };
  useEffect(load, []);

  const forget = async (folder: string) => {
    await window.api.forgetVault(folder).catch(() => {});
    load();
  };

  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    const folder = file ? window.api.pathForFile(file) : null;
    if (folder) onOpen(folder);
    else onError();
  };

  // Lista de recentes: setas sobem e descem entre os itens, como numa lista do sistema.
  const onListKey = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-recent]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    items[(index + step + items.length) % items.length]?.focus();
  };

  // O vault que está faltando já aparece no aviso: não se repete na lista.
  const others = recents.filter((item) => item.path !== missing);

  return (
    <div
      className="frame welcome relative flex h-full justify-center gap-20 overflow-y-auto px-10 py-14 [align-items:safe_center]"
      data-dragging={dragging || undefined}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        depth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={drop}
    >
      {/* Idioma e configurações no canto: dá para trocar a língua antes de escolher o vault. */}
      <div className="absolute right-4 top-3 flex items-center gap-1">
        <div className="welcome-langs" role="radiogroup" aria-label={t('welcome.language')}>
          {LANGUAGES.map(([code, name]) => (
            <button
              key={code}
              role="radio"
              aria-checked={code === language}
              lang={code}
              title={name}
              data-active={code === language}
              onClick={() => setLanguage(code)}
            >
              {code === 'pt-BR' ? 'PT' : code.toUpperCase()}
            </button>
          ))}
        </div>
        <button className="icon-button" title={`${t('settings.title')} (Ctrl ,)`} aria-label={t('settings.title')} onClick={onSettings}>
          <SettingsIcon size={15} />
        </button>
      </div>

      <div className="stagger w-full max-w-[440px]">
        <div className="flex items-center gap-2.5">
          <Mark size={26} />
          <span className="font-display text-lg font-semibold tracking-tight text-frost-100">Flintpad</span>
        </div>
        <h1 className="welcome-title mt-9 text-balance font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.025em] text-frost-100 max-[560px]:text-[34px]">
          {t('welcome.title')}
        </h1>
        <p className="welcome-lede mt-5 text-[15px] leading-relaxed text-frost-300">{t('welcome.body')}</p>

        {missing && (
          <div className="welcome-notice mt-6" role="alert">
            <p className="font-medium text-frost-100">{t('welcome.missing.title')}</p>
            <p className="path-tail mt-1 font-mono text-[11.5px] text-frost-500" title={missing}>
              <bdi>{missing}</bdi>
            </p>
            <p className="mt-1.5 text-[12.5px] text-frost-300">{t('welcome.missing.body')}</p>
            <div className="mt-3 flex gap-2">
              <button className="button-quiet" onClick={() => onOpen(missing)}>
                {t('welcome.missing.retry')}
              </button>
              <button className="button-quiet" onClick={() => void forget(missing).then(() => setMissing(null))}>
                {t('welcome.missing.forget')}
              </button>
            </div>
          </div>
        )}

        <div className="welcome-cta mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button className="button-primary" onClick={onChoose}>
            <FolderIcon />
            {t('welcome.choose')}
          </button>
          <span className="flex items-center gap-1.5 text-[12px] text-frost-500">
            <Kbd>Ctrl O</Kbd>
            {t('welcome.dropHint')}
          </span>
        </div>

        {others.length > 0 ? (
          <div className="mt-9 border-t border-(--hairline) pt-5">
            <p className="section-label flex items-center gap-2 pb-2">
              {t('welcome.recent')}
              <span className="welcome-count" aria-label={t('welcome.recent.count', { count: others.length })}>
                {others.length}
              </span>
            </p>
            <ul className="flex flex-col gap-px" onKeyDown={onListKey}>
              {others.map((item) => (
                <li key={item.path} className="group relative">
                  <button
                    data-recent
                    className="row welcome-recent w-full px-2 py-1 pr-9 text-left disabled:cursor-default"
                    title={item.path}
                    aria-label={t('welcome.recent.open', { name: item.name })}
                    onClick={() => (item.exists ? onOpen(item.path) : onError(t('welcome.recent.missing')))}
                  >
                    <FolderIcon size={14} className="row-icon" />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] ${item.exists ? '' : 'text-frost-500 line-through'}`}>{item.name}</span>
                      <span className="path-tail block font-mono text-[10.5px] text-frost-500">
                        <bdi>{item.exists ? item.path : t('welcome.recent.missing')}</bdi>
                      </span>
                    </span>
                  </button>
                  <button
                    className="icon-button welcome-forget absolute right-1.5 top-1/2 -translate-y-1/2"
                    title={t('welcome.recent.forget', { name: item.name })}
                    aria-label={t('welcome.recent.forget', { name: item.name })}
                    onClick={() => void forget(item.path)}
                  >
                    <CloseIcon size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="mt-10 flex flex-col gap-2.5 border-t border-(--hairline) pt-6 text-[13px] text-frost-500">
            <li className="flex items-center gap-2.5">
              <PageIcon className="text-sheen-400" />
              {t('welcome.feature.files')}
            </li>
            <li className="flex items-center gap-2.5">
              <GraphIcon className="text-sheen-400" />
              {t('welcome.feature.links')}
            </li>
            <li className="flex items-center gap-2.5">
              <PlusIcon className="text-sheen-400" />
              <span>
                <Trans k="welcome.feature.blocks" values={{ key: <Kbd>/</Kbd> }} />
              </span>
            </li>
          </ul>
        )}
      </div>

      {/* Amostra do produto: a folha encaixada na obsidiana. Decorativa. */}
      <div className="relative hidden w-[360px] shrink-0 min-[980px]:block" aria-hidden="true">
        <svg className="constellation absolute -left-14 -top-24 text-sheen-400" width="460" height="150" viewBox="0 0 460 150" fill="none">
          <path
            d="M96 150 150 62l96-34 104 46 62-52M150 62 60 40M350 74l-40 76M246 28l-30 122"
            stroke="currentColor"
            strokeOpacity="0.25"
            pathLength={1}
          />
          <circle cx="150" cy="62" r="6" fill="currentColor" />
          <circle cx="246" cy="28" r="4" fill="currentColor" fillOpacity="0.75" />
          <circle cx="350" cy="74" r="7.5" fill="currentColor" />
          <circle cx="412" cy="22" r="3.5" fill="currentColor" fillOpacity="0.6" />
          <circle cx="60" cy="40" r="3" fill="currentColor" fillOpacity="0.5" />
        </svg>
        <div className="welcome-sheet relative px-8 pb-9 pt-7">
          <p className="font-mono text-[10.5px] text-ink-faint">{t('welcome.sample.path')}</p>
          <p className="mt-3 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em]">{t('welcome.sample.title')}</p>
          <p className="mt-3 text-[13.5px] leading-relaxed">
            <Trans
              k="welcome.sample.body"
              values={{
                budget: <span className="wikilink">{t('welcome.sample.budget')}</span>,
                plan: <span className="wikilink">{t('welcome.sample.plan')}</span>,
              }}
            />
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-[13.5px]">
            <li className="flex items-center gap-2.5 text-ink-faint line-through">
              <span className="grid h-3.5 w-3.5 place-items-center rounded-[3px] bg-sheen-700 text-[9px] text-white no-underline">✓</span>
              {t('welcome.sample.done')}
            </li>
            <li className="flex items-center gap-2.5">
              <span className="h-3.5 w-3.5 rounded-[3px] border border-ink-faint" />
              {t('welcome.sample.todo')}
            </li>
          </ul>
        </div>
      </div>

      {dragging && (
        <div className="welcome-drop" aria-hidden="true">
          <span className="board-seal">
            <FolderIcon size={26} />
          </span>
          <span className="welcome-drop-label">{t('welcome.drop')}</span>
        </div>
      )}
    </div>
  );
}
