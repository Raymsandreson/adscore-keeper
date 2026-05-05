import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Tabelas de negócio — devem usar `externalSupabase`, nunca `supabase` (Cloud).
// Espelha src/integrations/supabase/db-routing.ts (mantenha sincronizado).
const BUSINESS_TABLES = [
  "leads",
  "lead_activities",
  "lead_processes",
  "lead_followups",
  "lead_custom_fields",
  "lead_stage_history",
  "lead_sources",
  "lead_whatsapp_groups",
  "legal_cases",
  "case_process_tracking",
  "contacts",
  "contact_leads",
  "contact_bridges",
  "contact_classifications",
  "contact_professions",
  "contact_relationships",
  "zapsign_documents",
  "kanban_boards",
  "whatsapp_messages",
  "whatsapp_instances",
  "whatsapp_conversation_agents",
  "lead_processes_movements",
  "process_parties",
  "activity_chat_messages",
  "beneficiaries",
  "checklists",
  "checklist_items",
];

const businessTablesPattern = `^(${BUSINESS_TABLES.join("|")})$`;

export default tseslint.config(
  { ignores: ["dist", "scripts", "railway-server"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Bloqueia `supabase.from('<tabela_de_negocio>')` (Cloud client).
      // Tabela de negócio mora no Supabase Externo — use `externalSupabase`.
      // Severidade "warn" para não quebrar build durante migração — vire para
      // "error" quando o backlog estiver zerado.
      "no-restricted-syntax": [
        "warn",
        {
          selector: `CallExpression[callee.object.name='supabase'][callee.property.name='from'][arguments.0.type='Literal'][arguments.0.value=/${businessTablesPattern}/]`,
          message:
            "Tabela de negócio: use externalSupabase (Supabase Externo), não o client Cloud. Lista em src/integrations/supabase/db-routing.ts.",
        },
      ],
    },
  },
  // O próprio client Cloud e o guard precisam referenciar `supabase` livremente.
  {
    files: [
      "src/integrations/supabase/client.ts",
      "src/integrations/supabase/install-db-routing-guard.ts",
      "src/integrations/supabase/db-routing.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
);
