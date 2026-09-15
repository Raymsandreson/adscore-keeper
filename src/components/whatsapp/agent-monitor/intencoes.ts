/**
 * O vocabulário das intenções do atendente virtual, num lugar só.
 *
 * Estava inteiro dentro do `RelatorioDeIntencoes`. Quando o clique na linha
 * passou a abrir a aba lateral com as decisões daquela intenção, o painel de
 * lá precisava do mesmo rótulo, da mesma família e da mesma cor — e rótulo
 * duplicado é rótulo que diverge no terceiro mês.
 */

/**
 * As 23 intenções em português. O código é o que o modelo devolve; o rótulo é
 * o que a pessoa lê. Manter os dois juntos evita a tela pedir que alguém
 * decore "E20".
 *
 * Esta lista tem um par na `dom-rascunho` (o prompt de classificação). Intenção
 * nova lá precisa entrar aqui, senão aparece como o código cru — que é feio,
 * mas não quebra: o fallback é mostrar o próprio código.
 */
export const ROTULOS: Record<string, string> = {
  A1: 'Andamento do processo',
  A2: 'Explicar algo já dito',
  A3: 'Problema prático (app, acesso)',
  A4: 'O que ELE precisa fazer',
  B5: 'Desabafo, ansiedade',
  B6: 'Notícia boa',
  B7: 'Notícia ruim, dificuldade',
  B23: 'Elogio',
  C8: 'Entregando dado pedido',
  C9: 'Mandando documento',
  C10: 'Agendamento',
  C11: 'Fato novo do caso',
  D12: 'Só cumprimento',
  D13: 'Agradecimento, fechamento',
  D14: 'Assunto fora do caso',
  D15: 'Mensagem da equipe',
  E16: 'Reclamação',
  E17: 'Dinheiro ou prazo',
  E18: 'Quer falar com alguém',
  E19: 'Assunto jurídico novo',
  E20: 'Fala em desistir',
  E21: 'Pede dinheiro adiantado',
  E22: 'Indica cliente novo',
  COBRANCA: 'Cobrança',
};

export const rotuloDaIntencao = (codigo: string): string => ROTULOS[codigo] || codigo;

/** A letra do código é a família. Serve para cor, ordem e para o gráfico. */
export const FAMILIA_DE = (codigo: string): string => {
  if (codigo === 'COBRANCA') return 'cobrança';
  if (codigo.startsWith('A')) return 'perguntou algo';
  if (codigo.startsWith('B')) return 'desabafo';
  if (codigo.startsWith('C')) return 'entregou algo';
  if (codigo.startsWith('D')) return 'não pede resposta';
  if (codigo.startsWith('E')) return 'precisa de gente';
  return 'sem classificação';
};

/**
 * DUAS CORES E UMA ESCALA DE CINZA — DE PROPÓSITO.
 *
 * A primeira versão pintava as sete famílias com sete matizes diferentes
 * (vermelho, laranja, azul, teal, roxo e dois cinzas). Sete cores com o mesmo
 * peso não hierarquizam nada: o roxo do desabafo brigava com o vermelho de
 * "fala em desistir" pela mesma atenção, e a tela inteira gritava igual.
 *
 * Agora o alfabeto é curto:
 *
 * - VERMELHO (`--destructive`) só para o que custa cliente se demorar —
 *   "precisa de gente" e, mais claro, a cobrança.
 * - VERDE da marca (`--primary`, o mesmo 153 100% 33% do resto do sistema)
 *   para o que o atendente virtual deu conta sozinho.
 * - CINZA para todo o resto, em tons que separam desabafo de bom-dia sem
 *   pedir atenção.
 *
 * São valores literais e não `hsl(var(--token))` porque o recharts escreve a
 * cor no atributo `fill` do SVG, e atributo com `var()` já falhou em cliente
 * embutido — barra preta que nenhum build acusa. Os números são os mesmos do
 * `index.css`; se a paleta mudar lá, muda aqui.
 */
export const COR: Record<string, string> = {
  'precisa de gente': 'hsl(0 84% 60%)',
  'cobrança': 'hsl(0 72% 77%)',
  'perguntou algo': 'hsl(153 100% 33%)',
  'entregou algo': 'hsl(153 42% 64%)',
  'desabafo': 'hsl(0 0% 58%)',
  'não pede resposta': 'hsl(0 0% 78%)',
  'sem classificação': 'hsl(0 0% 88%)',
};

/** Ordem fixa: o que exige gente em cima, o ruído embaixo. */
export const ORDEM_FAMILIAS = [
  'precisa de gente', 'cobrança', 'perguntou algo',
  'entregou algo', 'desabafo', 'não pede resposta', 'sem classificação',
];

/**
 * O que o atendente virtual fez, em português e com a mesma semântica de cor
 * da tabela: vermelho é o que sobrou para a equipe, verde é o que ele resolveu,
 * cinza é o que não pedia resposta.
 */
export const DECISOES: Record<string, { rotulo: string; classe: string }> = {
  humano: { rotulo: 'precisou de gente', classe: 'text-destructive border-destructive/30 bg-destructive/5' },
  respondeu: { rotulo: 'o Dom respondeu', classe: 'text-primary border-primary/30 bg-primary/5' },
  silencio: { rotulo: 'calou', classe: 'text-muted-foreground border-border bg-muted/40' },
  pulou: { rotulo: 'pulou', classe: 'text-muted-foreground border-border bg-muted/40' },
};
