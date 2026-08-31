#!/usr/bin/env node
// ============================================================================
// Vincula grupo de WhatsApp aos leads com requerimento no INSS que estão sem
// vínculo em `lead_whatsapp_groups` — e SÓ quando não há dúvida de que o grupo
// é daquele cliente.
//
// Por que existe: 102 dos 623 leads com requerimento INSS não têm vínculo, e
// sem vínculo a mensagem do INSS morre com "lead sem grupo vinculado" (foi o
// que aconteceu com o PREV 584 em 31/08/2026). Os 23 que guardam o JID em
// `leads.whatsapp_group_id` já são resolvidos em tempo de envio pelo fallback
// do `resolverGrupoDoLead`; este script cuida do resto, procurando o grupo na
// varredura real do WhatsApp (`whatsapp_groups_index`).
//
// Por que é tão restritivo: o auto-vínculo por nome do front foi DESLIGADO em
// 31/07/2026 depois de colar grupo de outro cliente em 101 leads (e um mesmo
// grupo em até 18 leads). Aqui, então: candidato tem que ser ÚNICO, não pode
// já pertencer a outro lead, e ainda precisa passar pelo `conferirGrupoDoLead`
// — a MESMA regra que o envio usa em produção, compilada na hora a partir do
// TypeScript para não existirem duas versões da verdade.
//
// Quem não passa não vira palpite: fica sem vínculo, e o `notify-inss-update`
// escreve na atividade pedindo que uma pessoa vincule o grupo (pedido do
// usuário em 31/08/2026 — na dúvida não arrisca assustar o cliente).
//
// Uso:
//   node scripts/vincular-grupos-inss-certeza.mjs            # dry run
//   node scripts/vincular-grupos-inss-certeza.mjs --aplicar  # grava
//
// Rollback: os ids inseridos ficam em scratchpad/rollback-vinculo-certeza.json
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const RAIZ = path.resolve(import.meta.dirname, '..');
const APLICAR = process.argv.includes('--aplicar');
const LABEL = `INSS ${new Date().toLocaleDateString('pt-BR')} (certeza)`;

// --- credenciais -----------------------------------------------------------
const env = Object.fromEntries(
  fs.readFileSync(path.join(RAIZ, '.env.diag'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_ = (env.EXTERNAL_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('faltam EXTERNAL_SUPABASE_* no .env.diag'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function get(p) {
  const r = await fetch(`${URL_}/rest/v1/${p}`, { headers: H });
  if (!r.ok) throw new Error(`${p} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function todos(p) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const lote = await get(`${p}&limit=1000&offset=${off}`);
    out.push(...lote);
    if (lote.length < 1000) return out;
  }
}

// --- a regra de certeza, vinda do código que roda em produção ---------------
const bundle = path.join(RAIZ, 'node_modules', '.cache', 'inss-grupo-certeza.mjs');
await build({
  entryPoints: [path.join(RAIZ, 'railway-server/src/lib/inss-grupo-certeza.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'error',
});
const { codigoDoCaso, conferirGrupoDoLead, nomesDeGente } = await import(bundle);

// --- universo --------------------------------------------------------------
const processos = await todos('inss_admin_processes?select=lead_id,nome_segurado&deleted_at=is.null');
const seguradoPorLead = new Map();
for (const p of processos) if (p.lead_id && !seguradoPorLead.has(p.lead_id)) seguradoPorLead.set(p.lead_id, p.nome_segurado);

const vinculados = new Set();
const usados = new Set();
for (const linha of await todos('lead_whatsapp_groups?select=lead_id,group_jid')) {
  if (!linha.group_jid) continue;
  vinculados.add(linha.lead_id);
  usados.add(linha.group_jid);
}

const semVinculo = [...seguradoPorLead.keys()].filter((id) => !vinculados.has(id));
const leads = [];
for (let i = 0; i < semVinculo.length; i += 100) {
  leads.push(...await get(`leads?id=in.(${semVinculo.slice(i, i + 100).join(',')})&select=id,lead_name,whatsapp_group_id&limit=1000`));
}
// Quem tem o JID no campo legado já é atendido pelo fallback do envio.
const alvo = leads.filter((l) => !/@g\.us$/.test(l.whatsapp_group_id || ''));

// --- candidatos: a varredura real de grupos --------------------------------
const grupos = new Map();
for (const g of await todos('whatsapp_groups_index?select=group_jid,contact_name,instance_name,updated_at')) {
  const atual = grupos.get(g.group_jid);
  if (!atual || Date.parse(g.updated_at || 0) > Date.parse(atual.updated_at || 0)) grupos.set(g.group_jid, g);
}
const catalogo = [...grupos.values()];

const aprovados = [];
const recusados = [];
for (const lead of alvo) {
  const codigo = codigoDoCaso(lead.lead_name);
  const tokens = nomesDeGente(lead.lead_name);
  const candidatos = new Set();
  // Duas buscas, ambas ancoradas: código do caso igual, ou o nome do lead
  // INTEIRO dentro do nome do grupo (nada de substring solta, que foi o que
  // colou "cris" em "CRISTINA" na versão desligada).
  for (const g of catalogo) {
    if (codigo && codigoDoCaso(g.contact_name) === codigo) candidatos.add(g.group_jid);
    if (tokens.length >= 2) {
      const doGrupo = new Set(nomesDeGente(g.contact_name));
      if (tokens.every((t) => doGrupo.has(t))) candidatos.add(g.group_jid);
    }
  }
  const livres = [...candidatos].filter((jid) => !usados.has(jid));
  if (livres.length !== 1) {
    recusados.push({
      lead: (lead.lead_name || '').slice(0, 45),
      motivo: candidatos.size === 0 ? 'nenhum grupo com esse código/nome'
        : livres.length === 0 ? 'único candidato já é de outro lead'
        : `${livres.length} candidatos — ambíguo`,
    });
    continue;
  }
  const grupo = grupos.get(livres[0]);
  const veredito = conferirGrupoDoLead({
    leadName: lead.lead_name,
    groupName: grupo.contact_name,
    nomeSegurado: seguradoPorLead.get(lead.id),
  });
  if (!veredito.ok) {
    recusados.push({ lead: (lead.lead_name || '').slice(0, 45), motivo: veredito.motivo.slice(0, 70) });
    continue;
  }
  aprovados.push({
    lead_id: lead.id,
    group_jid: grupo.group_jid,
    group_name: grupo.contact_name,
    instance_name: grupo.instance_name || null,
    auto_linked: true,
    label: LABEL,
    _lead: (lead.lead_name || '').slice(0, 40),
    _motivo: veredito.motivo.slice(0, 45),
  });
}

console.log(`leads INSS sem vínculo e sem JID legado: ${alvo.length}`);
console.table(aprovados.map((a) => ({ lead: a._lead, grupo: (a.group_name || '').slice(0, 40), instancia: a.instance_name, prova: a._motivo })));
const porMotivo = {};
for (const r of recusados) porMotivo[r.motivo] = (porMotivo[r.motivo] || 0) + 1;
console.log(`vincular: ${aprovados.length} | deixar para vínculo humano: ${recusados.length}`);
console.log(porMotivo);

if (!APLICAR) { console.log('\nDRY RUN — rode com --aplicar para gravar'); process.exit(0); }

const linhas = aprovados.map(({ _lead, _motivo, ...linha }) => linha);
const resp = await fetch(`${URL_}/rest/v1/lead_whatsapp_groups`, {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(linhas),
});
const corpo = await resp.text();
if (!resp.ok) { console.error('FALHOU:', resp.status, corpo.slice(0, 400)); process.exit(1); }
const inseridos = JSON.parse(corpo);
const destino = path.join(RAIZ, 'scratchpad', 'rollback-vinculo-certeza.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(inseridos.map((x) => x.id), null, 1));
console.log(`inseridos: ${inseridos.length} — rollback em ${path.relative(RAIZ, destino)}`);
