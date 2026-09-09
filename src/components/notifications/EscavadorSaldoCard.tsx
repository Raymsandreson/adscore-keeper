/**
 * Saldo do Escavador, dentro do sino — o alarme que faltava (09/09/2026).
 *
 * POR QUE. O Escavador cobra por consulta e o saldo acaba em silêncio: as
 * solicitações passam a voltar BLOQUEADO_SALDO e os crons só param de trazer
 * dado. Ninguém via. A `vw_escavador_saldo` lê o saldo de hora em hora pelo
 * endpoint de créditos (grátis), guarda o histórico e calcula quanto dura.
 *
 * O cartão vive no sino porque é onde já se olha a captura. Em alerta ele
 * fica vermelho e diz o motivo; fora de alerta é uma linha discreta.
 */
import { useEffect, useState } from 'react';
import { db } from '@/integrations/supabase';
import { Wallet, AlertTriangle } from 'lucide-react';

export interface EscavadorSaldo {
  saldo_reais: number | string | null;
  creditos: number | null;
  lido_em: string | null;
  gasto_24h_reais: number | string | null;
  gasto_7d_media_dia: number | string | null;
  dias_restantes: number | string | null;
  bloqueadas_saldo_24h: number | null;
  alerta: boolean;
  motivo: string | null;
  alertado_em: string | null;
}

const reais = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const hora = (iso: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
};

export function EscavadorSaldoCard() {
  const [s, setS] = useState<EscavadorSaldo | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (db as any).from('vw_escavador_saldo').select('*').limit(1).maybeSingle();
        if (!vivo) return;
        if (error) { setErro(true); return; }
        setS((data as EscavadorSaldo) || null);
      } catch {
        if (vivo) setErro(true);
      }
    })();
    return () => { vivo = false; };
  }, []);

  if (erro) return null;
  if (!s || s.saldo_reais == null) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="escavador-saldo">
        <Wallet className="h-3.5 w-3.5" /> Saldo do Escavador ainda não lido.
      </div>
    );
  }

  const dias = s.dias_restantes == null ? null : Number(s.dias_restantes);
  return (
    <div
      data-testid="escavador-saldo"
      className={`rounded-md border px-2.5 py-1.5 text-[11px] ${s.alerta
        ? 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400'
        : 'border-border text-muted-foreground'}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          {s.alerta ? <AlertTriangle className="h-3.5 w-3.5 text-red-600" /> : <Wallet className="h-3.5 w-3.5" />}
          Saldo do Escavador {reais(s.saldo_reais)}
        </span>
        {s.gasto_7d_media_dia != null && Number(s.gasto_7d_media_dia) > 0 ? (
          <span>~{reais(s.gasto_7d_media_dia)}/dia</span>
        ) : null}
        {dias != null ? <span>dá para ~{Math.floor(dias)} dia{Math.floor(dias) === 1 ? '' : 's'}</span> : null}
        {Number(s.bloqueadas_saldo_24h) > 0 ? (
          <span className="font-medium">{s.bloqueadas_saldo_24h} bloqueada(s) por saldo nas últimas 24 h</span>
        ) : null}
        <span>lido {hora(s.lido_em)}</span>
      </div>
      {s.alerta && s.motivo ? <div className="mt-0.5 font-medium">{s.motivo}</div> : null}
    </div>
  );
}
