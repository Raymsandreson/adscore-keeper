import { useEffect, useState } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';

/**
 * Leads já perguntados ("é caso fechado?") nesta sessão — evita repetir a cada
 * atividade aberta. Compartilhado com o ActivityDetailPanel para que a pergunta
 * não apareça duas vezes para o mesmo lead em telas diferentes.
 */
export const closedCaseAskedLeads = new Set<string>();

/**
 * Regra única de "vale perguntar se é caso fechado?" (usada aqui e no
 * ActivityDetailPanel). Pressupõe que o lead TEM grupo de WhatsApp vinculado —
 * quem chama verifica o grupo antes.
 *
 * Perguntamos quando o lead ainda não tem desfecho de verdade:
 *  - `no_response` ("sem resposta") conta como indefinido mesmo com datas
 *    preenchidas: é justamente a contradição que queremos resolver (lead com
 *    grupo ativo e became_client_date, mas parado em "sem resposta").
 *  - status vazio só pergunta se também não houver nenhuma data de desfecho.
 *  - closed / inviavel / refused / cancelled / in_progress já têm resultado.
 */
export function shouldAskClosedCase(lead: any): boolean {
  if (!lead) return false;
  const status = String(lead.lead_status || '').trim();

  if (status && status !== 'no_response') return false;

  if (!status) {
    const hasOutcomeDate = !!(
      lead.became_client_date ||
      lead.cancelled_date ||
      lead.inviavel_date ||
      lead.in_progress_date
    );
    if (hasOutcomeDate) return false;
  }

  return true;
}

interface ClosedCaseAskGateProps {
  leadId: string | null | undefined;
  leadName?: string | null;
  /** Chamado após salvar o lead pelo dialog (para recarregar a lista/atividade). */
  onLeadSaved?: () => void;
}

/**
 * Gatilho autocontido: ao abrir uma atividade cujo lead tem grupo de WhatsApp
 * vinculado e Resultado do Lead em branco, pergunta "é caso fechado?" e, no
 * "Sim", abre o cadastro do lead já com o fechamento confirmado.
 *
 * Existe como componente separado porque a tela de Atividades usa o
 * ActivityFormCompact (e não o ActivityDetailPanel, onde o gatilho nasceu).
 */
export function ClosedCaseAskGate({ leadId, leadName, onLeadSaved }: ClosedCaseAskGateProps) {
  const [lead, setLead] = useState<any>(null);
  const [ask, setAsk] = useState(false);
  const [showLeadSheet, setShowLeadSheet] = useState(false);
  const [autoConfirmClosedCase, setAutoConfirmClosedCase] = useState(false);

  useEffect(() => {
    if (!leadId || closedCaseAskedLeads.has(leadId)) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: l } = await externalSupabase
          .from('leads')
          .select('*')
          .eq('id', leadId)
          .maybeSingle();
        if (cancelled || !l) return;

        const anyLead = l as any;
        if (!shouldAskClosedCase(anyLead)) return;

        let hasGroup = !!(anyLead.whatsapp_group_id || anyLead.group_link);
        if (!hasGroup) {
          const { count } = await (externalSupabase as any)
            .from('lead_whatsapp_groups')
            .select('id', { count: 'exact', head: true })
            .eq('lead_id', leadId);
          hasGroup = (count ?? 0) > 0;
        }

        if (!cancelled && hasGroup && !closedCaseAskedLeads.has(leadId)) {
          closedCaseAskedLeads.add(leadId);
          setLead(l);
          setAsk(true);
        }
      } catch (err) {
        console.warn('Falha ao checar grupo do lead para pergunta de caso fechado:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [leadId]);

  if (!leadId) return null;

  return (
    <>
      <AlertDialog open={ask} onOpenChange={setAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Esse lead é de um caso fechado?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead <strong>{leadName || lead?.lead_name || 'sem nome'}</strong> tem grupo do WhatsApp
              vinculado mas o Resultado do Lead está{' '}
              {lead?.lead_status === 'no_response' ? <strong>“sem resposta”</strong> : 'em branco'}. Se
              for caso fechado, o cadastro do lead
              abre já marcado como <strong>Fechado</strong> (data de criação do grupo), com cadastro do
              contato do cliente por IA e exigência do processo do caso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setAsk(false);
                setAutoConfirmClosedCase(true);
                setShowLeadSheet(true);
              }}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              Sim, é caso fechado
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showLeadSheet && lead && (
        <LeadEditDialog
          open={showLeadSheet}
          onOpenChange={(o) => {
            setShowLeadSheet(o);
            if (!o) setAutoConfirmClosedCase(false);
          }}
          lead={lead}
          autoConfirmClosedCase={autoConfirmClosedCase}
          onSave={async (id, updates) => {
            const { error } = await externalSupabase.from('leads').update(updates as any).eq('id', id);
            if (error) throw error;
            setShowLeadSheet(false);
            onLeadSaved?.();
          }}
          mode="sheet"
        />
      )}
    </>
  );
}
