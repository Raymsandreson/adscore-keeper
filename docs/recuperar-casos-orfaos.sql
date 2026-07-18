-- ═══════════════════════════════════════════════════════════════════════════
-- RECUPERAÇÃO DE CASOS ÓRFÃOS (lead_id IS NULL) — Supabase EXTERNO kmedldlepwiityjsdahz
-- Gerado 15/07/2026. Rodar no SQL Editor do projeto externo.
--
-- Como o lead original foi APAGADO (hard-delete), só sobrou o TÍTULO do caso pra
-- casar com um lead ativo. Todo UPDATE tem guarda "AND lead_id IS NULL" (idempotente).
-- Confira sempre o nome no comentário antes de rodar.
-- ═══════════════════════════════════════════════════════════════════════════

-- PASSO 0 — ver todos os órfãos (deve listar 38)
SELECT case_number, title, status, created_at
FROM legal_cases WHERE lead_id IS NULL
ORDER BY created_at DESC;


-- ───────────────────────────────────────────────────────────────────────────
-- BUCKET 1 — CONFIÁVEIS (título do lead == título do caso). Pode rodar.
-- ───────────────────────────────────────────────────────────────────────────

-- CASO-923  "Família 276 (JM129/mai.25)- Raimundo - Campestre"  ->  lead #626 (título idêntico)
UPDATE legal_cases SET lead_id='004ed41f-c878-4cda-8ed0-46eec0e33c9e' WHERE id='8250f830-f19c-4ec4-888b-e4d770655ab5' AND lead_id IS NULL;

-- CASO-0471 "São José do Sabugi | Jailson Batista dos Santos"   ->  lead #407 (título idêntico)
UPDATE legal_cases SET lead_id='8e905530-2153-4576-918a-ac7aed043b1f' WHERE id='eec3352f-f211-420b-9a3e-5826e238667b' AND lead_id IS NULL;
-- CASO-0472 (mesmo cliente Jailson, #407)
UPDATE legal_cases SET lead_id='8e905530-2153-4576-918a-ac7aed043b1f' WHERE id='137a0f64-540c-4a4c-bb6c-f8b685a940ff' AND lead_id IS NULL;
-- CASO-0473 (mesmo cliente Jailson, #407)
UPDATE legal_cases SET lead_id='8e905530-2153-4576-918a-ac7aed043b1f' WHERE id='1d008af3-6a95-446f-92c3-62cf734ce752' AND lead_id IS NULL;

-- CASO 363  "Londrina/PR Márcia de Fátima Modelute"            ->  lead #76 (título idêntico)
UPDATE legal_cases SET lead_id='d2af8d99-86c3-4e4a-a49f-6846e498ba64' WHERE id='6f49c42c-b2f0-4ca1-8429-4feb04e899ae' AND lead_id IS NULL;

-- CG 118    "Marco Aurélio"  ->  lead "MARCOS AURÉLIO PINHEIRO DOS SANTOS" (nome bate; confira)
UPDATE legal_cases SET lead_id='28121ba6-79f1-47ac-915d-1e6f6c55c0ca' WHERE id='9dc3eff6-51f8-43e0-90b6-badd7d58f84b' AND lead_id IS NULL;

-- CASO 26.1 "kellem"  ->  lead "Kellem Carvalho" (candidato único)
UPDATE legal_cases SET lead_id='6949c2cc-9a10-46f7-92ac-938b51ed2ff9' WHERE id='327b7353-0135-4fa2-9f78-57a2b3e2fc2f' AND lead_id IS NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- BUCKET 2 — PALPITES (nome parcial / cidade). NÃO rode sem conferir o lead.
-- Descomente o UPDATE só depois de validar o nome. Alternativas ao lado.
-- ───────────────────────────────────────────────────────────────────────────

-- CASO 382 "SANTA INÊS MA - JOSÉ FRANCISCO"  cand: #165 "Santa Inês/MA | Telefonia" (é CIDADE, não a pessoa — provável ERRADO)
-- UPDATE legal_cases SET lead_id='05461be4-2e26-84b4-b1303f246afd' WHERE id='ce8953bf-81da-450d-8c65-9e2657f1af85' AND lead_id IS NULL;

-- CASO-0001 "Teresina/Carlos Alberto Goncalves Sousa e Silva"  cand: "carlos Alberto de Silva" (nomes do meio diferem)
-- UPDATE legal_cases SET lead_id='660bbff6-f1ac-47ce-8ea9-9859b976f1bf' WHERE id='764309a2-8510-47f6-bbc6-b1486fb00dd2' AND lead_id IS NULL;

-- PREV 1612 "Edson - Ketllyn"  cand: #86 DENIO EDSON / #149 EDSON LUCAS / #97 EDSON LUCAS  (ambíguo)
-- PREV 517  "Carliane"         cand: #429 CARLIANE MENEZES  /  #2926 PREV 516 CARLIANE
-- PREV 512  "KEMILLEN/VIVIANE" cand: #3182 Jucileia/Viviane  /  Viviane Lins  /  Viviane Graziela  (ambíguo)
-- CASO 163  "ESPERANTINA Cláudio Gomes"  cand: #143 / #147 / #498 (só bate cidade Esperantina)
-- Caso 82   "thais uniao"      cand: PREV 570 Thais / #1934 Thais Rodrigues / Thais Gabriela (ambíguo)
-- CASO-0807 "CG 117 Juan David x BRASPRESS"  cand: Juan dos santos / Karine David / Ethan David (fraco)
-- CASO 118  "Flávio (MT-MA)"   cand: #607 Flávio Gressler (mas é RS, não MT-MA — confira)
-- CASO 332  "Peritoró Mateus Cândido"  cand: vários "Mateus" (acolhedor, não cliente — provável ERRADO)
-- CASO 62   "nova ubiratã-MT"  cand: leads de NOTÍCIA de Nova Ubiratã (scrape — provável ERRADO)
-- CG 59     "cerâmica Queiroz" cand: #583 / #617 (só bate "cerâmica")
-- CASO 91   "Antônio Filho MA" cand: #316 Jose Antônio / prev 69 Antônio / Carlos Antônio (ambíguo)
-- CASO 47-JATAÍ-GO "THAISLANE, VITOR, GEOVANA..."  cand: VITOR TALYSON / VITOR EMANOEL (ambíguo)
-- CASO 267  "FRANCIANE MANAUS"  cand: Franciane Oliveira / Franciane Beatriz (ambíguo)
-- CASO 27   "Abaetetuba Viviane Amorim"  cand: leads de Abaetetuba (só cidade)
-- CG 8      "Fed.ConsCivil"    cand: leads de notícia (provável ERRADO)
-- CG 25     "Izabel Inventário" cand: Maria Izabel / Geizabel / Izabella (ambíguo)
-- 318       "Caso 318 Sinop/MT" cand: leads "Caso 319" (número DIFERENTE — provável ERRADO)
-- 287       "Família 287 Abaetetuba/Breno"  cand: só bate cidade
-- CASO 44   "Vera siq.Campos-PR" cand: #319 vera Lucia / Vera Ademir (ambíguo)
-- CASO-0030 "Maria de Lourdes Machado" cand: Maria De Lourdes / PREV 628 Maria de Lourdes (ambíguo)
-- CASO 176  "Barra do garças"  cand: lead de NOTÍCIA "Eletricista morre..." (scrape — ERRADO)
-- CASO-884  "Rosa Gomes de morais prudêncio" cand: RAYMSANDRESON (dono do sistema — ERRADO)


-- ───────────────────────────────────────────────────────────────────────────
-- BUCKET 3 — SEM lead ativo correspondente (nenhum match). Provavelmente o lead
-- ainda está SOFT-DELETADO (restaurar) ou foi apagado de vez (só PITR).
-- ───────────────────────────────────────────────────────────────────────────
-- CASO 161 "ALCÂNTARAS CE" | CASO CG 105 "Orismar X OI" | CASO 63 "Mataripe-BA"
-- CASO 7.1 "Millon TJPI"   | CASO 40 | CASO 328 | CASO 332 (2º, aberto)


-- ───────────────────────────────────────────────────────────────────────────
-- HELPER — achar o lead certo para um órfão específico (troque o texto):
--   SELECT id, lead_number, lead_name, deleted_at
--   FROM leads
--   WHERE lead_name ILIKE '%carliane%'   -- <-- nome do caso
--   ORDER BY deleted_at NULLS FIRST;      -- ativos primeiro; se só houver deletado, dá pra restaurar
--
-- Restaurar um lead soft-deletado (traz de volta o caso junto):
--   UPDATE leads SET deleted_at = NULL WHERE id = '<lead_id>';
-- ───────────────────────────────────────────────────────────────────────────

-- CONFERÊNCIA final — quantos órfãos sobraram:
-- SELECT count(*) FROM legal_cases WHERE lead_id IS NULL;
