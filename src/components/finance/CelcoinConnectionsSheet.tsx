// Painel das conexões Open Finance (Celcoin).
//
// Por que existe: o hook já tinha `fetchConsents` e `consentHealth` escritos, mas
// NADA renderizava — a pessoa conectava a conta e a conexão sumia da vista. Sem
// isto não há como ver o estado nem disparar sincronização pela tela.
//
// E há um segundo motivo, específico do momento: a autorização acontece no site
// do banco e o retorno é cadastrado NA CELCOIN, amarrado à credencial. Enquanto
// a credencial em uso não for a da aplicação WhatsJUD, o titular autoriza e cai
// noutro lugar — o callback deste app não roda e o consentimento fica preso em
// AWAITING_AUTHORISATION mesmo tendo sido aprovado. "Verificar autorização"
// resolve isso perguntando o estado direto à Celcoin, que não depende de
// redirect nenhum. O botão continua útil depois: dá para autorizar no celular,
// noutro navegador, dias depois, e sincronizar quando der.
//
// Abre em Sheet e não navega para lugar nenhum (princípio de interface).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, ShieldCheck, Landmark, AlertTriangle, Trash2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import {
  useCelcoinOpenFinance,
  consentHealth,
  isConsentAuthorised,
  isConsentDiscarded,
  isConsentAbandoned,
  normalizeConsentStatus,
  type CelcoinConsent,
} from '@/hooks/useCelcoinOpenFinance';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NIVEL_ESTILO: Record<string, string> = {
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  atencao: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  parado: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
};

function quando(iso: string | null): string {
  if (!iso) return 'nunca';
  return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

/**
 * Para coluna DATE ('2026-08-20'), que não tem hora nenhuma. Formatar com
 * `new Date(iso)` erraria o dia: a string sem fuso é lida como meia-noite UTC,
 * e em Brasília (UTC-3) isso é 21h do dia ANTERIOR — o extrato mostraria 19/08
 * para um lançamento de 20/08, e ainda inventaria um horário que o banco nunca
 * informou. Montando a data por componente ela nasce local, sem conversão.
 */
function quandoDia(data: string | null | undefined): string {
  if (!data) return 'nunca';
  const [ano, mes, dia] = String(data).slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return 'nunca';
  return format(new Date(ano, mes - 1, dia), 'dd/MM/yyyy', { locale: ptBR });
}

export function CelcoinConnectionsSheet({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { consents, loading, fetchConsents, checkConsent, discardConsent, syncTransactions } = useCelcoinOpenFinance();
  // Trava por consentimento, não global: sincronizar uma conta não pode
  // desabilitar o botão das outras.
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verDescartados, setVerDescartados] = useState(false);

  // Um consentimento não autorizado NÃO caduca sozinho — medido em 19/08/2026:
  // seis órfãos do mesmo banco continuavam AWAITING 21h depois, com expiração
  // marcada para 2027. Sem separar, a tela vira uma pilha de cartões idênticos
  // chamados "Banco Inter PJ" e o que funciona some no meio.
  const ativos = useMemo(() => consents.filter((c) => !isConsentDiscarded(c.status)), [consents]);
  const descartados = useMemo(() => consents.filter((c) => isConsentDiscarded(c.status)), [consents]);

  const recarregar = useCallback(() => {
    if (user?.id) fetchConsents(user.id);
  }, [user?.id, fetchConsents]);

  useEffect(() => {
    if (open) recarregar();
  }, [open, recarregar]);

  const verificar = async (c: CelcoinConsent) => {
    setOcupado(c.consent_id);
    try {
      const r = await checkConsent(c.consent_id);
      const status = normalizeConsentStatus(r?.consent_status) || 'sem status';
      if (isConsentAuthorised(status)) toast.success('Autorização confirmada pelo banco.');
      else toast.warning(`O banco ainda responde ${status}.`);
      recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao verificar.');
    } finally {
      setOcupado(null);
    }
  };

  const descartar = async (c: CelcoinConsent) => {
    const nome = c.custom_name || c.brand_name || c.brand_id;
    if (
      !window.confirm(
        `Descartar este consentimento de ${nome}?\n\nEle sai desta tela e não volta. Se a Celcoin permitir, é revogado de vez; se não permitir — o que acontece com consentimento que nunca foi autorizado — ele continua existindo lá, inerte, até a data de expiração.`,
      )
    )
      return;
    setOcupado(c.consent_id);
    try {
      const r = await discardConsent(c.consent_id);
      toast.success(
        r?.desfecho === 'REVOKED'
          ? 'Consentimento revogado na Celcoin.'
          : 'Consentimento descartado. A Celcoin não revoga consentimento não autorizado, então ele segue lá até expirar — mas sai daqui.',
      );
      recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao descartar.');
    } finally {
      setOcupado(null);
    }
  };

  const sincronizar = async (c: CelcoinConsent) => {
    if (!user?.id) return;
    setOcupado(c.consent_id);
    try {
      const r = await syncTransactions({ userId: user.id, consentId: c.consent_id });
      const total = (r?.bank_transactions || 0) + (r?.credit_card_transactions || 0);
      // A janela vem explícita na resposta porque ela é CALCULADA (retoma do dia
      // seguinte ao último lançamento gravado, para não duplicar com a Pluggy).
      // Sem mostrar, um sync de 0 linhas é indistinguível de conta sem movimento.
      const janela = r?.janela?.bank_from ? ` (desde ${r.janela.bank_from})` : '';
      toast.success(total > 0 ? `${total} lançamento(s) importado(s)${janela}.` : `Nenhum lançamento novo${janela}.`);
      recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao sincronizar.');
    } finally {
      setOcupado(null);
    }
  };

  const cartao = (c: CelcoinConsent) => {
    const saude = consentHealth(c);
    const autorizado = isConsentAuthorised(c.status);
    const descartado = isConsentDiscarded(c.status);
    const travado = ocupado === c.consent_id;

    return (
      <div key={c.consent_id} className="rounded-lg border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{c.custom_name || c.brand_name || c.brand_id}</p>
            {/* Duas datas, e a de baixo é a que importa. "Última sincronização"
                sobe toda vez que a rodada termina sem erro, mesmo trazendo zero
                linha — sozinha ela diz que o robô passou, não que veio dinheiro.
                Foi lendo só isso que a Pluggy passou 5 meses parada dizendo
                `status: UPDATED`. */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              Última sincronização: {quando(c.last_sync_at)}
            </p>
            {c.last_sync_at && (
              <p className="text-xs text-muted-foreground">
                Último lançamento: {c.last_transaction_date ? quandoDia(c.last_transaction_date) : 'nenhum'}
              </p>
            )}
            <p className="text-xs text-muted-foreground">Expira em: {quando(c.expires_at)}</p>
            {/* Dois consentimentos do mesmo banco são indistinguíveis pelo nome.
                O prefixo do id é a única coisa na tela que os separa. */}
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">{c.consent_id.slice(0, 10)}…</p>
            {isConsentAbandoned(c.status) && (
              <p className="mt-1 text-xs text-muted-foreground">
                Descartado aqui. Segue existindo na Celcoin, sem acesso a nada, até {quando(c.expires_at)}.
              </p>
            )}
          </div>
          <Badge variant="secondary" className={NIVEL_ESTILO[saude.level]}>
            {saude.level === 'ok' ? (
              <ShieldCheck className="mr-1 h-3 w-3" />
            ) : (
              <AlertTriangle className="mr-1 h-3 w-3" />
            )}
            {saude.label}
          </Badge>
        </div>

        {!descartado && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => verificar(c)} disabled={travado}>
              {travado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Verificar autorização
            </Button>
            <Button
              size="sm"
              onClick={() => sincronizar(c)}
              disabled={travado || !autorizado}
              title={autorizado ? undefined : 'A Celcoin só libera leitura com o consentimento AUTHORISED.'}
            >
              {travado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sincronizar agora
            </Button>
            {/* Só nos não autorizados: o backend recusa revogar um AUTHORISED sem
                force, e oferecer o botão que vai falhar é pior que não oferecer. */}
            {!autorizado && (
              <Button size="sm" variant="ghost" onClick={() => descartar(c)} disabled={travado} className="text-muted-foreground">
                <Trash2 className="mr-2 h-4 w-4" />
                Descartar
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Conexões Open Finance
          </SheetTitle>
          <SheetDescription>
            Contas conectadas pela Celcoin. A autorização é feita no site do banco; use
            “Verificar autorização” depois de aprovar por lá.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {loading && consents.length === 0 && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {!loading && consents.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma conta conectada por Open Finance ainda.
            </p>
          )}

          {ativos.map((c) => cartao(c))}

          {descartados.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setVerDescartados((v) => !v)}
                className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verDescartados ? '' : '-rotate-90'}`} />
                {descartados.length} consentimento(s) descartado(s)
              </button>
              {verDescartados && <div className="mt-3 space-y-3 opacity-60">{descartados.map((c) => cartao(c))}</div>}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
