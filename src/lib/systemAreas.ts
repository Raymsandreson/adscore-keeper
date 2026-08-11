/**
 * Mapa de ÁREAS do sistema (rota → área do menu).
 *
 * Serve à 3ª categoria do cronômetro: "uso do sistema". Sem atividade aberta,
 * o tempo em que a pessoa está de fato mexendo (clique/scroll/tecla) deixa de
 * cair como OCIOSO e passa a ser contado por área — WhatsApp, Leads,
 * Processual, Financeiro etc. Não é tempo produtivo (não pontua no ranking nem
 * entra em `active_seconds`): é a prova de que a pessoa estava trabalhando no
 * sistema mesmo sem vincular atividade.
 *
 * Granularidade: por rota/menu (decisão do usuário, 06/08/2026). Sub-contexto
 * dentro da tela (conversa x chat interno x grupo) fica para uma fase 2.
 *
 * As rotas saem de App.tsx e os rótulos do AppSidebar.tsx — mantenha os dois
 * lados em sincronia ao criar página nova; rota desconhecida cai em "Outras
 * telas" (nunca some do total).
 */

export interface SystemArea {
  key: string;
  label: string;
}

export const AREA_OUTROS: SystemArea = { key: 'outros', label: 'Outras telas' };

/** Prefixos de rota, do mais específico para o mais genérico. */
const ROUTE_RULES: { prefix: string; key: string; label: string }[] = [
  { prefix: '/whatsapp', key: 'whatsapp', label: 'WhatsApp' },
  { prefix: '/instagram', key: 'marketing', label: 'Marketing' },
  { prefix: '/campanhas', key: 'marketing', label: 'Marketing' },
  { prefix: '/noticias', key: 'marketing', label: 'Marketing' },
  { prefix: '/calls', key: 'ligacoes', label: 'Ligações' },
  { prefix: '/contacts', key: 'contatos', label: 'Contatos' },
  { prefix: '/leads', key: 'leads', label: 'Leads' },
  { prefix: '/mapa-leads', key: 'leads', label: 'Leads' },
  { prefix: '/acolhimento', key: 'leads', label: 'Leads' },
  { prefix: '/referrals', key: 'leads', label: 'Leads' },
  { prefix: '/cases', key: 'processual', label: 'Processual' },
  { prefix: '/processes', key: 'processual', label: 'Processual' },
  { prefix: '/process-tracking', key: 'processual', label: 'Processual' },
  { prefix: '/processual', key: 'processual', label: 'Processual' },
  { prefix: '/nuclei', key: 'processual', label: 'Processual' },
  { prefix: '/hearings', key: 'processual', label: 'Processual' },
  { prefix: '/workflow-progress', key: 'pop', label: 'POP' },
  { prefix: '/workflow', key: 'pop', label: 'POP' },
  { prefix: '/finance', key: 'financeiro', label: 'Financeiro' },
  { prefix: '/cost-organization', key: 'financeiro', label: 'Financeiro' },
  { prefix: '/sales-funnels', key: 'vendas', label: 'Vendas' },
  { prefix: '/leaderboard', key: 'vendas', label: 'Vendas' },
  { prefix: '/team', key: 'equipe', label: 'Equipe' },
  { prefix: '/banco-horas', key: 'equipe', label: 'Equipe' },
  { prefix: '/analytics', key: 'equipe', label: 'Equipe' },
  { prefix: '/destaques', key: 'equipe', label: 'Equipe' },
  { prefix: '/avaliacoes', key: 'equipe', label: 'Equipe' },
  { prefix: '/relatorios', key: 'relatorios', label: 'Relatórios' },
  { prefix: '/gerar-procuracao', key: 'documentos', label: 'Documentos' },
  { prefix: '/zapsign', key: 'documentos', label: 'Documentos' },
  { prefix: '/settings', key: 'configuracoes', label: 'Configurações' },
  { prefix: '/profile', key: 'configuracoes', label: 'Configurações' },
  { prefix: '/extension', key: 'configuracoes', label: 'Configurações' },
  { prefix: '/archived', key: 'configuracoes', label: 'Configurações' },
  { prefix: '/debug', key: 'configuracoes', label: 'Configurações' },
  { prefix: '/atv/', key: 'atividades', label: 'Atividades' },
  { prefix: '/tv/', key: 'telao', label: 'Telão' },
];

/** Abas do /dashboard que na prática são o menu Marketing. */
const MARKETING_TABS = new Set(['organic', 'paid', 'automation']);

/**
 * Área do momento a partir da URL. `search` distingue as abas do /dashboard
 * (Orgânico/Anúncios/Comentários/ManyChat/Funil são o menu Marketing).
 */
export function areaFromLocation(pathname: string, search = ''): SystemArea {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';

  if (path === '/' ) return { key: 'atividades', label: 'Atividades' };
  if (path === '/index' || path === '/dashboard') {
    const tab = new URLSearchParams(search || '').get('tab') || '';
    return MARKETING_TABS.has(tab)
      ? { key: 'marketing', label: 'Marketing' }
      : { key: 'visao-geral', label: 'Visão Geral' };
  }

  for (const r of ROUTE_RULES) {
    if (path === r.prefix || path.startsWith(`${r.prefix}/`) || path.startsWith(r.prefix)) {
      return { key: r.key, label: r.label };
    }
  }
  return AREA_OUTROS;
}
