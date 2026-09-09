/**
 * Relatórios — conversa com o analista de dados por IA.
 *
 * Não é mais "pergunta → tabela". É uma conversa: a IA consulta o banco, olha o
 * resultado e responde em português (o que achou, o que está estranho no dado,
 * o que dá pra fazer). As tabelas das consultas aparecem dentro da resposta.
 *
 * As mensagens ficam GRAVADAS (report_conversations/report_messages, via as
 * funções report-query e report-conversations) — F5 não apaga nada e cada
 * pessoa pode ter várias conversas em paralelo. Conversa é privada de quem criou.
 *
 * A pergunta pode vir com MATERIAL (print, foto, PDF) e pode ser DITADA por voz:
 * o arquivo sobe no bucket do chat interno, o áudio vira texto na
 * transcribe-team-audio (a mesma do chat da equipe) e os dois ficam gravados na
 * mensagem — reabrir a conversa mostra a pergunta com o arquivo que a sustentou.
 * O arquivo entra por três portas com a MESMA validação: o clipe, o Ctrl+V
 * (mesmo com o cursor fora do campo) e arrastar pra qualquer ponto da conversa.
 *
 * Nada aqui redireciona: a lista de conversas é uma coluna da própria tela (e
 * um Sheet lateral no celular), nunca uma rota nova. Anexo abre no
 * MediaLightbox, por cima da conversa.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/functionRouter';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  FileBarChart, Send, Loader2, Code2, AlertTriangle, Lock, Sparkles, Database,
  Plus, MessagesSquare, MoreVertical, Pencil, Trash2, Check, X,
  Paperclip, Mic, Square, FileText, Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface QueryRun {
  sql: string;
  purpose: string;
  columns: string[];
  rows: Record<string, unknown>[];
  count: number;
  truncated: boolean;
  /** Quantas linhas ficaram gravadas (só vem ao reabrir uma conversa antiga). */
  stored_rows?: number;
  error?: string | null;
}

/**
 * Material que veio COM a pergunta: print, foto, PDF — e o áudio do ditado.
 * Fica gravado na mensagem (report_messages.attachments), então reabrir a
 * conversa depois mostra a pergunta junto com o arquivo que a sustentou.
 */
interface Anexo {
  url: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'pdf' | 'audio';
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Anexo[];
  queries?: QueryRun[];
  engine?: string;
  status?: string;
  loading?: boolean;
  forbidden?: boolean;
}

// ---- Anexo: limites e tipos aceitos --------------------------------------
/** O mesmo bucket do chat interno da equipe — não vale abrir um segundo. */
const BUCKET_ANEXO = 'team-chat-media';
const MAX_ANEXOS = 4;
const MAX_ANEXO_MB = 10;
/** Só o que os dois modelos leem (Opus e Gemini). HEIC de iPhone fica fora. */
const MIMES_ACEITOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const ACCEPT_ANEXO = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';

/** Nome de arquivo virando chave de storage: acento e espaço não passam. */
function nomeSeguro(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'arquivo';
}

function tamanhoLegivel(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

function engineLabel(engine?: string): string {
  if (!engine) return '';
  if (engine.includes('gemini')) return 'Gemini';
  if (engine.includes('sonnet')) return 'Sonnet';
  if (engine.includes('opus')) return 'Opus';
  if (engine.includes('haiku')) return 'Haiku';
  return engine;
}

const EXAMPLES = [
  'Relação dos processos em que a Gisele é responsável',
  'Atividades atrasadas do João Manoel',
  'Casos abertos por núcleo',
  'Leads que viraram cliente esse mês',
  'Quais dados do funil BPC estão furados?',
];

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  // ISO date/datetime → dd/mm/aaaa
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(T[\d:.]+.*)?$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function humanCol(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function ResultTable({ query }: { query: QueryRun }) {
  if (!query.rows.length) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
        Nenhum registro voltou dessa consulta.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border max-h-[420px] overflow-y-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            {query.columns.map((c) => (
              <TableHead key={c} className="whitespace-nowrap font-semibold">{humanCol(c)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.rows.map((row, i) => (
            <TableRow key={i}>
              {query.columns.map((c) => (
                <TableCell key={c} className="whitespace-nowrap max-w-[320px] truncate" title={formatCell(row[c])}>
                  {formatCell(row[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function QueryBlock({ query }: { query: QueryRun }) {
  const partial = query.rows.length < query.count;
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Database className="h-3 w-3" /> {query.count} registro{query.count === 1 ? '' : 's'}
        </Badge>
        {query.truncated && (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            Teto de 1000 — pode haver mais
          </Badge>
        )}
        {partial && !query.truncated && (
          <Badge variant="outline" className="text-muted-foreground">
            Mostrando {query.rows.length} linhas gravadas
          </Badge>
        )}
        {query.purpose && <span className="text-xs text-muted-foreground">{query.purpose}</span>}
      </div>

      {query.error ? (
        <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> A consulta falhou: {query.error}
        </div>
      ) : (
        <ResultTable query={query} />
      )}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground h-7">
            <Code2 className="h-3.5 w-3.5" /> Ver a consulta usada
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
            {query.sql}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * O material anexado à pergunta, dentro da própria bolha.
 *
 * Clique em imagem ou PDF abre no MediaLightbox, por cima da conversa — nunca
 * em aba nova, e o fechar devolve a pessoa na mesma altura do histórico.
 * Áudio do ditado toca ali mesmo: o texto transcrito já é a pergunta, o áudio
 * fica como prova do que foi falado.
 */
function AnexosDaMensagem({ anexos, onAbrirMidia }: { anexos: Anexo[]; onAbrirMidia: (url: string) => void }) {
  if (!anexos.length) return null;
  return (
    <div className="space-y-2">
      {anexos.map((a, i) => {
        if (a.kind === 'audio') {
          return (
            <div key={i} className="flex items-center gap-2">
              <Mic className="h-3.5 w-3.5 shrink-0 opacity-80" />
              <audio controls preload="none" className="h-8 max-w-[240px]">
                <source src={a.url} type={a.mime || 'audio/webm'} />
              </audio>
            </div>
          );
        }
        if (a.kind === 'image') {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onAbrirMidia(a.url)}
              className="block overflow-hidden rounded-md border border-primary-foreground/20"
              title={a.name}
            >
              <img src={a.url} alt={a.name} loading="lazy" className="max-h-40 max-w-full object-cover" />
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => onAbrirMidia(a.url)}
            className="flex items-center gap-2 rounded-md border border-primary-foreground/20 px-2 py-1.5 text-xs hover:opacity-90 max-w-full"
            title={a.name}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{a.name}</span>
            {a.size > 0 && <span className="opacity-70 shrink-0">{tamanhoLegivel(a.size)}</span>}
          </button>
        );
      })}
    </div>
  );
}

function MessageBubble({ msg, onAbrirMidia }: { msg: Msg; onAbrirMidia: (url: string) => void }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[85%] space-y-2">
          <AnexosDaMensagem anexos={msg.attachments || []} onAbrirMidia={onAbrirMidia} />
          {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
        </div>
      </div>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0 space-y-3">
          {msg.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Consultando o banco...
            </div>
          ) : msg.forbidden ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <Lock className="h-4 w-4" /> {msg.content}
            </div>
          ) : msg.status === 'error' ? (
            <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {msg.content}
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-ul:my-1.5">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          )}

          {msg.queries?.map((q, i) => <QueryBlock key={i} query={q} />)}

          {msg.engine && !msg.loading && (
            <div className="text-[10px] text-muted-foreground">via {engineLabel(msg.engine)}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function RelatoriosPage() {
  const { user } = useAuthContext();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [subindo, setSubindo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [midiaAberta, setMidiaAberta] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const cronometroRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadConversations = useCallback(async () => {
    const { data } = await cloudFunctions.invoke('report-conversations', { body: { action: 'list' } });
    if (data?.success) setConversations(data.conversations || []);
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const openConversation = useCallback(async (id: string) => {
    setSheetOpen(false);
    setLoadingConv(true);
    setActiveId(id);
    setMessages([]);
    const { data } = await cloudFunctions.invoke('report-conversations', {
      body: { action: 'messages', conversation_id: id },
    });
    if (data?.success) {
      setMessages((data.messages || []).map((m: any) => ({
        id: m.id, role: m.role, content: m.content,
        attachments: Array.isArray(m.attachments) ? m.attachments : [],
        queries: Array.isArray(m.queries) ? m.queries : [],
        engine: m.engine, status: m.status,
      })));
    }
    setLoadingConv(false);
  }, []);

  const newConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setAnexos([]);
    setSheetOpen(false);
  }, []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    // Anexo sozinho já é pedido: o servidor completa a pergunta ("olhe isso").
    const anexosDoTurno = anexos;
    if ((!q && !anexosDoTurno.length) || busy || subindo) return;
    setBusy(true);
    setInput('');
    setAnexos([]);
    const tempId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID() : `t-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: `u-${tempId}`, role: 'user', content: q, attachments: anexosDoTurno },
      { id: tempId, role: 'assistant', content: '', loading: true },
    ]);

    try {
      const { data, error } = await cloudFunctions.invoke('report-query', {
        body: {
          question: q,
          conversation_id: activeIdRef.current || undefined,
          ...(anexosDoTurno.length ? { attachments: anexosDoTurno } : {}),
        },
      });

      // A pergunta gravada volta do servidor (com o texto que ele completou
      // quando só havia anexo) — a bolha passa a mostrar o que ficou no banco.
      if (data?.user_message?.content) {
        setMessages((prev) => prev.map((m) => (m.id === `u-${tempId}`
          ? { ...m, content: data.user_message.content, attachments: data.user_message.attachments || anexosDoTurno }
          : m)));
      }

      if (data?.conversation_id && !activeIdRef.current) {
        setActiveId(data.conversation_id);
        activeIdRef.current = data.conversation_id;
      }

      setMessages((prev) => prev.map((m) => {
        if (m.id !== tempId) return m;
        if (error) {
          return { ...m, loading: false, status: 'error', content: 'Erro de conexão com o servidor de relatórios. Tente de novo.' };
        }
        if (!data?.success) {
          return {
            ...m, loading: false, status: 'error',
            forbidden: data?.error === 'forbidden',
            content: data?.message || 'Não consegui responder essa.',
          };
        }
        return {
          ...m,
          id: data.message?.id || m.id,
          loading: false,
          content: data.message?.content || '',
          queries: data.message?.queries || [],
          engine: data.message?.engine,
          status: 'ok',
        };
      }));

      loadConversations();
    } catch (e) {
      setMessages((prev) => prev.map((m) => m.id === tempId
        ? { ...m, loading: false, status: 'error', content: e instanceof Error ? e.message : 'Erro inesperado.' }
        : m));
    } finally {
      setBusy(false);
    }
  }, [anexos, busy, subindo, loadConversations]);

  // ============================================================
  // Anexo e voz — a pergunta pode vir com material, ou ser ditada
  // ============================================================
  /**
   * Sobe um arquivo e devolve a URL pública.
   *
   * Bucket `team-chat-media`, o MESMO do chat interno da equipe (é de lá que a
   * função de transcrição já sabe baixar). Prefixo `relatorios/<usuário>` só
   * pra dar pra saber depois de onde cada arquivo veio.
   */
  const subirArquivo = useCallback(async (
    corpo: Blob, nome: string, mime: string,
  ): Promise<string | null> => {
    const caminho = `relatorios/${user?.id || 'anon'}/${Date.now()}_${nomeSeguro(nome)}`;
    const { error } = await supabase.storage.from(BUCKET_ANEXO)
      .upload(caminho, corpo, { contentType: mime || 'application/octet-stream' });
    if (error) {
      toast.error(`O arquivo não subiu: ${error.message}`);
      return null;
    }
    return supabase.storage.from(BUCKET_ANEXO).getPublicUrl(caminho).data.publicUrl;
  }, [user?.id]);

  const anexarArquivos = useCallback(async (lista: FileList | File[] | null) => {
    if (!lista?.length) return;
    const arquivos = Array.from(lista);
    setSubindo(true);
    try {
      for (const arquivo of arquivos) {
        // O teto de anexos é por pergunta: o estado é lido dentro do setState
        // pra não estourar quando alguém marca 6 arquivos de uma vez.
        let cabe = true;
        setAnexos((prev) => { cabe = prev.length < MAX_ANEXOS; return prev; });
        if (!cabe) {
          toast.error(`Máximo de ${MAX_ANEXOS} arquivos por pergunta.`);
          break;
        }
        if (!MIMES_ACEITOS.includes(arquivo.type)) {
          toast.error(`${arquivo.name}: mande imagem (PNG, JPG, WEBP) ou PDF.`);
          continue;
        }
        if (arquivo.size > MAX_ANEXO_MB * 1024 * 1024) {
          toast.error(`${arquivo.name} passa de ${MAX_ANEXO_MB} MB.`);
          continue;
        }
        const url = await subirArquivo(arquivo, arquivo.name, arquivo.type);
        if (!url) continue;
        setAnexos((prev) => [...prev, {
          url, name: arquivo.name, mime: arquivo.type, size: arquivo.size,
          kind: arquivo.type === 'application/pdf' ? 'pdf' : 'image',
        }]);
      }
    } finally {
      setSubindo(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  }, [subirArquivo]);

  const removerAnexo = useCallback((url: string) => {
    setAnexos((prev) => prev.filter((a) => a.url !== url));
  }, []);

  /**
   * Colar (Ctrl+V) e arrastar o arquivo pra dentro da conversa.
   *
   * É o caminho mais curto pra quem já está com o print na mão: recorta a tela,
   * cola aqui e pergunta. Passa pela MESMA validação do clipe (tipo, tamanho,
   * teto de 4) — não existe porta de entrada com regra própria.
   */
  const anexarDoClipboard = useCallback((dados: DataTransfer | null): boolean => {
    const arquivos: File[] = [];
    for (const item of Array.from(dados?.items || [])) {
      if (item.kind !== 'file') continue;
      const arquivo = item.getAsFile();
      if (!arquivo) continue;
      // Print colado chega como "image.png" sempre igual — com hora no nome dá
      // pra saber qual chip é qual quando se cola dois.
      const ehPrintSemNome = /^image\.(png|jpe?g|webp)$/i.test(arquivo.name || '');
      arquivos.push(ehPrintSemNome
        ? new File([arquivo], `print-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`, { type: arquivo.type })
        : arquivo);
    }
    if (!arquivos.length) return false;
    void anexarArquivos(arquivos);
    return true;
  }, [anexarArquivos]);

  const colarArquivos = useCallback((e: React.ClipboardEvent) => {
    // Só engole o Ctrl+V quando REALMENTE veio arquivo: colar texto continua
    // caindo no campo como sempre.
    if (anexarDoClipboard(e.clipboardData)) e.preventDefault();
  }, [anexarDoClipboard]);

  /**
   * Ctrl+V com o cursor fora do campo também anexa.
   *
   * Quem acabou de recortar a tela cola direto, sem clicar no campo antes — e
   * sem isto o print ia pro vazio. Texto nunca é afetado: só age quando o
   * clipboard traz arquivo. Fora o campo de renomear conversa, que é digitação.
   */
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo?.tagName === 'TEXTAREA') return; // o próprio campo já trata
      if (alvo?.closest('[data-sem-anexo-colado]')) return;
      if (anexarDoClipboard(e.clipboardData)) e.preventDefault();
    };
    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, [anexarDoClipboard]);

  const arrasteTemArquivo = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types || []).includes('Files');

  const aoArrastarSobre = useCallback((e: React.DragEvent) => {
    if (!arrasteTemArquivo(e)) return;
    e.preventDefault();
    setArrastando(true);
  }, []);

  const aoSairDoArraste = useCallback((e: React.DragEvent) => {
    // Sair pra um filho (o campo, um botão) não é sair da área — sem isso o
    // realce fica piscando enquanto a pessoa atravessa a conversa.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setArrastando(false);
  }, []);

  const aoSoltar = useCallback((e: React.DragEvent) => {
    if (!arrasteTemArquivo(e)) return;
    e.preventDefault();
    setArrastando(false);
    void anexarArquivos(e.dataTransfer.files);
  }, [anexarArquivos]);

  /**
   * Ditar o pedido em vez de digitar.
   *
   * O caminho é o mesmo que o chat da equipe e o lançamento financeiro já usam:
   * grava, sobe, e pede o texto à `transcribe-team-audio` (ElevenLabs Scribe com
   * Gemini de reserva). Um segundo transcritor aqui seria manter duas coisas
   * fazendo a mesma.
   *
   * O texto cai no campo pra pessoa CONFERIR antes de mandar — pergunta
   * transcrita torto custa uma rodada de consulta ao banco. O áudio vai junto
   * como anexo, então a conversa guarda o que foi falado de verdade.
   */
  const pararDitado = useCallback(() => {
    if (gravadorRef.current && gravadorRef.current.state !== 'inactive') gravadorRef.current.stop();
  }, []);

  const ditar = useCallback(async () => {
    if (gravando) { pararDitado(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const gravador = new MediaRecorder(stream, { mimeType: mime });
      pedacosRef.current = [];
      gravador.ondataavailable = (e) => { if (e.data.size) pedacosRef.current.push(e.data); };
      gravador.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        if (cronometroRef.current) clearInterval(cronometroRef.current);
        setSegundos(0);
        const blob = new Blob(pedacosRef.current, { type: mime });
        if (blob.size < 1000) { toast.error('Gravação muito curta.'); return; }

        setTranscrevendo(true);
        try {
          const ext = mime.includes('mp4') ? 'm4a' : 'webm';
          const url = await subirArquivo(blob, `ditado.${ext}`, mime.split(';')[0]);
          if (!url) return;
          const { data } = await cloudFunctions.invoke<{ success?: boolean; transcription?: string; error?: string }>(
            'transcribe-team-audio',
            { body: { audio_url: url, audio_mime: mime.split(';')[0] } },
          );
          const texto = data?.transcription?.trim();
          if (!texto) {
            toast.error(data?.error || 'Não entendi o áudio. Tente falar mais perto do microfone.');
            return;
          }
          setInput((prev) => (prev.trim() ? `${prev.trim()} ${texto}` : texto));
          setAnexos((prev) => (prev.length < MAX_ANEXOS
            ? [...prev, { url, name: `ditado.${ext}`, mime: mime.split(';')[0], size: blob.size, kind: 'audio' as const }]
            : prev));
          toast.success('Transcrito — confira e mande.');
        } finally {
          setTranscrevendo(false);
        }
      };
      gravadorRef.current = gravador;
      gravador.start();
      setGravando(true);
      setSegundos(0);
      cronometroRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    } catch {
      toast.error('Não consegui acessar o microfone.');
    }
  }, [gravando, pararDitado, subirArquivo]);

  // Sair da tela gravando não deixa o microfone ligado.
  useEffect(() => () => {
    if (cronometroRef.current) clearInterval(cronometroRef.current);
    if (gravadorRef.current && gravadorRef.current.state !== 'inactive') gravadorRef.current.stop();
  }, []);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const t = title.trim();
    setEditingId(null);
    if (!t) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: t } : c)));
    await cloudFunctions.invoke('report-conversations', {
      body: { action: 'rename', conversation_id: id, title: t },
    });
  }, []);

  const confirmDelete = useCallback(async () => {
    const id = deleteId;
    setDeleteId(null);
    if (!id) return;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeIdRef.current === id) newConversation();
    await cloudFunctions.invoke('report-conversations', {
      body: { action: 'delete', conversation_id: id },
    });
  }, [deleteId, newConversation]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  const ConversationList = (
    <div className="flex flex-col h-full">
      <Button variant="outline" size="sm" className="gap-2 m-2" onClick={newConversation}>
        <Plus className="h-4 w-4" /> Nova conversa
      </Button>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {conversations.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            Suas conversas ficam gravadas aqui.
          </p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent',
              c.id === activeId && 'bg-accent',
            )}
          >
            {editingId === c.id ? (
              <>
                <Input
                  data-sem-anexo-colado
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameConversation(c.id, editingTitle);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="h-7 text-xs"
                  autoFocus
                />
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  onClick={() => renameConversation(c.id, editingTitle)}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditingId(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <button className="flex-1 text-left truncate" onClick={() => openConversation(c.id)} title={c.title}>
                  {c.title}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditingId(c.id); setEditingTitle(c.title); }}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(c.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Apagar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full">
      {/* Lista de conversas — coluna fixa no desktop */}
      <aside className="hidden md:flex w-60 shrink-0 border-r flex-col">
        {ConversationList}
      </aside>

      {/* Arrastar arquivo vale em QUALQUER ponto da conversa, não só na barra */}
      <div
        className={cn(
          'flex flex-col flex-1 min-w-0 max-w-4xl mx-auto w-full relative',
          arrastando && 'ring-2 ring-primary ring-inset bg-primary/5',
        )}
        onDragEnter={aoArrastarSobre}
        onDragOver={aoArrastarSobre}
        onDragLeave={aoSairDoArraste}
        onDrop={aoSoltar}
      >
        {arrastando && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 rounded-lg border bg-background/95 px-4 py-3 text-sm font-medium shadow-lg">
              <Paperclip className="h-4 w-4 text-primary" />
              Solte aqui pra anexar à pergunta
            </div>
          </div>
        )}

        <div className="px-4 py-4 border-b flex items-center gap-2">
          {/* No celular a lista vira Sheet lateral — nada de rota nova */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden shrink-0">
                <MessagesSquare className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="p-4 pb-0">
                <SheetTitle>Conversas</SheetTitle>
              </SheetHeader>
              {ConversationList}
            </SheetContent>
          </Sheet>

          <FileBarChart className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">Relatórios</h1>
            <p className="text-xs text-muted-foreground">
              Converse com o analista: ele consulta o banco, mostra a tabela e aponta o que está estranho no dado.
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loadingConv && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-10">
              <Loader2 className="h-4 w-4 animate-spin" /> Abrindo a conversa...
            </div>
          )}

          {!loadingConv && messages.length === 0 && (
            <div className="text-center py-10 space-y-4">
              <div className="inline-flex p-3 rounded-full bg-primary/10">
                <FileBarChart className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="font-medium">O que você quer saber?</p>
                <p className="text-sm text-muted-foreground">
                  Atividades, processos, casos, contatos, leads — pergunte de qualquer jeito.
                  Pode perguntar também o que está furado no cadastro.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-2xl mx-auto">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => ask(ex)}
                    className="text-xs px-3 py-1.5 rounded-full border hover:bg-accent transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} onAbrirMidia={setMidiaAberta} />
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="border-t p-3">
          {/* O que já subiu e vai junto com a próxima pergunta */}
          {anexos.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {anexos.map((a) => (
                <div key={a.url} className="flex items-center gap-1.5 rounded-md border bg-muted/40 pl-2 pr-1 py-1 text-xs max-w-[240px]">
                  {a.kind === 'image' ? <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    : a.kind === 'pdf' ? <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    : <Mic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="truncate" title={a.name}>{a.kind === 'audio' ? 'Áudio do ditado' : a.name}</span>
                  <Button
                    variant="ghost" size="icon" className="h-5 w-5 shrink-0"
                    onClick={() => removerAnexo(a.url)}
                    title="Tirar este anexo"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={arquivoRef}
              type="file"
              multiple
              accept={ACCEPT_ANEXO}
              className="hidden"
              onChange={(e) => anexarArquivos(e.target.files)}
            />
            <Button
              variant="outline" size="icon" className="shrink-0 h-11 w-11"
              onClick={() => arquivoRef.current?.click()}
              disabled={busy || subindo || anexos.length >= MAX_ANEXOS}
              title={anexos.length >= MAX_ANEXOS ? `Máximo de ${MAX_ANEXOS} arquivos` : 'Anexar print, foto ou PDF'}
            >
              {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </Button>

            <Button
              variant={gravando ? 'destructive' : 'outline'}
              size="icon" className="shrink-0 h-11 w-11"
              onClick={ditar}
              disabled={busy || transcrevendo}
              title={gravando ? 'Parar e transcrever' : 'Ditar a pergunta'}
            >
              {transcrevendo ? <Loader2 className="h-4 w-4 animate-spin" />
                : gravando ? <Square className="h-4 w-4" />
                : <Mic className="h-4 w-4" />}
            </Button>

            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={colarArquivos}
              placeholder={gravando ? `Gravando… ${segundos}s — toque no quadrado para parar`
                : transcrevendo ? 'Transcrevendo o que você falou…'
                : 'Ex: me dê a relação dos processos que a Gisele é responsável'}
              className="resize-none min-h-[44px] max-h-32"
              rows={1}
              disabled={busy || gravando}
            />
            <Button
              onClick={() => ask(input)}
              disabled={busy || subindo || (!input.trim() && anexos.length === 0)}
              size="icon" className="shrink-0 h-11 w-11"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            Somente leitura · CPF e dados bancários são mascarados · acesso restrito à diretoria e gestores
            <br />
            Anexo (print, foto, PDF até {MAX_ANEXO_MB} MB) e ditado por voz entram na pergunta — a IA lê e compara com o banco.
            Pode colar com Ctrl+V ou arrastar o arquivo pra cá.
          </p>
        </div>
      </div>

      {/* Anexo abre POR CIMA da conversa, nunca em aba nova */}
      <MediaLightbox url={midiaAberta} title="Anexo da pergunta" onClose={() => setMidiaAberta(null)} />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar esta conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela some da sua lista. O histórico continua guardado para auditoria, mas você não abre mais por aqui.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
