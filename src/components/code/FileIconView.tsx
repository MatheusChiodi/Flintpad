import { useEffect, useState } from 'react';

import { iconImageUrl, type FileIcon } from '../../lib/iconTheme';

// Ícone de arquivo ou pasta vindo do tema de ícones; sem tema, um traço discreto ocupa o lugar.
export function FileIconView({ icon, dir, expanded }: { icon: FileIcon | null; dir?: boolean; expanded?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const imagePath = icon?.kind === 'image' ? icon.path : null;

  useEffect(() => {
    if (!imagePath) return;
    let alive = true;
    void iconImageUrl(imagePath).then(
      (next) => alive && setUrl(next),
      () => alive && setUrl(null),
    );
    return () => {
      alive = false;
    };
  }, [imagePath]);

  if (icon?.kind === 'font') {
    return (
      <span
        aria-hidden
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center leading-none"
        style={{ fontFamily: icon.fontFamily, color: icon.color, fontSize: icon.size ?? '150%' }}
      >
        {icon.char}
      </span>
    );
  }
  if (icon?.kind === 'image' && url) return <img aria-hidden src={url} alt="" className="h-4 w-4 shrink-0" draggable={false} />;
  // O tema não desenha pastas (o Seti, por exemplo): entra a pasta da casa, aberta ou fechada.
  if (dir) {
    return (
      <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" style={{ color: 'var(--vsc-icon-folder, #c09553)' }}>
        {expanded ? (
          <path d="M1.5 4.5v8h11l2-5.5H4.5L2.5 12.5M1.5 4.5V3.5h4l1.2 1.5h5.8v2" fill="currentColor" fillOpacity=".25" />
        ) : (
          <path d="M1.5 3.5h4.5l1.5 1.5h7v7.5h-13z" fill="currentColor" fillOpacity=".25" />
        )}
      </svg>
    );
  }
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" />
    </svg>
  );
}
