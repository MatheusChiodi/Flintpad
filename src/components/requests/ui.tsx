// Peças visuais compartilhadas pela tela de Requests: método colorido, seletor segmentado e tabela de pares.
import { useId, useState, type ReactNode } from 'react';

import { useT } from '../../lib/i18n';
import { pairsToText, textToPairs } from '../../lib/requestTools';

export const METHOD_COLOR: Record<string, string> = {
  GET: '#86d9cd',
  POST: '#e6c07b',
  PUT: '#8fb4ff',
  PATCH: '#c8a6f2',
  DELETE: '#f0908d',
};

export const statusColor = (status: number) => (status < 300 ? '#86d9cd' : status < 400 ? '#e6c07b' : '#f0908d');

export const field =
  'min-w-0 rounded-md bg-obsidian-950/60 px-2.5 py-1.5 font-mono text-[12.5px] text-frost-100 outline-none ring-1 ring-[var(--hairline-strong)] placeholder:text-frost-500 focus:ring-sheen-400';
export const ghostButton =
  'rounded-md px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] hover:bg-[var(--hover)] hover:text-frost-100 disabled:opacity-50 disabled:hover:bg-transparent';
export const toolButton = 'rounded-md px-2 py-1 text-[12px] text-frost-500 transition-colors hover:bg-[var(--hover)] hover:text-frost-100 disabled:opacity-50';
export const iconButton =
  'grid size-6 shrink-0 place-items-center rounded text-frost-500 transition-colors hover:bg-[var(--hover)] hover:text-frost-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-sheen-400';
export const primaryButton = 'shrink-0 rounded-md bg-sheen-400 px-4 py-1.5 font-semibold text-obsidian-950 hover:bg-sheen-300 disabled:opacity-50';

export function Method({ value }: { value: string }) {
  const method = value.toUpperCase();
  return (
    <span className="w-11 shrink-0 font-mono text-[10.5px] font-semibold" style={{ color: METHOD_COLOR[method] ?? '#aeb8c7' }}>
      {method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={key === value}
          className={`rounded-md px-2.5 py-1 text-[12.5px] ${
            key === value ? 'bg-[var(--hover-strong)] text-frost-100' : 'text-frost-500 hover:bg-[var(--hover)] hover:text-frost-300'
          }`}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

type PairRow = { name: string; value: string; enabled: boolean };

/**
 * Tabela de pares nome/valor com caixa de ativar, sugestões opcionais e um modo de edição em massa
 * (uma linha "nome: valor" por par, "//" desativa), como o Bulk Edit do Postman.
 */
export function PairTable<T extends PairRow>({
  rows,
  blank,
  onChange,
  namePlaceholder,
  valuePlaceholder,
  valueDisabled,
  nameSuggestions,
  valueSuggestions,
  lockNames,
  bulk = true,
}: {
  rows: T[];
  blank: T;
  onChange: (rows: T[]) => void;
  namePlaceholder: string;
  valuePlaceholder?: string;
  valueDisabled?: (row: T) => string | undefined;
  nameSuggestions?: string[];
  valueSuggestions?: (name: string) => string[] | undefined;
  /** Nomes vêm de fora (path params): não se edita, adiciona nem remove linha. */
  lockNames?: boolean;
  bulk?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [bulkText, setBulkText] = useState<string | null>(null);
  const patch = (index: number, change: Partial<T>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  if (bulkText !== null) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          className={`${field} min-h-32 w-full resize-y leading-relaxed`}
          value={bulkText}
          autoFocus
          spellCheck={false}
          aria-label={t('requests.bulk.label')}
          placeholder={t('requests.bulk.placeholder')}
          onChange={(event) => setBulkText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setBulkText(null);
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={ghostButton}
            onClick={() => {
              onChange(textToPairs(bulkText, { ...blank, name: '', value: '' }) as unknown as T[]);
              setBulkText(null);
            }}
          >
            {t('requests.bulk.apply')}
          </button>
          <button type="button" className={toolButton} onClick={() => setBulkText(null)}>
            {t('requests.cancel')}
          </button>
          <span className="text-[11.5px] text-frost-500">{t('requests.bulk.help')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {nameSuggestions && (
        <datalist id={`${id}-names`}>
          {nameSuggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      {rows.map((row, index) => {
        const lockedReason = valueDisabled?.(row);
        const values = valueSuggestions?.(row.name);
        return (
          <div key={index} className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-3.5 shrink-0 accent-[#4fbfb4]"
              checked={row.enabled}
              title={row.enabled ? t('requests.row.disable') : t('requests.row.enable')}
              aria-label={`${row.enabled ? t('requests.row.disable') : t('requests.row.enable')} ${row.name}`}
              onChange={(event) => patch(index, { enabled: event.target.checked } as Partial<T>)}
            />
            <input
              className={`${field} flex-[2] ${lockNames ? 'text-sheen-300' : ''}`}
              aria-label={namePlaceholder}
              placeholder={namePlaceholder}
              value={row.name}
              readOnly={lockNames}
              list={nameSuggestions ? `${id}-names` : undefined}
              spellCheck={false}
              onChange={(event) => patch(index, { name: event.target.value } as Partial<T>)}
            />
            {values && (
              <datalist id={`${id}-values-${index}`}>
                {values.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            )}
            <input
              className={`${field} flex-[3] disabled:opacity-50`}
              placeholder={lockedReason ?? valuePlaceholder ?? t('common.value')}
              aria-label={`${valuePlaceholder ?? t('common.value')} ${row.name}`}
              value={lockedReason ? '' : row.value}
              disabled={Boolean(lockedReason)}
              list={values ? `${id}-values-${index}` : undefined}
              spellCheck={false}
              onChange={(event) => patch(index, { value: event.target.value } as Partial<T>)}
            />
            {lockNames ? (
              <span className="w-[23px] shrink-0" aria-hidden="true" />
            ) : (
              <button
                type="button"
                className="rounded px-1.5 py-1 text-frost-500 hover:bg-[var(--hover)] hover:text-danger"
                title={t('requests.row.remove')}
                aria-label={`${t('requests.row.remove')} ${row.name}`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {!lockNames && (
        <div className="flex items-center gap-2">
          <button type="button" className={ghostButton} onClick={() => onChange([...rows, blank])}>
            {t('requests.row.add')}
          </button>
          {bulk && (
            <button type="button" className={toolButton} onClick={() => setBulkText(pairsToText(rows))}>
              {t('requests.bulk.edit')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
