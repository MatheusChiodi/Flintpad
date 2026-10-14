import { BlockNoteSchema, defaultInlineContentSpecs } from '@blocknote/core';
import { en, pt } from '@blocknote/core/locales';
import { BlockNoteView } from '@blocknote/mantine';
import { createReactInlineContentSpec, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { useEffect, useRef, useState } from 'react';

import { useLanguage, useT } from '../lib/i18n';
import { baseName, linkRegex, restoreWikilinks, splitFrontmatter } from '../lib/links';
import type { Note } from '../types';
import { StarIcon } from './Icons';

const SAVE_DELAY_MS = 400;
const MAX_SUGGESTIONS = 12;

export const openLinkEvent = 'obnotion:open-link';

const Wikilink = createReactInlineContentSpec(
  { type: 'wikilink', propSchema: { target: { default: '' }, alias: { default: '' } }, content: 'none' } as const,
  {
    render: ({ inlineContent }) => {
      const { target, alias } = inlineContent.props;
      return (
        <span
          className="wikilink"
          onMouseDown={(event) => {
            event.preventDefault();
            window.dispatchEvent(new CustomEvent(openLinkEvent, { detail: target }));
          }}
        >
          {alias || target}
        </span>
      );
    },
    toExternalHTML: ({ inlineContent }) => {
      const { target, alias } = inlineContent.props;
      return <span>{`[[${target}${alias ? `|${alias}` : ''}]]`}</span>;
    },
  },
);

const schema = BlockNoteSchema.create({
  inlineContentSpecs: { ...defaultInlineContentSpecs, wikilink: Wikilink },
});

// Troca o texto "[[Alvo]]" vindo do Markdown por nós de wikilink clicáveis.
function linkify(blocks: any[]): any[] {
  for (const block of blocks) {
    if (Array.isArray(block.content)) {
      block.content = block.content.flatMap((item: any) => {
        if (item.type !== 'text' || !item.text.includes('[[')) return [item];
        const parts: any[] = [];
        let last = 0;
        for (const match of item.text.matchAll(linkRegex())) {
          if (match.index > last) parts.push({ ...item, text: item.text.slice(last, match.index) });
          parts.push({ type: 'wikilink', props: { target: match[1].trim(), alias: match[2]?.trim() ?? '' } });
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
  favorite: boolean;
  onToggleFavorite: () => void;
  onSaved: (path: string, content: string) => void;
  onRename: (path: string, name: string) => void;
};

export function Editor({ path, notes, favorite, onToggleFavorite, onSaved, onRename }: Props) {
  const t = useT();
  // O dicionário só é lido na criação: a troca de língua remonta o componente (key em App).
  const { language } = useLanguage();
  const editor = useCreateBlockNote({ schema, dictionary: language === 'en' ? en : pt });
  const [title, setTitle] = useState(baseName(path));
  const session = useRef({ front: '', saved: '', latest: '', ready: false, timer: 0 });

  const toMarkdown = async () => restoreWikilinks(await editor.blocksToMarkdownLossy(editor.document));

  const flush = () => {
    const s = session.current;
    window.clearTimeout(s.timer);
    if (!s.ready || s.latest === s.saved) return;
    s.saved = s.latest;
    const content = s.front + s.latest;
    const write = window.api.write(path, content).then(() => onSaved(path, content));
    pendingWrites.set(path, write);
    void write.finally(() => pendingWrites.get(path) === write && pendingWrites.delete(path));
  };

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
      if (window.api.debug) console.log(`baseline ${path}\n${s.saved}`);
    })();
    return () => {
      alive = false;
      flush();
    };
    // O componente é remontado a cada troca de nota (key = path).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = async () => {
    const s = session.current;
    if (!s.ready) return;
    s.latest = await toMarkdown();
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  const commitTitle = () => {
    const name = title.trim().replace(/[\\/:*?"<>|]/g, '');
    if (!name || name === baseName(path)) return setTitle(baseName(path));
    flush();
    onRename(path, name);
  };

  const suggestNotes = async (query: string) => {
    const wanted = query.replace(/^\[/, '').toLowerCase();
    return notes
      .filter((n) => n.path !== path && n.name.toLowerCase().includes(wanted))
      .slice(0, MAX_SUGGESTIONS)
      .map((n) => ({
        title: n.name,
        subtext: n.path,
        onItemClick: () =>
          editor.insertInlineContent([{ type: 'wikilink', props: { target: n.name, alias: '' } }, ' ']),
      }));
  };

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 pb-40 pt-16">
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
  );
}
