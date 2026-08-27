// Painel do lead aberto POR ID, de qualquer lugar que só tenha o id do caso.
//
// Nasceu na lista de protocolos e passou a servir também a Conferência do
// processo (27/08/2026): de lá o caminho para o caso era fechar tudo e procurar
// pelo nome. O processo é metade da história — contato, atividades e financeiro
// do cliente moram no lead.
//
// Vive em arquivo separado e entra por React.lazy de propósito: ele arrasta o
// LeadEditDialog e o useLeads junto, e nenhum dos dois tem o que fazer na tela
// que o chama enquanto ninguém clicar.
//
// Por que reusa `updateLead` do useLeads em vez de um update direto: aquele
// caminho sanitiza os campos de data, carimba `updated_by` remapeado pro uuid
// do Externo e registra a troca de "Resultado do Lead" via log_lead_result_change
// (é o que alimenta o KPI de resultado por pessoa/mês). Um `db.update()` cru
// aqui salvaria o lead e perderia as três coisas sem avisar ninguém.

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LeadEditDialog } from "@/components/kanban/LeadEditDialog";
import { useKanbanBoards } from "@/hooks/useKanbanBoards";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { db } from "@/integrations/supabase";

interface Props {
  leadId: string;
  onClose: () => void;
}

export default function LeadPainelPorId({ leadId, onClose }: Props) {
  const { updateLead, loading: leadsCarregando } = useLeads();
  const { boards } = useKanbanBoards();
  const [lead, setLead] = useState<Lead | null>(null);
  const [aberto, setAberto] = useState(true);

  // Busca a linha inteira (select *): a lista do useLeads pode estar carregada
  // no modo índice, com um subconjunto de colunas.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data, error } = await db
          .from("leads")
          .select("*")
          .eq("id", leadId)
          .maybeSingle();
        if (error) throw error;
        if (!vivo) return;
        if (!data) {
          toast.error("Lead não encontrado");
          onClose();
          return;
        }
        setLead(data as unknown as Lead);
      } catch (e) {
        if (!vivo) return;
        toast.error("Erro ao abrir o lead: " + ((e as Error)?.message || ""));
        onClose();
      }
    })();
    return () => {
      vivo = false;
    };
  }, [leadId, onClose]);

  // Desmontar no clique do fechar cortaria a animação de saída do sheet; o
  // componente fica mais 300ms no ar (a duração da saída) e só então avisa
  // quem o montou. Sem o timer, o painel some seco.
  useEffect(() => {
    if (aberto) return;
    const t = setTimeout(onClose, 320);
    return () => clearTimeout(t);
  }, [aberto, onClose]);

  // Só abre depois que a lista do useLeads terminou de carregar. Motivo: o
  // updateLead lê o status anterior de dentro dessa lista pra registrar o
  // de/para no histórico. Salvar com ela ainda vazia gravaria "veio de nada".
  if (!lead || leadsCarregando) return null;

  return (
    <LeadEditDialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) setAberto(false);
      }}
      lead={lead}
      onSave={async (id, updates) => {
        await updateLead(id, updates);
      }}
      boards={boards}
      mode="sheet"
    />
  );
}
