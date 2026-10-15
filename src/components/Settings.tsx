import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { vaultStats } from '../lib/home';
import { LANGUAGES, useLanguage, useT, type Key } from '../lib/i18n';
import { ACCENT_TONES, ACCENTS, FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN, MOTIONS, STARTUPS } from '../lib/prefs';
import { usePrefs } from '../lib/prefsContext';
import { matchesSetting } from '../lib/settingsSearch';
import type { AppInfo, Note, RecentVault } from '../types';
import { ChevronIcon, CloseIcon, FolderIcon, InfoIcon, Kbd, KeyboardIcon, PageIcon, PaletteIcon, SearchIcon, SettingsIcon } from './Icons';

export const SETTINGS_SECTIONS = ['general', 'appearance', 'editor', 'vault', 'shortcuts', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

// Um ícone por seção, como na barra de seções do VS Code e do Notion.
const SECTION_ICONS: Record<SettingsSection, (props: { size?: number; className?: string }) => ReactNode> = {
  general: SettingsIcon,
  appearance: PaletteIcon,
  editor: PageIcon,
  vault: FolderIcon,
  shortcuts: KeyboardIcon,
  about: InfoIcon,
};

export type Shortcut = { label: string; keys: string };

type Props = {
  vault: string | null;
  notes: Note[];
  contents: Record<string, string>;
  tagCount: number;
  folders: string[];
  newNoteFolder: string;
  onNewNoteFolder: (folder: string) => void;
  shortcuts: Shortcut[];
  onChooseVault: () => void;
  onOpenVault: (folder: string) => void;
  onNotify: (kind: 'ok' | 'error', text: string, detail?: string) => void;
  onClose: () => void;
  initialSection?: SettingsSection;
};

type Row = { section: SettingsSection; id: string; title: string; desc?: string; control?: ReactNode; wide?: boolean; compact?: boolean; keys?: string };

export function Settings(props: Props) {
  const { vault, onClose } = props;
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const { prefs, setPrefs, resetPrefs } = usePrefs();
  const [section, setSection] = useState<SettingsSection>(props.initialSection ?? 'general');
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<RecentVault[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // Esc limpa a busca antes de fechar (como nas configurações do VS Code).
  const escape = useRef(() => {});
  escape.current = () => (query ? setQuery('') : onClose());

  useEffect(() => {
    // Ao fechar, o foco volta para onde estava (o botão da barra lateral, o editor…).
    const previous = document.activeElement as HTMLElement | null;
    search.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      escape.current();
    };
    window.addEventListener('keydown', onKey);
    void window.api
      .recentVaults()
      .then(setRecents)
      .catch(() => setRecents([]));
    void window.api
      .appInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  const stats = useMemo(() => (vault ? vaultStats(props.notes, props.contents, props.tagCount) : null), [vault, props.notes, props.contents, props.tagCount]);

  // Diálogo modal: Tab e Shift+Tab circulam só pelos controles dele.
  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]')].filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0,
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Grupo de rádio: as setas trocam a opção e levam o foco junto.
  const radioArrows =
    <T extends string>(values: readonly T[], current: T, choose: (value: T) => void) =>
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = values[(values.indexOf(current) + step + values.length) % values.length];
      choose(next);
      event.currentTarget.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
    };

  const onNavKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = SETTINGS_SECTIONS[(SETTINGS_SECTIONS.indexOf(section) + step + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length];
    setSection(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-section="${next}"]`)?.focus();
  };

  const reveal = (which: 'vault' | 'data') => window.api.revealVault(which).catch((error) => props.onNotify('error', t('settings.revealFailed'), String(error?.message ?? error)));

  const toggle = (on: boolean, change: (value: boolean) => void, label: string) => (
    <button className="settings-switch" role="switch" aria-checked={on} aria-label={label} onClick={() => change(!on)}>
      <span className="settings-switch-knob" />
      <span className="sr-only">{on ? t('settings.on') : t('settings.off')}</span>
    </button>
  );

  // Lista suspensa com a seta do app (a nativa destoa do vidro).
  const selectBox = (control: ReactNode) => (
    <span className="settings-select-wrap">
      {control}
      <ChevronIcon size={12} className="settings-select-caret" />
    </span>
  );

  const select = <T extends string>(value: T, options: readonly T[], label: (value: T) => string, change: (value: T) => void, aria: string) =>
    selectBox(
      <select className="settings-select" value={value} aria-label={aria} onChange={(event) => change(event.target.value as T)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {label(option)}
          </option>
        ))}
      </select>,
    );

  const otherVaults = recents.filter((item) => item.path !== vault);
  const infoLines = info
    ? [
        [t('settings.about.version'), info.version],
        ['Electron', info.electron],
        ['Chromium', info.chrome],
        ['Node.js', info.node],
        ['OS', info.platform],
      ]
    : [];

  const rows: Row[] = [
    {
      section: 'general',
      id: 'language',
      title: t('settings.language'),
      desc: t('settings.language.desc'),
      control: (
        <div className="settings-segmented" role="radiogroup" aria-label={t('settings.language')} onKeyDown={radioArrows(LANGUAGES.map(([code]) => code), language, setLanguage)}>
          {LANGUAGES.map(([code, name]) => (
            <button key={code} role="radio" aria-checked={code === language} tabIndex={code === language ? 0 : -1} data-value={code} lang={code} onClick={() => setLanguage(code)}>
              {name}
            </button>
          ))}
        </div>
      ),
    },
    {
      section: 'general',
      id: 'startup',
      title: t('settings.startup'),
      desc: t('settings.startup.desc'),
      control: select(prefs.startup, STARTUPS, (value) => t(`settings.startup.${value}`), (startup) => setPrefs({ startup }), t('settings.startup')),
    },
    ...(vault
      ? [
          {
            section: 'general' as const,
            id: 'new-folder',
            title: t('settings.newFolder'),
            desc: t('settings.newFolder.desc'),
            control: selectBox(
              <select className="settings-select" value={props.newNoteFolder} aria-label={t('settings.newFolder')} onChange={(event) => props.onNewNoteFolder(event.target.value)}>
                {(props.folders.includes(props.newNoteFolder) ? props.folders : [...props.folders, props.newNoteFolder]).map((folder) => (
                  <option key={folder} value={folder}>
                    {folder ? folder.replace(/\/$/, '') : t('move.root')}
                  </option>
                ))}
              </select>,
            ),
          },
        ]
      : []),
    { section: 'general', id: 'tips', title: t('settings.tips'), desc: t('settings.tips.desc'), control: toggle(prefs.tips, (tips) => setPrefs({ tips }), t('settings.tips')) },
    {
      section: 'general',
      id: 'reset',
      title: t('settings.reset'),
      desc: t('settings.reset.desc'),
      control: (
        <button
          className="button-quiet"
          onClick={() => {
            resetPrefs();
            props.onNotify('ok', t('settings.reset.done'));
          }}
        >
          {t('settings.reset')}
        </button>
      ),
    },
    {
      section: 'appearance',
      id: 'accent',
      title: t('settings.accent'),
      desc: t('settings.accent.desc'),
      control: (
        <div className="flex gap-1.5" role="radiogroup" aria-label={t('settings.accent')} onKeyDown={radioArrows(ACCENTS, prefs.accent, (accent) => setPrefs({ accent }))}>
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              className="settings-swatch"
              role="radio"
              aria-checked={accent === prefs.accent}
              aria-label={t(`settings.accent.${accent}`)}
              title={t(`settings.accent.${accent}`)}
              tabIndex={accent === prefs.accent ? 0 : -1}
              data-value={accent}
              style={{ '--swatch': ACCENT_TONES[accent][400] } as React.CSSProperties}
              onClick={() => setPrefs({ accent })}
            />
          ))}
        </div>
      ),
    },
    {
      section: 'appearance',
      id: 'motion',
      title: t('settings.motion'),
      desc: t('settings.motion.desc'),
      control: select(prefs.motion, MOTIONS, (value) => t(`settings.motion.${value}`), (motion) => setPrefs({ motion }), t('settings.motion')),
    },
    {
      section: 'editor',
      id: 'font-size',
      title: t('settings.fontSize'),
      desc: t('settings.fontSize.desc'),
      control: (
        <div className="flex items-center gap-1">
          <button className="settings-step" aria-label={t('settings.fontSize.smaller')} title={t('settings.fontSize.smaller')} disabled={prefs.editorFontSize <= FONT_SIZE_MIN} onClick={() => setPrefs({ editorFontSize: prefs.editorFontSize - 0.5 })}>
            −
          </button>
          <output className="w-12 text-center font-mono text-[12px] text-frost-100" aria-live="polite">
            {prefs.editorFontSize}px
          </output>
          <button className="settings-step" aria-label={t('settings.fontSize.larger')} title={t('settings.fontSize.larger')} disabled={prefs.editorFontSize >= FONT_SIZE_MAX} onClick={() => setPrefs({ editorFontSize: prefs.editorFontSize + 0.5 })}>
            +
          </button>
          <button className="button-quiet ml-1" disabled={prefs.editorFontSize === FONT_SIZE_DEFAULT} onClick={() => setPrefs({ editorFontSize: FONT_SIZE_DEFAULT })}>
            {t('settings.fontSize.reset')}
          </button>
        </div>
      ),
    },
    {
      section: 'editor',
      id: 'spellcheck',
      title: t('settings.spellcheck'),
      desc: t('settings.spellcheck.desc'),
      control: toggle(prefs.spellcheck, (spellcheck) => setPrefs({ spellcheck }), t('settings.spellcheck')),
    },
    {
      section: 'vault',
      id: 'vault-path',
      title: t('settings.vault.path'),
      desc: vault ?? t('settings.noVault'),
      control: (
        <div className="flex flex-wrap justify-end gap-1.5">
          {vault && (
            <button className="button-quiet" onClick={() => void reveal('vault')}>
              {t('settings.vault.reveal')}
            </button>
          )}
          <button className="button-quiet" onClick={props.onChooseVault}>
            <FolderIcon size={13} />
            {vault ? t('settings.changeVault') : t('welcome.choose')}
          </button>
        </div>
      ),
    },
    ...(stats
      ? [
          {
            section: 'vault' as const,
            id: 'vault-stats',
            title: t('settings.vault.stats'),
            desc: [
              t('home.stats.pages', { count: stats.pages }),
              t('home.stats.folders', { count: stats.folders }),
              t('home.stats.tasks', { count: stats.openTasks }),
              t('home.stats.tags', { count: stats.tags }),
              t('home.stats.words', { count: new Intl.NumberFormat(language).format(stats.words) }),
            ].join(' · '),
          },
        ]
      : []),
    {
      section: 'vault',
      id: 'vault-recent',
      title: t('settings.vault.recent'),
      desc: t('settings.vault.recent.desc'),
      wide: true,
      control: otherVaults.length ? (
        <ul className="flex flex-col gap-px">
          {otherVaults.map((item) => (
            <li key={item.path}>
              <button
                className="row w-full px-2 text-left"
                disabled={!item.exists}
                title={item.path}
                aria-label={t('welcome.recent.open', { name: item.name })}
                onClick={() => props.onOpenVault(item.path)}
              >
                <FolderIcon size={13} className="row-icon" />
                <span className={`text-[13px] ${item.exists ? '' : 'text-frost-500 line-through'}`}>{item.name}</span>
                <span className="path-tail ml-auto pl-3 font-mono text-[10.5px] text-frost-500">
                  <bdi>{item.exists ? item.path : t('welcome.recent.missing')}</bdi>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-frost-500">{t('settings.vault.noRecent')}</p>
      ),
    },
    ...props.shortcuts.map((shortcut) => ({
      section: 'shortcuts' as const,
      id: `key:${shortcut.label}`,
      title: shortcut.label,
      // As teclas entram na busca: "ctrl shift" acha os atalhos com essas teclas.
      keys: shortcut.keys,
      compact: true,
      control: <Kbd>{shortcut.keys}</Kbd>,
    })),
    {
      section: 'about',
      id: 'about',
      title: 'ObNotion',
      desc: t('settings.about.privacy'),
      wide: true,
      control: (
        <div className="flex flex-col gap-2">
          <dl className="settings-info">
            {infoLines.map(([label, value]) => (
              <div key={label} className="contents">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {info && (
            <button
              className="button-quiet self-start"
              onClick={() =>
                void navigator.clipboard
                  .writeText(infoLines.map(([label, value]) => `${label}: ${value}`).join('\n'))
                  .then(() => props.onNotify('ok', t('settings.about.copied')))
              }
            >
              {t('settings.about.copy')}
            </button>
          )}
        </div>
      ),
    },
    {
      section: 'about',
      id: 'data',
      title: t('settings.about.data'),
      desc: `${t('settings.about.data.desc')} ${info?.dataPath ?? ''}`.trim(),
      control: (
        <button className="button-quiet" onClick={() => void reveal('data')}>
          {t('settings.openFolder')}
        </button>
      ),
    },
  ];

  const searching = query.trim().length > 0;
  const sectionTitle = (name: SettingsSection) => t(`settings.section.${name}` as Key);
  const visible = searching ? rows.filter((row) => matchesSetting(query, [row.title, row.desc ?? '', row.keys ?? '', sectionTitle(row.section)])) : rows.filter((row) => row.section === section);
  // Na busca, os resultados aparecem agrupados pela seção de origem.
  const groups = SETTINGS_SECTIONS.map((name) => ({ name, rows: visible.filter((row) => row.section === name) })).filter((group) => group.rows.length);

  return (
    <div className="scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[min(96px,10vh)]" onMouseDown={onClose}>
      <div
        ref={dialog}
        className="palette settings flex w-[800px] max-w-full flex-col overflow-hidden rounded-xl outline-none"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <div className="flex items-center gap-3 border-b border-(--hairline) px-4 py-3">
          <SettingsIcon size={18} className="shrink-0 text-frost-500" />
          <h2 className="text-[15px] text-frost-100">{t('settings.title')}</h2>
          <label className="settings-search ml-auto">
            <SearchIcon size={13} className="shrink-0 text-frost-500" />
            <input
              ref={search}
              type="search"
              value={query}
              placeholder={t('settings.search')}
              aria-label={t('settings.search')}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button className="icon-button" aria-label={t('switcher.close')} title={`${t('switcher.close')} (Esc)`} onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="settings-body flex min-h-0 flex-1">
          <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label={t('settings.sections')} onKeyDown={onNavKey}>
            {SETTINGS_SECTIONS.map((name) => (
              <button
                key={name}
                role="tab"
                className="row px-2.5 text-left text-[13px]"
                aria-selected={!searching && name === section}
                data-active={!searching && name === section}
                tabIndex={name === section ? 0 : -1}
                data-section={name}
                onClick={() => {
                  setQuery('');
                  setSection(name);
                }}
              >
                <SectionIcon name={name} />
                {sectionTitle(name)}
              </button>
            ))}
          </nav>

          <div className="settings-content min-w-0 flex-1 overflow-y-auto px-5 pb-6" role={searching ? 'region' : 'tabpanel'} aria-label={searching ? t('settings.search') : sectionTitle(section)}>
            {searching && groups.length > 0 && (
              <p className="settings-count" aria-live="polite">
                {t('settings.results', { count: visible.length })}
              </p>
            )}
            {groups.length === 0 && (
              <div className="settings-empty" role="status">
                <span className="board-seal" aria-hidden="true">
                  <SearchIcon size={22} />
                </span>
                <p className="text-[13px] text-frost-300">{t('settings.noMatch')}</p>
                <p className="max-w-full truncate font-mono text-[11.5px] text-frost-500">“{query.trim()}”</p>
                <button
                  className="button-quiet"
                  onClick={() => {
                    setQuery('');
                    search.current?.focus();
                  }}
                >
                  {t('settings.clearSearch')}
                </button>
              </div>
            )}
            {groups.map((group) => (
              <section key={group.name}>
                {searching ? (
                  <h3 className="section-label flex items-center gap-1.5 pb-1 pt-5">
                    <SectionIcon name={group.name} size={11} />
                    {sectionTitle(group.name)}
                  </h3>
                ) : (
                  // Fora da busca a seção já está marcada na barra: o título vira o cabeçalho da página.
                  <h3 className="settings-heading">{sectionTitle(group.name)}</h3>
                )}
                {group.name === 'shortcuts' && <p className="pb-1 pt-1.5 text-[12px] text-frost-500">{t('settings.shortcuts.desc')}</p>}
                {group.rows.map((row) => (
                  <div key={row.id} className="settings-row" data-wide={row.wide || undefined} data-compact={row.compact || undefined}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-frost-100">{row.title}</div>
                      {row.desc && <div className="mt-0.5 break-words text-[12px] leading-snug text-frost-500">{row.desc}</div>}
                    </div>
                    {row.control && <div className="settings-control">{row.control}</div>}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionIcon({ name, size = 14 }: { name: SettingsSection; size?: number }) {
  const Glyph = SECTION_ICONS[name];
  return <Glyph size={size} className="settings-nav-icon shrink-0" />;
}
