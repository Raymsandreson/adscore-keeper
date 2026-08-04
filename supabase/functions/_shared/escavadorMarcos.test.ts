// Testes do parser de marcos processuais (keyword + guard de sigilo).
// Roda com: deno test (ou supabase--test_edge_functions).
//
// Foco: garantir que o placeholder de segredo de justiça do Escavador
// NÃO vire marco de "pagamento" (regressão do processo 0010878-77.2026.5.03.0029,
// uma DECISÃO de indeferimento de tutela que virava falso "Pagamento" porque o
// texto sigiloso contém "PRECATÓRIO OU RPV").
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractMarcos } from "./escavadorMarcos.ts";

// ────────────────────────────────────────────────────────────────────────────
// Guard de sigilo: placeholder do Escavador nunca vira marco
// ────────────────────────────────────────────────────────────────────────────

Deno.test("sigilo: placeholder 'MOVIMENTAÇÃO CONFIDENCIAL ... PRECATÓRIO OU RPV' não gera marco", () => {
  const out = extractMarcos([
    {
      id: 1,
      data: "2026-07-01",
      conteudo: "MOVIMENTAÇÃO CONFIDENCIAL - PROCESSO EM SEGREDO DE JUSTIÇA, PRECATÓRIO OU RPV.",
    },
  ], { numeroCnj: "0010878-77.2026.5.03.0029" });
  assertEquals(out, []);
});

Deno.test("sigilo: placeholder mesmo com classificacao_predita não gera marco", () => {
  const out = extractMarcos([
    {
      id: 2,
      data: "2026-07-01",
      titulo: "Movimentação confidencial",
      conteudo: "Conteúdo sigiloso — processo em segredo de justiça.",
      classificacao_predita: { nome: "Pagamento" },
    },
  ]);
  assertEquals(out, []);
});

// ────────────────────────────────────────────────────────────────────────────
// Não-regressão: pagamento legítimo continua sendo detectado
// ────────────────────────────────────────────────────────────────────────────

Deno.test("pagamento real: alvará de levantamento gera marco pagamento", () => {
  const out = extractMarcos([
    {
      id: 3,
      data: "2026-07-01",
      titulo: "Expedição de alvará",
      conteudo: "Expedido alvará para levantamento do depósito judicial. Comprovante de pagamento anexado.",
    },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].tipo_movimentacao, "pagamento");
});

// ────────────────────────────────────────────────────────────────────────────
// Redistribuição no tribunal não é ajuizamento
// ────────────────────────────────────────────────────────────────────────────

Deno.test("redistribuição: 'Distribuído por sorteio' depois do acórdão NÃO vira petição inicial", () => {
  // Caso real 0000657-98.2025.5.11.0012: a distribuição de 08/06/2026 é a remessa
  // ao relator no TRT, meses após o acórdão de 29/04/2026.
  const out = extractMarcos([
    { id: 1, data: "2026-04-29", titulo: "Acórdão", conteudo: "Acórdão do Tribunal Regional do Trabalho." },
    { id: 2, data: "2026-06-08", titulo: "Distribuição", conteudo: "Distribuído por sorteio" },
  ], { numeroCnj: "0000657-98.2025.5.11.0012" });

  assertEquals(out.filter((m) => m.tipo_movimentacao === "peticao_inicial").length, 0);
  assertEquals(out.filter((m) => m.tipo_movimentacao === "acordao_2grau").length, 1);
});

Deno.test("ajuizamento: distribuição ANTES dos demais marcos continua sendo petição inicial", () => {
  const out = extractMarcos([
    { id: 1, data: "2025-03-10", titulo: "Distribuição", conteudo: "Distribuído por sorteio" },
    { id: 2, data: "2026-04-29", titulo: "Acórdão", conteudo: "Acórdão do Tribunal Regional do Trabalho." },
  ]);

  const pi = out.filter((m) => m.tipo_movimentacao === "peticao_inicial");
  assertEquals(pi.length, 1);
  assertEquals(pi[0].data_movimentacao, "2025-03-10");
});

Deno.test("processo novo: só a distribuição, sem marco avançado, vira petição inicial", () => {
  const out = extractMarcos([
    { id: 1, data: "2026-07-20", titulo: "Distribuição", conteudo: "Distribuído por sorteio" },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].tipo_movimentacao, "peticao_inicial");
});

Deno.test("indeferimento: decisão de tutela indeferida NÃO vira pagamento", () => {
  // Cabeçalho real da decisão — a palavra "pagamento" aparece só no corpo (verba alimentar),
  // fora da janela de cabeçalho, então não deve casar marco de pagamento.
  const out = extractMarcos([
    {
      id: 4,
      data: "2026-06-30",
      titulo: "Decisão",
      conteudo: "DECISÃO DE TUTELA DE URGÊNCIA. Vistos, etc. Os autores postulam a concessão de tutela de urgência para determinar que a reclamada proceda ao",
    },
  ]);
  const pagamentos = out.filter((m) => m.tipo_movimentacao === "pagamento");
  assertEquals(pagamentos.length, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// Escala de marco_ordem: a MESMA das 10 estações (processStations.ts)
// ────────────────────────────────────────────────────────────────────────────

Deno.test("escala: marco_ordem usa a régua de 10 estações, não uma escala própria de 7", () => {
  const casos: Array<[string, string, number]> = [
    ["Distribuição", "Distribuído por sorteio", 1],
    ["Sentença", "Julgo procedente o pedido", 5],
    ["Acordo", "Homologação de acordo entre as partes", 6],
    ["Acórdão", "Acórdão. Negaram provimento ao recurso ordinário", 7],
    ["Trânsito em julgado", "Certidão de trânsito em julgado", 9],
    ["Alvará", "Expedido alvará de levantamento", 10],
  ];
  for (const [titulo, conteudo, ordem] of casos) {
    const out = extractMarcos([{ id: 1, data: "2026-01-10", titulo, conteudo }]);
    assertEquals(out.length, 1, `esperava 1 marco para "${titulo}"`);
    assertEquals(out[0].marco_ordem, ordem, `ordem errada para "${titulo}"`);
  }
});

Deno.test("escala: sentença (5) supera audiência de instrução (4) das estações", () => {
  // Regressão: com a escala antiga sentenca_1grau valia 2 e empatava com
  // audiencia_conciliacao (2); acordao_2grau valia 4 e empatava com
  // audiencia_instrucao (4). O "status atual" (maior marco_ordem) escolhia a
  // audiência e o processo aparecia atrás do estágio real.
  const ORDEM_ESTACOES = { audiencia_conciliacao: 2, pericia: 3, audiencia_instrucao: 4 };
  const out = extractMarcos([
    { id: 1, data: "2026-02-01", titulo: "Sentença", conteudo: "Julgo procedente o pedido" },
    { id: 2, data: "2026-03-01", titulo: "Acórdão", conteudo: "Acórdão. Deram provimento à apelação" },
  ]);
  for (const m of out) {
    assertEquals(
      m.marco_ordem > ORDEM_ESTACOES.audiencia_instrucao,
      true,
      `${m.tipo_movimentacao} (${m.marco_ordem}) deveria superar audiencia_instrucao (4)`,
    );
  }
});
