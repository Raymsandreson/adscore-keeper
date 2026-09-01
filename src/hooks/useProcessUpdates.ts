import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { classificarEsfera, type Esfera } from '@/lib/esferaJustica';
import { responsavelDoPassoAberto } from '@/lib/leadStepContext';
import { showNativeNotification } from '@/lib/nativeNotification';
import { abrirMovimentacaoSheet } from '@/lib/movimentacaoSheet';
import { ASSIGNEE_BLOCKLIST } from '@/lib/assigneeBlocklist';

export type UpdateCategoria =
  | 'decisao_merito'
  | 'audiencia'
  | 'pericia'
  | 'prazo'
  | 'despacho'
  | 'movimentacao';

/** Um evento do push do tribunal, como veio no e-mail. */
export interface EventoProcesso {
  data: string | null;
  hora: string | null;
  texto: string;
}

export interface ProcessUpdate {
  id: string;
  process_id: string;
  lead_id: string | null;
  case_id: string | null;
  numero_cnj: string | null;
  processo_titulo: string | null;
  /** Ramo da Justiça (migration 20260811210000). Null em linhas antigas. */
  esfera: Esfera | null;
  categoria: UpdateCategoria;
  titulo: string;
  descricao: string | null;
  data_movimentacao: string | null;
  /**
   * true = o e-mail do tribunal não trouxe a data do ato (layout desconhecido)
   * e data_movimentacao ficou nula DE PROPÓSITO (migration 20260830120000).
   * O card mostra "sem data no e-mail" — nunca a data do e-mail como se fosse
   * a do ato, que foi o bug dos 9 cards de 29/08/2026.
   */
  data_presumida: boolean;
  created_at: string;
  /**
   * Eventos do push agrupado (migration 20260812150000). Null nas linhas do
   * Escavador e nas do layout de tabela, em que cada movimento já é uma linha.
   */
  eventos: EventoProcesso[] | null;
  /**
   * Resumo do que o e-mail do tribunal disse, escrito pela IA na captura
   * (migration 20260812210000, Railway: summarize-process-updates). Null
   * enquanto a fila não passou pela linha — o card cai no texto cru.
   */
  resumo_ia: string | null;
  /**
   * Vínculos do processo, buscados depois da lista (leads e legal_cases) e
   * grudados na linha. Não vêm de process_updates: a tabela guarda só os ids.
   *
   * `vinculos` null = ainda carregando (a lista pinta antes da busca terminar);
   * objeto = resolvido, e aí `grupo_id` null quer dizer "sem grupo de WhatsApp",
   * que é o que o filtro de vínculo separa.
   */
  vinculos: UpdateVinculos | null;
}

/** Lead e caso por trás da movimentação — quem avisar e sob que número. */
export interface UpdateVinculos {
  lead_nome: string | null;
  grupo_id: string | null;
  caso_numero: string | null;
  caso_titulo: string | null;
}

/** Etiqueta "Notificado" — o cliente já foi avisado desta movimentação. */
export interface UpdateNotificacao {
  update_id: string;
  notified_at: string;
  notified_by_name: string | null;
  activity_id: string | null;
}

// Exportado porque o sino precisa saber quando a lista está no teto: um período
// que abrange tudo que foi carregado vira "5000+" no chip, e não número cravado.
//
// Era 100, e 100 mentia: em 12/08/2026 o banco tinha 452 movimentações nos
// últimos 30 dias e 1882 no total, mas a busca pegava as 100 mais recentes de
// TODOS os tempos — e como audiência designada entra com data futura (a mais
// distante era 09/12/2026), essas 100 começavam em dezembro e terminavam em
// 04/08. O chip dizia "30 dias (100+)" para 452, e as 352 restantes não
// existiam em lugar nenhum da tela.
//
// Depois foi 600, e 600 passou a cortar de novo: em 17/08/2026 a janela de 30
// dias tinha 974 movimentações, então "Marcar todas" no lote pegava 600 de 974 —
// número redondo demais para alguém desconfiar. Agora a busca PAGINA até o
// filtro acabar (ver PAGINA_BUSCA) e isto virou só teto de segurança: a tabela
// inteira pesa 275 kB nas colunas de texto (2576 linhas, ~750 B por linha), logo
// 5000 linhas são ~3,7 MB — caro o suficiente para valer um limite, longe o
// suficiente para não cortar uso real.
export const FETCH_LIMIT = 5000;

/**
 * Linhas por requisição da paginação. 1000 é o teto que o PostgREST devolve por
 * request no Supabase; pedir mais numa só chamada é silenciosamente truncado —
 * que era como as 974 viravam 600 sem ninguém ver.
 */
const PAGINA_BUSCA = 1000;

/**
 * Janela padrão da busca, em dias. O sino carrega o PERÍODO inteiro — todas as
 * linhas dele, paginando — em vez das N linhas mais recentes da tabela: é o que
 * faz o chip de 30 dias contar 974 e abrir 974. Clicar em "Tudo" tira a janela e
 * carrega a tabela inteira.
 */
export const JANELA_DIAS = 30;

// Teto do `.in()`: 600 UUIDs viram uma URL de ~22KB no GET do PostgREST, que
// proxy nenhum entrega. Em lotes, a etiqueta continua chegando.
const LOTE_IDS = 200;

// Em paralelo, não em fila: com a busca paginada são até 5000 ids, ou 25 lotes
// por tabela — em série isso somava dezenas de idas ao banco antes do sino
// aparecer. São só leituras por `in (...)`, então não há ordem a respeitar.
async function emLotes<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LOTE_IDS) chunks.push(ids.slice(i, i + LOTE_IDS));
  const partes = await Promise.all(chunks.map(fn));
  return partes.flat();
}

/** Mesma ordem do `order()` da busca — usada para reencaixar o que vem do realtime. */
const ordemDoFeed = (a: ProcessUpdate, b: ProcessUpdate): number => {
  const da = a.data_movimentacao || '';
  const dbb = b.data_movimentacao || '';
  // Sem data de movimentação vai para o fim, igual ao nullsFirst: false.
  if (da !== dbb) return da && dbb ? (da < dbb ? 1 : -1) : (da ? -1 : 1);
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  // Terceiro critério igual ao da busca: empate em data + created_at é comum
  // (1164 linhas), e sem o desempate pela PK a linha vinda do realtime cairia em
  // posição diferente da que a próxima busca daria para ela.
  return a.id < b.id ? 1 : -1;
};

const COLUNAS = 'id, process_id, lead_id, case_id, numero_cnj, processo_titulo, esfera, categoria, titulo, descricao, data_movimentacao, data_presumida, created_at, eventos, resumo_ia';
// Coluna que falta derruba o select INTEIRO e o sino fica vazio em silêncio —
// já aconteceu com callback_at em lead_activities. Então cada coluna nova entra
// com degrau de recuo próprio: sem data_presumida o card só perde o aviso "sem
// data no e-mail", sem resumo_ia cai no texto cru, sem eventos ainda dá para
// ler o feed, e sem esfera dá para ler sem o filtro por ramo. O degrau da
// data_presumida é o primeiro porque é a coluna mais nova — enquanto a
// migration 20260830120000 não roda no Externo, é ela que derrubaria o feed.
const COLUNAS_SEM_PRESUMIDA = COLUNAS.replace(', data_presumida', '');
const COLUNAS_SEM_RESUMO = COLUNAS_SEM_PRESUMIDA.replace(', resumo_ia', '');
const COLUNAS_SEM_EVENTOS = COLUNAS_SEM_RESUMO.replace(', eventos', '');
const COLUNAS_SEM_ESFERA = COLUNAS_SEM_EVENTOS.replace(', esfera', '');

/**
 * Feed do sino de atualizações processuais (process_updates no Externo,
 * alimentada pela edge sync-process-compromissos + cron diário 5h).
 * Lido/não-lido é POR USUÁRIO, persistido em process_update_reads
 * (user_id = profile do Externo via remapToExternal).
 *
 * `opts.processId` restringe o feed a um processo só — é o que permite o mesmo
 * sino virar atalho dentro da ficha da atividade ("tem movimentação NESTE
 * processo?"). Filtrar a lista global no cliente não serviria: ela é cortada nas
 * FETCH_LIMIT mais recentes de todo mundo, então um processo parado há duas
 * semanas apareceria como "nenhuma atualização".
 *
 * `opts.desde` (dia YYYY-MM-DD) é a janela da busca. Com ela o corte deixa de
 * ser "as N linhas mais recentes da tabela" e passa a ser "tudo do período" —
 * e `totalNoBanco` diz quantas o filtro casou de verdade, com teto ou sem.
 */
export const useProcessUpdates = (opts?: { processId?: string | null; desde?: string | null }) => {
  const scopeProcessId = opts?.processId || null;
  const desde = opts?.desde || null;
  const { user } = useAuthContext();
  const [updates, setUpdates] = useState<ProcessUpdate[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [notificadas, setNotificadas] = useState<Map<string, UpdateNotificacao>>(new Map());
  const [extUserId, setExtUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Quantas linhas o filtro casou no banco — não quantas couberam no teto. */
  const [totalNoBanco, setTotalNoBanco] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      await ensureExternalSession();
      const uid = user?.id ? await remapToExternal(user.id) : null;
      setExtUserId(uid);

      // process_updates/process_update_reads ainda não estão no types.ts gerado.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = db as any;
      // Ordem pela data DA MOVIMENTAÇÃO, não pela da linha.
      //
      // Ordenar por created_at parecia igual e não era: o backfill do Escavador
      // e do DataJud insere linhas novas com movimentação velha, e elas tomavam
      // as FETCH_LIMIT vagas. Em 12/08/2026 o banco tinha 22 movimentações do
      // dia e 26 do anterior — o sino mostrava 3 e 0. O filtro de período lê
      // data_movimentacao e o card mostra data_movimentacao; a busca também
      // precisa, senão "Hoje" esconde o que é de hoje.
      //
      // A janela (`desde`) é o que impede o teto de virar mentira: sem ela, as
      // FETCH_LIMIT vagas eram disputadas pela tabela inteira — e audiência
      // designada, que entra com data futura, ficava com as primeiras.
      // `count: 'exact'` vem junto para o chip saber dizer "452", e não "600+".
      const buscar = (colunas: string, de: number, ate: number) => {
        let q = client.from('process_updates').select(colunas, { count: 'exact' });
        if (scopeProcessId) q = q.eq('process_id', scopeProcessId);
        // Linha sem data de movimentação não pode sumir do período: o card e o
        // filtro caem no created_at quando ela falta.
        if (desde) q = q.or(`data_movimentacao.gte.${desde},data_movimentacao.is.null`);
        return q
          .order('data_movimentacao', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          // Desempate pela PK, obrigatório para a paginação. Sem ele a ordem não
          // é total — a tabela tem 313 grupos de empate em
          // (data_movimentacao, created_at), o maior com 20 linhas (17/08/2026) —
          // e o Postgres não garante a mesma ordem entre duas requisições. Na
          // fronteira de uma página isso não só repete linha (o dedupe pegaria):
          // ele PULA linha, que é o modo silencioso de "todas" não ser todas.
          .order('id', { ascending: false })
          .range(de, ate);
      };

      // A primeira página decide o conjunto de colunas que este banco aceita (os
      // degraus de recuo acima); as seguintes reusam o mesmo, senão cada página
      // repetiria as quatro tentativas.
      let colunas = COLUNAS;
      let pagina = await buscar(colunas, 0, PAGINA_BUSCA - 1);
      for (const alternativa of [COLUNAS_SEM_PRESUMIDA, COLUNAS_SEM_RESUMO, COLUNAS_SEM_EVENTOS, COLUNAS_SEM_ESFERA]) {
        if (!pagina.error) break;
        colunas = alternativa;
        pagina = await buscar(colunas, 0, PAGINA_BUSCA - 1);
      }
      if (pagina.error) throw pagina.error;

      const count: number | null = typeof pagina.count === 'number' ? pagina.count : null;
      setTotalNoBanco(count);

      // "Todas" tem que ser literalmente todas: pagina até o filtro acabar, em
      // vez de parar na primeira fatia. O que segura é o teto de segurança.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const brutas: any[] = [...(pagina.data || [])];
      while (
        (pagina.data?.length || 0) === PAGINA_BUSCA
        && brutas.length < FETCH_LIMIT
        && (count === null || brutas.length < count)
      ) {
        const ate = Math.min(brutas.length + PAGINA_BUSCA, FETCH_LIMIT) - 1;
        pagina = await buscar(colunas, brutas.length, ate);
        if (pagina.error) {
          // Página seguinte falhou: fica com o que já veio em vez de zerar o
          // sino. `totalNoBanco` continua maior que o carregado, então o chip
          // mostra o "+" e a conta não mente.
          console.warn('[useProcessUpdates] paginação interrompida:', pagina.error.message);
          break;
        }
        brutas.push(...(pagina.data || []));
      }

      // Uma linha nova inserida no meio da paginação empurra o offset e faria a
      // mesma movimentação vir em duas páginas — e id repetido no feed é chave
      // repetida no React.
      const vistos = new Set<string>();
      const unicas = brutas.filter((r) => {
        if (vistos.has(r.id)) return false;
        vistos.add(r.id);
        return true;
      });

      // Linha antiga (ou banco sem a coluna): classifica pelo CNJ na hora, para
      // o filtro por ramo já valer sem esperar o backfill.
      const rows = (unicas as ProcessUpdate[]).map((r) => ({
        ...r,
        esfera: r.esfera || classificarEsfera({ numeroCnj: r.numero_cnj, titulo: r.processo_titulo }),
        eventos: Array.isArray(r.eventos) ? r.eventos : null,
        // Degrau sem a coluna devolve linha sem o campo — `undefined` no card
        // seria "carregando", e o que vale dizer é "ainda não resumido".
        resumo_ia: r.resumo_ia ?? null,
        data_presumida: r.data_presumida === true,
        vinculos: null,
      }));
      setUpdates(rows);

      if (rows.length) {
        const ids = rows.map((r) => r.id);
        // Lead e caso do processo. Ficam fora da primeira pintura de propósito:
        // são duas tabelas a mais, e o feed não pode esperar por elas para
        // aparecer. Enquanto não chegam, `vinculos` é null e a linha não some
        // do filtro — "sem grupo" só depois de ter olhado.
        void (async () => {
          try {
            const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))] as string[];
            const caseIds = [...new Set(rows.map((r) => r.case_id).filter(Boolean))] as string[];
            const [leads, casos] = await Promise.all([
              leadIds.length ? emLotes(leadIds, async (chunk) => {
                const { data, error: e } = await client
                  .from('leads').select('id, lead_name, whatsapp_group_id').in('id', chunk);
                if (e) throw e;
                return (data || []) as Array<{ id: string; lead_name: string | null; whatsapp_group_id: string | null }>;
              }) : Promise.resolve([]),
              caseIds.length ? emLotes(caseIds, async (chunk) => {
                const { data, error: e } = await client
                  .from('legal_cases').select('id, case_number, title').in('id', chunk);
                if (e) throw e;
                return (data || []) as Array<{ id: string; case_number: string | null; title: string | null }>;
              }) : Promise.resolve([]),
            ]);
            const porLead = new Map(leads.map((l) => [l.id, l]));
            const porCaso = new Map(casos.map((c) => [c.id, c]));
            setUpdates((atuais) => atuais.map((u) => {
              const l = u.lead_id ? porLead.get(u.lead_id) : undefined;
              const c = u.case_id ? porCaso.get(u.case_id) : undefined;
              return {
                ...u,
                vinculos: {
                  lead_nome: l?.lead_name ?? null,
                  grupo_id: l?.whatsapp_group_id ?? null,
                  caso_numero: c?.case_number ?? null,
                  caso_titulo: c?.title ?? null,
                },
              };
            }));
          } catch (vinculoErr) {
            // Sem vínculo o feed continua inteiro — só o filtro de grupo e a
            // linha do caso ficam de fora.
            console.warn(
              '[useProcessUpdates] vínculos (lead/caso) indisponíveis:',
              vinculoErr instanceof Error ? vinculoErr.message : vinculoErr,
            );
          }
        })();
        if (uid) {
          const reads = await emLotes(ids, async (chunk) => {
            const { data } = await client
              .from('process_update_reads')
              .select('update_id')
              .eq('user_id', uid)
              .in('update_id', chunk);
            return (data || []) as Array<{ update_id: string }>;
          });
          setReadIds(new Set(reads.map((r) => r.update_id)));
        }
        // Etiqueta "Notificado" é global (fato do caso), não por usuário.
        try {
          const notifs = await emLotes(ids, async (chunk) => {
            const { data, error: e } = await client
              .from('process_update_notifications')
              .select('update_id, notified_at, notified_by_name, activity_id')
              .in('update_id', chunk);
            if (e) throw e;
            return (data || []) as UpdateNotificacao[];
          });
          setNotificadas(new Map(notifs.map((n) => [n.update_id, n])));
        } catch (notifErr) {
          console.warn(
            '[useProcessUpdates] etiqueta de notificação indisponível:',
            notifErr instanceof Error ? notifErr.message : notifErr,
          );
        }
      }
    } catch (err) {
      console.error('Error fetching process updates:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, scopeProcessId, desde]);

  // Ref e não estado: o canal do realtime é montado uma vez só, e uma dependência
  // que muda depois do login faria a assinatura cair e subir de novo.
  const extUserIdRef = useRef<string | null>(null);
  useEffect(() => { extUserIdRef.current = extUserId; }, [extUserId]);

  /**
   * Movimentação nova chegou: avisa SÓ quem responde pelo passo que está em
   * aberto naquele processo.
   *
   * Por que o passo e não o processo: o dono muda ao longo do POP — quem cuida
   * da instrução não é quem cuida da execução. Avisar o responsável do processo
   * inteiro mandaria o aviso para a pessoa errada na metade das fases; avisar
   * todo mundo com o sino aberto (o que o canal fazia) é o mesmo que não avisar.
   *
   * Quando a cascata inteira falha (origem 'nenhum'), o aviso vai para TODO
   * MUNDO — decisão do Raym em 12/08/2026. É fundo de poço, não descuido:
   * cinco degraus já foram tentados, e movimentação sem destinatário é
   * movimentação que ninguém lê. Cada cliente decide por si (todos resolvem a
   * mesma cascata), então não precisa de fan-out no servidor.
   *
   * Silencioso só quando o dono é outro: notificação que chega para quem não
   * vai agir ensina a ignorar notificação.
   */
  const avisarSeForMinha = useCallback(async (u: ProcessUpdate) => {
    const eu = extUserIdRef.current;
    if (!eu || !u.lead_id) return;
    try {
      const passo = await responsavelDoPassoAberto(u.process_id, u.lead_id);

      const semDono = !passo.assigneeId;
      const minha = passo.assigneeId === eu;
      // Contas de teste e inativas ficam de fora do "todo mundo" — elas não
      // atuam em processo, e engrossariam o barulho justamente no caso em que
      // ele já é mais largo.
      if (!minha && !(semDono && !ASSIGNEE_BLOCKLIST.has(user?.id || ''))) return;

      const processo = u.processo_titulo || u.numero_cnj || 'processo';
      const corpo = [
        u.descricao?.slice(0, 140),
        passo.stepLabel ? `Passo em aberto: ${passo.stepLabel}` : null,
        // Quem recebe por falta de dono precisa saber que não é "sua" tarefa —
        // senão ou todo mundo age, ou ninguém age achando que é de outro.
        semDono ? 'Sem responsável definido — avisando a equipe' : null,
      ].filter(Boolean).join('\n');

      const exibiu = await showNativeNotification(`${u.titulo} — ${processo}`, {
        body: corpo,
        // Uma notificação por movimentação: reenvio do mesmo id substitui em vez
        // de empilhar quatro avisos do mesmo fato.
        tag: `process-update-${u.id}`,
        // O aviso é DA MOVIMENTAÇÃO: abre a movimentação, não o kanban do lead
        // (que era o destino até 01/09/2026 e não mostra nem o que caiu nem se
        // o cliente foi avisado). Com o app aberto, o PushNotificationBridge
        // intercepta estes parâmetros e sobe o painel de baixo pra cima sem
        // navegar; com o app fechado, o MovimentacaoSheetHost consome os mesmos
        // parâmetros no boot.
        url: `/?openUpdate=${u.id}&processo=${u.process_id}`,
      });

      // Sem permissão do navegador o aviso não pode simplesmente sumir — quem
      // tem o app aberto ainda precisa ver que caiu algo no passo dele.
      if (!exibiu) {
        toast.info(`${u.titulo} — ${processo}`, {
          description: semDono
            ? 'Sem responsável definido — avisando a equipe'
            : (passo.stepLabel ? `Seu passo: ${passo.stepLabel}` : undefined),
          duration: 10000,
          // Mesmo destino do balão do sistema: aviso sem para onde ir obriga a
          // procurar a movimentação no sino depois de já ter lido qual é.
          action: {
            label: 'Abrir',
            onClick: () => abrirMovimentacaoSheet({
              processId: u.process_id,
              updateId: u.id,
              processLabel: u.processo_titulo || u.numero_cnj || null,
            }),
          },
        });
      }
    } catch (err) {
      console.warn('[useProcessUpdates] não deu para avisar o responsável:', err);
    }
  }, [user?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Assinatura separada da busca: trocar o período refaz o fetch, e antes isso
  // derrubaria e subiria o canal do realtime junto — perdendo INSERT no meio.
  useEffect(() => {
    // Tópico por escopo: o sino global e o atalho da ficha ficam montados ao
    // mesmo tempo, e dois canais com o mesmo nome disputam a mesma assinatura.
    const channel = db
      .channel(scopeProcessId ? `process-updates-bell-${scopeProcessId}` : 'process-updates-bell')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'process_updates',
          ...(scopeProcessId ? { filter: `process_id=eq.${scopeProcessId}` } : {}),
        },
        (payload) => {
          const bruto = payload.new as ProcessUpdate;
          if (scopeProcessId && bruto.process_id !== scopeProcessId) return;
          const novo = {
            ...bruto,
            esfera: bruto.esfera || classificarEsfera({ numeroCnj: bruto.numero_cnj, titulo: bruto.processo_titulo }),
            eventos: Array.isArray(bruto.eventos) ? bruto.eventos : null,
            // Chegou agora: o resumo é escrito minutos depois, pelo cron do
            // Railway. Até lá o card mostra o texto cru — nunca "undefined".
            resumo_ia: bruto.resumo_ia ?? null,
            data_presumida: bruto.data_presumida === true,
            // Lead e caso vêm de outras tabelas; a próxima busca os resolve.
            vinculos: null,
          };
          // Reordena em vez de empilhar no topo: com a lista ordenada por
          // data_movimentacao, uma linha recém-inserida de movimentação antiga
          // no topo apareceria acima do que é de hoje.
          setUpdates((prev) => [novo, ...prev].sort(ordemDoFeed).slice(0, FETCH_LIMIT));
          setTotalNoBanco((t) => (t === null ? t : t + 1));
          // Só o feed global avisa. O atalho da ficha é outra instância do mesmo
          // hook: deixá-lo avisar também mandaria dois pop-ups do mesmo fato pra
          // quem estiver com a atividade daquele processo aberta.
          if (!scopeProcessId) void avisarSeForMinha(novo);
        },
      )
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [avisarSeForMinha, scopeProcessId]);

  const unreadCount = useMemo(
    () => updates.filter((u) => !readIds.has(u.id)).length,
    [updates, readIds],
  );

  const persistReads = useCallback(async (ids: string[]) => {
    if (!extUserId || !ids.length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = db as any;
    const { error } = await client
      .from('process_update_reads')
      .upsert(ids.map((id) => ({ update_id: id, user_id: extUserId })), {
        onConflict: 'update_id,user_id',
        ignoreDuplicates: true,
      });
    if (error) console.error('Error marking updates read:', error);
  }, [extUserId]);

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    persistReads([id]);
  }, [persistReads]);

  const markAllRead = useCallback(() => {
    const pendentes = updates.filter((u) => !readIds.has(u.id)).map((u) => u.id);
    setReadIds(new Set(updates.map((u) => u.id)));
    persistReads(pendentes);
  }, [updates, readIds, persistReads]);

  /**
   * Carimba a etiqueta "Notificado" na movimentação. Upsert: reenvio atualiza
   * quem mandou e quando, sem criar linha nova (update_id é a PK).
   */
  const markNotified = useCallback(async (
    updateId: string,
    info: { activityId?: string | null; groupJid?: string | null; notifiedByName?: string | null },
  ) => {
    const registro: UpdateNotificacao = {
      update_id: updateId,
      notified_at: new Date().toISOString(),
      notified_by_name: info.notifiedByName || null,
      activity_id: info.activityId || null,
    };
    setNotificadas((prev) => new Map(prev).set(updateId, registro));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = db as any;
    const { error } = await client
      .from('process_update_notifications')
      .upsert({
        ...registro,
        notified_by: extUserId,
        channel: 'whatsapp_grupo',
        group_jid: info.groupJid || null,
      }, { onConflict: 'update_id' });
    if (error) console.error('Error marking update notified:', error);
  }, [extUserId]);

  return {
    updates, loading, unreadCount, readIds, markRead, markAllRead,
    notificadas, markNotified, refetch: fetchAll, totalNoBanco,
  };
};
