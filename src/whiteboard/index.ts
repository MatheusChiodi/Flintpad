// Módulo do quadro branco. Interface pública:
//   default        a guia Quadros (lista + editor), carregada sob demanda pelo App
//   model          formato do arquivo, migração, validação e operações puras
//   render         primitivas de desenho e exportação SVG
//   files          nomes e caminhos (.whiteboard.json)
// Para remover o módulo: apagar esta pasta e as linhas marcadas com "whiteboard" em App.tsx,
// types.ts, Sidebar.tsx, Panels.tsx, Icons.tsx, i18n.tsx, styles.css e electron/ (menu).
export { default } from './Whiteboards';
export { BOARD_EXT, BOARD_FOLDER, isBoardPath } from './files.ts';
export { BOARD_FORMAT, BOARD_VERSION, parseBoard, serializeBoard } from './model.ts';
export { boardToSvg } from './render.ts';
