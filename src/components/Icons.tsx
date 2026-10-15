import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

// Traço fino e grade de 16px: todos os ícones da casa saem daqui.
function Icon({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

// Painel lateral: a coluna da esquerda marcada.
export const SidebarIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="2.75" width="12" height="10.5" rx="1.75" />
    <path d="M6 2.75v10.5" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.2 10.2 3.3 3.3" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4.25 4.25 7.5 7.5m0-7.5-7.5 7.5" />
  </Icon>
);

export const ChevronIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 3.75 4.25 4.25L6 12.25" />
  </Icon>
);

export const PageIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.25 2.25h4.9l2.6 2.6v8.9h-7.5z" />
    <path d="M9 2.4v2.6h2.6" />
  </Icon>
);

export const NewPageIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M11.75 7.5V4.85l-2.6-2.6h-4.9v11.5H8" />
    <path d="M9 2.4v2.6h2.6M11.75 10v4M9.75 12h4" />
  </Icon>
);

export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.25 4.25h3.9l1.35 1.5h6.25v7h-11.5z" />
  </Icon>
);

export const GraphIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5.3 5.6 1.9 3.9m1.9.2 2.3-3.6M5.6 4.3l4.6.5" />
    <circle cx="4.25" cy="4.25" r="1.6" />
    <circle cx="11.9" cy="5" r="1.6" />
    <circle cx="8" cy="11.25" r="1.9" />
  </Icon>
);

export const CalendarIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.75 4.25h10.5v9h-10.5zM2.75 6.75h10.5M5.5 2.5v2.75M10.5 2.5v2.75" />
  </Icon>
);

export const CodeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5.5 4.5-3.25 3.5 3.25 3.5m5-7 3.25 3.5-3.25 3.5M9.1 3.25l-2.2 9.5" />
  </Icon>
);

export const RequestIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 5.25h9.5m-2.5-2.5 2.5 2.5-2.5 2.5M13.5 10.75H4m2.5-2.5-2.5 2.5 2.5 2.5" />
  </Icon>
);

export const TasksIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.25" />
    <path d="m5.4 8.2 1.9 1.9 3.4-4.1" />
  </Icon>
);

// Quadro branco: uma caixa ligada a um círculo.
export const WhiteboardIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.75" y="2.75" width="5.5" height="4" rx="1" />
    <circle cx="11.5" cy="11.25" r="2.5" />
    <path d="M7.25 4.75h2.5a1.75 1.75 0 0 1 1.75 1.75v2.25" />
  </Icon>
);

export const TrashIcon =(props: IconProps) => (
  <Icon {...props}>
    <path d="M3 4.5h10M6.25 4.5V2.75h3.5V4.5M4.5 4.5l.6 8.75h5.8l.6-8.75M6.9 7v3.75M9.1 7v3.75" />
  </Icon>
);

export const StarIcon = ({ filled, ...props }: IconProps & { filled?: boolean }) => (
  <Icon fill={filled ? 'currentColor' : 'none'} {...props}>
    <path d="m8 2.4 1.7 3.5 3.85.55-2.8 2.7.67 3.8L8 11.15l-3.42 1.8.67-3.8-2.8-2.7 3.85-.55z" />
  </Icon>
);

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m12.41 7.12 1.55.17v1.42l-1.55.17-.67 1.62.97 1.21-1 1-1.21-.97-1.62.67-.17 1.55H7.29l-.17-1.55-1.62-.67-1.21.97-1-1 .97-1.21-.67-1.62-1.55-.17V7.29l1.55-.17.67-1.62-.97-1.21 1-1 1.21.97 1.62-.67.17-1.55h1.42l.17 1.55 1.62.67 1.21-.97 1 1-.97 1.21z" />
    <circle cx="8" cy="8" r="1.9" />
  </Icon>
);

export const BacklinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12.75 3.25 5 11M5 5.75V11h5.25" />
  </Icon>
);

export const OutlinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.25 12.75 11 5M5.75 5H11v5.25" />
  </Icon>
);

// Recolher tudo: duas setas que se encontram.
export const CollapseAllIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 2.75 3 3 3-3M5 13.25l3-3 3 3" />
  </Icon>
);

// Expandir tudo: duas setas que se afastam.
export const ExpandAllIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 5.75 3-3 3 3M5 10.25l3 3 3-3" />
  </Icon>
);

// Revelar a página aberta na árvore: uma mira.
export const LocateIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="4.25" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" />
    <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2" />
  </Icon>
);

// Largura da página: setas para fora (largura cheia) ou para dentro (coluna de leitura).
export const WidthIcon = ({ wide, ...props }: IconProps & { wide?: boolean }) => (
  <Icon {...props}>
    <path d="M2.25 3v10M13.75 3v10" />
    {wide ? <path d="M9.5 8h-5m1.75-1.75L4.5 8l1.75 1.75" /> : <path d="M4.5 8h7M9.75 6.25 11.5 8l-1.75 1.75M6.25 6.25 4.5 8l1.75 1.75" />}
  </Icon>
);

// Fixar guia: um alfinete.
export const PinIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 2.75h4M6.75 2.75v3.5L4.5 9h7L9.25 6.25v-3.5M8 9v4.25" />
  </Icon>
);

// Requests: executar uma pasta, copiar, mostrar segredo e código gerado.
export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 3.5v9l7-4.5z" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" />
    <path d="M10.75 5.25V4.25a1.5 1.5 0 0 0-1.5-1.5h-5a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1.5 1.5h1" />
  </Icon>
);

export const EyeIcon = ({ off, ...props }: IconProps & { off?: boolean }) => (
  <Icon {...props}>
    <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" />
    <circle cx="8" cy="8" r="1.9" />
    {off && <path d="m2.75 2.75 10.5 10.5" />}
  </Icon>
);

// Grafo: aproximar, afastar, enquadrar, pausar, baixar e ajuda.
export const ZoomInIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3.5 3.5M5.25 7h3.5M7 5.25v3.5" />
  </Icon>
);

export const ZoomOutIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3.5 3.5M5.25 7h3.5" />
  </Icon>
);

export const FitIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.25 5.5V3.75a1.5 1.5 0 0 1 1.5-1.5H5.5M10.5 2.25h1.75a1.5 1.5 0 0 1 1.5 1.5V5.5M13.75 10.5v1.75a1.5 1.5 0 0 1-1.5 1.5H10.5M5.5 13.75H3.75a1.5 1.5 0 0 1-1.5-1.5V10.5" />
    <circle cx="8" cy="8" r="1.75" />
  </Icon>
);

export const PauseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 3.5v9M10.5 3.5v9" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2.5v7.75M4.75 7 8 10.25 11.25 7M2.75 13.25h10.5" />
  </Icon>
);

export const HelpIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M6.25 6.4a1.85 1.85 0 0 1 3.6.6c0 1.25-1.85 1.5-1.85 2.6" />
    <circle cx="8" cy="11.4" r="0.35" fill="currentColor" />
  </Icon>
);

// Marca: uma lasca de obsidiana com uma faceta acesa.
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path d="M12 1.5 21 8l-3.4 12.5H6.4L3 8z" fill="var(--color-obsidian-600)" />
      <path d="M12 1.5 21 8l-9 3.2z" fill="var(--color-sheen-400)" />
      <path d="M12 1.5 3 8l9 3.2z" fill="var(--color-obsidian-500)" />
      <path d="m12 11.2 5.6 9.3H6.4z" fill="var(--color-obsidian-700)" />
      <path d="m21 8-3.4 12.5L12 11.2z" fill="var(--color-sheen-700)" />
      <path
        d="M12 1.5 21 8l-3.4 12.5H6.4L3 8z"
        fill="none"
        stroke="var(--color-sheen-300)"
        strokeOpacity="0.35"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
