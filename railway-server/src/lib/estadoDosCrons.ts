// Estado das rotinas automáticas, num lugar só.
//
// Vivia dentro de `index.ts`, onde só o `/health` alcançava — e `/health` é uma
// URL que a equipe não abre. A aba de Métricas precisa do mesmo dado: "esse
// número está velho?" e "a rotina parou?" são a mesma pergunta vista de dois
// lados, e até agora a tela não tinha como responder a segunda.
//
// Os contadores ZERAM a cada deploy: são de processo, não de banco. Por isso
// `ultima_em` é o campo que importa — `execucoes: 0` logo após uma publicação
// significa "ainda não rodou nesta versão", não "está parado".
export interface EstadoDeRotina {
  execucoes: number;
  ultima_em: string | null;
  ultimo_resultado: string | null;
}

export const sheetSyncEstado = {
  ligado: (process.env.SHEET_LEAD_SYNC || '').toLowerCase() === 'on',
  execucoes: 0,
  ultima_em: null as string | null,
  ultimo_resultado: null as string | null,
  criados_acumulado: 0,
};

export const capiReconcileEstado = {
  execucoes: 0,
  ultima_em: null as string | null,
  ultimo_resultado: null as string | null,
  enfileirados_acumulado: 0,
};

export const sheetStatusEstado = {
  execucoes: 0,
  ultima_em: null as string | null,
  ultimo_resultado: null as string | null,
  status_escritos_acumulado: 0,
};

export const metaLeadsEstado = {
  execucoes: 0,
  ultima_em: null as string | null,
  ultimo_resultado: null as string | null,
  criados_acumulado: 0,
};

/** Como a aba de Métricas lê as rotinas: rótulo humano + de quanto em quanto tempo roda. */
export function rotinasParaOPainel() {
  return [
    {
      chave: 'sheet_lead_sync',
      rotulo: 'Planilha de Lead Ads → funil',
      a_cada: '10 min',
      ligado: sheetSyncEstado.ligado,
      execucoes: sheetSyncEstado.execucoes,
      ultima_em: sheetSyncEstado.ultima_em,
      ultimo_resultado: sheetSyncEstado.ultimo_resultado,
      acumulado: `${sheetSyncEstado.criados_acumulado} leads criados`,
    },
    {
      chave: 'meta_leads_sync',
      rotulo: 'Formulários da Meta → funil',
      a_cada: '30 min',
      ligado: true,
      execucoes: metaLeadsEstado.execucoes,
      ultima_em: metaLeadsEstado.ultima_em,
      ultimo_resultado: metaLeadsEstado.ultimo_resultado,
      acumulado: `${metaLeadsEstado.criados_acumulado} leads criados`,
    },
    {
      chave: 'sheet_status_sync',
      rotulo: 'Status escrito na planilha → CRM',
      a_cada: '60 min',
      ligado: true,
      execucoes: sheetStatusEstado.execucoes,
      ultima_em: sheetStatusEstado.ultima_em,
      ultimo_resultado: sheetStatusEstado.ultimo_resultado,
      acumulado: `${sheetStatusEstado.status_escritos_acumulado} status escritos`,
    },
    {
      chave: 'capi_reconcile',
      rotulo: 'Caso fechado → conversão na Meta',
      a_cada: '15 min',
      ligado: true,
      execucoes: capiReconcileEstado.execucoes,
      ultima_em: capiReconcileEstado.ultima_em,
      ultimo_resultado: capiReconcileEstado.ultimo_resultado,
      acumulado: `${capiReconcileEstado.enfileirados_acumulado} conversões enfileiradas`,
    },
  ];
}
