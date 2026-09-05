// =============================================================================
// Radar de empresa — busca os processos de um ou vários CNPJs no Escavador.
//
// Passa pela edge `search-escavador` (action buscar_por_cpf_cnpj), a mesma que
// o "Adicionar processo" usa: o token do Escavador não sai de lá.
//
// SERIAL DE PROPÓSITO: cada página é consulta paga. Disparar as filiais em
// paralelo tornaria o custo invisível e impossível de interromper no meio.
// Aqui o usuário vê CNPJ por CNPJ e pode parar a qualquer momento.
// =============================================================================
import { useCallback, useRef, useState } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';
import {
  itensDaResposta, limparCnpj, mapearProcessoDaEmpresa, proximaPagina,
  type ProcessoDaEmpresa,
} from '@/lib/processosDaEmpresa';

export interface ProgressoRadar {
  cnpjAtual: string | null;
  cnpjsFeitos: number;
  cnpjsTotal: number;
  paginas: number;
  encontrados: number;
}

export interface AvisoRadar {
  cnpj: string;
  texto: string;
}

const PROGRESSO_ZERO: ProgressoRadar = {
  cnpjAtual: null, cnpjsFeitos: 0, cnpjsTotal: 0, paginas: 0, encontrados: 0,
};

export function useRadarEmpresa() {
  const [processos, setProcessos] = useState<ProcessoDaEmpresa[]>([]);
  const [avisos, setAvisos] = useState<AvisoRadar[]>([]);
  const [progresso, setProgresso] = useState<ProgressoRadar>(PROGRESSO_ZERO);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluidoEm, setConcluidoEm] = useState<Date | null>(null);
  const cancelar = useRef(false);

  const parar = useCallback(() => { cancelar.current = true; }, []);

  const limpar = useCallback(() => {
    setProcessos([]); setAvisos([]); setProgresso(PROGRESSO_ZERO);
    setErro(null); setConcluidoEm(null);
  }, []);

  /**
   * @param cnpjs           CNPJs a consultar (1 = empresa; N = raiz varrida)
   * @param maxPaginasPorCnpj trava de custo por CNPJ
   */
  const buscar = useCallback(async (cnpjs: string[], maxPaginasPorCnpj: number) => {
    cancelar.current = false;
    setBuscando(true);
    setErro(null);
    setConcluidoEm(null);
    setProcessos([]);
    setAvisos([]);
    setProgresso({ ...PROGRESSO_ZERO, cnpjsTotal: cnpjs.length });

    const achados: ProcessoDaEmpresa[] = [];
    const recados: AvisoRadar[] = [];
    let paginas = 0;

    try {
      for (let i = 0; i < cnpjs.length; i++) {
        if (cancelar.current) {
          recados.push({ cnpj: '—', texto: `Interrompido: ${cnpjs.length - i} CNPJ(s) não foram consultados.` });
          break;
        }
        const cnpj = limparCnpj(cnpjs[i]);
        setProgresso(p => ({ ...p, cnpjAtual: cnpj, cnpjsFeitos: i }));

        let cursor: string | null = null;
        let pagina = 0;

        do {
          if (cancelar.current) break;
          const body: Record<string, unknown> = { action: 'buscar_por_cpf_cnpj', cpf_cnpj: cnpj };
          if (cursor) body.cursor = cursor;

          const { data, error } = await cloudFunctions.invoke('search-escavador', { body });
          if (error) throw error;
          if (!data?.success) {
            // Erro de UM CNPJ não derruba a varredura inteira — vira aviso e a
            // fila continua. Sumir com o CNPJ que falhou é que seria mentira.
            recados.push({ cnpj, texto: data?.error || 'a busca falhou neste CNPJ' });
            break;
          }

          pagina += 1;
          paginas += 1;
          const itens = itensDaResposta(data);
          achados.push(...itens.map(it => mapearProcessoDaEmpresa(it, cnpj)));
          cursor = proximaPagina(data);

          setProgresso(p => ({ ...p, paginas, encontrados: achados.length }));

          if (cursor && pagina >= maxPaginasPorCnpj) {
            recados.push({
              cnpj,
              texto: `parou em ${maxPaginasPorCnpj} página(s) e ainda havia mais — o total deste CNPJ está incompleto`,
            });
            cursor = null;
          }
        } while (cursor);
      }

      setProcessos(achados);
      setAvisos(recados);
      setProgresso(p => ({ ...p, cnpjAtual: null, cnpjsFeitos: p.cnpjsTotal, encontrados: achados.length }));
      setConcluidoEm(new Date());
    } catch (e) {
      const msg = (e as { message?: string })?.message || 'falha ao consultar o Escavador';
      console.error('[useRadarEmpresa]', msg);
      setErro(msg);
      // O que já veio fica na tela: 40 processos lidos valem mais que zero.
      setProcessos(achados);
      setAvisos(recados);
    } finally {
      setBuscando(false);
    }
  }, []);

  return { processos, avisos, progresso, buscando, erro, concluidoEm, buscar, parar, limpar };
}
