import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Carrega .env.diag (na raiz do projeto, um nível acima)
const envText = readFileSync(new URL('../.env.diag', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}

const url = env.EXTERNAL_SUPABASE_URL;
const key = env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('faltam credenciais no .env.diag'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });

// 1) Estado da última sincronização
const { data: state, error: e1 } = await db
  .from('inss_sync_state').select('*').eq('id', 1).maybeSingle();
if (e1) console.error('inss_sync_state erro:', e1.message);
const lr = state?.last_result || {};
console.log('=== inss_sync_state (id=1) ===');
console.log('last_run_at      :', state?.last_run_at);
console.log('last_synced_at   :', state?.last_synced_at);
console.log('last.success     :', lr.success);
console.log('last.backfill    :', lr.backfill);
console.log('last.done        :', lr.done);
console.log('last.cursor      :', JSON.stringify(lr.cursor));
console.log('last.params.after:', lr.params?.backfill_after);
console.log('last.checked/new/created_proc:', lr.checked, lr.new, lr.created_processes);
console.log('last.inbox_labels:', JSON.stringify(lr.inbox_labels));
console.log('last.errors      :', JSON.stringify((lr.errors || []).slice(0, 5)));

// 2) Total de processos (não deletados)
const { count: total, error: e2 } = await db
  .from('inss_admin_processes').select('*', { count: 'exact', head: true })
  .is('deleted_at', null);
if (e2) console.error('count erro:', e2.message);
console.log('\n=== inss_admin_processes (deleted_at null) ===');
console.log('TOTAL processos  :', total);

// 3) Distribuição por mês de last_email_at
const { data: rows, error: e3 } = await db
  .from('inss_admin_processes').select('last_email_at, created_at')
  .is('deleted_at', null).limit(20000);
if (e3) console.error('rows erro:', e3.message);
const byMonth = {};
let nullEmail = 0, minE = null, maxE = null;
for (const r of rows || []) {
  const d = r.last_email_at;
  if (!d) { nullEmail++; continue; }
  const ym = d.slice(0, 7);
  byMonth[ym] = (byMonth[ym] || 0) + 1;
  if (!minE || d < minE) minE = d;
  if (!maxE || d > maxE) maxE = d;
}
console.log('rows lidas       :', (rows || []).length, '| sem last_email_at:', nullEmail);
console.log('last_email_at min:', minE, '| max:', maxE);
console.log('\n--- processos por mês (last_email_at) ---');
for (const ym of Object.keys(byMonth).sort()) {
  console.log(ym, ':', byMonth[ym]);
}

// 4) Histórico: total e janela de datas dos e-mails realmente importados
const { count: histCount } = await db
  .from('inss_status_history').select('*', { count: 'exact', head: true });
const { data: oldest } = await db
  .from('inss_status_history').select('email_received_at')
  .order('email_received_at', { ascending: true }).limit(1);
const { data: newest } = await db
  .from('inss_status_history').select('email_received_at')
  .order('email_received_at', { ascending: false }).limit(1);
console.log('\n=== inss_status_history ===');
console.log('TOTAL e-mails importados:', histCount);
console.log('e-mail mais antigo      :', oldest?.[0]?.email_received_at);
console.log('e-mail mais novo        :', newest?.[0]?.email_received_at);
