import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useT } from '../../lib/i18n';
import { xtermTheme, type WorkbenchColors } from '../../lib/workbenchTheme';

type Instance = { term: Terminal; fit: FitAddon; host: HTMLDivElement };
type Info = { id: number; title: string };
export type TerminalCommand = { kind: 'new' | 'kill' | 'focus' | 'run' | 'claude'; serial: number; text?: string };
type Notice = { text: string; error: boolean };

export const CLAUDE_TITLE = 'Claude Code';
// Shell que fecha antes disto quase sempre falhou ao abrir (perfil quebrado, executável inválido).
const EARLY_EXIT_MS = 2000;
// Texto para o Claude Code recém-aberto espera a saída dele sossegar (a interface já desenhada).
const CLAUDE_SETTLE_MS = 900;
const CLAUDE_MIN_WAIT_MS = 1500;

// Último pedido atendido: o painel remonta com o mesmo `command` (fechar e abrir) e não deve repeti-lo.
let handledSerial = 0;

// Painel Terminal: várias sessões, uma visível por vez; os processos ficam no processo principal.
export function TerminalPanel({ colors, command, maximized, tabs, onClose, onToggleMaximize, onEmpty }: { colors: WorkbenchColors; command: TerminalCommand | null; maximized: boolean; tabs: ReactNode; onClose(): void; onToggleMaximize(): void; onEmpty(): void }) {
  const t = useT();
  const area = useRef<HTMLDivElement>(null);
  const instances = useRef(new Map<number, Instance>());
  const [terminals, setTerminals] = useState<Info[]>([]);
  const terminalsRef = useRef(terminals);
  terminalsRef.current = terminals;
  const [active, setActive] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const born = useRef(new Map<number, number>());
  const claudeQueue = useRef<{ id: number; text: string; since: number; timer: number } | null>(null);
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

  // Falha ao abrir vira aviso no painel (com "tentar de novo"), em vez de um painel preto e mudo.
  const create = async (extra: { run?: string; title?: string } = {}): Promise<Info | null> => {
    const size = [...instances.current.values()][0]?.term;
    try {
      const info = await window.api.term.create({ cols: size?.cols ?? 80, rows: size?.rows ?? 24, ...extra });
      born.current.set(info.id, Date.now());
      attach(info);
      setTerminals((list) => [...list, info]);
      setActive(info.id);
      setNotice(null);
      return info;
    } catch (error) {
      const reason = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);
      setNotice({ text: t('code.terminal.failed', { reason }), error: true });
      return null;
    }
  };

  // Claude Code numa guia própria: reaproveita a que já está aberta; o texto (uma @menção) entra sem Enter.
  const openClaude = async (text?: string) => {
    const existing = terminalsRef.current.find((info) => info.title === CLAUDE_TITLE && instances.current.has(info.id));
    if (existing) {
      setActive(existing.id);
      if (text) void window.api.term.write(existing.id, text);
      return;
    }
    if (!(await window.api.term.claudePath())) {
      setNotice({ text: t('code.claude.missing'), error: true });
      return;
    }
    const info = await create({ run: 'claude', title: CLAUDE_TITLE });
    if (info && text) claudeQueue.current = { id: info.id, text, since: Date.now(), timer: 0 };
  };
  const feedClaude = (id: number) => {
    const queue = claudeQueue.current;
    if (!queue || queue.id !== id) return;
    window.clearTimeout(queue.timer);
    queue.timer = window.setTimeout(() => {
      if (claudeQueue.current !== queue) return;
      if (Date.now() - queue.since < CLAUDE_MIN_WAIT_MS) return feedClaude(id);
      claudeQueue.current = null;
      void window.api.term.write(id, queue.text);
    }, CLAUDE_SETTLE_MS);
  };

  // Texto pedido antes de o painel terminar de montar (Rodar arquivo com o painel fechado) espera aqui.
  const ready = useRef(false);
  const pending = useRef<string | null>(null);
  const pendingClaude = useRef<string | null>(null);
  // O pedido que montou o painel ("novo terminal", "abrir Claude Code") já cria a sua guia: a lista vazia não cria outra.
  const startsOwn = useRef(Boolean(command && command.serial > handledSerial && (command.kind === 'new' || command.kind === 'claude')));
  const run = (id: number, text: string) => {
    void window.api.term.write(id, `${text}\r`);
    requestAnimationFrame(() => instances.current.get(id)?.term.focus());
  };
  const flushPending = (id: number) => {
    if (pending.current === null) return;
    run(id, pending.current);
    pending.current = null;
  };

  const kill = (id: number | null) => {
    if (id !== null) void window.api.term.kill(id);
  };

  useEffect(() => {
    let alive = true;
    void window.api.term.list().then((list) => {
      if (!alive) return;
      for (const info of list) attach(info, info.buffer);
      const infos = list.map(({ id, title }) => ({ id, title }));
      terminalsRef.current = infos;
      setTerminals(infos);
      ready.current = true;
      if (pendingClaude.current !== null) {
        void openClaude(pendingClaude.current || undefined);
        pendingClaude.current = null;
      } else if (list.length) {
        setActive(list[list.length - 1].id);
        flushPending(list[list.length - 1].id);
      } else if (!startsOwn.current) void create().then((info) => info && flushPending(info.id));
    });
    const offData = window.api.term.onData((id, data) => {
      instances.current.get(id)?.term.write(data);
      feedClaude(id);
    });
    const offExit = window.api.term.onExit((id, code) => {
      const instance = instances.current.get(id);
      const title = terminalsRef.current.find((info) => info.id === id)?.title ?? '';
      // Fechou logo ao abrir: o painel fica aberto com o motivo, senão pareceria que "não abriu".
      const early = Date.now() - (born.current.get(id) ?? 0) < EARLY_EXIT_MS;
      born.current.delete(id);
      instance?.term.dispose();
      instance?.host.remove();
      instances.current.delete(id);
      if (early) setNotice({ text: t('code.terminal.exitedEarly', { name: title, code }), error: true });
      setTerminals((list) => {
        const next = list.filter((info) => info.id !== id);
        if (!next.length && !early) onEmptyRef.current();
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
    if (!command || command.serial <= handledSerial) return;
    handledSerial = command.serial;
    if (command.kind === 'new') void create();
    else if (command.kind === 'claude') {
      // Antes da lista chegar não dá para saber se já existe uma guia do Claude: espera por ela.
      if (ready.current) void openClaude(command.text);
      else pendingClaude.current = command.text ?? '';
    }
    else if (command.kind === 'kill') kill(active);
    else if (command.kind === 'run') {
      const text = command.text ?? '';
      if (!ready.current) pending.current = text;
      else if (active !== null) run(active, text);
      else void create().then((info) => info && run(info.id, text));
    }
    else if (active !== null) instances.current.get(active)?.term.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  return (
    <div className="wb-panel-enter flex h-full min-h-0 flex-col" style={{ background: 'var(--vsc-panel-background)' }}>
      <div className="wb-panel-head">
        {tabs}
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {terminals.map((info, index) => (
            <button key={info.id} className="wb-chip" data-on={info.id === active} onClick={() => setActive(info.id)}>
              <span className="font-mono text-[10.5px] opacity-60">{index + 1}</span> {info.title}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-0.5" style={{ color: 'var(--vsc-panelTitle-activeForeground)' }}>
          <button className="wb-icon-btn" title={t('code.cmd.claudeOpen')} aria-label={t('code.cmd.claudeOpen')} onClick={() => void openClaude()}>
            <ClaudeIcon />
          </button>
          <button className="wb-icon-btn" title={t('code.cmd.newTerminal')} aria-label={t('code.cmd.newTerminal')} onClick={() => void create()}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
          </button>
          <button className="wb-icon-btn" title={t('code.cmd.killTerminal')} aria-label={t('code.cmd.killTerminal')} onClick={() => kill(active)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.5h6.6l.7-8.5" /></svg>
          </button>
          <button className="wb-icon-btn" title={t('code.cmd.maximizePanel')} aria-label={t('code.cmd.maximizePanel')} onClick={onToggleMaximize}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: maximized ? 'rotate(180deg)' : undefined, transition: 'transform var(--wb-glide) var(--wb-ease)' }}><path d="m4 10 4-4 4 4" /></svg>
          </button>
          <button className="wb-icon-btn" title={t('code.cmd.togglePanel')} aria-label={t('code.cmd.togglePanel')} onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </span>
      </div>
      {notice && (
        <div className="wb-search-msg flex items-center gap-3" data-error={notice.error || undefined} data-term-error role="alert">
          <span className="min-w-0 flex-1">{notice.text}</span>
          {!terminals.length && (
            <button type="button" className="wb-link-btn" onClick={() => void create()}>
              {t('code.terminal.retry')}
            </button>
          )}
          <button type="button" className="wb-link-btn" onClick={() => (terminals.length ? setNotice(null) : onClose())}>
            {t('code.terminal.dismiss')}
          </button>
        </div>
      )}
      <div ref={area} className="relative min-h-0 flex-1 pl-1.5" style={{ background: 'var(--vsc-terminal-background)' }} />
    </div>
  );
}

// Faísca de oito pontas, no espírito da marca do Claude.
export function ClaudeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <path d="M8 2v12M2 8h12M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" />
    </svg>
  );
}
