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

// Variáveis de ambiente: um par de chaves, como {{nome}}.
export const VariablesIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.75 2.75h-.5A1.5 1.5 0 0 0 3.75 4.25v2.1L2.5 8l1.25 1.65v2.1a1.5 1.5 0 0 0 1.5 1.5h.5m4.5-10.5h.5a1.5 1.5 0 0 1 1.5 1.5v2.1L13.5 8l-1.25 1.65v2.1a1.5 1.5 0 0 1-1.5 1.5h-.5" />
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
// Bandeira de prioridade (tela de Tarefas).
export const FlagIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 13.5V2.75M4 3.25h7.25L9.75 6l1.5 2.75H4" />
  </Icon>
);

// Repetição: duas setas em ciclo.
export const RepeatIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 7.25v-.5A2.25 2.25 0 0 1 5.25 4.5h7.25M10.5 2.5l2 2-2 2M13 8.75v.5a2.25 2.25 0 0 1-2.25 2.25H3.5M5.5 13.5l-2-2 2-2" />
  </Icon>
);

// Logo do Flintpad: uma ponta de pederneira lascada; as faces do golpe brilham na cor de destaque.
// Abaixo de 24 px usa o desenho simplificado (menos facetas), que continua legível.
const MARK_STONE = ['#262e3d', '#323c50', '#424f68', '#5b6984'];
const MARK_FACETS: Array<[string, string | number]> = [
  ['M128 20 188 96 136 86Z', 'var(--color-sheen-300)'],
  ['M128 20 136 86 68 96Z', 3],
  ['M68 96 136 86 120 146Z', 2],
  ['M188 96 136 86 120 146Z', 'var(--color-sheen-400)'],
  ['M188 96 176 192 120 146Z', 1],
  ['M68 96 80 192 120 146Z', 1],
  ['M80 192 120 146 134 196Z', 2],
  ['M176 192 120 146 134 196Z', 0],
  ['M80 192 128 236 134 196Z', 0],
  ['M176 192 128 236 134 196Z', 1],
];
const MARK_FACETS_SMALL: Array<[string, string | number]> = [
  ['M128 20 188 96 128 128Z', 'var(--color-sheen-300)'],
  ['M128 20 128 128 68 96Z', 3],
  ['M68 96 128 128 80 192Z', 2],
  ['M188 96 176 192 128 128Z', 'var(--color-sheen-400)'],
  ['M80 192 128 236 128 128Z', 1],
  ['M176 192 128 236 128 128Z', 0],
];

export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  const facets = size < 24 ? MARK_FACETS_SMALL : MARK_FACETS;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" className={className} aria-hidden="true" focusable="false">
      {facets.map(([d, tone]) => {
        const fill = typeof tone === 'number' ? MARK_STONE[tone] : tone;
        // O traço da mesma cor fecha as frestas de antialias entre as facetas.
        return <path key={d} d={d} fill={fill} stroke={fill} strokeWidth={0.8} strokeLinejoin="round" />;
      })}
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

// Paleta de pintor: aparência (cor de destaque, animações).
export const PaletteIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2.25a5.75 5.75 0 0 0 0 11.5c.9 0 1.25-.55 1.05-1.25-.25-.85.3-1.6 1.2-1.6h1.3a2.2 2.2 0 0 0 2.2-2.2c0-3.6-2.55-6.45-5.75-6.45Z" />
    <circle cx="5.25" cy="7" r=".55" fill="currentColor" />
    <circle cx="7.6" cy="4.9" r=".55" fill="currentColor" />
    <circle cx="10.4" cy="6" r=".55" fill="currentColor" />
  </Icon>
);

// Teclado: lista de atalhos.
export const KeyboardIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.75" y="4" width="12.5" height="8" rx="1.5" />
    <path d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h.01M5.25 9.5h5.5" />
  </Icon>
);

// Informação: "Sobre".
export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 7.25V11M8 5h.01" />
  </Icon>
);
