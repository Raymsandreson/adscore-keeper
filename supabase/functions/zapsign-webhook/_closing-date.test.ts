// Testes da prioridade da data de fechamento usada no auto_close_lead_on_sign.
// Roda com: supabase--test_edge_functions (Deno test runner).
//
// Cobertura:
//   1) resolveClosingDate — função pura: groupDate > signedAtIso > today
//   2) fetchGroupCreationDate — busca grupo + chama UazAPI com fetch mockado
import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchGroupCreationDate, resolveClosingDate } from "./_closing-date.ts";

// ────────────────────────────────────────────────────────────────────────────
// 1) resolveClosingDate — prioridade pura
// ────────────────────────────────────────────────────────────────────────────

Deno.test("resolveClosingDate: usa groupDate quando presente (vence signed_at e today)", () => {
  const out = resolveClosingDate("2024-01-15", "2026-06-03T10:00:00Z", "2026-06-03T20:00:00Z");
  assertStrictEquals(out, "2024-01-15");
});

Deno.test("resolveClosingDate: usa signed_at quando groupDate é null", () => {
  const out = resolveClosingDate(null, "2026-06-03T10:00:00Z", "2026-06-03T20:00:00Z");
  assertStrictEquals(out, "2026-06-03");
});

Deno.test("resolveClosingDate: usa signed_at quando groupDate é string vazia", () => {
  const out = resolveClosingDate("", "2026-06-03T10:00:00Z", "2026-06-03T20:00:00Z");
  assertStrictEquals(out, "2026-06-03");
});

Deno.test("resolveClosingDate: usa today quando ambos faltam", () => {
  const out = resolveClosingDate(null, null, "2026-06-03T20:00:00Z");
  assertStrictEquals(out, "2026-06-03");
});

Deno.test("resolveClosingDate: ignora groupDate malformado e cai pra signed_at", () => {
  const out = resolveClosingDate("amanhã" as any, "2026-06-03T10:00:00Z", "2026-06-03T20:00:00Z");
  assertStrictEquals(out, "2026-06-03");
});

Deno.test("resolveClosingDate: hoje como default real quando nada é passado", () => {
  const out = resolveClosingDate(null, null);
  // formato YYYY-MM-DD
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(out);
  assertStrictEquals(ok, true);
});

// ────────────────────────────────────────────────────────────────────────────
// 2) fetchGroupCreationDate — mocks de Supabase + fetch
// ────────────────────────────────────────────────────────────────────────────

// Mock minimal do query builder do Supabase. Cada .from() retorna um objeto
// encadeável que termina em .maybeSingle() devolvendo { data } pré-definido.
function makeClient(rows: Record<string, any>) {
  const builder = (table: string) => {
    let stored: any = rows[table] ?? null;
    const api: any = {
      select: () => api,
      eq: () => api,
      ilike: () => api,
      not: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: stored, error: null }),
    };
    return api;
  };
  return { from: builder };
}

function mockFetchOk(body: unknown): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

function mockFetchFail(status = 500): typeof fetch {
  return (async () => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => "",
  })) as unknown as typeof fetch;
}

Deno.test("fetchGroupCreationDate: retorna null quando lead não tem grupo", async () => {
  const client = makeClient({
    lead_whatsapp_groups: null,
    leads: { whatsapp_group_id: null },
  });
  const out = await fetchGroupCreationDate(client, "lead-1", "abraci-01", mockFetchOk({}));
  assertStrictEquals(out, null);
});

Deno.test("fetchGroupCreationDate: extrai data de 'creation' (Unix timestamp em segundos)", async () => {
  const client = makeClient({
    lead_whatsapp_groups: { group_jid: "123@g.us" },
    whatsapp_instances: { instance_token: "tk", base_url: "https://abraci.uazapi.com" },
  });
  // 2024-01-15T12:00:00Z = 1705320000
  const out = await fetchGroupCreationDate(
    client,
    "lead-1",
    "abraci-01",
    mockFetchOk({ creation: 1705320000 }),
  );
  assertStrictEquals(out, "2024-01-15");
});

Deno.test("fetchGroupCreationDate: aceita campo 'GroupCreated' (ISO string)", async () => {
  const client = makeClient({
    lead_whatsapp_groups: { group_jid: "123@g.us" },
    whatsapp_instances: { instance_token: "tk", base_url: "https://abraci.uazapi.com" },
  });
  const out = await fetchGroupCreationDate(
    client,
    "lead-1",
    "abraci-01",
    mockFetchOk({ GroupCreated: "2023-06-10T08:30:00Z" }),
  );
  assertStrictEquals(out, "2023-06-10");
});

Deno.test("fetchGroupCreationDate: fallback para leads.whatsapp_group_id quando não há row em lead_whatsapp_groups", async () => {
  const client = makeClient({
    lead_whatsapp_groups: null,
    leads: { whatsapp_group_id: "999@g.us" },
    whatsapp_instances: { instance_token: "tk", base_url: "https://abraci.uazapi.com" },
  });
  const out = await fetchGroupCreationDate(
    client,
    "lead-1",
    "abraci-01",
    mockFetchOk({ creation: 1705320000 }),
  );
  assertStrictEquals(out, "2024-01-15");
});

Deno.test("fetchGroupCreationDate: retorna null quando UazAPI responde 4xx/5xx", async () => {
  const client = makeClient({
    lead_whatsapp_groups: { group_jid: "123@g.us" },
    whatsapp_instances: { instance_token: "tk", base_url: "https://abraci.uazapi.com" },
  });
  const out = await fetchGroupCreationDate(client, "lead-1", "abraci-01", mockFetchFail(500));
  assertStrictEquals(out, null);
});

Deno.test("fetchGroupCreationDate: retorna null quando não há instância com token", async () => {
  const client = makeClient({
    lead_whatsapp_groups: { group_jid: "123@g.us" },
    whatsapp_instances: null,
  });
  const out = await fetchGroupCreationDate(client, "lead-1", null, mockFetchOk({ creation: 1 }));
  assertStrictEquals(out, null);
});

Deno.test("fetchGroupCreationDate: normaliza JID adicionando @g.us quando vem só o número", async () => {
  let calledUrl = "";
  let calledBody = "";
  const client = makeClient({
    lead_whatsapp_groups: { group_jid: "120363" },
    whatsapp_instances: { instance_token: "tk", base_url: "https://abraci.uazapi.com" },
  });
  const fetchSpy: typeof fetch = (async (url: any, init: any) => {
    calledUrl = String(url);
    calledBody = String(init?.body || "");
    return {
      ok: true,
      status: 200,
      json: async () => ({ creation: 1705320000 }),
      text: async () => "",
    };
  }) as unknown as typeof fetch;
  await fetchGroupCreationDate(client, "lead-1", "abraci-01", fetchSpy);
  assertEquals(calledUrl, "https://abraci.uazapi.com/group/info");
  assertEquals(JSON.parse(calledBody).id, "120363@g.us");
});

// ────────────────────────────────────────────────────────────────────────────
// 3) Integração das duas peças — simulando o auto_close_lead_on_sign
// ────────────────────────────────────────────────────────────────────────────

Deno.test("integração: grupo antigo + signed_at hoje → became_client_date = data do grupo", async () => {
  const client = makeClient({
    lead_whatsapp_groups: { group_jid: "abc@g.us" },
    whatsapp_instances: { instance_token: "tk", base_url: "https://abraci.uazapi.com" },
  });
  const groupDate = await fetchGroupCreationDate(
    client,
    "lead-old",
    "abraci-01",
    mockFetchOk({ creation: 1705320000 }), // 2024-01-15
  );
  const signedAtIso = "2026-06-03T15:00:00Z";
  const closingDate = resolveClosingDate(groupDate, signedAtIso);
  assertStrictEquals(closingDate, "2024-01-15");
});

Deno.test("integração: sem grupo + signed_at presente → became_client_date = signed_at", async () => {
  const client = makeClient({
    lead_whatsapp_groups: null,
    leads: { whatsapp_group_id: null },
  });
  const groupDate = await fetchGroupCreationDate(client, "lead-new", "abraci-01", mockFetchOk({}));
  const closingDate = resolveClosingDate(groupDate, "2026-06-03T15:00:00Z");
  assertStrictEquals(closingDate, "2026-06-03");
});

Deno.test("integração: sem grupo + sem signed_at → became_client_date = today", async () => {
  const client = makeClient({
    lead_whatsapp_groups: null,
    leads: { whatsapp_group_id: null },
  });
  const groupDate = await fetchGroupCreationDate(client, "lead-x", null, mockFetchOk({}));
  const closingDate = resolveClosingDate(groupDate, null, "2026-06-03T20:00:00Z");
  assertStrictEquals(closingDate, "2026-06-03");
});
