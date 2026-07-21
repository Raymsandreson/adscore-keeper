import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';

/**
 * /atv/:code — link curto pra uma atividade, pensado pra caber em mensagem
 * de chat/WhatsApp (ex.: o coach de desempenho do telão).
 *
 * :code é o prefixo hex de 8 caracteres do UUID da atividade (ou o UUID
 * inteiro). O prefixo vira um range [xxxxxxxx-0000-…, xxxxxxxx-ffff-…] no
 * id, que resolve pro UUID completo; daí redireciona pro mecanismo já
 * existente /?openActivity=<id>, que abre o painel da atividade.
 */
export default function AtvShortLinkPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = (code || '').trim().toLowerCase();

      // UUID completo → vai direto.
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw)) {
        navigate(`/?openActivity=${raw}`, { replace: true });
        return;
      }

      if (!/^[0-9a-f]{8}$/.test(raw)) {
        setError('Link inválido.');
        return;
      }

      try {
        await ensureExternalSession();
        const { data, error: qErr } = await externalSupabase
          .from('lead_activities')
          .select('id')
          .gte('id', `${raw}-0000-0000-0000-000000000000`)
          .lte('id', `${raw}-ffff-ffff-ffff-ffffffffffff`)
          .limit(2);
        if (cancelled) return;
        if (qErr) throw qErr;
        if (!data?.length) {
          setError('Atividade não encontrada — o link pode estar desatualizado.');
          return;
        }
        // Colisão de prefixo é ~impossível (8 hex = 4 bi); se houver, abre a primeira.
        navigate(`/?openActivity=${data[0].id}`, { replace: true });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao abrir a atividade.');
      }
    })();
    return () => { cancelled = true; };
  }, [code, navigate]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 p-4 text-center">
      {error ? (
        <>
          <p className="text-lg font-semibold">Não deu pra abrir a atividade</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="mt-2 rounded-full border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Ir pras atividades
          </button>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Abrindo atividade…</p>
        </>
      )}
    </div>
  );
}
