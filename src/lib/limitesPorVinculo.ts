// Limite de gasto por GRUPO DE WHATSAPP (o caso) e por CLIENTE (o contato).
//
// As unidades antigas (`per_transaction`, `per_day`, `per_month`) somam por
// tempo: a chave sai da própria transação. Estas duas somam por VÍNCULO — a
// chave mora em outra tabela, e nem toda despesa consegue resolvê-la.
//
// Regra 8 do CLAUDE.md aplicada aqui: despesa que não resolve o vínculo NÃO é
// descartada nem some da conta. Ela sai como PENDÊNCIA, com o motivo e o que
// precisa ser feito. Filtrar em silêncio trocaria um total errado por outro
// total errado e ainda esconderia o registro que precisa de conserto.
//
// Precedência da resolução (medido no Externo em 11/09/2026):
//   grupo   -> `overrides.group_jid` (escolha explícita) > grupo único do lead
//              > grupo do contato
//   cliente -> `overrides.contact_id` (escolha explícita) > contato único do lead
// "Único" é literal: lead com 2+ grupos não vira chute, vira pendência.

export type UnidadeLimite =
  | 'per_transaction'
  | 'per_day'
  | 'per_month'
  | 'per_whatsapp_group'
  | 'per_client';

/** As duas unidades que somam por vínculo, não por tempo. */
export const UNIDADES_POR_VINCULO: UnidadeLimite[] = ['per_whatsapp_group', 'per_client'];

export function ehUnidadePorVinculo(unidade: string | null | undefined): boolean {
  return UNIDADES_POR_VINCULO.includes(unidade as UnidadeLimite);
}

export interface CategoriaComLimite {
  id: string;
  name: string;
  max_limit_per_unit: number | null;
  limit_unit: string | null;
}

export interface TransacaoParaLimite {
  id: string;
  amount: number;
  transaction_date: string;
}

export interface OverrideParaLimite {
  transaction_id: string;
  category_id: string | null;
  lead_id: string | null;
  contact_id: string | null;
  group_jid?: string | null;
}

export interface GrupoDoLead {
  group_jid: string;
  group_name: string | null;
}

export interface ContatoDoLead {
  id: string;
  full_name: string | null;
}

/** Mapas lidos de uma vez só (ver `useVinculoDespesas`), nunca dentro do laço. */
export interface MapaDeVinculos {
  /** lead_id -> grupos (união de `lead_whatsapp_groups` e `leads.whatsapp_group_id`) */
  gruposPorLead: Map<string, GrupoDoLead[]>;
  /** lead_id -> contatos que apontam para esse lead (`contacts.lead_id`) */
  contatosPorLead: Map<string, ContatoDoLead[]>;
  /** contact_id -> contato, para nome e grupo do próprio contato */
  contatoPorId: Map<string, { full_name: string | null; whatsapp_group_id: string | null }>;
  /** group_jid -> nome legível do grupo */
  nomeDoGrupo: Map<string, string>;
}

export const MAPA_VAZIO: MapaDeVinculos = {
  gruposPorLead: new Map(),
  contatosPorLead: new Map(),
  contatoPorId: new Map(),
  nomeDoGrupo: new Map(),
};

export type MotivoPendencia =
  | 'sem-vinculo'
  | 'lead-sem-grupo'
  | 'lead-com-varios-grupos'
  | 'lead-sem-contato'
  | 'lead-com-varios-contatos';

/** O texto que vai pra tela: o que falta e onde resolver. */
export const TEXTO_DO_MOTIVO: Record<MotivoPendencia, string> = {
  'sem-vinculo': 'Despesa sem lead nem contato — categorize e vincule.',
  'lead-sem-grupo': 'O lead não tem grupo de WhatsApp — crie ou vincule o grupo do caso.',
  'lead-com-varios-grupos':
    'O lead tem mais de um grupo — escolha o caso no seletor de grupo da despesa.',
  'lead-sem-contato': 'O lead não tem contato — vincule o cliente na despesa.',
  'lead-com-varios-contatos':
    'O lead tem mais de um contato — escolha o cliente na aba Contato da despesa.',
};

export interface ChaveResolvida {
  chave: string;
  rotulo: string;
  /** 'explicito' = escolhido na despesa; 'deduzido' = veio do lead/contato. */
  origem: 'explicito' | 'deduzido';
}

export interface ChaveNaoResolvida {
  chave: null;
  motivo: MotivoPendencia;
}

export type ResultadoResolucao = ChaveResolvida | ChaveNaoResolvida;

function grupoDoLead(leadId: string, mapa: MapaDeVinculos): GrupoDoLead[] {
  const grupos = mapa.gruposPorLead.get(leadId) || [];
  // Dedup por jid: o mesmo grupo aparece em `leads.whatsapp_group_id` e em
  // `lead_whatsapp_groups` com frequência — contar duas vezes viraria
  // "lead com vários grupos" onde só existe um.
  const porJid = new Map<string, GrupoDoLead>();
  grupos.forEach(g => {
    if (!g.group_jid) return;
    const atual = porJid.get(g.group_jid);
    if (!atual || (!atual.group_name && g.group_name)) porJid.set(g.group_jid, g);
  });
  return Array.from(porJid.values());
}

function nomeDoGrupo(jid: string, mapa: MapaDeVinculos, fallback?: string | null): string {
  return fallback || mapa.nomeDoGrupo.get(jid) || jid;
}

/** Qual grupo de WhatsApp (caso) responde por esta despesa. */
export function resolverGrupo(
  override: OverrideParaLimite | undefined,
  mapa: MapaDeVinculos
): ResultadoResolucao {
  if (!override) return { chave: null, motivo: 'sem-vinculo' };

  if (override.group_jid) {
    return {
      chave: override.group_jid,
      rotulo: nomeDoGrupo(override.group_jid, mapa),
      origem: 'explicito',
    };
  }

  if (override.lead_id) {
    const grupos = grupoDoLead(override.lead_id, mapa);
    if (grupos.length === 1) {
      const g = grupos[0];
      return {
        chave: g.group_jid,
        rotulo: nomeDoGrupo(g.group_jid, mapa, g.group_name),
        origem: 'deduzido',
      };
    }
    if (grupos.length > 1) return { chave: null, motivo: 'lead-com-varios-grupos' };
    // Lead sem grupo próprio ainda pode ter o grupo pelo contato vinculado.
    if (!override.contact_id) return { chave: null, motivo: 'lead-sem-grupo' };
  }

  if (override.contact_id) {
    const contato = mapa.contatoPorId.get(override.contact_id);
    if (contato?.whatsapp_group_id) {
      return {
        chave: contato.whatsapp_group_id,
        rotulo: nomeDoGrupo(contato.whatsapp_group_id, mapa),
        origem: 'deduzido',
      };
    }
    return { chave: null, motivo: 'lead-sem-grupo' };
  }

  return { chave: null, motivo: 'sem-vinculo' };
}

/** Qual cliente (contato) responde por esta despesa. */
export function resolverCliente(
  override: OverrideParaLimite | undefined,
  mapa: MapaDeVinculos
): ResultadoResolucao {
  if (!override) return { chave: null, motivo: 'sem-vinculo' };

  if (override.contact_id) {
    const contato = mapa.contatoPorId.get(override.contact_id);
    return {
      chave: override.contact_id,
      rotulo: contato?.full_name || override.contact_id,
      origem: 'explicito',
    };
  }

  if (override.lead_id) {
    const contatos = mapa.contatosPorLead.get(override.lead_id) || [];
    if (contatos.length === 1) {
      return {
        chave: contatos[0].id,
        rotulo: contatos[0].full_name || contatos[0].id,
        origem: 'deduzido',
      };
    }
    return {
      chave: null,
      motivo: contatos.length > 1 ? 'lead-com-varios-contatos' : 'lead-sem-contato',
    };
  }

  return { chave: null, motivo: 'sem-vinculo' };
}

export interface EstouroPorVinculo {
  categoryId: string;
  categoryName: string;
  unidade: 'per_whatsapp_group' | 'per_client';
  chave: string;
  rotulo: string;
  limite: number;
  totalGasto: number;
  excedente: number;
  transacoes: number;
  /** true quando alguma despesa da chave foi deduzida, não escolhida à mão. */
  temDeducao: boolean;
}

export interface PendenciaVinculo {
  categoryId: string;
  categoryName: string;
  unidade: 'per_whatsapp_group' | 'per_client';
  transactionId: string;
  transactionDate: string;
  valor: number;
  motivo: MotivoPendencia;
  leadId: string | null;
  contactId: string | null;
}

export interface ResumoPorVinculo {
  /** Chaves que passaram do limite, maior excedente primeiro. */
  estouros: EstouroPorVinculo[];
  /** Todas as chaves somadas (estourando ou não), maior gasto primeiro. */
  totais: EstouroPorVinculo[];
  /** Despesas que não resolveram a chave — não entram em `totais`. */
  pendencias: PendenciaVinculo[];
}

export function calcularLimitesPorVinculo(
  transacoes: TransacaoParaLimite[],
  categorias: CategoriaComLimite[],
  overrides: OverrideParaLimite[],
  mapa: MapaDeVinculos = MAPA_VAZIO
): ResumoPorVinculo {
  const overridePorTransacao = new Map(overrides.map(o => [o.transaction_id, o]));
  const totais: EstouroPorVinculo[] = [];
  const pendencias: PendenciaVinculo[] = [];

  const comLimite = categorias.filter(
    c => c.max_limit_per_unit && ehUnidadePorVinculo(c.limit_unit)
  );
  if (comLimite.length === 0) return { estouros: [], totais: [], pendencias: [] };

  comLimite.forEach(categoria => {
    const unidade = categoria.limit_unit as 'per_whatsapp_group' | 'per_client';
    const limite = categoria.max_limit_per_unit!;
    const acumulado = new Map<
      string,
      { rotulo: string; total: number; transacoes: number; temDeducao: boolean }
    >();

    transacoes.forEach(tx => {
      const override = overridePorTransacao.get(tx.id);
      if (!override || override.category_id !== categoria.id) return;

      const resolucao =
        unidade === 'per_whatsapp_group'
          ? resolverGrupo(override, mapa)
          : resolverCliente(override, mapa);

      if (resolucao.chave === null) {
        pendencias.push({
          categoryId: categoria.id,
          categoryName: categoria.name,
          unidade,
          transactionId: tx.id,
          transactionDate: tx.transaction_date,
          valor: Math.abs(tx.amount),
          motivo: resolucao.motivo,
          leadId: override.lead_id,
          contactId: override.contact_id,
        });
        return;
      }

      const atual = acumulado.get(resolucao.chave) || {
        rotulo: resolucao.rotulo,
        total: 0,
        transacoes: 0,
        temDeducao: false,
      };
      acumulado.set(resolucao.chave, {
        rotulo: atual.rotulo,
        total: atual.total + Math.abs(tx.amount),
        transacoes: atual.transacoes + 1,
        temDeducao: atual.temDeducao || resolucao.origem === 'deduzido',
      });
    });

    acumulado.forEach((dados, chave) => {
      totais.push({
        categoryId: categoria.id,
        categoryName: categoria.name,
        unidade,
        chave,
        rotulo: dados.rotulo,
        limite,
        totalGasto: dados.total,
        excedente: Math.max(0, dados.total - limite),
        transacoes: dados.transacoes,
        temDeducao: dados.temDeducao,
      });
    });
  });

  totais.sort((a, b) => b.totalGasto - a.totalGasto);
  const estouros = totais
    .filter(t => t.excedente > 0)
    .sort((a, b) => b.excedente - a.excedente);
  pendencias.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

  return { estouros, totais, pendencias };
}
