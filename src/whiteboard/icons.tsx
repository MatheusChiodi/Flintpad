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

export const DrawIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 11.5c1.5-3 3-4.5 4-3.5s-1 3 .5 3.5 2.5-4 4-5.5 2.5-.5 2.5-.5" />
  </Icon>
);

export const LineIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 13 13 3" />
  </Icon>
);

export const EraserIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 3 4 4-6 6H4.5l-2-2z" />
    <path d="M6 6l4 4M7 13h6.5" />
  </Icon>
);

export const HandIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 8.5V4a1 1 0 0 1 2 0v3.5M7 7V3a1 1 0 0 1 2 0v4M9 7V3.75a1 1 0 0 1 2 0V8M11 6.5a1 1 0 0 1 2 0V10a4 4 0 0 1-4 4H8.5a4 4 0 0 1-3.2-1.6L3.2 9.6a1 1 0 0 1 1.6-1.2L5 8.7" />
  </Icon>
);

export const ImageIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="2.75" width="12" height="10.5" rx="1.5" />
    <circle cx="5.75" cy="6.25" r="1.1" />
    <path d="m2.5 12 3.75-3.5 2.5 2.25L11 8.5l2.75 2.75" />
  </Icon>
);

export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" />
  </Icon>
);

export const UnlockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.25 7V5a2.75 2.75 0 0 1 5.3-1" />
  </Icon>
);

export const GroupIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="1.5" strokeDasharray="2 2" />
    <rect x="4" y="4" width="4" height="4" rx=".75" />
    <rect x="8" y="8" width="4" height="4" rx=".75" />
  </Icon>
);

export const UngroupIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="2" width="5" height="5" rx=".75" />
    <rect x="9" y="9" width="5" height="5" rx=".75" />
    <path d="M9.5 3.5h3v3M3.5 9.5v3h3" strokeDasharray="1.5 1.5" />
  </Icon>
);

export const FrontIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="6" width="7.5" height="7.5" rx="1" strokeDasharray="1.6 1.6" />
    <rect x="6.5" y="2.5" width="7.5" height="7.5" rx="1" fill="currentColor" fillOpacity={0.35} />
  </Icon>
);

export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="6" width="7.5" height="7.5" rx="1" fill="currentColor" fillOpacity={0.35} />
    <rect x="6.5" y="2.5" width="7.5" height="7.5" rx="1" strokeDasharray="1.6 1.6" />
  </Icon>
);

export const UpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 13V3.5M4.5 7 8 3.5 11.5 7" />
  </Icon>
);

export const DownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3v9.5M4.5 9 8 12.5 11.5 9" />
  </Icon>
);

export const AlignIcon = ({ how, ...props }: IconProps & { how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' }) => {
  const vertical = how === 'left' || how === 'hcenter' || how === 'right';
  const at = how === 'left' || how === 'top' ? 2 : how === 'right' || how === 'bottom' ? 14 : 8;
  return (
    <Icon {...props}>
      {vertical ? (
        <>
          <path d={`M${at} 1.5v13`} />
          <rect x={how === 'left' ? 3.5 : how === 'right' ? 4.5 : 3} y="3.5" width="8" height="3" rx=".75" />
          <rect x={how === 'left' ? 3.5 : how === 'right' ? 7.5 : 5} y="9.5" width="5" height="3" rx=".75" />
        </>
      ) : (
        <>
          <path d={`M1.5 ${at}h13`} />
          <rect x="3.5" y={how === 'top' ? 3.5 : how === 'bottom' ? 4.5 : 3} width="3" height="8" rx=".75" />
          <rect x="9.5" y={how === 'top' ? 3.5 : how === 'bottom' ? 7.5 : 5} width="3" height="5" rx=".75" />
        </>
      )}
    </Icon>
  );
};

export const DistributeIcon = ({ axis, ...props }: IconProps & { axis: 'horizontal' | 'vertical' }) => (
  <Icon {...props}>
    {axis === 'horizontal' ? (
      <>
        <path d="M1.75 2v12M14.25 2v12" />
        <rect x="6" y="4.5" width="4" height="7" rx=".75" />
      </>
    ) : (
      <>
        <path d="M2 1.75h12M2 14.25h12" />
        <rect x="4.5" y="6" width="7" height="4" rx=".75" />
      </>
    )}
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3.25 3.25" />
  </Icon>
);

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
  </Icon>
);

export const GridIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 5.5h11M2.5 10.5h11M5.5 2.5v11M10.5 2.5v11" />
  </Icon>
);

export const OpenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
  </Icon>
);

export const ChevronIcon = ({ up, ...props }: IconProps & { up?: boolean }) => (
  <Icon {...props}>
    <path d={up ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'} />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.4c.05.66.6 1.1 1.25 1.1h4.3c.65 0 1.2-.44 1.25-1.1l.6-8.4" />
  </Icon>
);

export const ChainIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.75 9.25 9.25 6.75" />
    <path d="M7.5 4.5 8.6 3.4a2.5 2.5 0 0 1 3.5 3.5L11 8M8.5 11.5l-1.1 1.1a2.5 2.5 0 0 1-3.5-3.5L5 8" />
  </Icon>
);
