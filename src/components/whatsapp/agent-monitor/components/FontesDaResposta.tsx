/**
 * As FONTES que geraram a resposta, à vista do revisor.
 *
 * Por que existe (07/09/2026): o painel mostrava a pergunta do cliente e a
 * resposta sugerida, e mais nada. Quem revisava tinha que confiar — não tinha
 * como conferir. E o caso que expôs isso é real: numa resposta ao PREV 1050 o
 * assessor disse "o INSS ainda não detalhou", enquanto a atividade anterior
 * guardada no contexto trazia data de pagamento, valor e banco. A informação
 * estava na mão e a resposta não usou. Com a fonte ao lado, o revisor pega isso
 * em dois segundos.
 *
 * NÃO há juízo automático aqui: nada de "a IA usou esta fonte para dizer X".
 * Pedir ao modelo que justifique a si mesmo cria uma segunda coisa para não
 * confiar. Aqui ficam os FATOS que entraram no prompt; quem liga fato e frase é
 * a pessoa que revisa.
 *
 * DE ONDE VEIO A MOVIMENTAÇÃO importa e por isso aparece com selo:
 *   • no processo JUDICIAL o e-mail do tribunal é o GATILHO — avisa que mexeu,
 *     e a partir dele se busca a peça no Escavador;
 *   • no ADMINISTRATIVO (INSS) o e-mail é a ÚNICA fonte. Não existe peça para
 *     procurar, e quem não sabe disso procura um documento que nunca existiu.
 */
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { FileText, Mail, Search, ClipboardList, Landmark, AlertTriangle, MessagesSquare, UserX, Users, Loader2 } from 'lucide-react';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { useAbrirPecaDosAutos } from '@/hooks/useAbrirPecaDosAutos';

/** O que a dom_contexto_processual devolve e a dom-rascunho grava em contexto_usado. */
export interface ContextoUsado {
  processos?: Array<{
    numero?: string | null;
    /**
     * De onde o processo entrou: 'lead' (está no cadastro do lead do grupo)
     * ou 'citado_no_grupo' (a equipe citou o número numa notificação neste
     * grupo e o número do caso bateu — regra de 08/09/2026). Rascunho antigo
     * não traz a chave.
     */
    origem_vinculo?: 'lead' | 'citado_no_grupo' | null;
    titulo?: string | null;
    classe?: string | null;
    tribunal?: string | null;
    fase_atual?: string | null;
    ultima_movimentacao?: string | null;
    cadastro_desatualizado?: boolean | null;
    andamentos?: Array<{
      data?: string | null; titulo?: string | null; resumo?: string | null;
      categoria?: string | null; origem?: string | null; esfera?: string | null;
      do_email?: boolean | null; email_em?: string | null;
    }> | null;
    // `peca` é a chave que a RPC emite. `titulo` ficou aqui porque a interface
    // antiga dizia isso e o painel lia isso — e por isso toda peça aparecia
    // como "sem título" na tela, com o nome dela guardado o tempo todo em
    // `peca`. Leem-se as duas: os rascunhos já gravados não mudam.
    // `id` e `arquivo` (jm_documentos.id / storage_path) entraram em 08/09/2026
    // para o clique abrir A peça certa em vez de a peça parecida: título + data
    // repetem em 251 chaves do acervo, até 17 documentos na mesma chave. Falta
    // deles = rascunho antigo, e aí a peça é procurada e só abre se for única.
    documentos?: Array<{
      id?: number | null; arquivo?: string | null;
      peca?: string | null; titulo?: string | null; data?: string | null; resumo?: string | null;
    }> | null;
  }> | null;
  requerimentos_inss?: Array<{
    numero?: string | null; servico?: string | null; status?: string | null;
    resultado?: string | null; despacho?: string | null; protocolado_em?: string | null;
  }> | null;
  ultima_atividade?: {
    titulo?: string | null; assunto?: string | null; como_esta?: string | null;
    proximo_passo?: string | null; quando?: string | null; status?: string | null;
  } | null;
  tem_vinculo?: boolean | null;
  /**
   * COMO a RPC achou a ficha do cliente — ou por que nao achou.
   *
   * Existe porque "(0)" respondia duas perguntas opostas com o mesmo número:
   * "o processo não andou" e "não sei de quem é este grupo". Quem revisa lê as
   * duas como a primeira, e foi assim que o Caso 09 gerou resposta sem uma
   * linha do processo — 3 movimentações, 18 peças lidas e 36 atividades
   * existiam no banco naquele momento.
   */
  vinculo?: {
    fonte?: 'ponte' | 'cadastro_do_lead' | 'fichas_do_mesmo_processo' | null;
    fichas_no_grupo?: number | null;
    /**
     * Quantas das fichas do grupo entraram de fato. Só difere de
     * `fichas_no_grupo` no degrau `fichas_do_mesmo_processo`, e é justamente
     * aí que o revisor precisa saber: "2 fichas apontam para este grupo, 1
     * tem processo, usei essa" é uma frase que ele pode conferir. "Resolvido"
     * sozinho esconde a duplicidade que causou o problema.
     */
    fichas_usadas?: number | null;
    /** Processos que entraram porque a equipe os citou neste grupo. */
    processos_citados?: number | null;
    ambiguo?: boolean | null;
  } | null;
}

const dataBR = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v.length <= 10 ? `${v}T12:00:00` : v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR');
};

const diasAtras = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const n = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (n <= 0) return 'hoje';
  return n === 1 ? 'há 1 dia' : `há ${n} dias`;
};

/** Selo da origem. Texto explícito: "e-mail do tribunal" não é jargão nosso. */
function SeloOrigem({ origem, doEmail }: { origem?: string | null; doEmail?: boolean | null }) {
  if (origem === 'email_push') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] font-normal border-sky-300 text-sky-700">
        <Mail className="h-3 w-3" />
        e-mail do tribunal{doEmail ? '' : ' (e-mail não guardado)'}
      </Badge>
    );
  }
  if (origem === 'escavador') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] font-normal border-violet-300 text-violet-700">
        <Search className="h-3 w-3" />Escavador
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-[10px] font-normal">origem não registrada</Badge>;
}

function Secao({ icone, titulo, children }: { icone: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center gap-1.5">{icone}{titulo}</Label>
      {children}
    </div>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground italic">{children}</p>;
}

/**
 * A FICHA NÃO FOI ENCONTRADA — e isso não é a mesma coisa que "nada aconteceu".
 *
 * Sem este aviso o painel mostrava "(0)" nos dois casos, e quem revisa lia o
 * "(0)" como processo parado. Foi o que houve no Caso 09 em 07/09/2026: o
 * grupo tinha a ficha no cadastro (`leads.whatsapp_group_id`) mas não na ponte
 * (`lead_whatsapp_groups`), a RPC só olhava a ponte, e a resposta saiu sem as
 * 3 movimentações, as 18 peças lidas e as 36 atividades que estavam no banco.
 *
 * O aviso diz o que FAZER, não só que deu errado: cada caso tem um conserto
 * diferente, e nenhum deles é a máquina escolher uma ficha no chute.
 */
function FichaNaoEncontrada({ fichas, ambiguo, processosCitados }: { fichas?: number | null; ambiguo?: boolean | null; processosCitados?: number }) {
  const n = typeof fichas === 'number' ? fichas : null;
  // Desde 08/09/2026 o processo pode entrar SEM lead resolvido: a equipe o
  // citou no grupo e o número do caso bateu. Aí "nada do processo entrou" é
  // mentira — o que faltou foi só o que pende do lead (atividade, INSS).
  const comProcesso = (processosCitados ?? 0) > 0;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-1">
      <p className="text-[11px] font-medium text-amber-900 flex items-start gap-1.5">
        <UserX className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        {comProcesso
          ? `Não achei o lead deste grupo — mas ${processosCitados === 1 ? '1 processo entrou' : `${processosCitados} processos entraram`} porque a equipe o citou aqui. O que ficou de fora é só o que pende do lead: atividade e INSS.`
          : 'Não achei o lead deste grupo. Nada do processo entrou no prompt.'}
      </p>
      <p className="text-[10px] text-amber-800">
        {ambiguo && n
          ? `${n} fichas de cliente apontam para este grupo. O sistema não escolhe uma — seria sortear de quem é o processo. Abra o grupo e ligue-o à ficha certa.`
          : n === 0
            ? 'Nenhuma ficha aponta para este grupo. Cadastre o cliente ou ligue o grupo à ficha que já existe.'
            : 'O vínculo entre este grupo e a ficha do cliente não foi resolvido. Ligue o grupo à ficha para o assessor enxergar o caso.'}
      </p>
      {!comProcesso && (
        <p className="text-[10px] text-amber-800">
          Os "(0)" abaixo são consequência disso — não são prova de que o processo está parado.
        </p>
      )}
    </div>
  );
}

/**
 * O GRUPO TINHA DUAS FICHAS E UM PROCESSO SÓ — resolveu, e diz como.
 *
 * Por que aparece (08/09/2026, Caso 335): o grupo tem duas fichas do mesmo
 * Eduardo, as duas apontando para 0001723-93.2025.5.17.0191. A RPC contava
 * FICHAS, via "2", e parava por ambiguidade — sendo que processo só há um.
 * Agora resolve. Mas resolver calado seria trocar um erro por outro: quem
 * revisa precisa saber que a ficha está duplicada, senão a duplicidade nunca
 * é consertada e volta a morder em outro lugar.
 *
 * Não é alarme (não impediu nada de entrar no prompt) — é etiqueta de origem.
 */
function FichasDoMesmoProcesso({ noGrupo, usadas }: { noGrupo?: number | null; usadas?: number | null }) {
  const n = typeof noGrupo === 'number' ? noGrupo : null;
  const u = typeof usadas === 'number' ? usadas : null;
  if (!n || n < 2) return null;
  return (
    <div className="rounded border border-sky-200 bg-sky-50 p-2 space-y-1">
      <p className="text-[11px] font-medium text-sky-900 flex items-start gap-1.5">
        <Users className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        {n} fichas apontam para este grupo — e todas caem no mesmo processo.
      </p>
      <p className="text-[10px] text-sky-800">
        {u === n
          ? `Por isso não houve sorteio: usei as ${n}. O que entrou abaixo é o processo delas.`
          : `Não havia o que sortear — só existe um processo aqui. ${u ?? 0} de ${n} ficha${n > 2 ? 's' : ''} tem processo, e foi ${u === 1 ? 'ela que entrou' : 'nelas que fui buscar'}; o resto da ficha duplicada ficou de fora.`}
      </p>
      <p className="text-[10px] text-sky-800">
        A ficha duplicada continua duplicada. Vale juntar as duas na ficha certa —
        enquanto houver duas, atividade e histórico ficam partidos entre elas.
      </p>
    </div>
  );
}

export function FontesDaResposta({ contexto }: { contexto: ContextoUsado | null | undefined }) {
  // Antes do `return` de contexto vazio de propósito: hook não pode ficar
  // depois de saída antecipada.
  const { peca, carregando, erro, abrir, fechar } = useAbrirPecaDosAutos();

  if (!contexto) {
    return (
      <div className="rounded border border-dashed p-2">
        <p className="text-[11px] text-muted-foreground">
          Este rascunho é anterior ao registro das fontes — não dá para conferir de onde saiu.
          Os novos guardam.
        </p>
      </div>
    );
  }

  const processos = contexto.processos ?? [];
  const inss = contexto.requerimentos_inss ?? [];
  const atv = contexto.ultima_atividade;
  const andamentos = processos.flatMap(p =>
    (p.andamentos ?? []).map(a => ({ ...a, processo: p.titulo || p.numero || 'processo' })));
  // `cnj` viaja junto: é por ele que a peça é procurada no acervo quando o
  // rascunho é antigo e não guardou o id do documento.
  const documentos = processos.flatMap(p =>
    (p.documentos ?? []).map(d => ({
      ...d,
      processo: p.titulo || p.numero || 'processo',
      cnj: p.numero ?? null,
    })));

  const soDoEmail = andamentos.length > 0 && andamentos.every(a => a.origem === 'email_push');
  const citadosNoGrupo = processos
    .filter(p => p.origem_vinculo === 'citado_no_grupo')
    .map(p => p.numero || p.titulo || 'processo');

  // `tem_vinculo === false` é afirmação da RPC, não ausência de dado: rascunho
  // antigo, gravado antes desta chave existir, traz `undefined` e não dispara o
  // aviso — não dá para acusar falta de ficha em contexto que nunca a mediu.
  const semFicha = contexto.tem_vinculo === false;

  return (
    <>
    <div className="space-y-3 rounded border p-2.5 bg-muted/30">
      <p className="text-[11px] text-muted-foreground">
        O que entrou no prompt. A ligação entre cada fato e a frase da resposta é sua —
        aqui não há palpite da máquina sobre si mesma.
      </p>

      {semFicha && (
        <FichaNaoEncontrada
          fichas={contexto.vinculo?.fichas_no_grupo}
          ambiguo={contexto.vinculo?.ambiguo}
          processosCitados={citadosNoGrupo.length}
        />
      )}
      {!semFicha && contexto.vinculo?.fonte === 'fichas_do_mesmo_processo' && (
        <FichasDoMesmoProcesso
          noGrupo={contexto.vinculo?.fichas_no_grupo}
          usadas={contexto.vinculo?.fichas_usadas}
        />
      )}
      {/* O processo entrou porque A EQUIPE o citou neste grupo (notificação
          "Referente ao processo n° X") e o número do caso bateu. Não é o lead
          do grupo que o traz — é a citação. Quem revisa precisa saber, porque
          é sinal de que o processo está cadastrado em OUTRO lead (o CASO 398
          nasceu assim) e vale juntar. */}
      {citadosNoGrupo.length > 0 && (
        <p className="text-[10px] text-sky-800 flex items-start gap-1 rounded border border-sky-200 bg-sky-50 p-2">
          <ClipboardList className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            {citadosNoGrupo.length === 1
              ? `O processo ${citadosNoGrupo[0]} entrou porque a equipe o citou neste grupo`
              : `${citadosNoGrupo.length} processos entraram porque a equipe os citou neste grupo (${citadosNoGrupo.join(', ')})`}
            {' '}— ele não está no lead do grupo. Se for do mesmo cliente, vale juntar os leads.
          </span>
        </p>
      )}
      {/* A conversa do grupo TAMBÉM entra no prompt, e de propósito não é copiada
          para cá: ela já existe inteira, ao vivo, no botão logo abaixo. Guardar
          uma segunda cópia só criaria duas versões da mesma conversa para
          divergirem com o tempo. */}
      <p className="text-[10px] text-muted-foreground flex items-start gap-1">
        <MessagesSquare className="h-3 w-3 mt-0.5 shrink-0" />
        As mensagens do grupo também entraram no prompt. Elas não são copiadas para cá —
        abra a conversa no botão abaixo para ver o que foi dito, sempre atualizado.
      </p>

      {/* ── Movimentações ─────────────────────────────────────────────── */}
      <Secao icone={<ClipboardList className="h-3.5 w-3.5" />}
             titulo={`Movimentação (${andamentos.length})`}>
        {andamentos.length === 0 ? (
          <Vazio>{semFicha
            ? 'Não entrou porque a ficha do cliente não foi encontrada — e não porque o processo esteja parado.'
            : 'Nenhuma movimentação entrou. A resposta não pode afirmar que algo andou.'}</Vazio>
        ) : (
          <>
            {soDoEmail && (
              <p className="text-[10px] text-sky-700 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                Tudo veio do e-mail. Em processo administrativo isso é o esperado — é a única
                fonte, não existe peça no Escavador para conferir.
              </p>
            )}
            <ul className="space-y-1.5">
              {andamentos.map((a, i) => (
                <li key={i} className="text-[11px] border-l-2 border-muted-foreground/30 pl-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{dataBR(a.data) || 'sem data'}</span>
                    <SeloOrigem origem={a.origem} doEmail={a.do_email} />
                    {a.categoria && (
                      <span className="text-[10px] text-muted-foreground">{a.categoria}</span>
                    )}
                  </div>
                  {a.titulo && <p className="font-medium">{a.titulo}</p>}
                  {a.resumo && <p className="text-muted-foreground">{a.resumo}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Secao>

      {/* ── Documentos lidos ──────────────────────────────────────────── */}
      <Secao icone={<FileText className="h-3.5 w-3.5" />}
             titulo={`Documento lido (${documentos.length})`}>
        {documentos.length === 0 ? (
          <Vazio>
            {semFicha ? (
              'Nenhuma peça entrou porque a ficha do cliente não foi encontrada. Pode haver peça lida no processo — o assessor é que não chegou até ela.'
            ) : (
              <>
                Nenhuma peça foi lida. A resposta não pode citar conteúdo de documento —
                {soDoEmail ? ' e em processo administrativo não há peça mesmo.' : ' se citar, é invenção.'}
              </>
            )}
          </Vazio>
        ) : (
          <ul className="space-y-1.5">
            {documentos.map((d, i) => {
              const chave = String(i);
              return (
              <li key={i} className="text-[11px] border-l-2 border-muted-foreground/30 pl-2">
                {/* O TÍTULO ABRE A PEÇA — o resumo é da IA, o documento é a
                    prova. Sem isto o revisor conferia a resposta contra outro
                    texto de máquina, que é conferir uma coisa contra ela mesma.
                    Abre no MediaLightbox, com zoom, como na aba Documentos do
                    processo: nada de aba nova, nada de sair da revisão.

                    `peca` primeiro: é a chave que a RPC emite. Lendo só
                    `titulo`, como era antes, toda peça saía como "sem título"
                    com o nome guardado ao lado. `titulo` fica de reserva. */}
                <button
                  type="button"
                  onClick={() => void abrir(chave, d.cnj, d)}
                  disabled={carregando !== null}
                  className="text-left font-medium underline decoration-dotted underline-offset-2 hover:text-primary disabled:opacity-60"
                  title="Abrir a peça dos autos"
                >
                  {dataBR(d.data) || 'sem data'} · {d.peca || d.titulo || 'sem título'}
                  {carregando === chave && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                </button>
                {d.resumo && <p className="text-muted-foreground">{d.resumo}</p>}
                {/* Não abriu: o motivo fica aqui, embaixo da peça em questão.
                    Sumir com o botão ou abrir "a mais parecida" seria pior —
                    peça errada ao lado de um resumo vira prova falsa. */}
                {erro?.chave === chave && (
                  <p className="mt-0.5 flex items-start gap-1 text-[10px] text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {erro.motivo}
                  </p>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </Secao>

      {/* ── Requerimento no INSS ──────────────────────────────────────── */}
      {inss.length > 0 && (
        <Secao icone={<Landmark className="h-3.5 w-3.5" />} titulo={`Requerimento no INSS (${inss.length})`}>
          <ul className="space-y-1.5">
            {inss.map((r, i) => (
              <li key={i} className="text-[11px] border-l-2 border-muted-foreground/30 pl-2">
                <p className="font-medium">
                  {r.servico || 'requerimento'} · {r.status || 'sem status'}
                  {r.resultado && <span className="text-emerald-700"> · {r.resultado}</span>}
                </p>
                {r.protocolado_em && (
                  <p className="text-muted-foreground">protocolado em {dataBR(r.protocolado_em)}</p>
                )}
                {r.despacho && <p className="text-muted-foreground">{r.despacho}</p>}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {/* ── Atividade anterior ────────────────────────────────────────── */}
      <Secao icone={<ClipboardList className="h-3.5 w-3.5" />} titulo="Atividade anterior da equipe">
        {!atv ? (
          <Vazio>{semFicha
            ? 'A atividade não entrou porque a ficha do cliente não foi encontrada — pode existir e não ter sido lida.'
            : 'Nenhuma atividade anterior. A resposta não sabe o que a equipe já combinou.'}</Vazio>
        ) : (
          <div className="text-[11px] border-l-2 border-muted-foreground/30 pl-2 space-y-0.5">
            <p className="font-medium">{atv.titulo || 'sem título'}</p>
            <p className="text-muted-foreground">
              {atv.status || 'sem status'}
              {atv.quando && ` · ${dataBR(atv.quando)} (${diasAtras(atv.quando)})`}
            </p>
            {atv.como_esta && (
              <div>
                <span className="text-muted-foreground">Como está: </span>
                <span className="whitespace-pre-wrap">{atv.como_esta}</span>
              </div>
            )}
            {atv.proximo_passo && (
              <div>
                <span className="text-muted-foreground">Próximo passo: </span>
                <span>{atv.proximo_passo}</span>
              </div>
            )}
          </div>
        )}
      </Secao>
    </div>

    {/* Portalado para o body e com o cadeado de rolagem próprio — por isso
        funciona empilhado por cima do Sheet do painel, sem fechá-lo: fechar a
        peça devolve o revisor exatamente à conferência de onde ele saiu. */}
    <MediaLightbox url={peca?.url ?? null} title={peca?.titulo ?? 'Peça dos autos'} onClose={fechar} />
    </>
  );
}
