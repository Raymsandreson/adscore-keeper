#!/usr/bin/env node
/**
 * Valida que TODAS as telas que editam leads usam o mesmo componente
 * `LeadEditDialog` com o mesmo conjunto de abas/campos.
 *
 * Invariantes validadas:
 *  1. Existe exatamente UMA fonte de verdade: src/components/kanban/LeadEditDialog.tsx
 *  2. Toda tela que edita leads importa esse componente (Kanban, tabela LeadManager,
 *     pipeline StageFunnelChart, e outras superfícies registradas).
 *  3. Nenhum outro arquivo define um Dialog próprio com formulário de edição de lead
 *     (heurística: arquivo contém <Dialog> + campos típicos como lead_name + lead_phone
 *     fora do LeadEditDialog).
 *  4. O LeadEditDialog expõe TODAS as abas canônicas esperadas — qualquer remoção
 *     futura precisa atualizar este teste de propósito.
 *
 * Roda como `npm run test:lead-form` ou em CI sem dependências extras.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(ROOT, 'src');
const SOURCE_OF_TRUTH = 'src/components/kanban/LeadEditDialog.tsx';

// Telas onde o usuário edita um lead — devem usar LeadEditDialog
const REQUIRED_CONSUMERS = [
  'src/components/kanban/UnifiedKanbanManager.tsx', // Kanban
  'src/components/LeadManager.tsx',                 // Tabela / Central de Leads
  'src/components/kanban/StageFunnelChart.tsx',     // Pipeline / funil
];

// Abas que o LeadEditDialog deve sempre expor (podem ser condicionais como "casos")
const REQUIRED_TABS = [
  { value: 'basic',      label: 'Básico' },
  { value: 'contacts',   label: 'Contatos' },
  { value: 'checklist',  label: 'Funil de Vendas' },
  { value: 'activities', label: 'Atividades' },
  { value: 'accident',   label: 'Acidente' },
  { value: 'location',   label: 'Local' },
  { value: 'companies',  label: 'Empresas' },
  { value: 'legal',      label: 'Jurídico' },
  { value: 'history',    label: 'Histórico' },
  { value: 'casos',      label: 'Casos' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'config',     label: 'Config' },
  { value: 'ai_chat',    label: 'Chat IA' },
  { value: 'team_chat',  label: 'Chat Equipe' },
];

const errors = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { errors.push(msg); console.log(`  ✗ ${msg}`); };

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full);
  }
  return out;
}

console.log('\n[1/4] Fonte única de verdade existe…');
let sourceContent;
try {
  sourceContent = read(SOURCE_OF_TRUTH);
  ok(`${SOURCE_OF_TRUTH} encontrado`);
} catch {
  fail(`Arquivo ${SOURCE_OF_TRUTH} não existe — a unificação foi quebrada.`);
  process.exit(1);
}

console.log('\n[2/4] Telas obrigatórias usam o LeadEditDialog…');
for (const consumer of REQUIRED_CONSUMERS) {
  let content;
  try { content = read(consumer); } catch { fail(`${consumer} não existe`); continue; }
  const importsIt = /from ['"]@\/components\/kanban\/LeadEditDialog['"]|from ['"]\.\/kanban\/LeadEditDialog['"]/.test(content);
  const usesIt = /<LeadEditDialog\b/.test(content);
  if (importsIt && usesIt) ok(`${consumer} usa LeadEditDialog`);
  else fail(`${consumer} NÃO usa LeadEditDialog (import=${importsIt}, jsx=${usesIt})`);
}

console.log('\n[3/4] Nenhum form paralelo de edição de lead em outro arquivo…');
const allFiles = walk(SRC);
// Heurística: arquivo que NÃO seja o LeadEditDialog mas que tenha um <Dialog>
// contendo os campos lead_name + lead_phone (assinatura clara de form de lead).
const leakage = [];
for (const file of allFiles) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel === SOURCE_OF_TRUTH) continue;
  const content = readFileSync(file, 'utf8');
  if (!/<Dialog\b/.test(content)) continue;
  // procura sinais de formulário de cadastro/edição de lead inline
  const hasLeadName = /name=["']lead_name["']|formData\.lead_name|setLeadName\(|leadData\.lead_name/.test(content);
  const hasLeadPhone = /name=["']lead_phone["']|formData\.lead_phone|setLeadPhone\(|leadData\.lead_phone/.test(content);
  // permite Dialogs auxiliares (mini-forms aprovados): CreateLeadFromCatDialog, ImportFromSocialLinkDialog
  const isApprovedSpecialized =
    rel.endsWith('leads/CreateLeadFromCatDialog.tsx') ||
    rel.endsWith('instagram/CreateLeadFromSearchDialog.tsx') ||
    rel.endsWith('instagram/ImportFromSocialLinkDialog.tsx');
  if (hasLeadName && hasLeadPhone && !isApprovedSpecialized) {
    leakage.push(rel);
  }
}
if (leakage.length === 0) {
  ok('nenhum form paralelo de edição encontrado');
} else {
  for (const f of leakage) {
    fail(`form paralelo detectado em ${f} — todo edit de lead deve passar por LeadEditDialog`);
  }
}

console.log('\n[4/4] LeadEditDialog expõe todas as abas canônicas…');
for (const tab of REQUIRED_TABS) {
  const re = new RegExp(`<TabsTrigger\\s+value=["']${tab.value}["'][\\s\\S]{0,400}?${tab.label}`);
  if (re.test(sourceContent)) ok(`aba "${tab.label}" (${tab.value})`);
  else fail(`aba "${tab.label}" (value="${tab.value}") ausente do LeadEditDialog`);
}

console.log('');
if (errors.length) {
  console.error(`\n❌ FALHA: ${errors.length} invariante(s) violada(s) na unificação do form de lead.\n`);
  process.exit(1);
}
console.log(`✅ OK: form de edição de lead unificado em ${REQUIRED_CONSUMERS.length} telas com ${REQUIRED_TABS.length} abas canônicas.\n`);
