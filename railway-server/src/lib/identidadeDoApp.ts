// Quem está chamando, nos DOIS espaços de uuid.
//
// O app (e o navegador logado) carrega JWT do Cloud; as tabelas de negócio
// moram no Externo e guardam uuid do Externo. Em 26 dos 56 cadastros os dois
// valores DIVERGEM (medido em 14/09/2026), então traduzir é obrigatório e
// testar com um usuário cujos ids coincidem esconde o bug.
//
// O id do autor NUNCA vem do corpo da requisição. Se viesse, qualquer um
// criaria atividade no nome de qualquer um — é a mesma razão que está no
// cabeçalho do `update-profile-avatar`, e o guard contra a anon key (que é um
// JWT válido e não identifica ninguém) já vive no `verifyCloudJwt`.
//
// Existe porque este é o TERCEIRO lugar a precisar da tradução:
// `update-profile-avatar` e `performance-coach` já tinham a sua, cada uma com
// um recorte. Uma quarta cópia seria a hora de alguém corrigir só duas.
import { verifyCloudJwt } from './functionAuth';
import { supabase as ext } from './supabase';

export interface AutorDaRequisicao {
  /** Id no Cloud — é o espaço em que `member_time_off.user_id` guarda gente. */
  cloudUserId: string;
  /** Id no Externo — é o que as colunas de `lead_activities` guardam. */
  extUserId: string;
}

/**
 * Traduz um uuid do Cloud para o Externo.
 *
 * Sem linha no mapa, devolve o próprio id: são os 30 cadastros em que os dois
 * valores coincidem, e é o mesmo fallback do `update-profile-avatar`. Um id
 * inventado passa direto e vira atividade órfã — por isso ele só é usado depois
 * do JWT, nunca em id que veio do corpo sem conferência.
 */
export async function paraExterno(cloudUserId: string | null): Promise<string | null> {
  if (!cloudUserId) return null;
  const { data } = await ext
    .from('auth_uuid_mapping')
    .select('ext_uuid')
    .eq('cloud_uuid', cloudUserId)
    .maybeSingle();
  return ((data as { ext_uuid?: string } | null)?.ext_uuid) || cloudUserId;
}

/** Null = não autenticado. Quem chama devolve `nao_autenticado` e para. */
export async function autorDaRequisicao(authHeader: string | undefined): Promise<AutorDaRequisicao | null> {
  const veredito = await verifyCloudJwt(authHeader);
  if (!veredito.ok || !veredito.userId) return null;
  const extUserId = await paraExterno(veredito.userId);
  if (!extUserId) return null;
  return { cloudUserId: veredito.userId, extUserId };
}
