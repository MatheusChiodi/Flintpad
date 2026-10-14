import { useEffect, useRef } from 'react';

import { LANGUAGES, useLanguage, useT } from '../lib/i18n';
import { FolderIcon, Kbd, SettingsIcon } from './Icons';

type Props = {
  vault: string | null;
  onChooseVault: () => void;
  onClose: () => void;
};

export function Settings({ vault, onChooseVault, onClose }: Props) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="scrim fixed inset-0 z-50 flex items-start justify-center pt-24" onMouseDown={onClose}>
      <div
        ref={dialog}
        className="palette w-[560px] max-w-[90vw] overflow-hidden rounded-xl outline-none"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-(--hairline) px-4 py-3.5">
          <SettingsIcon size={18} className="shrink-0 text-frost-500" />
          <h2 className="text-[15px] text-frost-100">{t('settings.title')}</h2>
        </div>

        <div className="section-label px-4 pb-2 pt-4">{t('settings.language')}</div>
        <div className="flex flex-col gap-px px-1.5" role="radiogroup" aria-label={t('settings.language')}>
          {LANGUAGES.map(([code, name]) => (
            <button
              key={code}
              className="row w-full px-2.5 text-left text-[13px]"
              role="radio"
              aria-checked={code === language}
              data-active={code === language}
              lang={code}
              onClick={() => setLanguage(code)}
            >
              <span className="flex-1">{name}</span>
              <span className="font-mono text-[11px] text-frost-500">{code}</span>
            </button>
          ))}
        </div>

        <div className="section-label px-4 pb-2 pt-5">{t('settings.vault')}</div>
        <div className="flex items-center gap-3 px-4 pb-4">
          <FolderIcon size={14} className="shrink-0 text-frost-500" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-frost-300" title={vault ?? undefined}>
            {vault ?? t('settings.noVault')}
          </span>
          <button
            className="shrink-0 rounded-md px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] hover:bg-[var(--hover)] hover:text-frost-100"
            onClick={onChooseVault}
          >
            {vault ? t('settings.changeVault') : t('welcome.choose')}
          </button>
        </div>

        <div className="flex items-center gap-4 border-t border-(--hairline) px-4 py-2 text-[11px] text-frost-500">
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> {t('switcher.close')}
          </span>
        </div>
      </div>
    </div>
  );
}
