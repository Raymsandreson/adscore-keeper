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
import { useCallback, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, ShieldCheck, Landmark, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import {
  useCelcoinOpenFinance,
  consentHealth,
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

export function CelcoinConnectionsSheet({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { consents, loading, fetchConsents, checkConsent, syncTransactions } = useCelcoinOpenFinance();
  // Trava por consentimento, não global: sincronizar uma conta não pode
  // desabilitar o botão das outras.
  const [ocupado, setOcupado] = useState<string | null>(null);

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
      const status = r?.consent_status || 'sem status';
      if (status === 'AUTHORISED') toast.success('Autorização confirmada pelo banco.');
      else toast.warning(`O banco ainda responde ${status}.`);
      recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao verificar.');
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

          {consents.map((c) => {
            const saude = consentHealth(c);
            const autorizado = c.status === 'AUTHORISED';
            const travado = ocupado === c.consent_id;

            return (
              <div key={c.consent_id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.custom_name || c.brand_name || c.brand_id}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Última sincronização: {quando(c.last_sync_at)}
                    </p>
                    <p className="text-xs text-muted-foreground">Expira em: {quando(c.expires_at)}</p>
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
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
