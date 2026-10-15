import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

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
  const uid = useId();
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
    <div className="wb-quick-scrim" onMouseDown={onClose}>
      <div className="wb-quick text-[13px]" role="dialog" aria-label={placeholder || undefined} onMouseDown={(event) => event.stopPropagation()}>
        <div className="p-2">
          <input
            ref={input}
            className="wb-quick-input"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={`${uid}-list`}
            aria-activedescendant={items[active] ? `${uid}-${active}` : undefined}
            aria-label={placeholder || message}
            aria-describedby={message ? `${uid}-message` : undefined}
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
        {message && <div id={`${uid}-message`} role="status" className="px-4 pb-2.5 text-[12px] text-[var(--vsc-descriptionForeground)]">{message}</div>}
        {items.length > 0 && (
          <div ref={list} className="max-h-[min(440px,60vh)] overflow-y-auto pb-1.5" role="listbox" id={`${uid}-list`}>
            {items.map((item, index) => {
              const separator = item.group && item.group !== items[index - 1]?.group;
              const selected = index === active;
              return (
                <div key={item.id} data-index={index}>
                  {separator && index > 0 && <div className="mx-4 my-1 border-t border-[var(--vsc-pickerGroup-border)]" />}
                  <div
                    id={`${uid}-${index}`}
                    role="option"
                    aria-selected={selected}
                    className="wb-quick-row"
                    onMouseMove={() => index !== active && setActive(index)}
                    onClick={() => onPick(item, value)}
                  >
                    {item.icon && <span className="flex w-4 shrink-0 justify-center">{item.icon}</span>}
                    <span className="min-w-0 truncate">
                      <Highlighted text={item.label} positions={item.positions} />
                    </span>
                    {item.description && <span className="min-w-0 flex-1 truncate text-[11.5px] opacity-60">{item.description}</span>}
                    {!item.description && <span className="flex-1" />}
                    {separator && item.group && <span className="shrink-0 text-[11px] font-medium text-[var(--vsc-pickerGroup-foreground)]">{item.group}</span>}
                    {item.keybinding && <kbd className="wb-kbd shrink-0">{item.keybinding}</kbd>}
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
