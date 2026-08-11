export type SystemArea = { key: string; label: string };

const AREA_MAP: { match: RegExp; key: string; label: string }[] = [
  { match: /^\/whatsapp-api\/conversas/, key: 'whatsapp_conversas', label: 'WhatsApp · Conversas' },
  { match: /^\/whatsapp-api/, key: 'whatsapp_api', label: 'WhatsApp API' },
  { match: /^\/whatsapp/, key: 'whatsapp', label: 'WhatsApp' },
  { match: /^\/atividades/, key: 'atividades', label: 'Atividades' },
  { match: /^\/leads/, key: 'leads', label: 'Leads' },
  { match: /^\/acolhimento/, key: 'acolhimento', label: 'Acolhimento' },
  { match: /^\/processos|^\/processual/, key: 'processual', label: 'Processual' },
  { match: /^\/casos/, key: 'casos', label: 'Casos' },
  { match: /^\/contatos|^\/contacts/, key: 'contatos', label: 'Contatos' },
  { match: /^\/financeiro|^\/finance/, key: 'financeiro', label: 'Financeiro' },
  { match: /^\/campanhas|^\/campaigns/, key: 'campanhas', label: 'Campanhas' },
  { match: /^\/equipe|^\/team/, key: 'equipe', label: 'Equipe' },
  { match: /^\/workflow/, key: 'workflow', label: 'Workflow' },
  { match: /^\/configuracoes|^\/settings/, key: 'configuracoes', label: 'Configurações' },
  { match: /^\/$/, key: 'inicio', label: 'Início' },
];

export function areaFromLocation(pathname: string, _search = ''): SystemArea {
  const path = (pathname || '/').toLowerCase();
  for (const a of AREA_MAP) {
    if (a.match.test(path)) return { key: a.key, label: a.label };
  }
  const seg = path.split('/').filter(Boolean)[0] || 'inicio';
  return { key: seg, label: seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ') };
}
