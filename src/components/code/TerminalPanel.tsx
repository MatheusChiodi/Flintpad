import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../../lib/i18n';
import { xtermTheme, type WorkbenchColors } from '../../lib/workbenchTheme';

type Instance = { term: Terminal; fit: FitAddon; host: HTMLDivElement };
type Info = { id: number; title: string };
export type TerminalCommand = { kind: 'new' | 'kill' | 'focus'; serial: number };

// Painel Terminal: várias sessões, uma visível por vez; os processos ficam no processo principal.
export function TerminalPanel({ colors, command, maximized, onClose, onToggleMaximize, onEmpty }: { colors: WorkbenchColors; command: TerminalCommand | null; maximized: boolean; onClose(): void; onToggleMaximize(): void; onEmpty(): void }) {
  const t = useT();
  const area = useRef<HTMLDivElement>(null);
  const instances = useRef(new Map<number, Instance>());
  const [terminals, setTerminals] = useState<Info[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  const onEmptyRef = useRef(onEmpty);
  onEmptyRef.current = onEmpty;

  const attach = (info: Info, buffer = '') => {
    const host = document.createElement('div');
    host.className = 'absolute inset-0 px-2 pt-1';
    area.current?.appendChild(host);
    const term = new Terminal({
      fontFamily: getComputedStyle(document.body).getPropertyValue('--font-mono') || 'Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: xtermTheme(colorsRef.current),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    if (buffer) term.write(buffer);
    term.onData((data) => void window.api.term.write(info.id, data));
    term.onResize(({ cols, rows }) => void window.api.term.resize(info.id, cols, rows));
    // Ctrl+C com seleção copia; sem seleção vai para o shell (como no VS Code).
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.ctrlKey && event.key.toLowerCase() === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      if (event.type === 'keydown' && event.ctrlKey && event.key.toLowerCase() === 'v') {
        void navigator.clipboard.readText().then((text) => term.paste(text));
        return false;
      }
      // Atalhos do workbench (Ctrl+`, Ctrl+P, Ctrl+Shift+P...) passam direto.
      if (event.ctrlKey && (event.key === '`' || event.key.toLowerCase() === 'p' || event.key.toLowerCase() === 'b' || event.key.toLowerCase() === 'j')) return false;
      return true;
    });
    instances.current.set(info.id, { term, fit, host });
  };

  const create = async () => {
    const size = [...instances.current.values()][0]?.term;
    const info = await window.api.term.create({ cols: size?.cols ?? 80, rows: size?.rows ?? 24 });
    attach(info);
    setTerminals((list) => [...list, info]);
    setActive(info.id);
  };

  const kill = (id: number | null) => {
    if (id !== null) void window.api.term.kill(id);
  };

  useEffect(() => {
    let alive = true;
    void window.api.term.list().then((list) => {
      if (!alive) return;
      for (const info of list) attach(info, info.buffer);
      setTerminals(list.map(({ id, title }) => ({ id, title })));
      if (list.length) setActive(list[list.length - 1].id);
      else void create();
    });
    const offData = window.api.term.onData((id, data) => instances.current.get(id)?.term.write(data));
    const offExit = window.api.term.onExit((id) => {
      const instance = instances.current.get(id);
      instance?.term.dispose();
      instance?.host.remove();
      instances.current.delete(id);
      setTerminals((list) => {
        const next = list.filter((info) => info.id !== id);
        if (!next.length) onEmptyRef.current();
        return next;
      });
      setActive((current) => (current === id ? ([...instances.current.keys()].pop() ?? null) : current));
    });
    const resize = new ResizeObserver(() => {
      for (const { fit, host } of instances.current.values()) if (host.style.display !== 'none') fit.fit();
    });
    if (area.current) resize.observe(area.current);
    const map = instances.current;
    return () => {
      alive = false;
      offData();
      offExit();
      resize.disconnect();
      for (const instance of map.values()) {
        instance.term.dispose();
        instance.host.remove();
      }
      map.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    for (const [id, instance] of instances.current) {
      instance.host.style.display = id === active ? '' : 'none';
      if (id === active) {
        requestAnimationFrame(() => {
          instance.fit.fit();
          instance.term.focus();
        });
      }
    }
  }, [active, terminals]);

  useEffect(() => {
    for (const { term } of instances.current.values()) term.options.theme = xtermTheme(colors);
  }, [colors]);

  useEffect(() => {
    if (!command) return;
    if (command.kind === 'new') void create();
    else if (command.kind === 'kill') kill(active);
    else if (active !== null) instances.current.get(active)?.term.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  const iconButton = 'flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--vsc-list-hoverBackground)]';

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--vsc-panel-background)' }}>
      <div className="flex h-[35px] shrink-0 items-center gap-3 px-3 text-[11px] uppercase">
        <span className="border-b pb-1 pt-1.5" style={{ color: 'var(--vsc-panelTitle-activeForeground)', borderColor: 'var(--vsc-panelTitle-activeBorder)' }}>
          {t('code.terminal')}
        </span>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto normal-case">
          {terminals.map((info, index) => (
            <button
              key={info.id}
              className="shrink-0 rounded px-2 py-0.5 text-[12px]"
              style={{ color: info.id === active ? 'var(--vsc-panelTitle-activeForeground)' : 'var(--vsc-panelTitle-inactiveForeground)', background: info.id === active ? 'var(--vsc-list-inactiveSelectionBackground)' : undefined }}
              onClick={() => setActive(info.id)}
            >
              {index + 1}: {info.title}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-0.5 normal-case" style={{ color: 'var(--vsc-panelTitle-activeForeground)' }}>
          <button className={iconButton} title={t('code.cmd.newTerminal')} onClick={() => void create()}>
            +
          </button>
          <button className={iconButton} title={t('code.cmd.killTerminal')} onClick={() => kill(active)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1ZM9 2H6v1h3V2ZM4 13h7V4H4v9Zm2-8H5v7h1V5Zm1 0h1v7H7V5Zm2 0h1v7H9V5Z" /></svg>
          </button>
          <button className={iconButton} title={t('code.cmd.maximizePanel')} onClick={onToggleMaximize}>
            {maximized ? '⌄' : '⌃'}
          </button>
          <button className={iconButton} title={t('code.cmd.togglePanel')} onClick={onClose}>
            ×
          </button>
        </span>
      </div>
      <div ref={area} className="relative min-h-0 flex-1" style={{ background: 'var(--vsc-terminal-background)' }} />
    </div>
  );
}
