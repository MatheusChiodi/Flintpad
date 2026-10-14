// Quadro de exemplo: um fluxo de revisão de artigo. Marcado com `sample: true` e com um aviso
// no próprio quadro; apaga-se como qualquer outro quadro.
import { addShape, connect, emptyBoard, type Board, type ShapeKind } from './model.ts';

export type SampleLabels = {
  note: string;
  draft: string;
  review: string;
  approved: string;
  publish: string;
  fix: string;
};

export function sampleBoard(labels: SampleLabels): Board {
  let board: Board = { ...emptyBoard(), sample: true };
  const add = (kind: ShapeKind, x: number, y: number, w: number, h: number, text: string, fill = 'transparent', stroke?: string) => {
    const result = addShape(board, kind, { x, y, w, h }, { text, fill, stroke });
    board = result.board;
    return result.id;
  };
  add('text', 0, -110, 520, 30, labels.note, 'transparent', '#7c3aed');
  const draft = add('rectangle', 0, 0, 170, 80, labels.draft, '#dbe6fb', '#1d4ed8');
  const review = add('diamond', 250, -20, 190, 120, labels.review, '#fde7d3', '#c2410c');
  const publish = add('ellipse', 600, 0, 170, 80, labels.publish, '#d7f0ec', '#0c6c64');
  const fix = add('rectangle', 255, 170, 180, 70, labels.fix, '#fbdada', '#b91c1c');
  const link = (from: string, to: string) => {
    board = connect(board, from, to)?.board ?? board;
  };
  link(draft, review);
  link(review, publish);
  link(review, fix);
  link(fix, draft);
  add('text', 474, 4, 90, 26, labels.approved, 'transparent', '#0c6c64');
  return board;
}
