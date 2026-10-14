// Resposta de uma request: corpo (formatado ou cru, com busca e filtro JSON), headers, cookies e asserções.
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../../lib/i18n';
import { formatBody, formatSize, type HttpResult } from '../../lib/request';
import { findMatches, highlightSegments, parseSetCookies, queryJson, type AssertionResult } from '../../lib/requestTools';
import { CopyIcon, NewPageIcon } from '../Icons';
import { field, iconButton, Segmented, statusColor } from './ui';

const MAX_SHOWN_CHARS = 400_000;

type Tab = 'body' | 'headers' | 'cookies' | 'tests';

const show = (value: unknown) => (value === undefined ? 'undefined' : typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value));

export function ResponsePanel({
  result,
  sending,
  assertions = [],
  onCopy,
  onSaveAsNote,
}: {
  result: HttpResult | null;
  sending: boolean;
  assertions?: AssertionResult[];
  onCopy?: (text: string) => void;
  onSaveAsNote?: () => void;
}) {
  const t = useT();
  const [chosenTab, setTab] = useState<Tab>('body');
  const [raw, setRaw] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [current, setCurrent] = useState(0);
  const bodyRef = useRef<HTMLPreElement>(null);

  const pretty = useMemo(() => (result?.ok ? formatBody(result.body, result.headers) : ''), [result]);
  const parsed = useMemo(() => {
    if (!result?.ok) return undefined;
    try {
      return { value: JSON.parse(result.body) as unknown };
    } catch {
      return undefined;
    }
  }, [result]);

  // Filtro JSON (users[0].name, $.items[*].id): mostra só o pedaço pedido.
  const filtered = useMemo((): { text: string; error?: string } | null => {
    if (!filter.trim() || !parsed) return null;
    try {
      const value = queryJson(parsed.value, filter);
      return value === undefined ? { text: '', error: t('requests.response.filterEmpty') } : { text: JSON.stringify(value, null, 2) };
    } catch {
      return { text: '', error: t('requests.response.filterInvalid') };
    }
  }, [filter, parsed, t]);

  const shown = (filtered ? filtered.text : raw ? (result?.ok ? result.body : '') : pretty).slice(0, MAX_SHOWN_CHARS);
  const matches = useMemo(() => findMatches(shown, search), [shown, search]);
  const segments = useMemo(() => (search && matches.length ? highlightSegments(shown, search) : null), [shown, search, matches.length]);
  const cookies = useMemo(() => (result?.ok ? parseSetCookies(result.headers) : []), [result]);

  useEffect(() => setCurrent(0), [search, shown]);
  useEffect(() => {
    bodyRef.current?.querySelector(`[data-match="${current}"]`)?.scrollIntoView({ block: 'center' });
  }, [current, segments]);

  if (sending)
    return (
      <p className="p-4 text-frost-500" role="status">
        {t('requests.response.sending')}
      </p>
    );
  if (!result) return <p className="p-4 text-frost-500">{t('requests.response.idle')}</p>;

  // Sem asserções a aba Testes some; se era ela a aberta, volta para o corpo.
  const tab: Tab = chosenTab === 'tests' && !assertions.length ? 'body' : chosenTab;
  const passed = assertions.filter((a) => a.pass).length;
  const testsLabel = assertions.length ? t('requests.response.testsCount', { passed, total: assertions.length }) : t('requests.response.tests');
  const testsTab = assertions.length ? ([['tests', testsLabel]] as const) : [];

  if (!result.ok) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4" role="alert">
        <p className="font-medium text-danger">{result.cancelled ? t('requests.response.cancelled') : t('requests.response.failed')}</p>
        {!result.cancelled && <p className="mt-1 font-mono text-[12.5px] text-frost-300 select-text">{result.error}</p>}
        {!result.cancelled && <p className="mt-3 text-[12.5px] text-frost-500">{t('requests.response.failedHint')}</p>}
      </div>
    );
  }

  let index = -1;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <Segmented
          label={t('requests.response.label')}
          value={tab}
          onChange={setTab}
          options={
            [
              ['body', t('requests.tab.body')],
              ['headers', t('requests.tabCount', { label: t('requests.tab.headers'), count: result.headers.length })],
              ['cookies', cookies.length ? t('requests.tabCount', { label: t('requests.response.cookies'), count: cookies.length }) : t('requests.response.cookies')],
              ...testsTab,
            ] as const
          }
        />
        <span className="ml-auto flex items-center gap-3">
          {assertions.length > 0 && (
            <span className={`font-mono text-[12px] ${passed === assertions.length ? 'text-sheen-300' : 'text-danger'}`}>{testsLabel}</span>
          )}
          <span className="font-mono text-[12.5px] font-semibold" role="status" style={{ color: statusColor(result.status) }}>
            {result.status} {result.statusText}
          </span>
          <span className="font-mono text-[12px] text-frost-500">{result.time} ms</span>
          <span className="font-mono text-[12px] text-frost-500">{formatSize(result.size)}</span>
        </span>
      </div>

      {tab === 'body' && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
          <Segmented
            label={t('requests.response.format')}
            value={raw ? 'raw' : 'pretty'}
            onChange={(mode) => setRaw(mode === 'raw')}
            options={[
              ['pretty', t('requests.response.pretty')],
              ['raw', t('requests.response.raw')],
            ]}
          />
          <input
            className={`${field} w-44 font-sans max-[900px]:w-32`}
            type="search"
            value={search}
            placeholder={t('requests.response.search')}
            aria-label={t('requests.response.search')}
            spellCheck={false}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches.length) {
                event.preventDefault();
                setCurrent((at) => (at + (event.shiftKey ? matches.length - 1 : 1)) % matches.length);
              } else if (event.key === 'Escape') setSearch('');
            }}
          />
          {search && (
            <span className="font-mono text-[11.5px] text-frost-500" aria-live="polite">
              {matches.length ? t('requests.response.matchOf', { current: current + 1, total: matches.length }) : t('requests.response.noMatch')}
            </span>
          )}
          {parsed && (
            <input
              className={`${field} w-48 max-[900px]:w-36`}
              value={filter}
              placeholder={t('requests.response.filter')}
              aria-label={t('requests.response.filter')}
              title={t('requests.response.filterHelp')}
              spellCheck={false}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setFilter('')}
            />
          )}
          <span className="flex-1" />
          {onCopy && (
            <button type="button" className={iconButton} title={t('requests.response.copy')} aria-label={t('requests.response.copy')} onClick={() => onCopy(shown)}>
              <CopyIcon size={14} />
            </button>
          )}
          {onSaveAsNote && (
            <button type="button" className={iconButton} title={t('requests.response.saveNote')} aria-label={t('requests.response.saveNote')} onClick={onSaveAsNote}>
              <NewPageIcon size={14} />
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {tab === 'body' &&
          (filtered?.error ? (
            <p className="text-frost-500">{filtered.error}</p>
          ) : (
            <>
              <pre ref={bodyRef} className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-frost-100 select-text">
                {segments
                  ? segments.map((segment, i) => {
                      if (!segment.match) return segment.text;
                      index++;
                      return (
                        <mark key={i} data-match={index} className={`rounded-sm text-obsidian-950 ${index === current ? 'bg-sheen-300' : 'bg-[#e6c07b]/70'}`}>
                          {segment.text}
                        </mark>
                      );
                    })
                  : shown || <span className="text-frost-500">{t('requests.response.noBody')}</span>}
              </pre>
              {(pretty.length > MAX_SHOWN_CHARS || result.truncated) && <p className="mt-2 text-frost-500">{t('requests.response.truncated')}</p>}
            </>
          ))}
        {tab === 'headers' && (
          <table className="w-full font-mono text-[12.5px]">
            <tbody>
              {result.headers.map(([name, value], i) => (
                <tr key={i} className="align-top">
                  <td className="py-0.5 pr-4 text-sheen-300">{name}</td>
                  <td className="break-all py-0.5 text-frost-100 select-text">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'cookies' &&
          (cookies.length ? (
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[11px] text-frost-500">
                <tr>
                  <th className="py-1 pr-4 font-medium">{t('requests.cookie.name')}</th>
                  <th className="py-1 pr-4 font-medium">{t('common.value')}</th>
                  <th className="py-1 pr-4 font-medium">{t('requests.cookie.attributes')}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {cookies.map((cookie, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-0.5 pr-4 text-sheen-300">{cookie.name}</td>
                    <td className="break-all py-0.5 pr-4 text-frost-100 select-text">{cookie.value}</td>
                    <td className="py-0.5 text-[11.5px] text-frost-500">
                      {[
                        cookie.domain && `Domain=${cookie.domain}`,
                        cookie.path && `Path=${cookie.path}`,
                        cookie.expires && `Expires=${cookie.expires}`,
                        cookie.maxAge && `Max-Age=${cookie.maxAge}`,
                        cookie.sameSite && `SameSite=${cookie.sameSite}`,
                        cookie.httpOnly && 'HttpOnly',
                        cookie.secure && 'Secure',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-frost-500">{t('requests.response.noCookies')}</p>
          ))}
        {tab === 'tests' && (
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {assertions.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`mt-px w-10 shrink-0 font-mono text-[11px] font-semibold ${a.pass ? 'text-sheen-300' : 'text-danger'}`}>
                  {a.pass ? t('requests.assert.pass') : t('requests.assert.fail')}
                </span>
                <span className="min-w-0 flex-1 font-mono">
                  <span className="text-frost-100">{a.name}</span> <span className="text-frost-300">{a.operator}</span> <span className="text-frost-100">{a.expected}</span>
                  {!a.pass && (
                    <span className="block text-[11.5px] text-frost-500">
                      {a.error === 'target'
                        ? t('requests.assert.badTarget')
                        : a.error === 'expected'
                          ? t('requests.assert.badExpected')
                          : a.error === 'request'
                            ? t('requests.assert.noResponse')
                            : t('requests.assert.actual', { value: show(a.actual).slice(0, 300) })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
