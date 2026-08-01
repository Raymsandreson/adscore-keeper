import { cloudFunctions } from '@/lib/functionRouter';
import { toast } from 'sonner';

export interface UnlinkGroupDocsSummary {
  matched: number;
  removed: number;
  failed: number;
  error?: string | null;
}

interface UnlinkGroupDocsResponse {
  matched?: number;
  removed?: number;
  failed?: number;
  delete_error?: string | null;
  error?: string;
}

/**
 * Grupo saiu do caso → os documentos que vieram daquele grupo saem junto:
 * arquivo vai pra LIXEIRA do Drive (recuperável ~30 dias) e o registro em
 * process_documents é apagado.
 *
 * Sem isso, desvincular um grupo colado por engano deixava a pasta do caso com
 * RG/procuração de outro cliente. Como o registro sai, se o grupo for
 * revinculado depois o import automático traz tudo de volta.
 */
export async function unlinkGroupDocs(
  leadId: string,
  groupJid: string,
  opts: { dryRun?: boolean } = {},
): Promise<UnlinkGroupDocsSummary> {
  try {
    const { data, error } = await cloudFunctions.invoke<UnlinkGroupDocsResponse>('unlink-group-docs', {
      body: { lead_id: leadId, group_jid: groupJid, dry_run: !!opts.dryRun },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return {
      matched: Number(data?.matched || 0),
      removed: Number(data?.removed || 0),
      failed: Number(data?.failed || 0),
      error: data?.delete_error || null,
    };
  } catch (e) {
    console.warn('[unlinkGroupDocs] falhou para', leadId, groupJid, e);
    return { matched: 0, removed: 0, failed: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Roda a limpeza de vários grupos desvinculados e avisa o usuário no fim.
 * Não bloqueia o fluxo de salvar: cada grupo pode ter dezenas de arquivos e o
 * Drive responde em ~1s por arquivo.
 */
export async function unlinkGroupDocsWithToast(
  leadId: string,
  groupJids: string[],
): Promise<UnlinkGroupDocsSummary> {
  const jids = Array.from(new Set(groupJids.filter(Boolean)));
  const total: UnlinkGroupDocsSummary = { matched: 0, removed: 0, failed: 0, error: null };
  if (jids.length === 0) return total;

  const toastId = `unlink-group-docs:${leadId}`;
  toast.loading('Removendo do Drive os documentos do grupo desvinculado...', { id: toastId });

  for (const jid of jids) {
    const r = await unlinkGroupDocs(leadId, jid);
    total.matched += r.matched;
    total.removed += r.removed;
    total.failed += r.failed;
    if (r.error && !total.error) total.error = r.error;
  }

  if (total.matched === 0 && !total.error) {
    toast.dismiss(toastId);
    return total;
  }

  if (total.failed > 0 || total.error) {
    toast.warning(
      `${total.removed} documento(s) do grupo removido(s); ${total.failed || 1} falhou(aram)`,
      {
        id: toastId,
        description: total.error
          ? `Erro: ${total.error}. Os que falharam continuam na pasta do caso.`
          : 'Os que falharam continuam na pasta do caso — tente remover manualmente no Drive.',
        duration: 10000,
      },
    );
  } else {
    toast.success(`${total.removed} documento(s) do grupo movido(s) para a lixeira do Drive`, {
      id: toastId,
      description: 'Dá pra restaurar na lixeira do Google Drive por ~30 dias.',
      duration: 8000,
    });
  }

  return total;
}
