# Contributing to Flintpad

Thanks for helping! Bug reports, ideas, documentation fixes and pull requests are all welcome.

## Before you start

- **Bugs:** search the [issues](https://github.com/MatheusChiodi/Flintpad/issues) first, then open one with the bug template.
- **Features:** open an issue (feature template) before writing a large change, so we can agree on the approach.
- **Security problems:** never in a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 22 or newer and npm. Windows is the main target; macOS and Linux builds are welcome but less tested.

```bash
git clone https://github.com/MatheusChiodi/Flintpad.git
cd Flintpad
npm install
npm run dev        # app with hot reload
npm test           # unit tests (Node's built-in runner)
npm run build      # type check + production build
npm run test:e2e   # builds and runs the Electron end-to-end test
npm run dist:dir   # fast build: release/win-unpacked/Flintpad.exe
npm run dist       # single portable Windows executable in release/
```

## Guidelines

- **Never break existing behavior.** Notes stay plain Markdown, `.bru` files stay compatible with Bruno, and whiteboard files keep loading (add a migration instead of changing a format in place).
- **Local and private.** No telemetry, analytics, accounts or required network access. Network features must be triggered by the user.
- **Treat file content as untrusted.** Validate on read, escape anything rendered into HTML/SVG, and keep disk access behind the vault-restricted bridge in `electron/`.
- **Match the surrounding code**: TypeScript, React function components, Tailwind with the tokens in `src/styles.css`. Most code comments are in Portuguese; follow the file you are editing.
- **Both languages.** Every visible string goes through i18n, with the same key in `pt-BR` and `en`.
- **Accessibility.** Keyboard access, visible focus and labels for every control; respect reduced motion.
- **Tests.** Put pure logic in `src/lib` (or the module folder) and cover it in `tests/`. `npm test` and `npm run build` must pass.
- **Docs.** Update the README when you add or change a feature or shortcut, and add a line to [CHANGELOG.md](CHANGELOG.md).

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the PR focused on one change; describe what and why, with a screenshot for UI changes.
3. Make sure CI is green.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
