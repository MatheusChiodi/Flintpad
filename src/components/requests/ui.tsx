// Peças visuais compartilhadas pela tela de Requests: método colorido, seletor segmentado e tabela de pares.
import { useId, useState, type ReactNode } from 'react';

import { useT } from '../../lib/i18n';
import { CloseIcon } from '../Icons';
import { pairsToText, textToPairs } from '../../lib/requestTools';

// Cores vêm dos tokens de src/styles.css (--color-method-*, --color-caution, --color-danger).
export const METHOD_COLOR: Record<string, string> = {
  GET: 'var(--color-method-get)',
  POST: 'var(--color-method-post)',
  PUT: 'var(--color-method-put)',
  PATCH: 'var(--color-method-patch)',
  DELETE: 'var(--color-method-delete)',
};

export const statusColor = (status: number) => (status < 300 ? 'var(--color-sheen-300)' : status < 400 ? 'var(--color-caution)' : 'var(--color-danger)');

// O campo mostra o próprio anel do veio no foco; o contorno global de :focus-visible sobraria.
export const field =
  'min-w-0 rounded-md bg-obsidian-950/60 px-2.5 py-1.5 font-mono text-[12.5px] text-frost-100 outline-none ring-1 ring-[var(--hairline-strong)] transition-shadow placeholder:text-frost-500 focus:ring-sheen-400 focus-visible:outline-none';
export const ghostButton =
  'rq-press whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12.5px] text-frost-300 ring-1 ring-[var(--hairline-strong)] transition-colors hover:bg-[var(--hover)] hover:text-frost-100 disabled:opacity-50 disabled:hover:bg-transparent';
export const toolButton = 'whitespace-nowrap rounded-md px-2 py-1 text-[12px] text-frost-500 transition-colors hover:bg-[var(--hover)] hover:text-frost-100 disabled:opacity-50';
export const iconButton = 'rq-press grid size-6 shrink-0 place-items-center rounded text-frost-500 transition-colors hover:bg-[var(--hover-strong)] hover:text-frost-100';
export const primaryButton =
  'rq-press rq-primary shrink-0 whitespace-nowrap rounded-md bg-sheen-400 px-4 py-1.5 font-semibold text-obsidian-950 transition-colors hover:bg-sheen-300 disabled:opacity-50';
export const dangerButton = 'rq-press shrink-0 whitespace-nowrap rounded-md px-4 py-1.5 font-medium text-danger ring-1 ring-danger/50 transition-colors hover:bg-danger/10';

export function Method({ value }: { value: string }) {
  const method = value.toUpperCase();
  return (
    <span className="w-11 shrink-0 font-mono text-[10.5px] font-semibold" style={{ color: METHOD_COLOR[method] ?? 'var(--color-frost-300)' }}>
      {method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  variant = 'pills',
}: {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (value: T) => void;
  label?: string;
  /**
   * pills: botões que quebram linha (modos do corpo, da autenticação).
   * tabs: guias sublinhadas numa linha só, que rolam de lado em janela estreita (seções da request e da resposta).
   * fill: poucas opções dividindo a largura toda (Coleção / Histórico).
   */
  variant?: 'pills' | 'tabs' | 'fill';
}) {
  if (variant === 'tabs')
    return (
      <div className="rq-tabs" role="group" aria-label={label}>
        {options.map(([key, text]) => (
          <button key={key} type="button" aria-pressed={key === value} className="rq-tab" onClick={() => onChange(key)}>
            {text}
          </button>
        ))}
      </div>
    );
  return (
    <div className={variant === 'fill' ? 'rq-fill' : 'flex flex-wrap gap-1'} role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={key === value}
          className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[12.5px] transition-colors ${
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
          <div key={index} className={`flex items-center gap-2 transition-opacity ${row.enabled ? '' : 'opacity-60'}`}>
            <input
              type="checkbox"
              className="size-3.5 shrink-0 accent-sheen-400"
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
              <span className="w-6 shrink-0" aria-hidden="true" />
            ) : (
              <button
                type="button"
                className={`${iconButton} hover:text-danger`}
                title={t('requests.row.remove')}
                aria-label={`${t('requests.row.remove')} ${row.name}`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                <CloseIcon size={12} />
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
