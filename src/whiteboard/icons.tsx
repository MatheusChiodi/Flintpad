import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

// Mesmo traço e grade de 16px dos ícones do app (components/Icons.tsx).
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

export const PointerIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 2.5 12 8l-3.6.7L10.6 13l-1.5.7-2.2-4.3L4 12z" />
  </Icon>
);

export const RectangleIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
  </Icon>
);

export const EllipseIcon = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx="8" cy="8" rx="5.75" ry="4.75" />
  </Icon>
);

export const DiamondIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2 14 8 8 14 2 8z" />
  </Icon>
);

export const ArrowIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 13 13 3M7.5 3H13v5.5" />
  </Icon>
);

export const TextIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 4V3h9v1M8 3v10M6 13h4" />
  </Icon>
);

export const UndoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7h-2" />
  </Icon>
);

export const RedoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m10.5 3.5 3 3-3 3" />
    <path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7h2" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2.5v8M4.75 7.5 8 10.75l3.25-3.25M3 13.5h10" />
  </Icon>
);

export const UploadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 10.5v-8M4.75 5.5 8 2.25l3.25 3.25M3 13.5h10" />
  </Icon>
);

export const KeyboardIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.75" y="4" width="12.5" height="8" rx="1.5" />
    <path d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h.01M5 9.5h6" />
  </Icon>
);

export const LinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="3.75" cy="8" r="1.75" />
    <circle cx="12.25" cy="8" r="1.75" />
    <path d="M5.5 8h3.75M8 6l2 2-2 2" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5v-.25A1.25 1.25 0 0 0 9.25 2h-6A1.25 1.25 0 0 0 2 3.25v6c0 .69.56 1.25 1.25 1.25h.25" />
  </Icon>
);

export const PencilIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m10.5 3 2.5 2.5-7.5 7.5H3v-2.5z" />
  </Icon>
);

export const FitIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </Icon>
);
