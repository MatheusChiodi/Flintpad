import { BlockNoteSchema, defaultInlineContentSpecs } from '@blocknote/core';
import { en, pt } from '@blocknote/core/locales';
import { BlockNoteView } from '@blocknote/mantine';
import { createReactInlineContentSpec, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useLanguage, useT } from '../lib/i18n';
import { baseName, isRequestTarget, resolveLink, restoreWikilinks, splitFrontmatter } from '../lib/links';
import { gotoHeadingEvent, previewLink, setNoteIndex, takeHeading, useResolvedLink, type HeadingRequest } from '../lib/noteBridge';
import { detailedLinkRegex, extractHeadings, headingKey, linkMarkdown, sanitizeNoteName, textStats, type TextStats } from '../lib/notes';
import { getRequestIndex, useRequestSummary } from '../lib/requestIndex';
import type { Note } from '../types';
import { StarIcon } from './Icons';
import { FindBar, StatusBar, type SaveState } from './NoteTools';

const SAVE_DELAY_MS = 400;
const MAX_SUGGESTIONS = 12;
const FLASH_MS = 1200;

export const openLinkEvent = 'obnotion:open-link';
export const findFocusEvent = 'obnotion:find-focus';
// Pedidos de fora para o editor de uma página: gravar já o que está pendente (antes de renomear ou
// mover) ou descartar (a página foi para a lixeira; gravar recriaria o arquivo).
const noteCommandEvent = 'obnotion:note-command';
type NoteCommand = { path: string; discard: boolean };
export const flushNote = (path: string) => window.dispatchEvent(new CustomEvent<NoteCommand>(noteCommandEvent, { detail: { path, discard: false } }));
export const discardNote = (path: string) => window.dispatchEvent(new CustomEvent<NoteCommand>(noteCommandEvent, { detail: { path, discard: true } }));

// Inserir Markdown no ponto do cursor (modelos): vira blocos, com os wikilinks já clicáveis.
const insertMarkdownEvent = 'obnotion:insert-markdown';
export const insertMarkdown = (path: string, markdown: string) =>
  window.dispatchEvent(new CustomEvent(insertMarkdownEvent, { detail: { path, markdown } }));

// Abrir a busca na página por fora do teclado (paleta de comandos).
export const findOpenEvent = 'obnotion:find-open';

// Link para uma request (.bru): mostra o método e o nome; sem a request, fica riscado.
function RequestChip({ target, alias }: { target: string; alias: string }) {
  const t = useT();
  const request = useRequestSummary(target);
  const method = request?.method.toUpperCase() ?? '';
  const label = alias || request?.name || target.split('/').pop()!.replace(/\.bru$/i, '');
  return (
    <span
      className="wikilink request-link"
      data-missing={!request}
      title={request ? `${method} ${request.url}` : t('links.requestMissing')}
      onMouseDown={(event) => {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(openLinkEvent, { detail: target }));
      }}
    >
      {method && <span className="request-link-method" data-method={method}>{method === 'DELETE' ? 'DEL' : method}</span>}
      {label}
    </span>
  );
}

// Link para página: fica esmaecido quando a página ainda não existe; com seção, mostra "Página › Seção".
function NoteLinkChip({ target, section, alias }: { target: string; section: string; alias: string }) {
  const t = useT();
  const path = useResolvedLink(target);
  const detail = section ? `${target}#${section}` : target;
  return (
    <span
      className="wikilink"
      data-missing={!path}
      title={path ? undefined : t('links.missing')}
      onMouseDown={(event) => {
        event.preventDefault();
        previewLink(null);
        window.dispatchEvent(new CustomEvent(openLinkEvent, { detail }));
      }}
      onMouseEnter={(event) => {
        if (!path) return;
        const rect = event.currentTarget.getBoundingClientRect();
        previewLink({ target: detail, rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width } });
      }}
      onMouseLeave={() => previewLink(null)}
    >
      {alias || (section ? `${target} › ${section}` : target)}
    </span>
  );
}

const Wikilink = createReactInlineContentSpec(
  {
    type: 'wikilink',
    propSchema: { target: { default: '' }, section: { default: '' }, alias: { default: '' } },
    content: 'none',
  } as const,
  {
    render: ({ inlineContent }) => {
      const { target, section, alias } = inlineContent.props;
      if (isRequestTarget(target)) return <RequestChip target={target} alias={alias} />;
      return <NoteLinkChip target={target} section={section} alias={alias} />;
    },
    // A seção vai junto: sem ela, [[Página#Seção]] voltaria ao disco como [[Página]].
    toExternalHTML: ({ inlineContent }) => <span>{linkMarkdown(inlineContent.props)}</span>,
  },
);

const schema = BlockNoteSchema.create({
  inlineContentSpecs: { ...defaultInlineContentSpecs, wikilink: Wikilink },
});

// Troca o texto "[[Alvo#Seção|apelido]]" vindo do Markdown por nós de wikilink clicáveis.
function linkify(blocks: any[]): any[] {
  for (const block of blocks) {
    if (Array.isArray(block.content)) {
      block.content = block.content.flatMap((item: any) => {
        if (item.type !== 'text' || !item.text.includes('[[')) return [item];
        const parts: any[] = [];
        let last = 0;
        for (const match of item.text.matchAll(detailedLinkRegex())) {
          if (match.index > last) parts.push({ ...item, text: item.text.slice(last, match.index) });
          parts.push({
            type: 'wikilink',
            props: { target: match[1].trim(), section: match[2]?.trim() ?? '', alias: match[3]?.trim() ?? '' },
          });
          last = match.index + match[0].length;
        }
        if (last < item.text.length) parts.push({ ...item, text: item.text.slice(last) });
        return parts;
      });
    }
    if (block.children?.length) linkify(block.children);
  }
  return blocks;
}

// Texto visível de um bloco (para achar um título pelo nome).
function blockText(block: any): string {
  if (!Array.isArray(block.content)) return '';
  return block.content
    .map((item: any) => {
      if (item.type === 'text') return item.text;
      if (item.type === 'wikilink') return item.props.alias || item.props.target;
      return (item.content ?? []).map((inner: any) => inner.text ?? '').join('');
    })
    .join('');
}

function headingBlocks(blocks: any[], out: any[] = []): any[] {
  for (const block of blocks) {
    if (block.type === 'heading') out.push(block);
    if (block.children?.length) headingBlocks(block.children, out);
  }
  return out;
}

// Gravações em andamento por nota, para a próxima abertura esperar por elas.
const pendingWrites = new Map<string, Promise<void>>();

// Quem lê a nota do disco fora do editor (guia Tarefas) espera a gravação em andamento.
export const pendingWrite = (path: string) => pendingWrites.get(path)?.catch(() => undefined);

// Quem grava a nota fora do editor registra a gravação, para o editor esperar por ela ao abrir.
export function trackWrite(path: string, write: Promise<void>): Promise<void> {
  pendingWrites.set(path, write);
  void write.finally(() => pendingWrites.get(path) === write && pendingWrites.delete(path)).catch(() => undefined);
  return write;
}

type Props = {
  path: string;
  notes: Note[];
  /** Conteúdo das páginas (para sugerir os títulos de outra página em [[Página#). */
  contents: Record<string, string>;
  favorite: boolean;
  onToggleFavorite: () => void;
  onSaved: (path: string, content: string) => void;
  onRename: (path: string, name: string) => void;
  /** Falha ao gravar no disco: quem chama avisa o usuário. */
  onSaveError: (error: unknown) => void;
  /** Faixa acima do título (navegação da nota diária, por exemplo). */
  header?: ReactNode;
  /** Largura cheia em vez da coluna de leitura. */
  wide?: boolean;
  onToggleWide: () => void;
};

export function Editor({ path, notes, contents, favorite, onToggleFavorite, onSaved, onRename, onSaveError, header, wide, onToggleWide }: Props) {
  const t = useT();
  // O dicionário só é lido na criação: a troca de língua remonta o componente (key em App).
  const { language } = useLanguage();
  const editor = useCreateBlockNote({ schema, dictionary: language === 'en' ? en : pt });
  const [title, setTitle] = useState(baseName(path));
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [stats, setStats] = useState<TextStats>({ words: 0, characters: 0, minutes: 0 });
  const [finding, setFinding] = useState(false);
  const [version, setVersion] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  const session = useRef({ front: '', saved: '', latest: '', ready: false, failed: false, timer: 0 });

  useEffect(() => setNoteIndex(notes), [notes]);

  const toMarkdown = async () => restoreWikilinks(await editor.blocksToMarkdownLossy(editor.document));

  const flush = () => {
    const s = session.current;
    window.clearTimeout(s.timer);
    if (!s.ready || (s.latest === s.saved && !s.failed)) return;
    s.failed = false;
    s.saved = s.latest;
    const text = s.front + s.latest;
    const write = window.api.write(path, text).then(
      () => {
        onSaved(path, text);
        if (s.latest === s.saved && !s.failed) setSaveState('saved');
      },
      (error) => {
        // A próxima edição (ou a saída da nota) tenta gravar de novo.
        s.failed = true;
        setSaveState('error');
        onSaveError(error);
      },
    );
    pendingWrites.set(path, write);
    void write.finally(() => pendingWrites.get(path) === write && pendingWrites.delete(path));
  };

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Rola até o título pedido e põe o cursor nele: pelo índice quando o texto confere, senão pelo texto.
  const showHeading = (request: HeadingRequest) => {
    const headings = headingBlocks(editor.document);
    const wanted = headingKey(request.text);
    const byIndex = request.index !== undefined ? headings[request.index] : undefined;
    const block =
      byIndex && headingKey(blockText(byIndex)) === wanted
        ? byIndex
        : (headings.find((heading) => headingKey(blockText(heading)) === wanted) ?? byIndex);
    if (!block) return;
    const element = content.current?.querySelector(`[data-id="${CSS.escape(block.id)}"]`);
    element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    element?.classList.add('flash');
    window.setTimeout(() => element?.classList.remove('flash'), FLASH_MS);
    editor.setTextCursorPosition(block, 'end');
  };
  const showHeadingRef = useRef(showHeading);
  showHeadingRef.current = showHeading;

  useEffect(() => {
    const s = session.current;
    let alive = true;
    void (async () => {
      // Um editor recém-desmontado da mesma nota pode ainda estar gravando: ler antes traria texto velho.
      await pendingWrites.get(path)?.catch(() => undefined);
      const [front, body] = splitFrontmatter(await window.api.read(path));
      if (!alive) return;
      const blocks = linkify(await editor.tryParseMarkdownToBlocks(body));
      editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: 'paragraph' }]);
      // A linha de base evita regravar a nota só por abri-la.
      s.front = front;
      s.saved = s.latest = await toMarkdown();
      s.ready = true;
      setStats(textStats(s.latest));
      setVersion((v) => v + 1);
      const heading = takeHeading(path);
      if (heading) requestAnimationFrame(() => showHeadingRef.current(heading));
      if (window.api.debug) console.log(`baseline ${path}\n${s.saved}`);
    })();
    const onHeading = (event: Event) => {
      const request = (event as CustomEvent<HeadingRequest>).detail;
      if (request.path === path && s.ready && takeHeading(path)) showHeadingRef.current(request);
    };
    // Ctrl+F abre a busca na página (Ctrl+Shift+F é favoritar, no menu). Com um diálogo aberto, não.
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'f') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setFinding(true);
      window.dispatchEvent(new Event(findFocusEvent));
    };
    const onFindOpen = () => {
      setFinding(true);
      window.dispatchEvent(new Event(findFocusEvent));
    };
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<NoteCommand>).detail;
      if (command.path !== path) return;
      if (!command.discard) return flushRef.current();
      window.clearTimeout(s.timer);
      s.ready = false;
    };
    window.addEventListener(gotoHeadingEvent, onHeading);
    window.addEventListener('keydown', onKey);
    window.addEventListener(findOpenEvent, onFindOpen);
    window.addEventListener(noteCommandEvent, onCommand);
    const onInsert = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; markdown: string }>).detail;
      if (detail.path !== path || !s.ready) return;
      void (async () => {
        const blocks = linkify(await editor.tryParseMarkdownToBlocks(detail.markdown));
        if (!blocks.length) return;
        const anchor = editor.getTextCursorPosition().block;
        // Num parágrafo vazio o modelo toma o lugar dele; senão entra logo abaixo.
        const empty = anchor.type === 'paragraph' && Array.isArray(anchor.content) && anchor.content.length === 0;
        if (empty) editor.replaceBlocks([anchor], blocks);
        else editor.insertBlocks(blocks, anchor, 'after');
        editor.focus();
      })();
    };
    window.addEventListener(insertMarkdownEvent, onInsert);
    return () => {
      alive = false;
      window.removeEventListener(gotoHeadingEvent, onHeading);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(findOpenEvent, onFindOpen);
      window.removeEventListener(noteCommandEvent, onCommand);
      window.removeEventListener(insertMarkdownEvent, onInsert);
      flush();
    };
    // O componente é remontado a cada troca de nota (key = path).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = async () => {
    const s = session.current;
    if (!s.ready) return;
    s.latest = await toMarkdown();
    if (s.latest !== s.saved || s.failed) setSaveState(s.failed ? 'error' : 'saving');
    setStats(textStats(s.latest));
    setVersion((v) => v + 1);
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  const commitTitle = () => {
    const name = sanitizeNoteName(title);
    if (!name || name === baseName(path)) return setTitle(baseName(path));
    flush();
    onRename(path, name);
  };

  const insertLink = (target: string, section = '', alias = '') =>
    editor.insertInlineContent([{ type: 'wikilink', props: { target, section, alias } }, ' ']);

  // "[" sugere páginas e requests; a request entra como link para o arquivo .bru, com o nome de apelido.
  // "[Página#" sugere os títulos daquela página ("[#", os desta).
  const suggestNotes = async (query: string) => {
    const wanted = query.replace(/^\[/, '');
    const hash = wanted.indexOf('#');
    if (hash >= 0) {
      const name = wanted.slice(0, hash).trim();
      const targetPath = name ? resolveLink(name, notes) : path;
      if (!targetPath) return [];
      const source = targetPath === path ? session.current.latest : (contents[targetPath] ?? '');
      const filter = headingKey(wanted.slice(hash + 1));
      const targetName = baseName(targetPath);
      return extractHeadings(source)
        .filter((heading) => headingKey(heading.text).includes(filter))
        .slice(0, MAX_SUGGESTIONS)
        .map((heading) => ({
          title: heading.text,
          subtext: `${'#'.repeat(heading.level)} ${targetName}`,
          group: t('editor.suggest.headings'),
          onItemClick: () => insertLink(targetName, heading.text.replace(/[\]|#]/g, '')),
        }));
    }
    const lower = wanted.toLowerCase();
    const pages = notes
      .filter((n) => n.path !== path && n.name.toLowerCase().includes(lower))
      .slice(0, MAX_SUGGESTIONS)
      .map((n) => ({ title: n.name, subtext: n.path, group: t('editor.suggest.pages'), onItemClick: () => insertLink(n.name) }));
    const requests = getRequestIndex()
      .filter((r) => `${r.name} ${r.url} ${r.method}`.toLowerCase().includes(lower))
      .slice(0, MAX_SUGGESTIONS)
      .map((r) => ({
        title: r.name,
        subtext: `${r.method.toUpperCase()} ${r.url || r.path}`,
        group: t('editor.suggest.requests'),
        onItemClick: () => insertLink(r.path, '', r.name.replace(/[\]|]/g, '')),
      }));
    return [...pages, ...requests];
  };

  const findRoot = useCallback(() => content.current?.querySelector<HTMLElement>('.bn-editor') ?? null, []);
  const closeFind = () => {
    setFinding(false);
    editor.focus();
  };
  const retry = () => {
    session.current.failed = true;
    flush();
  };

  return (
    <div className="note-shell flex min-h-full flex-col">
      {finding && (
        <div className="find-dock">
          <FindBar root={findRoot} version={version} onClose={closeFind} />
        </div>
      )}
      <div ref={content} className={`note-page mx-auto w-full flex-1 pb-40 pt-16 ${wide ? 'max-w-none px-10' : 'max-w-[820px] px-6'}`}>
        {header}
        <div className="relative mb-5">
          <input
            className="title-input block w-full bg-transparent px-[54px] outline-none"
            value={title}
            placeholder={t('note.untitled')}
            aria-label={t('editor.titleLabel')}
            spellCheck={false}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              // Esc desiste do nome digitado.
              if (event.key === 'Escape') {
                setTitle(baseName(path));
                requestAnimationFrame(() => editor.focus());
                return;
              }
              if (event.key !== 'Enter') return;
              event.preventDefault();
              editor.focus();
            }}
          />
          {/* Com o painel de links oculto (janela menor), a estrela fica na margem do título. */}
          <div className="absolute right-3.5 top-3 lg:hidden">
            <button
              className="icon-button sheet-button"
              data-on={favorite}
              title={t(favorite ? 'favorites.remove' : 'favorites.add')}
              aria-label={t(favorite ? 'favorites.remove' : 'favorites.add')}
              aria-pressed={favorite}
              onClick={onToggleFavorite}
            >
              <StarIcon size={15} filled={favorite} />
            </button>
          </div>
        </div>
        <BlockNoteView editor={editor} theme="light" onChange={handleChange}>
          <SuggestionMenuController triggerCharacter="[" getItems={suggestNotes} />
        </BlockNoteView>
      </div>
      <StatusBar state={saveState} stats={stats} onRetry={retry} wide={Boolean(wide)} onToggleWide={onToggleWide} />
    </div>
  );
}
