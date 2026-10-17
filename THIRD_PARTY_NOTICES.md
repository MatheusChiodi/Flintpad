# Third-party notices

Flintpad's own code is released under the [MIT License](LICENSE). The app also bundles the open-source components below, which remain under their own licenses. Each one's full copyright notice and license text is in its package (`node_modules/<package>/LICENSE` after `npm install`) and its repository, linked below. The Windows build places this file and Flintpad's `LICENSE` next to `Flintpad.exe`, together with `LICENSE.electron.txt` and `LICENSES.chromium.html` (the licenses of Chromium and its dependencies).

Only components shipped inside the app are listed. Build and test tools (Vite, Tailwind CSS, TypeScript type packages, electron-builder, concurrently, cross-env, wait-on) are used to produce the app but are not part of it.

## Runtime and engine

| Component | Version | License | Used for |
|---|---|---|---|
| [Electron](https://github.com/electron/electron) | 44.7.1 | MIT | Desktop runtime |
| [Chromium](https://www.chromium.org/) (inside Electron) | bundled with Electron | BSD-3-Clause and others (see `LICENSES.chromium.html`) | Rendering engine and the Browser tab |
| [Node.js](https://nodejs.org/) (inside Electron) | bundled with Electron | MIT and others | Main process |

## Interface

| Component | Version | License | Used for |
|---|---|---|---|
| [React](https://github.com/facebook/react) / React DOM | 19.3.0 | MIT | User interface |
| [BlockNote](https://github.com/TypeCellOS/BlockNote) (`@blocknote/core`, `react`, `mantine`) | 0.55.0 | MPL-2.0 | Block editor for notes |
| [Mantine](https://github.com/mantinedev/mantine) (`@mantine/core`, `hooks`) | 9.7.2 | MIT | Editor menus and popovers |
| [d3-force](https://github.com/d3/d3-force) | 3.0.0 | ISC | Graph layout |
| [Monaco Editor](https://github.com/microsoft/monaco-editor) | 0.57.0 | MIT | Code editor |
| [vscode-textmate](https://github.com/microsoft/vscode-textmate) | 9.3.2 | MIT | Syntax highlighting |
| [vscode-oniguruma](https://github.com/microsoft/vscode-oniguruma) | 2.0.1 | MIT | Regular expressions for grammars |
| [xterm.js](https://github.com/xtermjs/xterm.js) (`@xterm/xterm`, `addon-fit`) | 6.0.0 / 0.11.0 | MIT | Terminal panel |
| [node-sql-parser](https://github.com/taozhi8833998/node-sql-parser) | 5.4.0 | Apache-2.0 | SQL validation |

## Main process

| Component | Version | License | Used for |
|---|---|---|---|
| [@lydell/node-pty](https://github.com/lydell/node-pty) (fork of microsoft/node-pty) | 1.2.0-beta.15 | MIT | Terminal sessions |
| [@usebruno/lang](https://www.npmjs.com/package/@usebruno/lang) | 0.40.0 | MIT | `.bru` request files |
| [jsonc-parser](https://github.com/microsoft/node-jsonc-parser) | 3.3.1 | MIT | VS Code settings and extension files |
| [TypeScript](https://github.com/microsoft/TypeScript) | 7.0.2 | Apache-2.0 | TypeScript language server (`tsc --lsp`) |
| [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) | 4.10.0 | MIT | JSON, CSS and HTML language servers |

## Fonts

| Font | Version | License |
|---|---|---|
| [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) (`@fontsource-variable/bricolage-grotesque`) | 5.3.0 | SIL Open Font License 1.1 |
| [Instrument Sans](https://github.com/Instrument/instrument-sans) (`@fontsource-variable/instrument-sans`) | 5.3.0 | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (`@fontsource-variable/jetbrains-mono`) | 5.3.0 | SIL Open Font License 1.1 |

## Notes on specific licenses

- **MPL-2.0 (BlockNote).** Flintpad uses BlockNote unmodified, as published on npm. Its source code is available at <https://github.com/TypeCellOS/BlockNote>. If you modify BlockNote's files in a fork, the MPL-2.0 requires you to make those modified files available under the same license.
- **Apache-2.0 (TypeScript, node-sql-parser).** Used unmodified; their `LICENSE` and any `NOTICE` files ship inside the packages.
- **SIL OFL 1.1 (fonts).** The fonts may be bundled and redistributed with the app; they may not be sold on their own.

## Not bundled

Visual Studio Code extensions (themes, grammars, icon themes, snippets) are read from your own VS Code installation at run time and are not distributed with Flintpad. The Claude Code CLI is not bundled either: Flintpad only starts it if you installed it yourself.

To check versions and licenses, run in the project folder (interface libraries are `devDependencies` because Vite bundles them into the app):

```bash
node -e "const p=require('./package.json');for(const n of Object.keys({...p.dependencies,...p.devDependencies})){const q=require('./node_modules/'+n+'/package.json');console.log(n,q.version,q.license)}"
```
