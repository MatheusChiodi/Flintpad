// Executor de pasta: envia as requests da pasta em ordem, confere as asserções e resume o resultado.
import { useEffect, useRef, useState } from 'react';

import { useT } from '../../lib/i18n';
import { buildRequest, type BruRequest, type HttpResult, type RequestSummary } from '../../lib/request';
import { evaluateAssertions, type Assertion, type AssertionResult } from '../../lib/requestTools';
import { PlayIcon } from '../Icons';
import { ghostButton, Method, primaryButton, statusColor } from './ui';

type Row = {
  path: string;
  name: string;
  method: string;
  state: 'waiting' | 'running' | 'done' | 'skipped';
  result?: HttpResult;
  assertions?: AssertionResult[];
  error?: string;
};

/** Passou: chegou resposta, nenhuma asserção falhou e, sem asserções, o status não é de erro. */
export function rowPassed(row: Row) {
  const result = row.result;
  if (!result?.ok) return false;
  return row.assertions?.length ? row.assertions.every((a) => a.pass) : result.status < 400;
}

export function Runner({
  folder,
  requests,
  vars,
  environment,
  readRequest,
  onOpen,
  onClose,
}: {
  folder: string;
  requests: RequestSummary[];
  vars: Record<string, string>;
  environment: string | null;
  readRequest: (path: string) => Promise<BruRequest>;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<Row[]>(() => requests.map((r) => ({ path: r.path, name: r.name, method: r.method, state: 'waiting' })));
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const stop = useRef<{ cancelled: boolean; id: string | null }>({ cancelled: false, id: null });

  // Ao sair da tela no meio de uma execução, o envio em andamento é cancelado.
  useEffect(
    () => () => {
      stop.current.cancelled = true;
      if (stop.current.id) void window.api.httpCancel(stop.current.id);
    },
    [],
  );

  const patch = (index: number, change: Partial<Row>) => setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const run = async () => {
    stop.current = { cancelled: false, id: null };
    setRunning(true);
    setElapsed(null);
    const started = performance.now();
    setRows(requests.map((r) => ({ path: r.path, name: r.name, method: r.method, state: 'waiting' })));
    for (let i = 0; i < requests.length; i++) {
      if (stop.current.cancelled) {
        setRows((prev) => prev.map((row, j) => (j >= i ? { ...row, state: 'skipped' } : row)));
        break;
      }
      patch(i, { state: 'running' });
      try {
        const request = await readRequest(requests[i].path);
        const id = crypto.randomUUID();
        stop.current.id = id;
        const result = await window.api.httpSend(buildRequest(request, vars, id));
        stop.current.id = null;
        patch(i, { state: 'done', name: request.meta.name, result, assertions: evaluateAssertions(request.assertions as Assertion[] | undefined, result) });
      } catch (error) {
        patch(i, { state: 'done', error: (error as Error).message });
      }
    }
    setElapsed(Math.round(performance.now() - started));
    setRunning(false);
  };

  const done = rows.filter((row) => row.state === 'done');
  const passed = done.filter(rowPassed).length;

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate font-display text-xl font-semibold text-frost-100">{t('requests.runner.title', { folder })}</h2>
        <button type="button" className={ghostButton} onClick={onClose}>
          {t('requests.runner.close')}
        </button>
        {running ? (
          <button
            type="button"
            className="shrink-0 rounded-md px-4 py-1.5 font-medium text-danger ring-1 ring-danger/50 hover:bg-danger/10"
            onClick={() => {
              stop.current.cancelled = true;
              if (stop.current.id) void window.api.httpCancel(stop.current.id);
            }}
          >
            {t('requests.runner.stop')}
          </button>
        ) : (
          <button type="button" className={`${primaryButton} inline-flex items-center gap-1.5`} onClick={() => void run()} disabled={!requests.length}>
            <PlayIcon size={13} />
            {done.length ? t('requests.runner.again') : t('requests.runner.run')}
          </button>
        )}
      </div>
      <p className="mt-1 text-[12px] text-frost-500">
        {t('requests.runner.help', { count: requests.length })}
        {environment && ` · ${t('requests.history.environment', { name: environment })}`}
      </p>
      {done.length > 0 && (
        <p className="mt-3 text-[13px]" role="status">
          <span className={passed === done.length ? 'text-sheen-300' : 'text-danger'}>{t('requests.runner.summary', { passed, total: done.length })}</span>
          {elapsed !== null && <span className="text-frost-500"> · {elapsed} ms</span>}
        </p>
      )}
      <ul className="mt-3 flex flex-col">
        {rows.map((row) => {
          const ok = row.state === 'done' && rowPassed(row);
          const failedAsserts = row.assertions?.filter((a) => !a.pass) ?? [];
          return (
            <li key={row.path} className="border-b border-[var(--hairline)] last:border-0">
              <button type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[var(--hover)]" onClick={() => onOpen(row.path)}>
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    row.state === 'done' ? (ok ? 'bg-sheen-400' : 'bg-danger') : row.state === 'running' ? 'animate-pulse bg-[#e6c07b]' : 'bg-[var(--hairline-strong)]'
                  }`}
                  aria-hidden="true"
                />
                <Method value={row.method} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-frost-100">{row.name}</span>
                  {row.error && <span className="block truncate text-[11.5px] text-danger">{row.error}</span>}
                  {row.result && !row.result.ok && <span className="block truncate text-[11.5px] text-danger">{row.result.cancelled ? t('requests.history.cancelled') : row.result.error}</span>}
                  {failedAsserts.length > 0 && (
                    <span className="block truncate font-mono text-[11px] text-danger">
                      {failedAsserts.map((a) => `${a.name} ${a.operator} ${a.expected}`.trim()).join(' · ')}
                    </span>
                  )}
                </span>
                {row.assertions && row.assertions.length > 0 && (
                  <span className="font-mono text-[11px] text-frost-500">{t('requests.response.testsCount', { passed: row.assertions.length - failedAsserts.length, total: row.assertions.length })}</span>
                )}
                <span className="w-24 shrink-0 text-right font-mono text-[11.5px]">
                  {row.state === 'running' ? (
                    <span className="text-frost-500">{t('requests.response.sending')}</span>
                  ) : row.state === 'skipped' ? (
                    <span className="text-frost-500">{t('requests.runner.skipped')}</span>
                  ) : row.result?.ok ? (
                    <>
                      <span style={{ color: statusColor(row.result.status) }}>{row.result.status}</span>
                      <span className="text-frost-500"> · {row.result.time} ms</span>
                    </>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
