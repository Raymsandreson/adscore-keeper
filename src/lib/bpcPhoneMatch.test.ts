import { describe, it, expect } from "vitest";
import {
  buildBpcAcolhedorFilter,
  leadMatchesFilter,
  phoneKey,
  digitsOnly,
} from "./bpcPhoneMatch";

describe("digitsOnly", () => {
  it("aceita null/undefined sem quebrar", () => {
    expect(digitsOnly(null)).toBe("");
    expect(digitsOnly(undefined)).toBe("");
    expect(digitsOnly(123 as unknown)).toBe("123");
  });
  it("limpa formatação", () => {
    expect(digitsOnly("+55 (11) 99999-1234")).toBe("5511999991234");
  });
});

describe("phoneKey", () => {
  it("retorna últimos 8 dígitos", () => {
    expect(phoneKey("+5511999991234")).toBe("99991234");
    expect(phoneKey("11999991234")).toBe("99991234");
    expect(phoneKey("999991234")).toBe("99991234");
  });
  it("retorna '' pra telefone curto/inválido", () => {
    expect(phoneKey("")).toBe("");
    expect(phoneKey(null)).toBe("");
    expect(phoneKey("1234")).toBe("");
  });
});

describe("buildBpcAcolhedorFilter", () => {
  const leads = [
    { operator: "Karolyne", phone_normalized: "5511999991111" },
    { operator: " KAROLYNE ", phone_normalized: "5511888882222" }, // case + whitespace
    { operator: "Edilan", phone_raw: "(11) 77777-3333" },          // fallback raw
    { operator: "Mateus", phone_normalized: "5511666664444" },
    { operator: "", phone_normalized: "5511555555555" },           // sem operator
    { operator: "Karolyne", phone_normalized: null },              // sem phone
    { operator: "Karolyne", phone_normalized: "abc" },             // phone inválido
    { operator: null, phone_normalized: "5511444444444" },         // operator null
  ];

  it("sem seleção → null (passa tudo)", () => {
    const r = buildBpcAcolhedorFilter({ selected: [], leads });
    expect(r.phoneKeys).toBeNull();
  });

  it("filtra case-insensitive e trim", () => {
    const r = buildBpcAcolhedorFilter({ selected: ["Karolyne"], leads });
    expect(r.phoneKeys?.has("99991111")).toBe(true);
    expect(r.phoneKeys?.has("88882222")).toBe(true);
    expect(r.phoneKeys?.has("66664444")).toBe(false);
    expect(r.matchedLeadCount).toBe(4); // 2 com phone + 2 sem
    expect(r.validPhoneCount).toBe(2);
    expect(r.droppedNoPhone).toBe(2);
  });

  it("multi-select combina acolhedores", () => {
    const r = buildBpcAcolhedorFilter({ selected: ["Karolyne", "Edilan"], leads });
    expect(r.phoneKeys?.has("99991111")).toBe(true);
    expect(r.phoneKeys?.has("77773333")).toBe(true);
    expect(r.phoneKeys?.has("66664444")).toBe(false);
  });

  it("__none__ inclui operator vazio/null", () => {
    const r = buildBpcAcolhedorFilter({ selected: ["__none__"], leads });
    expect(r.phoneKeys?.has("55555555")).toBe(true);
    expect(r.phoneKeys?.has("44444444")).toBe(true);
    expect(r.phoneKeys?.has("99991111")).toBe(false);
  });

  it("não quebra com leads vazio/undefined", () => {
    expect(() => buildBpcAcolhedorFilter({ selected: ["Karolyne"], leads: [] })).not.toThrow();
    expect(() =>
      buildBpcAcolhedorFilter({ selected: ["Karolyne"], leads: undefined as unknown as [] }),
    ).not.toThrow();
  });
});

describe("leadMatchesFilter", () => {
  const filter = { phoneKeys: new Set(["99991234"]) };
  it("casa por últimos 8 dígitos independente do prefixo 55", () => {
    expect(leadMatchesFilter("+5511999991234", filter)).toBe(true);
    expect(leadMatchesFilter("11999991234", filter)).toBe(true);
    expect(leadMatchesFilter("999991234", filter)).toBe(true);
  });
  it("rejeita telefones diferentes", () => {
    expect(leadMatchesFilter("5511888880000", filter)).toBe(false);
  });
  it("trata null/empty como não-match", () => {
    expect(leadMatchesFilter(null, filter)).toBe(false);
    expect(leadMatchesFilter("", filter)).toBe(false);
    expect(leadMatchesFilter("123", filter)).toBe(false);
  });
  it("phoneKeys=null → passa tudo", () => {
    expect(leadMatchesFilter(null, { phoneKeys: null })).toBe(true);
    expect(leadMatchesFilter("qualquercoisa", { phoneKeys: null })).toBe(true);
  });
});
