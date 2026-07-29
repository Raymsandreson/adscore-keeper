// Lista canônica de acolhedores do board Trabalhista (Acidente de Trabalho).
// Os valores devem bater com leads.acolhedor (nome completo) e com o mapa de
// fotos em acolhedorPhotos.ts.
export const TRABALHISTA_BOARD_ID = '2dcd54b5-502b-413b-b795-5e24a20797d2';

export const TRABALHISTA_ACOLHEDORES: string[] = [
  'Analyne Sousa de Oliveira',
  'João Manoel Cavalcante Santana',
  'Bruno Wenner Dantas Nunes',
  'Juliana Clara Santos Pimentel',
  'Luiz Ricardo',
  'Grazielle Aline Moreira da Silva',
];

export function isTrabalhistaBoard(boardId: string | null | undefined): boolean {
  return boardId === TRABALHISTA_BOARD_ID;
}
