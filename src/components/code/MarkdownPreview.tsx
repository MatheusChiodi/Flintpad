import * as monaco from 'monaco-editor';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useT } from '../../lib/i18n';
import { linkTarget, parseMarkdown, type Block, type Inline } from '../../lib/markdownPreview';
import { baseName } from '../../lib/paths';

const REPARSE_DELAY_MS = 120;

type Props = {
  model: monaco.editor.ITextModel;
  cursorLine: number;
  /** Link relativo (outro arquivo do disco) clicado na prévia. */
  onOpenFile(href: string, anchor: string): void;
  /** Duplo clique num bloco: leva o cursor do editor à linha de origem. */
  onRevealLine(line: number): void;
  onClose(): void;
};

// Código cercado colorido pelo próprio Monaco (o HTML que ele gera escapa o texto).
function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    const wanted = lang.toLowerCase();
    const language = monaco.languages.getLanguages().find((item) => item.id === wanted || item.aliases?.some((alias) => alias.toLowerCase() === wanted) || item.extensions?.includes(`.${wanted}`));
    if (!language) {
      setHtml(null);
      return;
    }
    let alive = true;
    monaco.editor.colorize(text, language.id, { tabSize: 2 }).then(
      (result) => alive && setHtml(result),
      () => alive && setHtml(null),
    );
    return () => {
      alive = false;
    };
  }, [lang, text]);
  return (
    <pre className="wb-md-pre">
      {lang && <span className="wb-md-lang">{lang}</span>}
      {html !== null ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{text}</code>}
    </pre>
  );
}

export function MarkdownPreview({ model, cursorLine, onOpenFile, onRevealLine, onClose }: Props) {
  const t = useT();
  const [source, setSource] = useState(() => model.getValue());
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSource(model.getValue());
    let timer = 0;
    const sub = model.onDidChangeContent(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSource(model.getValue()), REPARSE_DELAY_MS);
    });
    return () => {
      sub.dispose();
      window.clearTimeout(timer);
    };
  }, [model]);

  const blocks = useMemo(() => parseMarkdown(source), [source]);

  // O bloco do cursor fica destacado e à vista na prévia.
  const currentLine = useMemo(() => {
    let line = 0;
    for (const block of blocks) if (block.line <= cursorLine) line = block.line;
    return line;
  }, [blocks, cursorLine]);
  useEffect(() => {
    const element = scroller.current?.querySelector<HTMLElement>(`[data-line="${currentLine}"]`);
    const box = scroller.current?.getBoundingClientRect();
    if (!element || !box) return;
    const rect = element.getBoundingClientRect();
    if (rect.top < box.top || rect.bottom > box.bottom) element.scrollIntoView({ block: 'center' });
  }, [currentLine]);

  const follow = (href: string) => {
    const target = linkTarget(href);
    if (!target) return;
    if (target.kind === 'external') window.open(target.url, '_blank', 'noopener');
    else if (target.kind === 'anchor') scroller.current?.querySelector(`[data-anchor="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else onOpenFile(target.path, target.anchor);
  };

  const inline = (nodes: Inline[]): ReactNode =>
    nodes.map((node, index) => {
      switch (node.type) {
        case 'text':
          return <Fragment key={index}>{node.text}</Fragment>;
        case 'code':
          return <code key={index} className="wb-md-code">{node.text}</code>;
        case 'strong':
          return <strong key={index}>{inline(node.children)}</strong>;
        case 'em':
          return <em key={index}>{inline(node.children)}</em>;
        case 'del':
          return <del key={index}>{inline(node.children)}</del>;
        case 'br':
          return <br key={index} />;
        case 'wikilink':
          return (
            <span key={index} className="wb-md-wikilink" title={node.target}>
              {node.label}
            </span>
          );
        case 'image':
          // Imagens não são carregadas (sem rede e sem ler o disco por fora): fica o texto alternativo.
          return (
            <span key={index} className="wb-md-image" title={node.src}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="m2.5 11 3.5-3.5 3 3 2-2 2.5 2.5" /></svg>
              {node.alt || baseName(node.src)}
            </span>
          );
        case 'link': {
          const target = linkTarget(node.href);
          return (
            <a
              key={index}
              href={target ? node.href : undefined}
              title={node.href}
              className="wb-md-link"
              data-blocked={!target}
              onClick={(event) => {
                event.preventDefault();
                follow(node.href);
              }}
            >
              {inline(node.children)}
            </a>
          );
        }
      }
    });

  const block = (item: Block, key: number): ReactNode => <Fragment key={key}>{blockBody(item)}</Fragment>;
  const blockBody = (item: Block): ReactNode => {
    const common = { 'data-line': item.line, 'data-current': item.line === currentLine, onDoubleClick: () => onRevealLine(item.line) };
    switch (item.type) {
      case 'heading': {
        const Tag = `h${item.level}` as 'h1';
        return (
          <Tag {...common} data-anchor={item.id}>
            {inline(item.children)}
          </Tag>
        );
      }
      case 'paragraph':
        return <p {...common}>{inline(item.children)}</p>;
      case 'code':
        return (
          <div {...common}>
            <CodeBlock lang={item.lang} text={item.text} />
          </div>
        );
      case 'frontmatter':
        return (
          <div {...common} className="wb-md-front">
            <CodeBlock lang="yaml" text={item.text} />
          </div>
        );
      case 'hr':
        return <hr {...common} />;
      case 'quote':
        return <blockquote {...common}>{item.blocks.map(block)}</blockquote>;
      case 'list': {
        const children = item.items.map((entry, index) => (
          <li key={index} data-task={entry.checked !== null}>
            {entry.checked !== null && <input type="checkbox" checked={entry.checked} readOnly tabIndex={-1} aria-label={entry.checked ? t('code.preview.done') : t('code.preview.todo')} />}
            {/* O primeiro parágrafo fica na linha do marcador; listas aninhadas e outros blocos vêm abaixo. */}
            {entry.blocks[0]?.type === 'paragraph' ? (
              <>
                {inline(entry.blocks[0].children)}
                {entry.blocks.slice(1).map(block)}
              </>
            ) : (
              entry.blocks.map(block)
            )}
          </li>
        ));
        return item.ordered ? (
          <ol {...common} start={item.start}>
            {children}
          </ol>
        ) : (
          <ul {...common}>{children}</ul>
        );
      }
      case 'table':
        return (
          <div {...common} className="wb-md-table-wrap">
            <table>
              <thead>
                <tr>
                  {item.head.map((cell, index) => (
                    <th key={index} style={{ textAlign: item.align[index] ?? undefined }}>
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {item.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, index) => (
                      <td key={index} style={{ textAlign: item.align[index] ?? undefined }}>
                        {inline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  };

  const name = baseName(model.uri.fsPath);
  return (
    <section className="wb-md flex min-h-0 flex-col" aria-label={t('code.preview.title', { name })}>
      <div className="wb-diff-head">
        <span className="min-w-0 truncate">
          <span className="opacity-60">{t('code.preview.label')}</span> <span className="font-medium">{name}</span>
        </span>
        <span className="flex-1" />
        <button type="button" className="wb-icon-btn" title={`${t('code.preview.close')} (Ctrl+K V)`} aria-label={t('code.preview.close')} onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </div>
      <div ref={scroller} className="wb-md-body min-h-0 flex-1 overflow-y-auto" tabIndex={0}>
        {blocks.length ? blocks.map(block) : <p className="opacity-60">{t('code.preview.empty')}</p>}
      </div>
    </section>
  );
}
