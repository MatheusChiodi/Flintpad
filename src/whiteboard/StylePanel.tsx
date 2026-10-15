// Painel de estilo e ações da seleção (à esquerda do quadro). Só apresenta: as mudanças voltam ao
// editor por callbacks, que cuidam do histórico e das travas.
import type { ReactNode } from 'react';

import type { WbKey, WbTranslate } from './i18n.ts';
import {
  AlignIcon,
  BackIcon,
  ChainIcon,
  CopyIcon,
  DistributeIcon,
  DownIcon,
  FrontIcon,
  GroupIcon,
  LinkIcon,
  LockIcon,
  OpenIcon,
  TextIcon,
  TrashIcon,
  UngroupIcon,
  UnlockIcon,
  UpIcon,
} from './icons';
import {
  ARROW_HEADS,
  DEFAULT_STROKE_WIDTH,
  FILLS,
  FONT_SIZES,
  isArrow,
  isPicture,
  isShape,
  OPACITIES,
  STROKE_STYLES,
  STROKE_WIDTHS,
  STROKES,
  type Align,
  type BoardElement,
  type Layer,
  type Patch,
} from './model.ts';
import { dashArray, fontSize } from './render.ts';

export type PanelActions = {
  patch: (patch: Patch) => void;
  layer: (where: Layer) => void;
  align: (how: Align) => void;
  distribute: (axis: 'horizontal' | 'vertical') => void;
  group: () => void;
  ungroup: () => void;
  toggleLock: () => void;
  editLink: () => void;
  openLink: () => void;
  editText: () => void;
  connect: () => void;
  duplicate: () => void;
  remove: () => void;
};

type Props = {
  elements: BoardElement[];
  /** Blocos independentes na seleção (um grupo conta como um). */
  units: number;
  canConnect: boolean;
  t: WbTranslate;
  actions: PanelActions;
  linkEditor: ReactNode;
};

/** Valor comum a todos os elementos, ou undefined se forem diferentes. */
function shared<T>(elements: BoardElement[], read: (element: BoardElement) => T | undefined): T | undefined {
  const values = elements.map(read).filter((value) => value !== undefined);
  return values.length && values.every((value) => value === values[0]) ? values[0] : undefined;
}

const iconButton = 'sheet-button grid h-7 w-7 place-items-center rounded-md disabled:pointer-events-none disabled:opacity-35';

export function StylePanel({ elements, units, canConnect, t, actions, linkEditor }: Props) {
  const shapes = elements.filter(isShape);
  const stroked = elements.filter((e) => !isPicture(e));
  const fillable = shapes.filter((s) => s.kind !== 'text');
  const arrows = elements.filter(isArrow);
  const allLocked = elements.every((e) => e.locked);
  const single = elements.length === 1 ? elements[0] : undefined;
  const grouped = elements.some((e) => e.group);

  return (
    <div
      data-ui="style"
      role="region"
      aria-label={t('actions')}
      className="absolute left-3 top-14 flex max-h-[calc(100%-4.5rem)] w-[188px] flex-col gap-2.5 overflow-y-auto rounded-lg bg-paper-raised p-2.5 text-[11.5px] text-ink-soft shadow-[0_0_0_1px_var(--color-paper-line),0_6px_18px_-8px_rgb(0_0_0_/_0.35)]"
      data-testid="wb-style"
    >
      {allLocked ? (
        <p className="leading-snug text-ink-faint">{t('lockedNotice')}</p>
      ) : (
        <>
          {stroked.length > 0 && (
            <Swatches label={t('stroke')} colors={STROKES} t={t} current={shared(stroked, (e) => ('stroke' in e ? e.stroke : undefined))} onPick={(stroke) => actions.patch({ stroke })} />
          )}
          {fillable.length > 0 && (
            <Swatches label={t('fill')} colors={FILLS} t={t} current={shared(fillable, (e) => (isShape(e) ? e.fill : undefined))} onPick={(fill) => actions.patch({ fill })} />
          )}
          {stroked.some((e) => !(isShape(e) && e.kind === 'text')) && (
            <>
              <Segmented
                label={t('strokeWidth')}
                current={shared(stroked, (e) => e.strokeWidth ?? DEFAULT_STROKE_WIDTH)}
                options={STROKE_WIDTHS.map((width) => ({
                  value: width,
                  title: t(`width.${width}` as WbKey),
                  content: <LineSample width={width} dash="" />,
                }))}
                onPick={(strokeWidth) => actions.patch({ strokeWidth })}
                testId="wb-width"
              />
              <Segmented
                label={t('strokeStyle')}
                current={shared(stroked, (e) => e.strokeStyle ?? 'solid')}
                options={STROKE_STYLES.map((style) => ({
                  value: style,
                  title: t(`style.${style}` as WbKey),
                  content: <LineSample width={2} dash={dashArray(style, 2)} />,
                }))}
                onPick={(strokeStyle) => actions.patch({ strokeStyle })}
                testId="wb-dash"
              />
            </>
          )}
          {arrows.length > 0 && (
            <Segmented
              label={t('heads')}
              current={shared(arrows, (e) => (isArrow(e) ? (e.head ?? 'end') : undefined))}
              options={ARROW_HEADS.map((head) => ({ value: head, title: t(`head.${head}` as WbKey), content: <HeadSample head={head} /> }))}
              onPick={(head) => actions.patch({ head })}
              testId="wb-head"
            />
          )}
          {shapes.length > 0 && (
            <>
              <Segmented
                label={t('fontSize')}
                current={shared(shapes, (e) => (isShape(e) ? fontSize(e) : undefined))}
                options={FONT_SIZES.map((size) => ({ value: size, title: t(`sizeName.${size}` as WbKey), content: <span className="text-[11px] font-semibold">{t(`size.${size}` as WbKey)}</span> }))}
                onPick={(size) => actions.patch({ fontSize: size })}
                testId="wb-size"
              />
              <Segmented
                label={t('font')}
                current={shared(shapes, (e) => (isShape(e) ? (e.font ?? 'sans') : undefined))}
                options={[
                  { value: 'sans' as const, title: t('font.sans'), content: <span className="text-[12px]">Aa</span> },
                  { value: 'mono' as const, title: t('font.mono'), content: <span className="font-mono text-[11px]">{'</>'}</span> },
                ]}
                onPick={(font) => actions.patch({ font })}
                testId="wb-font"
              />
            </>
          )}
          <Segmented
            label={t('opacity')}
            current={shared(elements, (e) => e.opacity ?? 100)}
            options={OPACITIES.map((value) => ({ value, title: t('opacityValue', { value }), content: <span className="font-mono text-[10.5px] tabular-nums">{value}</span> }))}
            onPick={(opacity) => actions.patch({ opacity })}
            testId="wb-opacity"
          />
          <Row label={t('layers')}>
            <button className={iconButton} title={`${t('layer.back')} (Shift+PageDown)`} aria-label={t('layer.back')} onClick={() => actions.layer('back')}>
              <BackIcon size={14} />
            </button>
            <button className={iconButton} title={`${t('layer.backward')} (PageDown)`} aria-label={t('layer.backward')} onClick={() => actions.layer('backward')}>
              <DownIcon size={14} />
            </button>
            <button className={iconButton} title={`${t('layer.forward')} (PageUp)`} aria-label={t('layer.forward')} onClick={() => actions.layer('forward')}>
              <UpIcon size={14} />
            </button>
            <button className={iconButton} title={`${t('layer.front')} (Shift+PageUp)`} aria-label={t('layer.front')} data-testid="wb-front" onClick={() => actions.layer('front')}>
              <FrontIcon size={14} />
            </button>
          </Row>
          {units >= 2 && (
            <Row label={t('align')}>
              {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((how) => (
                <button key={how} className={iconButton} title={t(`align.${how}`)} aria-label={t(`align.${how}`)} data-testid={`wb-align-${how}`} onClick={() => actions.align(how)}>
                  <AlignIcon how={how} size={14} />
                </button>
              ))}
              {units >= 3 &&
                (['horizontal', 'vertical'] as const).map((axis) => (
                  <button key={axis} className={iconButton} title={t(`distribute.${axis}`)} aria-label={t(`distribute.${axis}`)} onClick={() => actions.distribute(axis)}>
                    <DistributeIcon axis={axis} size={14} />
                  </button>
                ))}
            </Row>
          )}
        </>
      )}

      {linkEditor}

      <div className="flex flex-wrap gap-1 border-t border-paper-line pt-2" role="group" aria-label={t('actions')}>
        {single && isShape(single) && !single.locked && (
          <button className={iconButton} title={`${t('editText')} (Enter)`} aria-label={t('editText')} onClick={actions.editText}>
            <TextIcon size={14} />
          </button>
        )}
        {canConnect && (
          <button className={iconButton} title={`${t('connect')} (C)`} aria-label={t('connect')} data-testid="wb-connect" onClick={actions.connect}>
            <LinkIcon size={14} />
          </button>
        )}
        <button className={iconButton} title={`${t('duplicate')} (Ctrl+D)`} aria-label={t('duplicate')} onClick={actions.duplicate}>
          <CopyIcon size={14} />
        </button>
        {units >= 2 && (
          <button className={iconButton} title={`${t('group')} (Ctrl+Shift+G)`} aria-label={t('group')} data-testid="wb-group" onClick={actions.group}>
            <GroupIcon size={14} />
          </button>
        )}
        {grouped && (
          <button className={iconButton} title={`${t('ungroup')} (Ctrl+Shift+U)`} aria-label={t('ungroup')} onClick={actions.ungroup}>
            <UngroupIcon size={14} />
          </button>
        )}
        <button
          className={iconButton}
          title={`${allLocked ? t('unlock') : t('lock')} (Ctrl+Shift+L)`}
          aria-label={allLocked ? t('unlock') : t('lock')}
          aria-pressed={allLocked}
          data-testid="wb-lock"
          onClick={actions.toggleLock}
        >
          {allLocked ? <UnlockIcon size={14} /> : <LockIcon size={14} />}
        </button>
        <button className={iconButton} title={`${t('link')} (Ctrl+K)`} aria-label={t('link')} data-testid="wb-link" onClick={actions.editLink}>
          <ChainIcon size={14} />
        </button>
        {single?.link && (
          <button className={iconButton} title={t('openLinkNamed', { link: single.link })} aria-label={t('openLinkNamed', { link: single.link })} data-testid="wb-open-link" onClick={actions.openLink}>
            <OpenIcon size={14} />
          </button>
        )}
        {!allLocked && (
          <button className={`${iconButton} hover:!text-[#b91c1c]`} title={`${t('delete')} (Delete)`} aria-label={t('delete')} onClick={actions.remove}>
            <TrashIcon size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      <div className="flex flex-wrap gap-0.5">{children}</div>
    </div>
  );
}

type Option<T> = { value: T; title: string; content: ReactNode };

function Segmented<T extends string | number>({ label, options, current, onPick, testId }: { label: string; options: Option<T>[]; current?: T; onPick: (value: T) => void; testId?: string }) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      <div className="flex gap-0.5 rounded-md bg-[rgb(26_31_38_/_0.05)] p-0.5">
        {options.map((option) => (
          <button
            key={String(option.value)}
            className="sheet-button grid h-6 min-w-0 flex-1 place-items-center rounded-[5px] data-[on=true]:bg-paper-raised data-[on=true]:text-ink data-[on=true]:shadow-[0_0_0_1px_var(--color-paper-line)]"
            data-on={current === option.value}
            aria-pressed={current === option.value}
            title={option.title}
            aria-label={option.title}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
            onClick={() => onPick(option.value)}
          >
            {option.content}
          </button>
        ))}
      </div>
    </div>
  );
}

function LineSample({ width, dash }: { width: number; dash: string }) {
  return (
    <svg width={24} height={10} viewBox="0 0 24 10" aria-hidden="true">
      <line x1={3} y1={5} x2={21} y2={5} stroke="currentColor" strokeWidth={width} strokeDasharray={dash || undefined} strokeLinecap="round" />
    </svg>
  );
}

function HeadSample({ head }: { head: 'end' | 'both' | 'none' }) {
  return (
    <svg width={24} height={10} viewBox="0 0 24 10" aria-hidden="true" fill="currentColor" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <line x1={3} y1={5} x2={21} y2={5} />
      {head !== 'none' && <path d="M21 5 17 2.5v5z" />}
      {head === 'both' && <path d="M3 5 7 2.5v5z" />}
    </svg>
  );
}

export function Swatches({ label, colors, current, t, onPick }: { label: string; colors: readonly string[]; current?: string; t: WbTranslate; onPick: (color: string) => void }) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">{label}</p>
      <div className="flex flex-wrap gap-1">
        {colors.map((color) => (
          <button
            key={color}
            className="h-5 w-5 rounded-[5px] ring-1 ring-paper-line transition-[box-shadow] hover:ring-ink-faint data-[on=true]:ring-2 data-[on=true]:ring-sheen-700"
            style={{
              background:
                color === 'transparent' ? 'linear-gradient(135deg, #ffffff 45%, #b91c1c 45%, #b91c1c 55%, #ffffff 55%)' : color,
            }}
            data-on={current === color}
            aria-pressed={current === color}
            title={t(`color.${color}` as WbKey)}
            aria-label={t(`color.${color}` as WbKey)}
            onClick={() => onPick(color)}
          />
        ))}
      </div>
    </div>
  );
}
