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
import { FileText, Mail, Search, ClipboardList, Landmark, AlertTriangle, MessagesSquare } from 'lucide-react';

/** O que a dom_contexto_processual devolve e a dom-rascunho grava em contexto_usado. */
export interface ContextoUsado {
  processos?: Array<{
    numero?: string | null;
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
    documentos?: Array<{ titulo?: string | null; data?: string | null; resumo?: string | null }> | null;
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

export function FontesDaResposta({ contexto }: { contexto: ContextoUsado | null | undefined }) {
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
  const documentos = processos.flatMap(p =>
    (p.documentos ?? []).map(d => ({ ...d, processo: p.titulo || p.numero || 'processo' })));

  const soDoEmail = andamentos.length > 0 && andamentos.every(a => a.origem === 'email_push');

  return (
    <div className="space-y-3 rounded border p-2.5 bg-muted/30">
      <p className="text-[11px] text-muted-foreground">
        O que entrou no prompt. A ligação entre cada fato e a frase da resposta é sua —
        aqui não há palpite da máquina sobre si mesma.
      </p>
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
          <Vazio>Nenhuma movimentação entrou. A resposta não pode afirmar que algo andou.</Vazio>
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
            Nenhuma peça foi lida. A resposta não pode citar conteúdo de documento —
            {soDoEmail ? ' e em processo administrativo não há peça mesmo.' : ' se citar, é invenção.'}
          </Vazio>
        ) : (
          <ul className="space-y-1.5">
            {documentos.map((d, i) => (
              <li key={i} className="text-[11px] border-l-2 border-muted-foreground/30 pl-2">
                <p className="font-medium">{dataBR(d.data) || 'sem data'} · {d.titulo || 'sem título'}</p>
                {d.resumo && <p className="text-muted-foreground">{d.resumo}</p>}
              </li>
            ))}
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
          <Vazio>Nenhuma atividade anterior. A resposta não sabe o que a equipe já combinou.</Vazio>
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
  );
}
