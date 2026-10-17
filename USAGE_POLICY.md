# Usage policy

Flintpad is free and open-source software released under the [MIT License](LICENSE). This page explains, in plain words, what that means for you and what Flintpad does (and does not do) with your data. If anything here conflicts with the license, the license wins.

## You may

- Use Flintpad for any purpose, personal or commercial, at no cost.
- Read, modify and build the source code.
- Redistribute Flintpad, modified or not, including inside commercial products, as long as you keep the copyright notice and the MIT License text.

## Please

- **Don't present a fork as the official Flintpad.** If you distribute a modified build, give it a different name and icon, or state clearly that it is an unofficial build. The name "Flintpad" and the Flintpad logo identify this project; the MIT License covers the code, not the right to imply endorsement.
- **Keep third-party notices.** Flintpad bundles open-source libraries (listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)); their own licenses still apply to them.
- **Report security problems privately**: see [SECURITY.md](SECURITY.md).

## No warranty

Flintpad is provided "as is", without warranty of any kind. It reads and writes files in the folders you choose. Keep backups of anything important; the authors are not liable for data loss or any other damage.

## Privacy

Flintpad is local-first and private by default:

- **No account, no cloud, no telemetry, no analytics, no ads.** The app does not phone home.
- Your notes, boards, requests and settings stay on your computer: notes and boards as plain files inside the vault folder you pick, preferences in the app's data folder (shown in *Settings → About*).
- The app only connects to the network when **you** ask it to: sending a request from the Requests tab, opening a web link, browsing in the Browser tab (sites you visit see you as any browser would; bookmark and top-site icons come from Google's favicon service), running commands in the integrated terminal, or opening Claude Code (which talks to Anthropic under your own account).
- The Browser tab keeps its history, bookmarks, download list and site permissions in the app's data folder, never in the vault; incognito tabs keep nothing after the last one closes.
- Nothing you write is sent to Flintpad's authors or to any third party.

## Third-party names

Obsidian, Notion, Bruno, Visual Studio Code, Cursor, Excalidraw, Google Chrome, Chromium, Claude and Claude Code are trademarks of their respective owners. Flintpad is an independent project, not affiliated with or endorsed by any of them. It reimplements ideas and open formats (Markdown, `.bru` files) with original code.
