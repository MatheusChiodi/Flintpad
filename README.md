# ObNotion

A desktop app that merges the Obsidian model (notes as local Markdown files, `[[wikilinks]]`, backlinks, graph) with the Notion experience (block editor, `/` menu, tabs and shortcuts). It also ships an API client and a code editor, so notes, requests and code live in the same folder.

Everything is original code. Nothing was copied from Obsidian, Notion, Bruno or VS Code; their behavior was studied and reimplemented with open-source libraries.

## Getting started

```bash
npm install
npm run dev     # app with hot reload
npm start       # production build + app
npm run dist    # portable Windows executable in release/
```

On Windows you can also double-click `gerar-exe.bat` to build the executable.

On first launch, pick the vault folder. It can be an existing Obsidian vault: files stay plain `.md` and YAML frontmatter is preserved.

## Features

### Block editor

<img src="docs/editor.svg" alt="Block editor with the slash menu open" width="640">

Each note is a light page set into the dark frame. Type `/` to insert headings, lists, to-dos, tables, quotes and code blocks, and drag blocks to reorder them. The big title renames the file (`Esc` gives up on the typed name); characters that Windows or wikilinks cannot hold (`\ / : * ? " < > | # ^ [ ]`) are dropped.

- **Status bar** at the foot of the page: save state (Saved / Saving… / Not saved, with a retry), word and character counts and reading time. A failed save also shows a notice instead of failing silently.
- **Find in page** with `Ctrl+F`: matches are highlighted in place, `Enter` / `Shift+Enter` (or `F3`) step through them, with a match-case toggle. Highlights use the CSS Custom Highlight API, so the note's text is never touched.
- **Full width**: the button at the right of the status bar (or the command palette) drops the reading column for that page; the choice is remembered per page on this computer.
- **Templates**: pages inside the `Templates` folder (`Modelos` in Portuguese) can start a new page or be inserted at the cursor, from the command palette. `{{title}}`, `{{date}}`, `{{time}}` and `{{date:DD/MM/YYYY}}` (tokens `YYYY MM DD HH mm`) are filled in. A template named after the daily folder (`Templates/Daily`) becomes the starting text of each new daily note.
- **Daily notes** show the full date above the title, with buttons to the previous and next existing daily note and back to today.

`Ctrl+Shift+P` (File → Export as PDF…) saves the open page as an A4 PDF: title and content only, black on white, without the sidebar, tabs or links panel. The file is then shown in its folder.

### Wikilinks and backlinks

<img src="docs/links.svg" alt="Links inside a page and the backlinks panel" width="640">

Link pages with `[[Page]]`, `[[Page|alias]]` or `[[Page#section]]`; type `[` to get page suggestions, and `[Page#` to pick one of that page's headings. A link with a section opens the page scrolled to that heading (it briefly glows), and the section survives editing. Links to pages that do not exist yet are faded; clicking one creates the page, and renaming or moving a page updates every link that points to it. Hovering a link shows a preview card with the start of the page (or of the section); click its title to open it.

The side panel (wide windows) has:

- **Outline**: the page's headings; click one to jump to it. In a narrow window use *Go to a heading* in the command palette.
- **Backlinks**, each with the passage around the link.
- **Links in this page**.
- **Unlinked mentions** (collapsible): pages that mention this page's name as plain text (outside code, links and headings), with a *Link* button that turns those mentions into `[[links]]`, keeping the original wording as the alias.

### Tags

`#tag` in the text (outside code and links) and `tags:` in the frontmatter (inline list or YAML list) are collected into a collapsible Tags section of the sidebar, with counts; `#parent/child` tags nest under their parent, which also counts them. Clicking a tag opens quick search filtered by it.

### Tasks

<img src="docs/tasks.svg" alt="Tasks tab listing to-do items grouped by page, with filters and search" width="640">

`Ctrl+Shift+J` opens the Tasks tab, which gathers the to-do items (`- [ ]` and `- [x]`) from every note in the vault, grouped by page. Filter by open, done or all, search by text, and click a page name to jump to it. Ticking a box rewrites only that line in the note's file.

### Whiteboards

<img src="docs/whiteboard.svg" alt="The sample whiteboard exported as SVG: four shapes connected by arrows" width="640">

`Ctrl+Shift+B` (or **Whiteboards** in the sidebar) opens a whiteboard tab: a list of boards on the left and the canvas on the right.

- **Shapes**: rectangle, ellipse, diamond and free text, each with a label. Drag to move, pull a corner handle to resize, double-click (or `Enter`) to edit the text, pick stroke and fill colors in the panel that appears with a selection.
- **Connectors**: the arrow tool draws from one shape to another; both ends stay attached and follow the shapes when they move. Select two shapes and press `C` to connect them without the mouse. Deleting a shape leaves its arrows in place with a loose end.
- **Boards**: create, rename (double-click in the list or edit the title), open and delete (to the system trash, like notes). **Create sample** adds a small, clearly labelled sample board with a banner and a one-click delete.
- **Autosave**: every change is written to disk a moment later; the header shows *Saving…* / *Saved*, or an error with a retry button.
- **Import / export**: **JSON** (the full board, re-importable), **SVG** and **PNG** (2× resolution, white background). Import takes a `.whiteboard.json` file; the file is validated first (see Limits).
- **Keyboard**: the canvas is focusable. `Tab` walks through the elements (each is announced with its kind and text), arrows nudge the selection (`Shift` for 10 px), `?` lists every shortcut.

| Action | Shortcut |
|---|---|
| Select / Rectangle / Ellipse / Diamond / Arrow / Text | `V` `R` `O` `D` `A` `T` (or `1`–`6`) |
| Delete / Duplicate / Select all | `Delete` / `Ctrl+D` / `Ctrl+A` |
| Copy / Cut / Paste (plain text becomes a text element) | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` |
| Zoom / 100% / Fit everything | `Ctrl`+wheel or `+` `-` / `0` / `Shift+1` |
| Pan | wheel, `Space`+drag or middle button |

**Data location and backup.** Each board is a file `Whiteboards/<name>.whiteboard.json` inside the vault (boards in other vault folders are listed too). Backing up the vault backs up the boards; the files are plain, versioned JSON (`"format": "obnotion-whiteboard", "version": 1`), so they can be diffed, synced or edited by hand. Nothing leaves the computer: no account, no network calls, no telemetry, no secrets (so there is nothing to add to a `.env`).

**Permissions.** None beyond what the app already has: boards are read and written through the same vault-restricted bridge as notes. Exporting opens the system *Save as* dialog.

**Architecture.** The module lives in `src/whiteboard/` and is loaded only when the tab opens:

- `model.ts`: file format, migration chain (files without `version`, from development builds, are upgraded on read; files from a newer version are refused, never overwritten), validation and pure editing operations (add, move, resize, connect, delete, duplicate, paste).
- `render.ts`: turns elements into drawing primitives; both the canvas and the SVG export draw from them, so exports match the screen.
- `storage.ts`: listing, reading, writing and the debounced autosave queue on top of `window.api`; PNG rasterization and downloads.
- `BoardEditor.tsx` (canvas, SVG + pointer events), `Whiteboards.tsx` (list and states), `files.ts`, `sample.ts`, `i18n.ts`, `icons.tsx`.

The rest of the app only knows the `::whiteboards` tab, the sidebar entry and the menu item; removing the folder and those lines removes the feature.

**Limits.**

- Imported files over 5 MB or with more than 5000 elements are refused; unknown element types, invalid numbers or colors and arrows pointing at missing shapes are skipped (the board says how many). Text is limited to 2000 characters per element, and only `#rrggbb` colors reach the SVG.
- Shapes are rectangles, ellipses, diamonds, text and straight arrows. No freehand drawing, images, curved or elbow connectors, rotation, grouping, layers, templates or locking.
- Text does not wrap; shape labels are centered lines.
- No real-time collaboration or sharing; one window edits a board at a time. A board edited elsewhere (for example in the Code tab) while it is open is overwritten by the next change.
- Undo history is kept per open board and is lost when the board is closed or renamed.
- Exports use system fonts when the app font is not installed, so PNG/SVG text may look slightly different outside ObNotion. It does not import or export Excalidraw files.

### Graph

<img src="docs/graph.svg" alt="Graph view with a highlighted node and its neighbours" width="640">

`Ctrl+G` opens the graph. It follows the same rules as the Obsidian graph: d3-force physics, node size by number of links, wheel zoom towards the cursor, draggable nodes, neighbours highlighted on hover, and labels that fade as you zoom out. The settings panel has filters, display options and the four force sliders.

### Tabs and shortcuts

<img src="docs/tabs.svg" alt="Tab bar, page tree and keyboard shortcuts" width="640">

Pages open in tabs with their own back/forward history, next to a collapsible page tree. Shortcuts match the Notion desktop app.

**Quick search** (`Ctrl+P`) matches page names loosely, VS Code style (`cn` finds *Casa nova*, matched letters highlighted), then the text inside notes, showing the passage around each hit. Narrow it with `tag:name` (or `#name`) and `path:folder`; `Ctrl+Enter` opens the result in a new tab, `Enter` on an unknown name creates the page. Start with `>` to get the **command palette**: every menu action plus page commands (rename, duplicate, move, move to trash, insert template, go to heading, random page, full width, pin tab…), each with its shortcut.

**Page tree**: right-click a page (or press the menu key / `Shift+F10`) for open in new tab, rename, duplicate, move to…, favorite, copy link and move to trash. On a focused row, `F2` renames in place, `Delete` moves to the trash and the arrow keys walk the tree. Drag a page onto a folder (or onto the *Pages* header for the vault root) to move it. The filter field above the tree narrows it to matching pages; the buttons beside *Pages* reveal the open page and collapse or expand every folder. The open page's folders open by themselves. Moving a page to the trash shows a notice with **Undo**, which recreates it with the same text.

**Tabs**: right-click a tab to pin it, duplicate it, copy its link or close it, the others or the ones to its right. A pinned tab stays at the left, ignores `Ctrl+W` and opens links in a new tab. Drag tabs to reorder them (`Shift+←/→` on a focused tab). The open tabs, their history and pins come back the next time the vault is opened.

Star a page to pin it in a Favorites section above the page tree: from the links panel, the star beside the title in smaller windows, the page tree, or `Ctrl+Shift+F`. The last 20 pages you opened come first in quick search while the field is empty, and the five most recent are listed when no page is open. Both lists are kept per vault.

| Action | Shortcut |
|---|---|
| New page / New tab | `Ctrl+N` / `Ctrl+T` |
| Today's note (one page per day, in the `Daily` folder) | `Ctrl+D` |
| Close tab / Reopen last closed | `Ctrl+W` / `Ctrl+Shift+T` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Back / Forward | `Ctrl+[` / `Ctrl+]` |
| Toggle sidebar | `Ctrl+\` |
| Collapse sidebar into icons (focus mode) | `Ctrl+Shift+\` or the panel button next to the vault name |
| Copy page link / page name | `Ctrl+L` / `Ctrl+Alt+L` |
| Add / remove current page from favorites | `Ctrl+Shift+F` |
| Find in page | `Ctrl+F` |
| Rename / move to trash the focused page in the tree | `F2` / `Delete` |
| Context menu of the focused tree row or tab | `Shift+F10` or the menu key |
| Export page as PDF | `Ctrl+Shift+P` |
| Paste without formatting | `Ctrl+Shift+V` |
| Quick search (creates the page if missing) | `Ctrl+P` |
| Tasks | `Ctrl+Shift+J` |
| Whiteboards | `Ctrl+Shift+B` |
| Graph / Requests / Code | `Ctrl+G` / `Ctrl+Shift+E` / `Ctrl+Shift+K` |
| Open another vault | `Ctrl+O` |
| Quit | `Ctrl+Shift+Q` |

The menu bar is hidden; press `Alt` to show it. In a narrow window (under 900 px) the sidebar collapses into an icon rail; use quick search to reach pages. With the sidebar hidden (`Ctrl+\`), a button at the left of the tabs brings it back.

### Requests

<img src="docs/requests.svg" alt="API client with a request list, URL bar and JSON response" width="640">

`Ctrl+Shift+E` opens an API client. Each request is a `.bru` file inside the vault, in the same format Bruno uses, so the `Requests` folder opens as a collection in Bruno and a Bruno collection copied into the vault shows up here.

- Method, URL, query parameters (kept in sync with the URL) and headers.
- Body as JSON, text, XML or URL-encoded form.
- Bearer, Basic and API key authentication.
- Environments with `{{variables}}`, and a warning when one has no value.
- Response status, time, size, formatted body and headers. `Ctrl+Enter` sends; a running request can be cancelled.
- Notes per request. Blocks the screen does not edit (scripts, tests, vars) are kept in the file.
- **Saving**: edits stay as an unsaved draft (dot in the list) until `Ctrl+S` or **Save**; drafts survive switching requests and tabs. **Save as…** and **Duplicate** write a copy under a new name or folder.
- **Mentions in pages**: type `[` in a page and pick a request; it shows as a chip with its method and opens the request when clicked. **Copy link** gives the same `[[Requests/Name.bru|Name]]` link to paste. Each request lists the pages that mention it, and a page's links panel lists its requests.
- **History**: every send is kept with its response (last 200, in `.obnotion/request-history.json` inside the vault), grouped by day. Open one to read the response again, send it again, save it to the collection or jump to the original request. Opening a request shows its last response.

Not there yet, compared to Bruno: scripts and tests, collection runner, GraphQL, gRPC, WebSocket, OAuth2/AWS/NTLM, multipart and file upload, cookies, proxy and certificates, Postman/OpenAPI import, auth inherited from the collection, Git integration, secret variables.

### Code

<img src="docs/code.svg" alt="Code editor with syntax highlighting, themes and snippets" width="640">

`Ctrl+Shift+K` opens a workbench laid out like VS Code, built on Monaco (the editor inside VS Code):

- **Explorer** for any folder on disk (the vault by default; `Open folder…`, `Open file…` and recent folders from the buttons above it). `Add folder to workspace…` opens several projects side by side, as a VS Code multi-root workspace, with new file/folder, rename, delete to trash, reveal in File Explorer and live refresh when files change on disk.
- **Editor tabs** with preview tabs (single click, italic), dirty markers, breadcrumbs, auto save (toggle in the status bar) and `Ctrl+S`.
- **Quick Open** (`Ctrl+P`), **Command Palette** (`Ctrl+Shift+P` or `F1`, including every Monaco editor action), go to line (`Ctrl+G`) and go to symbol (`Ctrl+Shift+O`).
- **Integrated terminal** (`` Ctrl+` ``, new with `` Ctrl+Shift+` ``): real PowerShell sessions through a pseudo-terminal, several at once, kept alive when you switch tabs.
- **Language servers**: the native TypeScript 7 server (`tsc --lsp`) for TypeScript/JavaScript and the VS Code JSON, CSS/SCSS/Less and HTML servers. Project-aware completions, hover, diagnostics, go to definition/references across files (`F12`, `Shift+F12`), rename, formatting, and JSON validation with the schemas VS Code extensions declare (package.json, tsconfig.json…).
- **Status bar** with errors/warnings, cursor position, indentation, line endings and language mode, each clickable as in VS Code.

ObNotion reads the extensions already installed in your VS Code (the built-in ones and those in `~/.vscode/extensions`):

- **Color themes** recolor the whole workbench (side bar, tabs, status bar, terminal, pickers) and the code. `Preferences: Color theme` (`Ctrl+K Ctrl+T`) previews each theme as you move through the list.
- **TextMate grammars** do the syntax highlighting, through the same engine as VS Code (`vscode-textmate` + Oniguruma), so the colors match VS Code's.
- **File icon themes** (Seti by default, Minimal, Modern or any installed one) in the explorer, tabs and Quick Open.
- **Languages and language configuration** (file associations, comments, brackets, indentation rules) and **snippets**.
- There is no extensions view: what the installed extensions contribute just works. Extensions that run their own code in the VS Code extension host (ESLint, Prettier, debuggers, Git, assistants) do not run here.

### Languages

<img src="docs/languages.svg" alt="Settings with the language choice" width="640">

The interface is available in English and Brazilian Portuguese. Change it in Settings (`Ctrl+,`); it applies right away, including the menu.

## Known limits

- Converting between blocks and Markdown is lossy: when you edit a note its formatting is normalized (for example `-` lists become `*` and tables are realigned). Opening a note without editing does not touch the file.
- Obsidian-only syntax (callouts `> [!note]`, embeds `![[...]]`, Dataview, canvas) shows as plain text.
- No Notion databases, no sync, no plugins.
- Files and folders starting with `.` are ignored.
- Favorites, recent pages, the tab session and full-width pages are stored in the app, keyed by the vault's folder path, not in the vault: moving or renaming the vault folder resets them.
- The daily-note and template folders follow the interface language (`Daily`/`Templates` in English, `Diário`/`Modelos` in Portuguese).
- Find in page searches the visible text of the editor; there is no replace.

## Project layout

- `electron/main.cjs`: window, menu, disk access restricted to the vault, HTTP requests, VS Code extension reader.
- `electron/workspace.cjs`: the Code tab's open folder (file access limited to it, the vault and files picked in a dialog) and its file watcher.
- `electron/terminal.cjs`, `electron/lsp.cjs`: terminal sessions and language server processes.
- `electron/preload.cjs`: the `window.api` bridge.
- `src/App.tsx`: state (tabs, link index).
- `src/whiteboard/`: the whiteboard module (see Whiteboards above).
- `src/components/`: `Editor` (BlockNote + wikilinks), `NoteTools` (find bar, status bar), `LinkPreview`, `DailyNav`, `ContextMenu`, `Sidebar`, `Panels` (tabs, links panel, quick search and command palette), `Graph`, `Tasks`, `Requests`, `Code` and its parts in `code/` (explorer, quick input, terminal, extensions).
- `src/lib/`: link parsing, note logic (`notes.ts`: tags, headings, word counts, mentions, search, templates), tabs and session (`tabs.ts`), task extraction, `.bru` request model, VS Code themes and snippets, TextMate grammars (`textmate.ts`), icon themes, workbench colors, the LSP bridge (`lsp.ts`).
- `tests/`: unit tests for `src/lib` and `src/whiteboard`, run with `npm test` (Node's built-in test runner). `npm run test:e2e` builds the app and runs `tests/e2e/whiteboard.e2e.mjs`: it starts the real Electron app off-screen with a temporary vault (through the existing `OBNOTION_SHOT`/`OBNOTION_EVAL` test hooks, no extra dependency), creates a board, draws, moves and connects shapes, exports SVG and PNG, then relaunches the app and checks that autosave kept everything.
- `docs/`: illustrations used in this file.

## Credits

Built on [Electron](https://www.electronjs.org/), [React](https://react.dev/), [BlockNote](https://www.blocknotejs.org/), [d3-force](https://d3js.org/d3-force), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [vscode-textmate](https://github.com/microsoft/vscode-textmate), [xterm.js](https://xtermjs.org/), [node-pty](https://github.com/microsoft/node-pty), [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) and [`@usebruno/lang`](https://www.npmjs.com/package/@usebruno/lang).
