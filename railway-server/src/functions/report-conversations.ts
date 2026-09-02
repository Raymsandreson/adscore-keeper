/**
 * report-conversations — memória da seção Relatórios.
 *
 * A tela nunca fala com report_conversations/report_messages direto: essas
 * tabelas estão com RLS ligada e SEM policy permissiva, então nem anon nem
 * authenticated leem nada. Tudo passa por aqui, que valida o JWT do Cloud e
 * filtra por user_id — conversa é privada de quem a criou.
 *
 * Ações (POST, campo `action`):
 *   list     → últimas conversas do usuário
 *   messages → mensagens de uma conversa (com as consultas e linhas gravadas)
 *   rename   → renomeia a conversa
 *   delete   → soft delete (deleted_at) — o histórico não é apagado de verdade
 *
 * Autorização idêntica à do report-query (diretoria/gestores/ai_user_roles),
 * reaproveitada de lá para não existirem duas regras de acesso divergentes.
 */
import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { verifyCloudJwt, isAuthorized } from './report-query';

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;

export const handler = async (req: Request, res: Response) => {
  const action: string = (req.body?.action || 'list').toString();
  const conversationId: string = (req.body?.conversation_id || '').toString().trim();

  const user = await verifyCloudJwt(req.headers['authorization'] as string | undefined);
  if (!user) {
    return res.status(401).json({ success: false, error: 'unauthorized', message: 'Sessão inválida. Faça login novamente.' });
  }
  if (!(await isAuthorized(user.id, user.email))) {
    return res.status(403).json({
      success: false, error: 'forbidden',
      message: 'Você não tem acesso ao gerador de relatórios. Ele é restrito à diretoria e gestores.',
    });
  }

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('report_conversations')
        .select('id, title, created_at, updated_at')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(MAX_CONVERSATIONS);
      if (error) throw new Error(error.message);
      return res.status(200).json({ success: true, conversations: data || [] });
    }

    if (!conversationId) {
      return res.status(400).json({ success: false, error: 'missing_conversation', message: 'Falta o id da conversa.' });
    }

    // Dono? Toda ação abaixo mexe numa conversa específica.
    const { data: conv } = await supabase
      .from('report_conversations')
      .select('id, user_id, title')
      .eq('id', conversationId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!conv || conv.user_id !== user.id) {
      return res.status(404).json({ success: false, error: 'not_found', message: 'Conversa não encontrada.' });
    }

    if (action === 'messages') {
      const { data, error } = await supabase
        .from('report_messages')
        .select('id, role, content, queries, engine, status, error_message, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(MAX_MESSAGES);
      if (error) throw new Error(error.message);
      return res.status(200).json({ success: true, conversation: { id: conv.id, title: conv.title }, messages: data || [] });
    }

    if (action === 'rename') {
      const title = (req.body?.title || '').toString().trim().slice(0, 120);
      if (!title) {
        return res.status(400).json({ success: false, error: 'empty_title', message: 'Dê um nome pra conversa.' });
      }
      const { error } = await supabase
        .from('report_conversations')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', conversationId);
      if (error) throw new Error(error.message);
      return res.status(200).json({ success: true, title });
    }

    if (action === 'delete') {
      // Soft delete: some da lista, mas o conteúdo continua no banco para
      // auditoria (ai_query_log guarda a pergunta; aqui fica a conversa inteira).
      const { error } = await supabase
        .from('report_conversations')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', conversationId);
      if (error) throw new Error(error.message);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: 'unknown_action', message: `Ação desconhecida: ${action}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[report-conversations] erro:', message);
    return res.status(200).json({ success: false, error: 'internal', message });
  }
};
