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
