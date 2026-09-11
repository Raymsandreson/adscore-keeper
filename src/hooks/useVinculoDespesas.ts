import { useCallback, useEffect, useMemo, useState } from 'react';
// Lê no EXTERNO, junto com `expense_categories`/`transaction_category_overrides`
// (ver o cabeçalho de useExpenseCategories sobre por que as três moram lá).
import { db } from '@/integrations/supabase';
import {
  MAPA_VAZIO,
  type ContatoDoLead,
  type GrupoDoLead,
  type MapaDeVinculos,
  type OverrideParaLimite,
} from '@/lib/limitesPorVinculo';

// A base tem 28k leads e 36k contatos: carregar tudo para somar 86 despesas
// seria absurdo. Aqui só entram os ids que as despesas realmente citam, em
// consultas `.in()` — uma por tabela, nunca uma por lead.
const TAMANHO_DO_LOTE = 200;

function emLotes<T>(itens: T[], tamanho = TAMANHO_DO_LOTE): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

function idsUnicos(valores: (string | null | undefined)[]): string[] {
  return Array.from(new Set(valores.filter((v): v is string => !!v)));
}

interface LinhaLead { id: string; whatsapp_group_id: string | null }
interface LinhaGrupoDoLead { lead_id: string | null; group_jid: string | null; group_name: string | null }
interface LinhaContato { id: string; full_name: string | null; whatsapp_group_id: string | null }
interface LinhaPonteContatoLead { lead_id: string | null; contact_id: string | null; is_primary_client: boolean | null }
interface LinhaGrupoIndex { group_jid: string | null; contact_name: string | null }

async function buscarEmLotes<T>(
  ids: string[],
  consulta: (lote: string[]) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  if (ids.length === 0) return [];
  const respostas = await Promise.all(emLotes(ids).map(lote => consulta(lote)));
  const linhas: T[] = [];
  respostas.forEach(({ data, error }) => {
    if (error) throw error;
    (data as T[] | null)?.forEach(linha => linhas.push(linha));
  });
  return linhas;
}

/**
 * Mapas lead ↔ grupo de WhatsApp ↔ contato usados pelos limites por vínculo
 * (`per_whatsapp_group` e `per_client`).
 */
export function useVinculoDespesas(overrides: OverrideParaLimite[]) {
  const [mapa, setMapa] = useState<MapaDeVinculos>(MAPA_VAZIO);
  const [carregando, setCarregando] = useState(false);

  // A identidade do array de overrides muda a cada fetch; o que importa para
  // recarregar são os ids citados.
  const leadIds = useMemo(() => idsUnicos(overrides.map(o => o.lead_id)), [overrides]);
  const contactIds = useMemo(() => idsUnicos(overrides.map(o => o.contact_id)), [overrides]);
  const jidsExplicitos = useMemo(() => idsUnicos(overrides.map(o => o.group_jid)), [overrides]);
  const chaveLeads = leadIds.join(',');
  const chaveContatos = contactIds.join(',');
  const chaveJids = jidsExplicitos.join(',');

  const carregar = useCallback(async () => {
    const leads = chaveLeads ? chaveLeads.split(',') : [];
    const contatos = chaveContatos ? chaveContatos.split(',') : [];
    const jids = chaveJids ? chaveJids.split(',') : [];

    if (leads.length === 0 && contatos.length === 0 && jids.length === 0) {
      setMapa(MAPA_VAZIO);
      return;
    }

    setCarregando(true);
    try {
      const [linhasLead, linhasGrupoDoLead, pontes] = await Promise.all([
        buscarEmLotes<LinhaLead>(leads, lote =>
          db.from('leads').select('id, whatsapp_group_id').in('id', lote)
        ),
        buscarEmLotes<LinhaGrupoDoLead>(leads, lote =>
          db
            .from('lead_whatsapp_groups')
            .select('lead_id, group_jid, group_name')
            .in('lead_id', lote)
        ),
        // `contact_leads` e a ponte lead<->contato de verdade: 10.264 vinculos
        // cobrindo 8.545 leads em 11/09/2026, contra 1.270 leads que
        // `contacts.lead_id` enxerga. Ver skill `db-tables-map`.
        buscarEmLotes<LinhaPonteContatoLead>(leads, lote =>
          db
            .from('contact_leads')
            .select('lead_id, contact_id, is_primary_client')
            .in('lead_id', lote)
        ),
      ]);

      // Os nomes dos contatos vem numa consulta so: os citados na despesa mais
      // os que a ponte trouxe.
      const idsDeContato = idsUnicos([
        ...contatos,
        ...pontes.map(p => p.contact_id),
      ]);
      const linhasContato = await buscarEmLotes<LinhaContato>(idsDeContato, lote =>
        db
          .from('contacts')
          .select('id, full_name, whatsapp_group_id')
          .in('id', lote)
      );

      const gruposPorLead = new Map<string, GrupoDoLead[]>();
      const nomeDoGrupo = new Map<string, string>();
      const guardarGrupo = (leadId: string, jid: string | null, nome: string | null) => {
        if (!jid) return;
        const atual = gruposPorLead.get(leadId) || [];
        atual.push({ group_jid: jid, group_name: nome });
        gruposPorLead.set(leadId, atual);
        if (nome) nomeDoGrupo.set(jid, nome);
      };

      linhasGrupoDoLead.forEach(l => {
        if (l.lead_id) guardarGrupo(l.lead_id, l.group_jid, l.group_name);
      });
      // `leads.whatsapp_group_id` é a outra origem do mesmo vínculo; a dedup
      // por jid mora em `limitesPorVinculo`, aqui só somamos as duas.
      linhasLead.forEach(l => guardarGrupo(l.id, l.whatsapp_group_id, null));

      const contatoPorId = new Map<string, { full_name: string | null; whatsapp_group_id: string | null }>();
      linhasContato.forEach(c => {
        contatoPorId.set(c.id, { full_name: c.full_name, whatsapp_group_id: c.whatsapp_group_id });
      });

      const contatosPorLead = new Map<string, ContatoDoLead[]>();
      pontes.forEach(ponte => {
        if (!ponte.lead_id || !ponte.contact_id) return;
        const atual = contatosPorLead.get(ponte.lead_id) || [];
        if (atual.some(existente => existente.id === ponte.contact_id)) return;
        atual.push({
          id: ponte.contact_id,
          full_name: contatoPorId.get(ponte.contact_id)?.full_name ?? null,
          ehPrimario: ponte.is_primary_client === true,
        });
        contatosPorLead.set(ponte.lead_id, atual);
      });

      // Nome dos grupos que ninguém nomeou ainda (jid escolhido à mão na
      // despesa, ou vínculo gravado só com o jid).
      const semNome = idsUnicos([
        ...jids,
        ...Array.from(contatoPorId.values()).map(c => c.whatsapp_group_id),
      ]).filter(jid => !nomeDoGrupo.has(jid));
      if (semNome.length > 0) {
        // `whatsapp_groups_index` e o indice oficial de nome de grupo (6.690
        // jids em 11/09/2026, contra 1.986 do `whatsapp_groups_cache`). Ver
        // skill `db-tables-map`. Uma jid aparece uma vez por instancia: o
        // primeiro nome basta, todos nomeiam o mesmo grupo.
        const indice = await buscarEmLotes<LinhaGrupoIndex>(semNome, lote =>
          db
            .from('whatsapp_groups_index')
            .select('group_jid, contact_name')
            .in('group_jid', lote)
        );
        indice.forEach(g => {
          if (g.group_jid && g.contact_name && !nomeDoGrupo.has(g.group_jid)) {
            nomeDoGrupo.set(g.group_jid, g.contact_name);
          }
        });
      }

      setMapa({ gruposPorLead, contatosPorLead, contatoPorId, nomeDoGrupo });
    } catch (err) {
      console.error('Erro ao carregar vínculos das despesas:', err);
      // Mapa vazio joga tudo para a lista de pendência, que é o comportamento
      // honesto: melhor mostrar "não resolvi" do que somar pela metade.
      setMapa(MAPA_VAZIO);
    } finally {
      setCarregando(false);
    }
  }, [chaveLeads, chaveContatos, chaveJids]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return { mapa, carregando, recarregar: carregar };
}

/**
 * Grupos de WhatsApp de um lead, para escolher o caso na hora de categorizar
 * a despesa. Vazio quando não há lead selecionado.
 */
export function useGruposDoLead(leadId: string | null | undefined) {
  const [grupos, setGrupos] = useState<GrupoDoLead[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let ativo = true;
    if (!leadId) {
      setGrupos([]);
      return () => { ativo = false; };
    }

    setCarregando(true);
    (async () => {
      try {
        const [vinculos, lead] = await Promise.all([
          db
            .from('lead_whatsapp_groups')
            .select('group_jid, group_name')
            .eq('lead_id', leadId),
          db
            .from('leads')
            .select('whatsapp_group_id')
            .eq('id', leadId)
            .maybeSingle(),
        ]);
        if (!ativo) return;

        const porJid = new Map<string, GrupoDoLead>();
        ((vinculos.data as { group_jid: string | null; group_name: string | null }[] | null) || []).forEach(g => {
          if (g.group_jid) porJid.set(g.group_jid, { group_jid: g.group_jid, group_name: g.group_name });
        });
        const jidDoLead = (lead.data as { whatsapp_group_id: string | null } | null)?.whatsapp_group_id;
        if (jidDoLead && !porJid.has(jidDoLead)) {
          porJid.set(jidDoLead, { group_jid: jidDoLead, group_name: null });
        }
        setGrupos(Array.from(porJid.values()));
      } catch (err) {
        console.error('Erro ao carregar grupos do lead:', err);
        if (ativo) setGrupos([]);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => { ativo = false; };
  }, [leadId]);

  return { grupos, carregando };
}
