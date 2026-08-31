// =============================================================================
// Estado vazio do painel de UM processo — detector, não ponto final.
//
// "Nenhuma movimentação capturada neste processo ainda" era a tela inteira, e
// ela mentia por omissão: em 30/08/2026 o processo 1017247-47.2025.4.01.3100
// tinha TRÊS pushes do TRF1 na base (17/06, 30/06 e 09/07) e nenhum card. Os
// e-mails haviam sido lidos em 11/08 pelo parser que só copiava o assunto; os
// cards genéricos foram apagados na limpeza de ruído do dia 12; e como
// email_push_processados guardava "já lido", nenhuma rodada do cron voltava
// neles. Quem abria a ficha via "não chegou nada" — quando o certo era "chegou,
// e ninguém releu".
//
// Então o vazio passa a responder as duas perguntas diferentes:
//   - tem e-mail de push deste processo na base? → botão que manda reler agora
//     (sync-email-push, modo reprocessar por identificador), e os cards nascem;
//   - não tem nenhum? → o furo é a montante (processo fora do push do tribunal
//     ou número cadastrado diferente do que o tribunal usa), e a tela diz isso
//     em vez de deixar a pessoa achando que o sistema perdeu a movimentação.
//
// Nada de redirecionar: tudo acontece dentro do painel que já está aberto.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, MailQuestion, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { db } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/functionRouter';

interface Props {
  processId: string;
  /** Recarrega o feed do painel depois da releitura. */
  onReprocessado: () => void;
}

interface Diagnostico {
  numero: string | null;
  emails: number;
}

/** Só dígitos — o e-mail traz o número com e sem máscara. */
function soDigitos(v: string): string {
  return v.replace(/\D/g, '');
}

export function SemMovimentacaoNoProcesso({ processId, onReprocessado }: Props) {
  const [diag, setDiag] = useState<Diagnostico | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [relendo, setRelendo] = useState(false);

  const conferir = useCallback(async () => {
    setCarregando(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = db as any;
      const { data: proc } = await client
        .from('lead_processes')
        .select('process_number')
        .eq('id', processId)
        .maybeSingle();
      const numero: string | null = proc?.process_number || null;
      if (!numero) {
        setDiag({ numero: null, emails: 0 });
        return;
      }

      // Mesmo casamento que o modo reprocessar da edge faz: número como veio no
      // cadastro, e também só os dígitos (tribunal manda dos dois jeitos).
      const digitos = soDigitos(numero);
      const alvos = digitos && digitos !== numero
        ? `process_number.eq.${numero},body_text.ilike.%${numero}%,body_text.ilike.%${digitos}%`
        : `process_number.eq.${numero},body_text.ilike.%${numero}%`;
      const { count } = await client
        .from('processual_emails')
        .select('gmail_message_id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .or(alvos);
      setDiag({ numero, emails: count || 0 });
    } catch (e) {
      // Sem o diagnóstico a tela volta a ser só a frase — que continua verdadeira.
      console.warn('[SemMovimentacaoNoProcesso] diagnóstico indisponível:', e);
      setDiag(null);
    } finally {
      setCarregando(false);
    }
  }, [processId]);

  useEffect(() => { void conferir(); }, [conferir]);

  const reler = useCallback(async () => {
    if (!diag?.numero) return;
    setRelendo(true);
    try {
      // apagar_cards fica FALSE: aqui não há card deste processo para limpar
      // (é o estado vazio), e apagar o que outro e-mail gerou seria estrago.
      const { error } = await cloudFunctions.invoke('sync-email-push', {
        body: { reprocessar: { identificador: diag.numero }, limite: 200 },
      });
      if (error) throw error;
      toast.success('E-mails relidos. Atualizando as movimentações...');
      onReprocessado();
      await conferir();
    } catch (e) {
      toast.error(`Não deu para reler os e-mails: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRelendo(false);
    }
  }, [diag, onReprocessado, conferir]);

  if (carregando) {
    return (
      <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Conferindo os e-mails de push deste processo...
      </p>
    );
  }

  if (!diag) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        Nenhuma movimentação capturada neste processo ainda.
      </p>
    );
  }

  if (diag.emails > 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <Mail className="h-6 w-6 text-amber-600 dark:text-amber-500" />
        <p className="text-xs text-muted-foreground">
          Nenhuma movimentação capturada — mas{' '}
          <strong className="text-foreground">
            {diag.emails} e-mail{diag.emails > 1 ? 's' : ''} de push
          </strong>{' '}
          deste processo {diag.emails > 1 ? 'estão' : 'está'} na base sem virar card.
          É releitura pendente, não processo parado.
        </p>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={reler} disabled={relendo}>
          {relendo
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Lendo...</>
            : <><RefreshCw className="h-3 w-3" /> Ler {diag.emails > 1 ? 'os e-mails' : 'o e-mail'} agora</>}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <MailQuestion className="h-6 w-6 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">
        Nenhuma movimentação capturada neste processo ainda — e nenhum e-mail de push
        chegou {diag.numero ? <>para <strong className="text-foreground">{diag.numero}</strong></> : 'para este processo'}.
      </p>
      <p className="max-w-xs text-[11px] text-muted-foreground/80">
        Ou o processo não está cadastrado no push do tribunal, ou o número aqui é
        diferente do que o tribunal usa. Conferir o cadastro do push resolve para
        frente; o histórico vem pela captura do Escavador.
      </p>
    </div>
  );
}
