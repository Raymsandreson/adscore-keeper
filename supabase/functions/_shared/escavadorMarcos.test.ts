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
