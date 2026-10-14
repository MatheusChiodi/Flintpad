import { useEffect, useRef, useState, type ReactNode } from 'react';

// Caixa de seleção no topo, como o Quick Input do VS Code: Quick Open, paleta de comandos,
// seletores de tema e perguntas de texto (nome de arquivo, número da linha).

export type QuickItem = {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  icon?: ReactNode;
  keybinding?: string;
  group?: string;
  positions?: number[];
};

type Props = {
  value: string;
  placeholder: string;
  items: QuickItem[];
  /** Texto de ajuda ou de erro abaixo do campo (modo pergunta). */
  message?: string;
  activeId?: string;
  onValueChange(value: string): void;
  onPick(item: QuickItem | null, value: string): void;
  onActive?(item: QuickItem | null): void;
  onClose(): void;
};

function Highlighted({ text, positions }: { text: string; positions?: number[] }) {
  if (!positions?.length) return <>{text}</>;
  const marks = new Set(positions);
  const parts: ReactNode[] = [];
  let run = '';
  let marked = false;
  const flush = (key: number) => {
    if (run) parts.push(marked ? <mark key={key} className="bg-transparent font-semibold text-[var(--vsc-list-highlightForeground)]">{run}</mark> : run);
    run = '';
  };
  [...text].forEach((char, index) => {
    if (marks.has(index) !== marked) {
      flush(index);
      marked = !marked;
    }
    run += char;
  });
  flush(text.length);
  return <>{parts}</>;
}

export function QuickInput({ value, placeholder, items, message, activeId, onValueChange, onPick, onActive, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  useEffect(() => input.current?.focus(), []);

  // A lista muda a cada letra: o destaque volta ao item pedido (tema atual) ou ao primeiro.
  useEffect(() => {
    const wanted = activeId ? items.findIndex((item) => item.id === activeId) : -1;
    setActive(wanted >= 0 ? wanted : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    onActiveRef.current?.(items[active] ?? null);
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, items]);

  const move = (delta: number) => {
    if (!items.length) return;
    setActive((current) => (current + delta + items.length) % items.length);
  };

  return (
    <div className="absolute inset-0 z-40" onMouseDown={onClose}>
      <div
        className="mx-auto mt-2 w-[min(600px,calc(100%-32px))] overflow-hidden rounded-md text-[13px] shadow-[0_0_8px_2px_var(--vsc-widget-shadow)]"
        style={{ background: 'var(--vsc-quickInput-background)', color: 'var(--vsc-quickInput-foreground)' }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="p-1.5">
          <input
            ref={input}
            className="w-full rounded-sm px-2 py-1 outline-none ring-1 ring-[var(--vsc-focusBorder)]"
            style={{ background: 'var(--vsc-input-background)', color: 'var(--vsc-input-foreground)' }}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') move(1);
              else if (event.key === 'ArrowUp') move(-1);
              else if (event.key === 'PageDown') move(10);
              else if (event.key === 'PageUp') move(-10);
              else if (event.key === 'Enter') onPick(items[active] ?? null, value);
              else if (event.key === 'Escape') onClose();
              else return;
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        </div>
        {message && <div className="px-3 pb-2 text-[12px] text-[var(--vsc-descriptionForeground)]">{message}</div>}
        {items.length > 0 && (
          <div ref={list} className="max-h-[min(440px,60vh)] overflow-y-auto pb-1" role="listbox">
            {items.map((item, index) => {
              const separator = item.group && item.group !== items[index - 1]?.group;
              const selected = index === active;
              return (
                <div key={item.id} data-index={index}>
                  {separator && index > 0 && <div className="mx-2 border-t border-[var(--vsc-pickerGroup-border)]" />}
                  <div
                    role="option"
                    aria-selected={selected}
                    className="flex cursor-pointer items-center gap-2 px-3 py-[3px]"
                    style={selected ? { background: 'var(--vsc-quickInputList-focusBackground)', color: 'var(--vsc-quickInputList-focusForeground)' } : undefined}
                    onMouseMove={() => index !== active && setActive(index)}
                    onClick={() => onPick(item, value)}
                  >
                    {item.icon && <span className="flex w-4 shrink-0 justify-center">{item.icon}</span>}
                    <span className="min-w-0 truncate">
                      <Highlighted text={item.label} positions={item.positions} />
                    </span>
                    {item.description && <span className="min-w-0 flex-1 truncate text-[12px] opacity-70">{item.description}</span>}
                    {!item.description && <span className="flex-1" />}
                    {separator && item.group && <span className="shrink-0 text-[11.5px] text-[var(--vsc-pickerGroup-foreground)]">{item.group}</span>}
                    {item.keybinding && <kbd className="shrink-0 rounded px-1 font-mono text-[11px] opacity-80 ring-1 ring-[var(--vsc-pickerGroup-border)]">{item.keybinding}</kbd>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
