// =============================================================================
// Uma mensagem por CLIENTE, não uma por movimentação.
//
// O sino notificava de um em um: cada clique montava a mensagem daquela linha e
// mandava. Com 43 movimentações em 30 grupos numa semana (12/08/2026), isso é
// 43 cliques — e sete clientes recebiam duas ou mais mensagens seguidas, um
// deles seis. Aqui as movimentações do mesmo cliente viram UM texto só: os
// registros em ordem, o glossário uma vez, e o "próximo passo" da movimentação
// que mais pesa entre elas.
//
// Determinístico, sem IA: o texto que chega ao cliente não pode depender de
// redação que ninguém revisou.
// =============================================================================
import { format, parseISO } from 'date-fns';
import type { ProcessUpdate, UpdateCategoria } from '@/hooks/useProcessUpdates';
import { ASSUNTO_SIMPLES, EXPLICACAO, blocoTextoDoTribunal, traduzirTermos } from '@/lib/linguagemSimples';

/**
 * Peso da categoria. Define QUEM manda na mensagem quando o cliente tem várias
 * movimentações: a audiência marcada é o assunto, não o "juntada de petição"
 * que caiu depois dela.
 */
const PESO: Record<UpdateCategoria, number> = {
  decisao_merito: 6,
  audiencia: 5,
  pericia: 4,
  prazo: 3,
  despacho: 2,
  movimentacao: 1,
};

/** Registros citados no corpo. Acima disso vira parede de texto e ninguém lê. */
const MAX_REGISTROS = 6;
/** Explicações de categoria no "Como está?" — mesma razão. */
const MAX_EXPLICACOES = 3;
/** Termos do glossário no fim do bloco. */
const MAX_TERMOS = 3;

export interface CamposDaMensagem {
  /** Vira o título da atividade e o "Assunto" no topo da mensagem. */
  titulo: string;
  comoEsta: string;
  oQueFoiFeito: string;
  proximo: string;
}

function fmtDia(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), 'dd/MM/yyyy');
  } catch {
    return iso;
  }
}

function rotuloProcesso(u: ProcessUpdate): string {
  return u.processo_titulo || u.numero_cnj || 'processo';
}

/** Mais pesada primeiro; empate na categoria, a mais recente. */
export function movimentacaoPrincipal(updates: ProcessUpdate[]): ProcessUpdate {
  return [...updates].sort((a, b) => {
    const pa = PESO[a.categoria] ?? 1;
    const pb = PESO[b.categoria] ?? 1;
    if (pa !== pb) return pb - pa;
    const da = a.data_movimentacao || a.created_at;
    const dbb = b.data_movimentacao || b.created_at;
    return da < dbb ? 1 : -1;
  })[0];
}

/** Cronológica ascendente: o cliente lê a história do processo na ordem em que aconteceu. */
function ordemDeLeitura(updates: ProcessUpdate[]): ProcessUpdate[] {
  return [...updates].sort((a, b) => {
    const da = a.data_movimentacao || a.created_at;
    const dbb = b.data_movimentacao || b.created_at;
    return da < dbb ? -1 : da > dbb ? 1 : 0;
  });
}

/**
 * Passo do POP no fim do "próximo passo" — entre parênteses, porque é escrito
 * para a equipe ("Redação da Petição") e não pode ser a frase endereçada ao
 * cliente. Some da mensagem quando o caso não tem POP.
 */
function comPassoDoPop(texto: string, passoPop: string | null): string {
  return passoPop
    ? `${texto}\n_(Na nossa lista de tarefas, o passo em andamento é: ${passoPop}.)_`
    : texto;
}

/**
 * UMA movimentação — o texto que o sino sempre mandou. Continua aqui inteiro
 * para o caminho de um clique não mudar de comportamento por causa do lote.
 */
export function camposDeUmaMovimentacao(u: ProcessUpdate, passoPop: string | null): CamposDaMensagem {
  const explicacao = EXPLICACAO[u.categoria] || EXPLICACAO.movimentacao;
  return {
    titulo: `${ASSUNTO_SIMPLES[u.categoria]} — ${rotuloProcesso(u)}`,
    comoEsta: explicacao.comoEsta,
    oQueFoiFeito: blocoTextoDoTribunal(u.descricao),
    proximo: comPassoDoPop(explicacao.proximo, passoPop),
  };
}

/**
 * VÁRIAS movimentações do mesmo cliente num texto só.
 *
 * Um cliente pode ter movimentação de mais de um processo no período (10 de 71
 * leads em 30 dias, até 3 processos) — por isso cada registro sai identificado
 * quando há mais de um processo em jogo. Sem isso o cliente lê três blocos e
 * não sabe de qual caso é qual.
 */
export function camposConsolidados(updates: ProcessUpdate[], passoPop: string | null): CamposDaMensagem {
  if (updates.length === 1) return camposDeUmaMovimentacao(updates[0], passoPop);

  const principal = movimentacaoPrincipal(updates);
  const n = updates.length;
  const processos = new Set(updates.map((u) => u.process_id));
  const variosProcessos = processos.size > 1;

  // ---- Assunto ----
  const restantes = n - 1;
  const alvo = variosProcessos ? 'seus processos' : rotuloProcesso(principal);
  const titulo = `${ASSUNTO_SIMPLES[principal.categoria]} e mais ${restantes} `
    + `${restantes === 1 ? 'atualização' : 'atualizações'} — ${alvo}`;

  // ---- Como está? ----
  // Uma explicação por CATEGORIA presente (as três que mais pesam), não uma por
  // movimentação: seis "juntada de petição" gerariam seis vezes o mesmo texto.
  const categorias = [...new Set(updates.map((u) => u.categoria))]
    .sort((a, b) => (PESO[b] ?? 1) - (PESO[a] ?? 1))
    .slice(0, MAX_EXPLICACOES);
  const comoEsta = [
    `Desde o último aviso, ${n} atualizações foram registradas `
    + `${variosProcessos ? 'nos seus processos' : 'no seu processo'}.`,
    ...categorias.map((c) => `*${ASSUNTO_SIMPLES[c]}*\n${(EXPLICACAO[c] || EXPLICACAO.movimentacao).comoEsta}`),
  ].join('\n\n');

  // ---- O que foi feito? ----
  // Cabeçalho e glossário saem UMA vez; no lugar de repetir o preâmbulo de
  // blocoTextoDoTribunal a cada registro, aqui vai a citação nua com a data.
  const emOrdem = ordemDeLeitura(updates);
  const mostrados = emOrdem.slice(-MAX_REGISTROS);
  const omitidos = emOrdem.length - mostrados.length;

  const registros = mostrados.map((u) => {
    const dia = fmtDia(u.data_movimentacao);
    const cabecalho = [dia ? `📅 ${dia}` : null, variosProcessos ? rotuloProcesso(u) : null]
      .filter(Boolean).join(' · ');
    const texto = (u.descricao || '').replace(/\s+/g, ' ').trim();
    return [cabecalho || null, texto ? `_"${texto}"_` : '_(o tribunal não detalhou este registro)_']
      .filter(Boolean).join('\n');
  });

  const glossario: Array<{ termo: string; explicacao: string }> = [];
  const vistos = new Set<string>();
  for (const u of mostrados) {
    for (const t of traduzirTermos(u.descricao)) {
      if (vistos.has(t.termo) || glossario.length >= MAX_TERMOS) continue;
      vistos.add(t.termo);
      glossario.push(t);
    }
  }

  // Blocos separados por linha em branco. `filter(Boolean)` só pode rodar sobre
  // os blocos OPCIONAIS — jogado em cima de uma lista com '' de separação, ele
  // apaga justamente as linhas em branco e cola tudo.
  const blocos = [
    `Acompanhamos ${variosProcessos ? 'os seus processos' : 'o seu processo'} e estes foram os registros que apareceram:`,
    registros.join('\n\n'),
  ];
  if (omitidos > 0) {
    blocos.push(`_(Além destes, houve mais ${omitidos} ${omitidos === 1 ? 'registro' : 'registros'} de rotina no período.)_`);
  }
  if (glossario.length) {
    blocos.push([
      '📖 Explicando os termos que aparecem aí:',
      ...glossario.map((g) => `• *${g.termo}*: ${g.explicacao}.`),
    ].join('\n'));
  }
  const oQueFoiFeito = blocos.join('\n\n');

  // ---- Próximo passo ----
  // O da movimentação que mais pesa: quem tem audiência marcada precisa ler
  // sobre a audiência, não sobre "seguimos acompanhando".
  const proximo = comPassoDoPop((EXPLICACAO[principal.categoria] || EXPLICACAO.movimentacao).proximo, passoPop);

  return { titulo, comoEsta, oQueFoiFeito, proximo };
}
