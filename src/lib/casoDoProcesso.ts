// =============================================================================
// DO PROCESSO ÓRFÃO PARA O CASO COM DONO.
//
// Pedido do Raym (26/08/2026): o inventário por OAB cria a ficha do processo com
// número e título e para por aí — sem lead, sem caso, sem grupo, sem contato.
// São processos que o escritório TEM, mas que não existem para o funil, para o
// financeiro nem para a conversa com o cliente.
//
// Aqui ficam só as DECISÕES de nome e de quem é o cliente — puras, testáveis e
// iguais em qualquer tela. Quem grava é o diálogo (CriarCasoDoProcessoDialog),
// que faz os passos na ordem em que dá para desfazer: lead → caso → vínculo →
// contato → grupo.
// =============================================================================

import { normalizeSearchText } from '@/lib/nomeMatch';

export interface ProcessoParaCaso {
  /** lead_processes.title — costuma ser o nome do cliente nas fichas do inventário. */
  titulo?: string | null;
  numero?: string | null;
  poloAtivo?: string | null;
  poloPassivo?: string | null;
  /** 'ATIVO' | 'PASSIVO' — de que lado estamos, quando já se sabe. */
  clientePolo?: string | null;
  cidade?: string | null;
  uf?: string | null;
}

const limpar = (v?: string | null) => String(v || '').replace(/\s+/g, ' ').trim();

const chave = (v: string) => normalizeSearchText(v);

/**
 * Quem é o cliente neste processo.
 *
 * Ordem: o polo declarado manda. Sem ele, o título da ficha decide — no
 * inventário por OAB o título É o nome do cliente ("Airton de Sousa Carvalho"),
 * e casá-lo com um dos polos é evidência, não chute. Sem os dois, devolve null:
 * nomear cliente errado contamina caso, grupo e saudação de mensagem.
 */
export function parteDoCliente(p: ProcessoParaCaso): { nome: string; polo: 'ATIVO' | 'PASSIVO' } | null {
  const ativo = limpar(p.poloAtivo);
  const passivo = limpar(p.poloPassivo);

  if (p.clientePolo === 'ATIVO' && ativo) return { nome: ativo, polo: 'ATIVO' };
  if (p.clientePolo === 'PASSIVO' && passivo) return { nome: passivo, polo: 'PASSIVO' };

  const titulo = limpar(p.titulo);
  if (titulo) {
    const t = chave(titulo);
    if (ativo && chave(ativo).includes(t)) return { nome: ativo, polo: 'ATIVO' };
    if (passivo && chave(passivo).includes(t)) return { nome: passivo, polo: 'PASSIVO' };
    // Título que não casa com polo nenhum ainda é o melhor nome que temos, mas
    // sem lado: quem abrir o diálogo escolhe.
    if (!ativo && !passivo) return null;
  }
  return null;
}

/**
 * Nome do lead: "Cliente x Adversário". É o que aparece no card do funil e o
 * que nomeia o grupo do WhatsApp — precisa dizer de quem é o caso na primeira
 * linha, sem o CNJ, que não diz nada para quem lê.
 */
export function nomeDoLead(p: ProcessoParaCaso): string {
  const cliente = parteDoCliente(p);
  const ativo = limpar(p.poloAtivo);
  const passivo = limpar(p.poloPassivo);
  const titulo = limpar(p.titulo);

  const nome = cliente?.nome || titulo || ativo || passivo;
  const adversario = cliente?.polo === 'PASSIVO' ? ativo : passivo;

  if (nome && adversario && chave(nome) !== chave(adversario)) return `${nome} x ${adversario}`;
  if (nome) return nome;
  return limpar(p.numero) ? `Processo ${limpar(p.numero)}` : 'Processo sem identificação';
}

/** Título do caso — mesmo padrão dos casos criados pelo Kanban ao fechar lead. */
export function tituloDoCaso(p: ProcessoParaCaso): string {
  return `Caso - ${nomeDoLead(p)}`;
}

/**
 * A nota que fica no lead dizendo de onde ele veio. Sem isso, daqui a um mês
 * ninguém sabe por que existe um lead na recepção sem conversa nenhuma.
 */
export function notaDoLeadCriado(p: ProcessoParaCaso, hojeISO: string): string {
  const partes = [
    `Lead criado em ${hojeISO.slice(8, 10)}/${hojeISO.slice(5, 7)}/${hojeISO.slice(0, 4)} a partir da ficha do processo`,
    limpar(p.numero) ? `nº ${limpar(p.numero)}` : null,
    '(processo que já era do escritório e estava sem lead e sem caso).',
  ].filter(Boolean);
  return partes.join(' ');
}
