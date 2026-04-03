import type { ConversationDetail, CaseStatus } from './types';

export const convKey = (c: { phone: string; instance_name: string }) => `${c.phone}|${c.instance_name}`;

export const getCaseStatus = (c: ConversationDetail): CaseStatus => {
  if (c.is_blocked) return 'bloqueado';
  if (!c.is_active && !c.is_blocked) return 'pausado';
  if (c.lead_status === 'closed') return 'fechado';
  if (c.lead_status === 'refused') return 'recusado';
  if (c.lead_status === 'unviable') return 'inviavel';
  if (c.inbound_count > 0) return 'em_andamento';
  return 'sem_resposta';
};

export const formatTimeAgo = (minutes: number | null) => {
  if (!minutes) return '-';
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export const activatedByLabel = (val: string | null) => {
  switch (val) {
    case 'manual': return 'Manual';
    case 'system': return 'Sistema';
    case 'agent': return 'Agente';
    case 'ctwa_campaign':
    case 'campaign_auto': return 'Anúncio Meta';
    case 'campaign_instance_auto':
    case 'instance_default': return 'Instância';
    case 'broadcast': return 'Lista de Transmissão';
    case 'stage_auto': return 'Troca de Etapa';
    default: return val || '-';
  }
};

export const statusColor = (s: CaseStatus) => {
  switch (s) {
    case 'sem_resposta': return 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800';
    case 'em_andamento': return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800';
    case 'fechado': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800';
    case 'recusado': return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800';
    case 'inviavel': return 'text-muted-foreground bg-muted border-border';
    case 'bloqueado': return 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-800';
    case 'pausado': return 'text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-950 dark:text-gray-400 dark:border-gray-800';
  }
};

export const statusLabel = (s: CaseStatus) => {
  switch (s) {
    case 'sem_resposta': return 'Sem Resposta';
    case 'em_andamento': return 'Em Andamento';
    case 'fechado': return 'Fechado';
    case 'recusado': return 'Recusado';
    case 'inviavel': return 'Inviável';
    case 'bloqueado': return 'Bloqueado';
    case 'pausado': return 'Pausado';
  }
};
