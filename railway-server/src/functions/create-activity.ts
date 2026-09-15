// create-activity — a criação de atividade com as três regras do lado do servidor.
//
// A dívida do §6 do escopo do mobile, e ela é maior do que "dedup": o app cria
// atividade por QUATRO caminhos (ditado, próxima, conversa e do zero), todos
// escrevendo direto no Externo, e das três regras do web só uma chega ao banco.
//
//   1. Dedup de pendente idêntica — vivia em `inflightCreates`, um Set de
//      módulo na memória do NAVEGADOR, janela de 5s. Não atravessa aparelho nem
//      reinício: celular e desktop criando a mesma coisa não se enxergam.
//   2. Prazo não cai em ausência registrada — vivia no front do web e
//      simplesmente NÃO EXISTE no app.
//   3. Atividade precisa de vínculo ou de marca — o app cumpre por construção
//      (`is_management: true`), mas por acordo, não por regra.
//
// O QUE O CLIENTE JÁ RESOLVE, e não é o motivo deste endpoint: o toque duplo no
// mesmo botão, que as quatro telas barram com `disabled`/`isPending`. O que ele
// NÃO pode resolver é a RESPOSTA PERDIDA (o insert chegou, a confirmação não
// voltou, a pessoa tenta de novo) e DOIS APARELHOS. Daí a idempotência por
// `client_request_id`, que é a única mudança de schema disto tudo.
//
// Identidade pelo mesmo caminho do `update-profile-avatar`: JWT do Cloud →
// `/auth/v1/user` → `auth_uuid_mapping` → ext uid. O id do autor nunca vem do
// corpo — se viesse, qualquer um criaria atividade no nome de qualquer um.
//
// Contrato completo: `docs/endpoint-criar-atividade.md` no repo mobile.
import type { RequestHandler } from 'express';
import { consultarAusencias } from '../lib/ausencias';
import { autorDaRequisicao, paraExterno } from '../lib/identidadeDoApp';
import { supabase as ext } from '../lib/supabase';

/** Mesma janela do `inflightCreates` do web. Rede de duplicata acidental, não
 *  proibição de criar duas tarefas iguais em dias diferentes — para isso existe
 *  o índice, e estendê-lo é outra pergunta (§5c do contrato). */
const JANELA_DEDUP_MS = 5000;

const EH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `lower(btrim(title))` do índice, do lado de cá. */
const chaveDoTitulo = (t: string) => t.trim().toLowerCase();

const texto = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

const uuidOuNulo = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return EH_UUID.test(s) ? s : null;
};

/** Atividade já gravada com este `client_request_id`. É o retry chegando. */
async function idPeloClientRequestId(clientRequestId: string): Promise<string | null> {
  const { data } = await ext
    .from('lead_activities')
    .select('id')
    .eq('client_request_id', clientRequestId)
    .maybeSingle();
  return ((data as { id?: string } | null)?.id) || null;
}

interface AlvoDoDedup {
  extAssignedTo: string | null;
  title: string;
  activityType: string;
  leadId: string | null;
  caseId: string | null;
  processId: string | null;
}

/**
 * Gêmea criada nos últimos 5 segundos: mesma pendente, mesmo vínculo, mesmo
 * título, mesmo tipo, mesmo responsável.
 *
 * A comparação de título e vínculo é feita AQUI e não no filtro da consulta de
 * propósito: `lower(btrim(...))` não tem equivalente honesto em PostgREST, e a
 * janela de 5s deixa o conjunto pequeno o bastante para conferir em memória com
 * a semântica exata do índice.
 */
async function gemeaRecente(alvo: AlvoDoDedup): Promise<string | null> {
  const desde = new Date(Date.now() - JANELA_DEDUP_MS).toISOString();
  const { data, error } = await ext
    .from('lead_activities')
    .select('id, title, activity_type, lead_id, case_id, process_id')
    .eq('status', 'pendente')
    .is('deleted_at', null)
    .eq('assigned_to', alvo.extAssignedTo)
    .gte('created_at', desde);
  if (error) {
    // Dedup é rede de proteção: falhar a consulta não pode impedir de gravar.
    console.warn('[create-activity] consulta de dedup falhou (seguindo):', error.message);
    return null;
  }
  const alvoTitulo = chaveDoTitulo(alvo.title);
  const gemea = (data || []).find((l) => {
    const linha = l as Record<string, unknown>;
    return (
      chaveDoTitulo(String(linha.title || '')) === alvoTitulo &&
      String(linha.activity_type || '') === alvo.activityType &&
      (linha.lead_id ?? null) === alvo.leadId &&
      (linha.case_id ?? null) === alvo.caseId &&
      (linha.process_id ?? null) === alvo.processId
    );
  });
  return ((gemea as { id?: string } | undefined)?.id) || null;
}

/** Nome do responsável quando quem chama não mandou — evita atividade sem nome na lista. */
async function nomeDoPerfil(extUserId: string | null): Promise<string | null> {
  if (!extUserId) return null;
  const { data } = await ext
    .from('profiles')
    .select('full_name')
    .eq('user_id', extUserId)
    .maybeSingle();
  return ((data as { full_name?: string } | null)?.full_name) || null;
}

export const handler: RequestHandler = async (req, res) => {
  // Formato da casa (chat-to-activity): sempre HTTP 200, resultado no corpo.
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const autor = await autorDaRequisicao(req.headers.authorization);
    if (!autor) return ok({ success: false, error: 'nao_autenticado' });

    const body = (req.body || {}) as Record<string, unknown>;

    const title = String(body.title ?? '').trim();
    if (!title) return ok({ success: false, error: 'titulo_obrigatorio' });

    const leadId = uuidOuNulo(body.lead_id);
    const caseId = uuidOuNulo(body.case_id);
    const processId = uuidOuNulo(body.process_id);
    const isManagement = body.is_management === true;
    const isSystem = body.is_system === true;
    // Regra 3: o app já cumpre por construção, mas por acordo. Aqui vira regra —
    // quem chamar sem vínculo e sem marca recebe recusa em vez de gravar órfã.
    if (!leadId && !caseId && !processId && !isManagement && !isSystem) {
      return ok({ success: false, error: 'sem_vinculo' });
    }

    // IDEMPOTÊNCIA (§3.1), antes de tudo que custa: o retry não pode ser barrado
    // por dedup nem por ausência — a atividade dele já existe.
    //
    // Sem janela de 24h de propósito, e o contrato dizia 24h: com índice único a
    // consulta é lookup e não custa nada, e a janela criaria um buraco — passado
    // o prazo, a busca não acharia a linha mas o índice ainda recusaria o insert,
    // trocando idempotência por erro.
    const clientRequestId = uuidOuNulo(body.client_request_id);
    if (clientRequestId) {
      const jaExiste = await idPeloClientRequestId(clientRequestId);
      if (jaExiste) return ok({ success: true, id: jaExiste, duplicated: true });
    }

    const activityType = texto(body.activity_type) || 'tarefa';
    const deadline = texto(body.deadline);
    // O responsável chega no espaço do CLOUD, como o resto dos ids de pessoa
    // que o app tem em mãos. Default: quem está chamando.
    const assignedToCloud = uuidOuNulo(body.assigned_to) || autor.cloudUserId;
    const extAssignedTo = await paraExterno(assignedToCloud);

    // DEDUP POR CONTEÚDO (§3.2) antes da ausência: se é duplicata, nada vai ser
    // gravado, e não faz sentido recusá-la por um prazo que já está em outra linha.
    const gemea = await gemeaRecente({ extAssignedTo, title, activityType, leadId, caseId, processId });
    if (gemea) return ok({ success: true, id: gemea, duplicated: true });

    // AUSÊNCIA (§3.4). Roda no espaço do Cloud, antes do remap, como no web.
    const ausencias = await consultarAusencias([assignedToCloud], deadline);
    if (ausencias.conflitos.length > 0) {
      // Conflitos estruturados, não a frase pronta: a do web é um toast e o app
      // precisa montar a sua. Duas frases, uma regra — o contrário do §5.5.
      return ok({ success: false, error: 'ausencia_registrada', conflicts: ausencias.conflitos });
    }

    const assignedToName = texto(body.assigned_to_name) || (await nomeDoPerfil(extAssignedTo));

    const linha = {
      title,
      description: texto(body.description),
      activity_type: activityType,
      priority: texto(body.priority) || 'normal',
      status: 'pendente',
      deadline,
      // O app grava prazo e aviso no mesmo dia: nascer com prazo numa data e
      // aviso em nenhuma faria a atividade vencer calada.
      notification_date: texto(body.notification_date),
      lead_id: leadId,
      lead_name: texto(body.lead_name),
      case_id: caseId,
      process_id: processId,
      is_management: isManagement,
      is_system: isSystem,
      assigned_to: extAssignedTo,
      assigned_to_name: assignedToName,
      next_steps: texto(body.next_steps),
      created_by: autor.extUserId,
      // Mesmo carimbo que o web põe em atividade de gente (o default da coluna
      // já é 'manual'; explícito porque é o que distingue de atividade de robô).
      action_source: 'manual',
      ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
    };

    const { data, error } = await ext.from('lead_activities').insert(linha).select('id').single();

    if (error) {
      // 23505 aqui é duplicata, não falha — e é resposta de SUCESSO. Duas
      // origens possíveis: o índice de dedup (só alcança linha com lead) ou o
      // único de `client_request_id`, quando dois retries do mesmo pedido
      // chegaram juntos e passaram os dois pela consulta lá em cima.
      if ((error as { code?: string }).code === '23505') {
        const id =
          (clientRequestId ? await idPeloClientRequestId(clientRequestId) : null) ||
          (await gemeaRecente({ extAssignedTo, title, activityType, leadId, caseId, processId }));
        if (id) return ok({ success: true, id, duplicated: true });
      }
      console.error('[create-activity] insert falhou:', error.message);
      return ok({ success: false, error: error.message });
    }

    const id = (data as { id: string }).id;
    console.log(
      `[create-activity] criada ${id} por ${autor.extUserId}` +
        `${ausencias.verificado ? '' : ' (ausência NÃO verificada)'}`,
    );

    return ok({
      success: true,
      id,
      duplicated: false,
      // Gravou sem conseguir conferir férias. O app mostra o aviso; a AUSÊNCIA
      // da flag é "conferido", que é o único jeito de ela não mudar o
      // comportamento de cliente antigo.
      ...(ausencias.verificado ? {} : { ausencia_nao_verificada: true }),
    });
  } catch (e) {
    console.error('[create-activity] erro:', e);
    return ok({ success: false, error: e instanceof Error ? e.message : 'erro_interno' });
  }
};
