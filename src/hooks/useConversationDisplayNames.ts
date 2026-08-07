/**
 * Nome legível de uma conversa a partir do telefone/JID.
 *
 * Listas que mostram conversa (caixa de pendências, por exemplo) só têm o
 * `phone` e, quando não existe lead vinculado, acabavam exibindo o JID cru do
 * grupo — "120363412904771767" não diz a ninguém de quem é a pendência.
 *
 * Resolve em lote: nome do grupo pelo cache da UazAPI (mais atual), depois
 * pelo nome guardado no vínculo com o lead e, para conversa individual, pelo
 * contato. Os grupos aparecem no banco nas duas grafias (bare e `@g.us`), por
 * isso o casamento é feito só pelos dígitos.
 */
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import { isWhatsAppGroupId } from '@/lib/whatsappPhone';

/** Rótulo final: lead > nome resolvido > "Grupo •••123456" > o próprio telefone. */
export function conversationDisplayName(
  phone: string | null | undefined,
  leadName: string | null | undefined,
  resolvidos: Record<string, string>
): string {
  if (leadName) return leadName;
  if (!phone) return '—';
  const achado = resolvidos[phone];
  if (achado) return achado;
  if (isWhatsAppGroupId(phone)) {
    const digitos = phone.replace(/\D/g, '');
    return `Grupo •••${digitos.slice(-6)}`;
  }
  return phone;
}

export function useConversationDisplayNames(
  phones: (string | null | undefined)[]
): Record<string, string> {
  const chave = useMemo(
    () => Array.from(new Set(phones.filter(Boolean) as string[])).sort().join('|'),
    [phones]
  );
  const [nomes, setNomes] = useState<Record<string, string>>({});

  useEffect(() => {
    const lista = chave ? chave.split('|') : [];
    if (!lista.length) { setNomes({}); return; }
    let cancelled = false;

    (async () => {
      const out: Record<string, string> = {};
      const grupos = lista.filter((p) => isWhatsAppGroupId(p));
      const individuais = lista.filter((p) => !isWhatsAppGroupId(p));

      if (grupos.length) {
        // dígitos → telefone como veio na lista, para devolver a chave certa
        const porDigitos = new Map(grupos.map((p) => [p.replace(/\D/g, ''), p]));
        const jids = [...porDigitos.keys()].flatMap((d) => [d, `${d}@g.us`]);
        for (const tabela of ['whatsapp_groups_cache', 'lead_whatsapp_groups'] as const) {
          if (porDigitos.size === Object.keys(out).length) break;
          const { data } = await (db as any)
            .from(tabela)
            .select('group_jid, group_name')
            .in('group_jid', jids)
            .not('group_name', 'is', null);
          for (const row of (data as any[]) || []) {
            const d = String(row.group_jid || '').replace(/\D/g, '');
            const phone = porDigitos.get(d);
            if (phone && !out[phone] && row.group_name) out[phone] = row.group_name;
          }
        }
      }

      if (individuais.length) {
        const { data } = await (db as any)
          .from('contacts')
          .select('phone, full_name')
          .in('phone', individuais);
        for (const row of (data as any[]) || []) {
          if (row.phone && row.full_name && !out[row.phone]) out[row.phone] = row.full_name;
        }
      }

      if (!cancelled) setNomes(out);
    })();

    return () => { cancelled = true; };
  }, [chave]);

  return nomes;
}
