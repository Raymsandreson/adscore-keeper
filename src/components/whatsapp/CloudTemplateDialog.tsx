/**
 * Escolha e envio de template da WhatsApp Cloud API.
 *
 * Abre quando a janela de 24h fechou — que é quando texto livre para de ser
 * entregue. Mostra o texto EXATO que o cliente vai receber, já com as variáveis
 * preenchidas, porque mandar template às cegas é assinar embaixo de um texto
 * que não se leu.
 */

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, AlertTriangle } from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import {
  CloudTemplate,
  renderizarTemplate,
  templatesEnviaveis,
  variaveisDoCorpo,
} from '@/lib/whatsappTemplate';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Valores iniciais das variáveis, na ordem ({{1}}, {{2}}...). */
  sugestoes?: string[];
  /** Devolve `true` quando o envio deu certo — aí o diálogo fecha sozinho. */
  onEnviar: (payload: {
    name: string;
    language: string;
    params: string[];
    textoRenderizado: string;
  }) => Promise<boolean>;
}

export function CloudTemplateDialog({ open, onOpenChange, sugestoes, onEnviar }: Props) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [todos, setTodos] = useState<CloudTemplate[]>([]);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    cloudFunctions
      .invoke('whatsapp-cloud-templates', { body: {} })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Falha lendo os templates');
        setTodos(data.templates || []);
      })
      .catch((e: any) => vivo && setErro(e?.message || 'Falha lendo os templates'))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [open]);

  const aprovados = useMemo(() => templatesEnviaveis(todos), [todos]);
  const emAnalise = useMemo(
    () => todos.filter((t) => (t.status || '').toUpperCase() === 'PENDING'),
    [todos],
  );

  const atual = useMemo(
    () => aprovados.find((t) => t.name === escolhido) || null,
    [aprovados, escolhido],
  );

  // Seleciona o primeiro aprovado assim que a lista chega.
  useEffect(() => {
    if (!escolhido && aprovados.length) setEscolhido(aprovados[0].name);
  }, [aprovados, escolhido]);

  // Cada troca de template redefine os campos: a contagem de variáveis muda.
  useEffect(() => {
    if (!atual) return;
    const n = variaveisDoCorpo(atual.body_text).length;
    setParams(Array.from({ length: n }, (_, i) => sugestoes?.[i] || ''));
  }, [atual, sugestoes]);

  const preview = atual ? renderizarTemplate(atual.body_text, params) : '';
  const faltando = atual ? params.some((p) => !p.trim()) : true;

  const enviar = async () => {
    if (!atual || faltando || enviando) return;
    setEnviando(true);
    try {
      const ok = await onEnviar({
        name: atual.name,
        language: atual.language,
        params,
        textoRenderizado: preview,
      });
      if (ok) onOpenChange(false);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar template</DialogTitle>
          <DialogDescription>
            O cliente não escreve há mais de 24 horas. Nessa situação o WhatsApp só entrega
            template aprovado — texto livre é recusado depois do envio.
          </DialogDescription>
        </DialogHeader>

        {carregando && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando templates…
          </div>
        )}

        {!carregando && erro && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
            <span>{erro}</span>
          </div>
        )}

        {!carregando && !erro && aprovados.length === 0 && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-2">
            <p className="font-medium">Nenhum template aprovado ainda.</p>
            {emAnalise.length > 0 ? (
              <p className="text-muted-foreground">
                {emAnalise.length === 1 ? 'Há 1 template' : `Há ${emAnalise.length} templates`} em
                análise na Meta ({emAnalise.map((t) => t.name).join(', ')}). Enquanto não aprovar,
                não dá para iniciar a conversa por aqui.
              </p>
            ) : (
              <p className="text-muted-foreground">
                Crie um template no WhatsApp Manager antes de conseguir reabrir esta conversa.
              </p>
            )}
          </div>
        )}

        {!carregando && !erro && aprovados.length > 0 && (
          <div className="space-y-3">
            {aprovados.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Template</Label>
                <div className="flex flex-wrap gap-1.5">
                  {aprovados.map((t) => (
                    <Button
                      key={t.name}
                      type="button"
                      size="sm"
                      variant={t.name === escolhido ? 'default' : 'outline'}
                      className="h-7 text-xs"
                      onClick={() => setEscolhido(t.name)}
                    >
                      {t.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {atual && (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{atual.category}</Badge>
                  <Badge variant="outline" className="text-[10px]">{atual.language}</Badge>
                </div>

                {params.map((valor, i) => (
                  <div key={i} className="space-y-1.5">
                    <Label className="text-xs">{`Variável {{${i + 1}}}`}</Label>
                    <Input
                      value={valor}
                      onChange={(e) => {
                        const novo = [...params];
                        novo[i] = e.target.value;
                        setParams(novo);
                      }}
                      className="h-8 text-sm"
                      placeholder={i === 0 ? 'Nome do cliente' : 'Seu nome'}
                    />
                  </div>
                ))}

                <div className="space-y-1.5">
                  <Label className="text-xs">O cliente vai receber exatamente isto</Label>
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                    {preview}
                    {atual.footer_text && (
                      <p className="mt-2 text-xs text-muted-foreground">{atual.footer_text}</p>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button type="button" onClick={enviar} disabled={faltando || enviando}>
                    {enviando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                    Enviar template
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
