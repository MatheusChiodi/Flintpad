// Gera o código da request aberta (cURL, fetch, Python, HTTP cru) com as variáveis do ambiente aplicadas.
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../../lib/i18n';
import { buildRequest, type BruRequest } from '../../lib/request';
import { SNIPPET_LANGUAGES, toSnippet, type SnippetLanguage } from '../../lib/requestTools';
import { CopyIcon } from '../Icons';
import { ghostButton, Segmented } from './ui';

const LANGUAGE_KEY = 'obnotion:requests-snippet';
const LABELS: Record<SnippetLanguage, string> = { curl: 'cURL', fetch: 'JavaScript fetch', python: 'Python requests', http: 'HTTP' };

function storedLanguage(): SnippetLanguage {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY) as SnippetLanguage | null;
    return value && SNIPPET_LANGUAGES.includes(value) ? value : 'curl';
  } catch {
    return 'curl';
  }
}

export function CodeDialog({ request, vars, onClose, onCopied }: { request: BruRequest; vars: Record<string, string>; onClose: () => void; onCopied: () => void }) {
  const t = useT();
  const [language, setLanguage] = useState<SnippetLanguage>(storedLanguage);
  const closeRef = useRef<HTMLButtonElement>(null);

  const code = useMemo(() => {
    try {
      return { text: toSnippet(buildRequest(request, vars, 'snippet'), language) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [request, vars, language]);

  useEffect(() => closeRef.current?.focus(), []);

  const choose = (next: SnippetLanguage) => {
    setLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // sem armazenamento: só não lembra a escolha
    }
  };

  return (
    <div className="scrim absolute inset-0 z-30 flex items-start justify-center pt-16" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-code-title"
        className="flex max-h-[calc(100%-96px)] w-[min(720px,calc(100%-32px))] flex-col rounded-xl bg-obsidian-800 p-5 shadow-2xl ring-1 ring-[var(--hairline-strong)]"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <div className="flex items-center gap-3">
          <h2 id="request-code-title" className="font-display text-lg font-semibold text-frost-100">
            {t('requests.code.title')}
          </h2>
          <span className="flex-1" />
          <button ref={closeRef} type="button" className={ghostButton} onClick={onClose}>
            {t('requests.code.close')}
          </button>
        </div>
        <div className="mt-3">
          <Segmented label={t('requests.code.language')} value={language} onChange={choose} options={SNIPPET_LANGUAGES.map((key) => [key, LABELS[key]] as const)} />
        </div>
        {'error' in code ? (
          <p className="mt-4 text-[12.5px] text-danger" role="alert">
            {code.error}
          </p>
        ) : (
          <>
            <pre className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre rounded-md bg-obsidian-950/70 p-3 font-mono text-[12px] leading-relaxed text-frost-100 ring-1 ring-[var(--hairline)] select-text">
              {code.text}
            </pre>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className={`${ghostButton} inline-flex items-center gap-1.5`}
                onClick={() => {
                  void navigator.clipboard.writeText(code.text).then(onCopied);
                }}
              >
                <CopyIcon size={13} />
                {t('requests.code.copy')}
              </button>
              <span className="text-[11.5px] text-frost-500">{t('requests.code.note')}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
