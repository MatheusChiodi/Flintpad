import * as monaco from 'monaco-editor';
import { useMemo, useState, type ReactNode } from 'react';

import { useT } from '../../lib/i18n';
import type { IconTheme } from '../../lib/iconTheme';
import { baseName, dirName } from '../../lib/paths';
import { languageForFile } from '../../lib/textmate';
import { FileIconView } from './FileIconView';
import { ResultTree, type ResultGroup } from './ResultTree';

/** Erros e avisos dos arquivos abertos, contados para o selo da guia Problemas. */
export function problemCounts() {
  let errors = 0;
  let warnings = 0;
  for (const marker of monaco.editor.getModelMarkers({})) {
    if (marker.resource.scheme !== 'file') continue;
    if (marker.severity === monaco.MarkerSeverity.Error) errors++;
    else if (marker.severity === monaco.MarkerSeverity.Warning) warnings++;
  }
  return { errors, warnings };
}

export function SeverityIcon({ severity }: { severity: monaco.MarkerSeverity }) {
  if (severity === monaco.MarkerSeverity.Error)
    return (
      <svg className="wb-sev" data-sev="error" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
        <circle cx="8" cy="8" r="6" />
        <path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" />
      </svg>
    );
  if (severity === monaco.MarkerSeverity.Warning)
    return (
      <svg className="wb-sev" data-sev="warning" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
        <path d="M8 2 14.5 13.5h-13z" />
        <path d="M8 6.5v3M8 11.6v.1" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg className="wb-sev" data-sev="info" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5v4M8 4.9v.1" />
    </svg>
  );
}

// Painel Problemas: os marcadores do Monaco (language servers e validação interna), por arquivo.
export function ProblemsPanel({ tabs, actions, version, iconTheme, displayPath, open }: { tabs: ReactNode; actions: ReactNode; version: number; iconTheme: IconTheme | null; displayPath(path: string): string; open(path: string, line: number, column: number, endLine: number, endColumn: number): void }) {
  const t = useT();
  const [filter, setFilter] = useState('');

  const groups = useMemo((): ResultGroup[] => {
    const query = filter.trim().toLowerCase();
    const byFile = new Map<string, monaco.editor.IMarker[]>();
    for (const marker of monaco.editor.getModelMarkers({})) {
      if (marker.resource.scheme !== 'file') continue;
      const path = marker.resource.fsPath;
      if (query && !`${marker.message} ${marker.source ?? ''} ${baseName(path)}`.toLowerCase().includes(query)) continue;
      byFile.set(path, [...(byFile.get(path) ?? []), marker]);
    }
    return [...byFile.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, markers]) => ({
        id: path,
        label: baseName(path),
        description: displayPath(dirName(path)),
        icon: <FileIconView icon={iconTheme?.forFile(path, languageForFile(path)) ?? null} />,
        count: markers.length,
        items: markers
          .sort((a, b) => b.severity - a.severity || a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn)
          .map((marker, index) => ({
            id: String(index),
            title: marker.message,
            onOpen: () => open(path, marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn),
            content: (
              <>
                <SeverityIcon severity={marker.severity} />
                <span className="min-w-0 flex-1 truncate">{marker.message}</span>
                {marker.source && (
                  <span className="wb-result-dir !flex-none">
                    {marker.source}
                    {marker.code ? `(${typeof marker.code === 'string' ? marker.code : marker.code.value})` : ''}
                  </span>
                )}
                <span className="wb-result-line-no">
                  [{marker.startLineNumber}, {marker.startColumn}]
                </span>
              </>
            ),
          })),
      }));
    // version muda quando os marcadores mudam
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, filter, iconTheme, displayPath, open]);

  return (
    <div className="wb-panel-enter flex h-full min-h-0 flex-col" style={{ background: 'var(--vsc-panel-background)' }}>
      <div className="wb-panel-head">
        {tabs}
        <span className="flex-1" />
        <span className="wb-field w-[min(240px,40%)]">
          <input className="wb-field-input !h-6 !text-[12px]" value={filter} placeholder={t('code.problems.filter')} aria-label={t('code.problems.filter')} spellCheck={false} onChange={(event) => setFilter(event.target.value)} />
        </span>
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.length ? (
          <ResultTree groups={groups} label={t('code.problems.title')} />
        ) : (
          <p className="wb-search-msg" role="status">
            {filter.trim() ? t('code.problems.noMatch') : t('code.problems.empty')}
          </p>
        )}
      </div>
    </div>
  );
}
