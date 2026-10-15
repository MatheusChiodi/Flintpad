import * as monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../../lib/i18n';
import { baseName } from '../../lib/paths';

// Comparar com o salvo: o texto do disco à esquerda (só leitura) e o modelo do editor à direita (editável),
// por cima da área do editor. Esc fecha.
export function DiffView({ path, saved, fontSize, onClose }: { path: string; saved: string; fontSize: number; onClose(): void }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [inline, setInline] = useState(false);
  const [changes, setChanges] = useState<number | null>(null);

  useEffect(() => {
    const modified = monaco.editor.getModels().find((model) => model.uri.scheme === 'file' && model.uri.fsPath.toLowerCase() === path.toLowerCase());
    if (!host.current || !modified) return;
    const original = monaco.editor.createModel(saved, modified.getLanguageId());
    const diff = monaco.editor.createDiffEditor(host.current, {
      automaticLayout: true,
      fontFamily: getComputedStyle(document.body).getPropertyValue('--font-mono'),
      fontSize,
      lineHeight: Math.round(fontSize * 1.6),
      originalEditable: false,
      renderSideBySide: true,
      // Lado a lado vira em linha quando a área fica estreita.
      useInlineViewWhenSpaceIsLimited: true,
      renderOverviewRuler: true,
      fixedOverflowWidgets: true,
    });
    diff.setModel({ original, modified });
    diffRef.current = diff;
    const update = () => setChanges(diff.getLineChanges()?.length ?? null);
    const sub = diff.onDidUpdateDiff(update);
    requestAnimationFrame(() => diff.getModifiedEditor().focus());
    return () => {
      sub.dispose();
      diff.setModel(null);
      diff.dispose();
      original.dispose();
      diffRef.current = null;
    };
  }, [path, saved, fontSize]);

  useEffect(() => diffRef.current?.updateOptions({ renderSideBySide: !inline }), [inline]);

  return (
    <div
      className="wb-diff absolute inset-0 z-10 flex flex-col"
      role="region"
      aria-label={t('code.diff.title', { name: baseName(path) })}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="wb-diff-head">
        <span className="min-w-0 truncate">
          <span className="font-medium">{baseName(path)}</span> <span className="opacity-60">{t('code.diff.subtitle')}</span>
        </span>
        {changes !== null && <span className="wb-badge" role="status">{t('code.diff.changes', { count: changes })}</span>}
        <span className="flex-1" />
        <button type="button" className="wb-chip" data-on={inline} aria-pressed={inline} onClick={() => setInline(!inline)}>
          {t('code.diff.inline')}
        </button>
        <button type="button" className="wb-icon-btn" title={`${t('code.diff.close')} (Esc)`} aria-label={t('code.diff.close')} onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </div>
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  );
}
