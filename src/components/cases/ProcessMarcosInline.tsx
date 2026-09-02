// =============================================================================
// Régua compacta de marcos de UM processo, para caber dentro de outra tela.
//
// Existe porque a atividade vinculada a um processo não mostrava em que altura
// esse processo está — quem abre a atividade via o título do processo e mais
// nada, e precisava sair da tela pra descobrir se já teve sentença.
//
// Formato deliberadamente resumido: a régua vira uma faixa horizontal com o
// marco ATUAL escrito por extenso e os demais como pontos. A visão detalhada
// (datas, tempo entre marcos, valores) continua sendo a linha do trem em
// ProcessMovementsTimeline.
//
// DUAS RÉGUAS, NESTA ORDEM (30/08/2026). A régua de POP-marcos
// (process_pop_marcos, useProcessoMarcos) é a que vale: é a que move a fase do
// processo e a que dá o percentual da barra. As 12 estações de
// process_movements são a régua antiga, que só cobre o trabalhista — em
// previdenciário ela está vazia. Lendo só ela, esta faixa dizia "Nenhum marco
// registrado neste processo ainda" no mesmo cabeçalho em que a barra logo
// abaixo mostrava 40% pela régua do POP. Duas afirmações opostas sobre o mesmo
// processo, na mesma tela.
// =============================================================================
import { useMemo } from 'react';
import { useProcessMovements, type MarcoTipo } from '@/hooks/useProcessMovements';
import { useProcessoMarcos } from '@/hooks/useProcessoMarcos';
import { estacoesDoProcesso } from '@/lib/processStations';
import { Badge } from '@/components/ui/badge';
import { TrainFront } from 'lucide-react';

/** Rótulos curtos — a versão longa vive em ProcessMovementsTimeline. */
const CURTO: Record<MarcoTipo, string> = {
  peticao_inicial: 'Inicial',
  audiencia_conciliacao: 'Conciliação',
  pericia: 'Perícia',
  audiencia_instrucao: 'Instrução',
  sentenca_1grau: 'Sentença',
  acordo: 'Acordo',
  acordao_2grau: 'Acórdão 2º',
  acordao_superior: 'Acórdão sup.',
  transito_julgado: 'Trânsito',
  cumprimento_sentenca: 'Cumprimento',
  precatorio_rpv: 'Precatório/RPV',
  pagamento: 'Pagamento',
};

function fmt(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

interface Props {
  processId?: string | null;
  /** Usado só para decidir quais estações intermediárias são previstas. */
  processNumber?: string | null;
  caseType?: string | null;
  className?: string;
}

export default function ProcessMarcosInline({
  processId, processNumber, caseType, className = '',
}: Props) {
  const { movements, loading } = useProcessMovements(processId || undefined);
  const regua = useProcessoMarcos(processId || null);

  const { estacoes, atualIdx, atual } = useMemo(() => {
    const tiposComMarco = new Set(movements.map((m) => m.tipo_movimentacao));
    const lista = estacoesDoProcesso({ tiposComMarco, processNumber, caseType });

    // Marco atual = a estação mais avançada já alcançada (mesma regra da view
    // lead_process_current_status: maior marco_ordem vence).
    let idx = -1;
    lista.forEach((t, i) => { if (tiposComMarco.has(t)) idx = i; });

    const dataAtual = idx >= 0
      ? movements
          .filter((m) => m.tipo_movimentacao === lista[idx])
          .map((m) => m.data_movimentacao)
          .sort()
          .slice(-1)[0]
      : null;

    return {
      estacoes: lista as MarcoTipo[],
      atualIdx: idx,
      atual: idx >= 0 ? { tipo: lista[idx] as MarcoTipo, data: dataAtual } : null,
    };
  }, [movements, processNumber, caseType]);

  /**
   * Marcos POSICIONAIS deste POP, na mesma conta do percentual da régua
   * (02/09/2026): todos entram, eventual ou não — o que não se aplica conta
   * como superado. Estado (acordo, suspensão) não disputa posição —
   * `atravessa_fases` existe para isso.
   */
  const reguaDoPop = useMemo(() => {
    if (regua.percentual == null) return null;
    const lista = regua.marcos.filter(m => !m.atravessa_fases);
    return lista.length > 0 ? lista : null;
  }, [regua.marcos, regua.percentual]);

  if (!processId) return null;

  // Régua do POP: quem tem percentual manda na faixa.
  if (reguaDoPop) {
    const idx = reguaDoPop.findIndex(m => m.atual);
    return (
      <div className={`space-y-1.5 ${className}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className="bg-primary/10 text-primary gap-1">
            <TrainFront className="h-3 w-3" />
            {regua.atual?.rotulo || 'Sem marco'}
          </Badge>
          {regua.atual?.data_detectada && (
            <span className="text-xs text-muted-foreground">em {fmt(regua.atual.data_detectada)}</span>
          )}
          <span className="text-xs text-muted-foreground">
            · marco {regua.cumpridos} de {regua.previstos} ({regua.percentual}%)
          </span>
        </div>
        <div className="flex items-center gap-1" title={reguaDoPop.map(m => m.rotulo).join(' → ')}>
          {reguaDoPop.map((m, i) => (
            <div
              key={m.marco_chave}
              className={`h-1.5 flex-1 rounded-full ${
                m.estado === 'atingido' || m.estado === 'presumido' ? (i === idx ? 'bg-primary' : 'bg-primary/60')
                : 'bg-muted'
              }`}
              title={`${m.rotulo}${m.data_detectada ? ` · ${fmt(m.data_detectada)}` : ''}`}
            />
          ))}
        </div>
      </div>
    );
  }

  if ((loading || regua.loading) && !movements.length) {
    return <div className={`text-xs text-muted-foreground ${className}`}>Carregando marcos…</div>;
  }
  if (!movements.length) {
    return (
      <div className={`text-xs text-muted-foreground ${className}`}>
        Nenhum marco registrado neste processo ainda.
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className="bg-primary/10 text-primary gap-1">
          <TrainFront className="h-3 w-3" />
          {atual ? CURTO[atual.tipo] : 'Sem marco'}
        </Badge>
        {atual?.data && (
          <span className="text-xs text-muted-foreground">em {fmt(atual.data)}</span>
        )}
        <span className="text-xs text-muted-foreground">
          · estação {atualIdx + 1} de {estacoes.length}
        </span>
      </div>

      {/* Faixa: cheio até a atual, vazio depois. */}
      <div className="flex items-center gap-1" title={estacoes.map(t => CURTO[t]).join(' → ')}>
        {estacoes.map((t, i) => (
          <div
            key={t}
            className={`h-1.5 flex-1 rounded-full ${
              i < atualIdx ? 'bg-primary/60'
              : i === atualIdx ? 'bg-primary'
              : 'bg-muted'
            }`}
            title={CURTO[t]}
          />
        ))}
      </div>
    </div>
  );
}
