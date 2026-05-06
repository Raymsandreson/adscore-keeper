#!/usr/bin/env node
/**
 * Guard contra drift entre a aba Grupo do Onboarding e a tabela externa
 * `board_group_settings`.
 *
 * Atualize BOARD_GROUP_SETTINGS_COLUMNS somente depois de aplicar a migration no
 * Supabase Externo e confirmar via information_schema.columns.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SOURCE_FILE = join(ROOT, "src/components/whatsapp/BoardGroupInstancesConfig.tsx");

const BOARD_GROUP_SETTINGS_COLUMNS = new Set([
  "id",
  "board_id",
  "group_name_prefix",
  "sequence_start",
  "current_sequence",
  "lead_fields",
  "created_at",
  "updated_at",
  "initial_message_template",
  "forward_document_types",
  "use_ai_message",
  "send_audio_message",
  "audio_voice_id",
  "auto_close_lead_on_sign",
  "auto_create_group_on_sign",
  "ai_generated_message",
  "post_sign_mode",
  "process_workflows",
  "processual_acolhedor_id",
  "auto_create_process_on_sign",
  "notify_acolhedor_on_sign",
  "process_workflow_board_id",
  "closed_group_name_prefix",
  "closed_sequence_start",
  "closed_current_sequence",
  "zapsign_template_token",
  "auto_archive_on_sign",
  "auto_create_process",
  "process_nucleus_id",
  "process_auto_activities",
  "bridge_approach_prompt",
  "post_close_agent_id",
]);

const content = readFileSync(SOURCE_FILE, "utf8");
const payloadMatch = content.match(/const payload = \{([\s\S]*?)\n\s*\};/);

if (!payloadMatch) {
  console.error("[board-group-schema] Não encontrei `const payload = { ... }` em BoardGroupInstancesConfig.tsx.");
  process.exit(1);
}

const payloadKeys = [...payloadMatch[1].matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)].map((m) => m[1]);
const missing = payloadKeys.filter((key) => !BOARD_GROUP_SETTINGS_COLUMNS.has(key));

if (missing.length > 0) {
  console.error("\n[board-group-schema] A aba Grupo tenta salvar campo(s) que não existem no schema externo confirmado:");
  for (const key of missing) console.error(`  - ${key}`);
  console.error("\nAplique a migration no Supabase Externo via run-external-migration, confirme no information_schema.columns e só então atualize este guard.");
  process.exit(1);
}

console.log(`✓ board_group_settings: ${payloadKeys.length} campo(s) do payload existem no schema externo confirmado.`);