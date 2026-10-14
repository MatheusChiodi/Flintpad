import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useT } from '../lib/i18n';
import { baseName, resolveLink } from '../lib/links';
import { previewLinkEvent, type PreviewRequest } from '../lib/noteBridge';
import { parseLinkTarget, previewLines } from '../lib/notes';
import type { Note } from '../types';
import { PageIcon } from './Icons';

// Prévia ao passar o mouse num [[link]]: um cartão com o começo da página (ou da seção).
// Só texto: o Markdown vira linhas simples, sem HTML vindo da nota.

const SHOW_DELAY_MS = 450;
const HIDE_DELAY_MS = 180;
const CARD_WIDTH = 380;
const GAP = 8;

type Props = {
  notes: Note[];
  contents: Record<string, string>;
  onOpen: (path: string) => void;
};

export function LinkPreview({ notes, contents, onOpen }: Props) {
  const t = useT();
  const [request, setRequest] = useState<PreviewRequest>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const hovering = useRef(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const onPreview = (event: Event) => {
      const next = (event as CustomEvent<PreviewRequest>).detail;
      window.clearTimeout(timer.current);
      if (next) timer.current = window.setTimeout(() => setRequest(next), SHOW_DELAY_MS);
      else timer.current = window.setTimeout(() => !hovering.current && setRequest(null), HIDE_DELAY_MS);
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      setRequest(null);
    };
    window.addEventListener(previewLinkEvent, onPreview);
    window.addEventListener('keydown', hide);
    window.addEventListener('wheel', hide, { passive: true });
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener(previewLinkEvent, onPreview);
      window.removeEventListener('keydown', hide);
      window.removeEventListener('wheel', hide);
    };
  }, []);

  // Abaixo do link; se não couber, acima. Nunca sai da janela.
  useLayoutEffect(() => {
    if (!request || !card.current) return;
    const height = card.current.offsetHeight;
    const below = request.rect.bottom + GAP;
    const top = below + height > window.innerHeight - GAP ? Math.max(GAP, request.rect.top - GAP - height) : below;
    const left = Math.max(GAP, Math.min(request.rect.left, window.innerWidth - CARD_WIDTH - GAP));
    setPosition({ left, top });
  }, [request]);

  if (!request) return null;
  const { target, section } = parseLinkTarget(request.target);
  const path = resolveLink(target, notes);
  if (!path) return null;
  const lines = previewLines(contents[path] ?? '', section);

  return (
    <div
      ref={card}
      className="link-preview"
      role="tooltip"
      style={{ left: position.left, top: position.top, width: CARD_WIDTH }}
      onMouseEnter={() => {
        hovering.current = true;
        window.clearTimeout(timer.current);
      }}
      onMouseLeave={() => {
        hovering.current = false;
        setRequest(null);
      }}
    >
      <button
        className="link-preview-title"
        onClick={() => {
          setRequest(null);
          onOpen(path);
        }}
      >
        <PageIcon size={14} />
        <span className="truncate">{baseName(path)}</span>
        {section && <span className="truncate text-ink-faint">› {section}</span>}
      </button>
      <div className="link-preview-body">
        {lines.length ? (
          lines.map((line, index) => (
            <p key={index} data-kind={line.kind}>
              {line.text}
            </p>
          ))
        ) : (
          <p className="text-ink-faint">{t('preview.empty')}</p>
        )}
      </div>
    </div>
  );
}
