import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import { abrirDiscador, exibirTelefone, normalizarTelefone, telefoneDiscavel } from '@/lib/dial';
import { isSoundEnabled } from '@/lib/soundSettings';
import { playUrgentChime } from '@/lib/sounds';

/**
 * Avisa na hora em que entra um lead com telefone discável, com o número já
 * montado num botão "Ligar".
 *
 * Não disca sozinho de propósito. Medido em 21/08/2026: 3 a 5 leads discáveis
 * por dia útil, e 27,5% dos últimos 60 dias chegaram fora do horário comercial
 * — robô discando nesse cenário entrega chamada sem ninguém na linha. O que
 * encurta o tempo até a primeira ligação aqui é a pessoa ver em segundos e
 * clicar uma vez, não a máquina discar.
 *
 * Escuta o Supabase Externo porque é lá que `leads` mora (e é lá que a tabela
 * está na publicação `supabase_realtime` — conferido).
 */

/** Espera antes de mostrar: junta o que chegar junto num aviso só. */
const JANELA_MS = 2_000;
/** Piso entre dois avisos. Segura a enxurrada se a ingestão por planilha voltar ao volume de junho (~200/dia). */
const PISO_MS = 15_000;
/** Teto do anti-repetição, para a aba aberta o dia todo não crescer sem fim. */
const TETO_VISTOS = 500;

interface LeadNovo {
  id: string;
  nome: string;
  telefone: string;
  source: string | null;
}

export function NewDialableLeadAlerts() {
  const { user } = useAuthContext();
  const navigate = useNavigate();

  const bufferRef = useRef<LeadNovo[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimoAvisoRef = useRef(0);
  const vistosRef = useRef<Set<string>>(new Set());
  /** Os uuids que representam "eu" no Externo — quem cadastrou não precisa ser avisado. */
  const meusIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;

    // O `created_by` do Externo às vezes guarda o uuid de lá, às vezes o do
    // Cloud. Carrega os dois e compara contra ambos.
    meusIdsRef.current = new Set([user.id]);
    (async () => {
      try {
        await ensureExternalSession();
        const { data } = await externalSupabase
          .from('auth_uuid_mapping')
          .select('ext_uuid')
          .eq('cloud_uuid', user.id)
          .maybeSingle();
        const ext = (data as { ext_uuid?: string } | null)?.ext_uuid;
        if (vivo && ext) meusIdsRef.current.add(ext);
      } catch {
        /* sem mapeamento: no pior caso quem cadastrou recebe o próprio aviso */
      }
    })();

    return () => {
      vivo = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const descarregar = () => {
      timerRef.current = null;
      const lote = bufferRef.current;
      bufferRef.current = [];
      if (lote.length === 0) return;
      ultimoAvisoRef.current = Date.now();

      if (isSoundEnabled('newDialableLead')) playUrgentChime();

      if (lote.length === 1) {
        const l = lote[0];
        toast(`${l.nome} — lead novo com telefone`, {
          description: [exibirTelefone(l.telefone), l.source].filter(Boolean).join(' · '),
          duration: 30_000,
          action: {
            label: 'Ligar',
            onClick: () => {
              if (!abrirDiscador(l.telefone)) toast.error('Número não é discável');
            },
          },
        });
        return;
      }

      const nomes = lote.slice(0, 3).map((l) => l.nome).join(', ');
      toast(`${lote.length} leads novos para ligar`, {
        description: lote.length > 3 ? `${nomes} e mais ${lote.length - 3}` : nomes,
        duration: 30_000,
        // Navegação normal para uma seção do menu — não é abrir detalhe, que
        // continua sendo em painel.
        action: { label: 'Ver fila', onClick: () => navigate('/calls?tab=fila') },
      });
    };

    const agendar = () => {
      if (timerRef.current) return;
      const desdeUltimo = Date.now() - ultimoAvisoRef.current;
      timerRef.current = setTimeout(descarregar, Math.max(JANELA_MS, PISO_MS - desdeUltimo));
    };

    const canal = externalSupabase
      .channel('novos-leads-discaveis')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const l = payload.new as Record<string, unknown>;
        const id = String(l.id ?? '');
        if (!id || vistosRef.current.has(id)) return;
        if (l.deleted_at) return;
        if (!telefoneDiscavel(l.lead_phone)) return;
        const autor = l.created_by ? String(l.created_by) : '';
        if (autor && meusIdsRef.current.has(autor)) return;

        if (vistosRef.current.size >= TETO_VISTOS) vistosRef.current.clear();
        vistosRef.current.add(id);
        bufferRef.current.push({
          id,
          nome: String(l.lead_name || '').trim() || 'Lead sem nome',
          telefone: normalizarTelefone(l.lead_phone),
          source: l.source ? String(l.source) : null,
        });
        agendar();
      });

    ensureExternalSession()
      .then(() => canal.subscribe())
      .catch(() => {
        /* sessão anônima indisponível: o aviso fica mudo, a fila em /calls continua */
      });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      externalSupabase.removeChannel(canal);
    };
  }, [user?.id, navigate]);

  return null;
}
