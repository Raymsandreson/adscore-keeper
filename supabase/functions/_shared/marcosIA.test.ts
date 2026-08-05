// Testes do classificador de marcos por IA.
// Roda com: deno test supabase/functions/_shared/marcosIA.test.ts
//
// Foco NÃO é a qualidade da classificação (isso é do modelo) e sim as GUARDAS:
// resposta da IA é entrada não confiável, e um marco trocado entre processos de
// clientes diferentes é pior do que marco nenhum. Por isso todo resultado que
// não casa exatamente com o que foi enviado tem que ser descartado.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classificarMarcosIA, type MovParaClassificar } from "./marcosIA.ts";

function entradas(n: number): MovParaClassificar[] {
  return Array.from({ length: n }, (_, i) => ({
    ref: `r${i}`,
    predita: null,
    titulo: `mov ${i}`,
    texto: `teor da movimentacao ${i}`,
  }));
}

/** Stub de chat que devolve sempre o mesmo texto. */
function chatFixo(texto: string) {
  let chamadas = 0;
  const fn = (() => {
    chamadas++;
    return Promise.resolve({ choices: [{ message: { content: texto } }] });
  }) as never;
  return { fn, contar: () => chamadas };
}

Deno.test("aceita resposta bem formada", async () => {
  const { fn } = chatFixo(JSON.stringify([
    { ref: "r0", tipo: "sentenca_1grau", confianca: "alta", motivo: "sentenca proferida" },
    { ref: "r1", tipo: "nenhum", confianca: "alta", motivo: "certidao de publicacao" },
  ]));
  const out = await classificarMarcosIA(entradas(2), { chat: fn });
  assertEquals(out.size, 2);
  assertEquals(out.get("r0")?.tipo, "sentenca_1grau");
  assertEquals(out.get("r1")?.tipo, "nenhum");
});

Deno.test("descarta ref que nao foi enviado", async () => {
  // O modo de falha que motivou o ref explícito: o Flash em lote devolve
  // resultado atribuído a um item que não estava no lote.
  const { fn } = chatFixo(JSON.stringify([
    { ref: "r0", tipo: "acordo", confianca: "alta", motivo: "acordo homologado" },
    { ref: "INVENTADO", tipo: "pagamento", confianca: "alta", motivo: "alvara" },
  ]));
  const out = await classificarMarcosIA(entradas(2), { chat: fn });
  assertEquals(out.size, 1);
  assertEquals(out.has("INVENTADO"), false);
});

Deno.test("descarta tipo fora da regua canonica", async () => {
  const { fn } = chatFixo(JSON.stringify([
    { ref: "r0", tipo: "embargos_declaracao", confianca: "alta", motivo: "inventado" },
  ]));
  const out = await classificarMarcosIA(entradas(1), { chat: fn });
  assertEquals(out.size, 0);
});

Deno.test("ignora ref repetido no mesmo lote (fica o primeiro)", async () => {
  const { fn } = chatFixo(JSON.stringify([
    { ref: "r0", tipo: "acordo", confianca: "alta", motivo: "primeiro" },
    { ref: "r0", tipo: "pagamento", confianca: "alta", motivo: "segundo" },
  ]));
  const out = await classificarMarcosIA(entradas(1), { chat: fn });
  assertEquals(out.size, 1);
  assertEquals(out.get("r0")?.tipo, "acordo");
});

Deno.test("tolera cerca ```json e texto em volta", async () => {
  const { fn } = chatFixo(
    'Claro! Segue:\n```json\n[{"ref":"r0","tipo":"pericia","confianca":"media","motivo":"laudo juntado"}]\n```',
  );
  const out = await classificarMarcosIA(entradas(1), { chat: fn });
  assertEquals(out.get("r0")?.tipo, "pericia");
});

Deno.test("JSON quebrado nao derruba a execucao", async () => {
  const { fn } = chatFixo('[{"ref":"r0","tipo":"acor');
  const out = await classificarMarcosIA(entradas(1), { chat: fn });
  assertEquals(out.size, 0);
});

Deno.test("lote que joga excecao nao aborta os demais", async () => {
  let n = 0;
  const fn = (() => {
    n++;
    if (n === 1) return Promise.reject(new Error("500 do provider"));
    return Promise.resolve({
      choices: [{ message: { content: JSON.stringify([
        { ref: "r8", tipo: "transito_julgado", confianca: "alta", motivo: "certidao" },
      ]) } }],
    });
  }) as never;
  // 9 itens = 2 lotes (8 + 1). O primeiro falha, o segundo tem que passar.
  const out = await classificarMarcosIA(entradas(9), { chat: fn });
  assertEquals(n, 2);
  assertEquals(out.size, 1);
  assertEquals(out.get("r8")?.tipo, "transito_julgado");
});

Deno.test("confianca invalida vira baixa", async () => {
  const { fn } = chatFixo(JSON.stringify([
    { ref: "r0", tipo: "acordo", confianca: "certeza absoluta", motivo: "x" },
  ]));
  const out = await classificarMarcosIA(entradas(1), { chat: fn });
  assertEquals(out.get("r0")?.confianca, "baixa");
});

Deno.test("respeita o lote de 8", async () => {
  const { fn, contar } = chatFixo("[]");
  await classificarMarcosIA(entradas(17), { chat: fn });
  assertEquals(contar(), 3); // 8 + 8 + 1
});
