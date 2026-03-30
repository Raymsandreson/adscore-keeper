import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, Upload, Trash2, Loader2, CheckCircle2, AlertCircle, Clock, Type, Plus, Sparkles, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { AIKnowledgeGenerator } from './AIKnowledgeGenerator';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface KnowledgeDoc {
  id: string;
  agent_id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  extracted_text: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface Props {
  agentId: string;
}

export function AgentKnowledgeDocs({ agentId }: Props) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [savingText, setSavingText] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchDocs();
  }, [agentId]);

  const fetchDocs = async () => {
    const { data } = await supabase
      .from('agent_knowledge_documents')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });
    setDocs((data as any[]) || []);
    setLoading(false);
  };

  const handleSaveText = async () => {
    if (!textContent.trim()) {
      toast.error('Cole ou digite o conteúdo');
      return;
    }

    const title = textTitle.trim() || `Texto ${new Date().toLocaleDateString('pt-BR')}`;
    setSavingText(true);

    try {
      const { error } = await supabase
        .from('agent_knowledge_documents')
        .insert({
          agent_id: agentId,
          file_name: `📝 ${title}`,
          file_url: '',
          file_size: new TextEncoder().encode(textContent).length,
          extracted_text: textContent.trim(),
          status: 'ready',
        } as any);

      if (error) throw error;

      toast.success('✅ Texto adicionado à base de conhecimento!');
      setTextTitle('');
      setTextContent('');
      setShowTextInput(false);
      fetchDocs();
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + (err.message || ''));
    } finally {
      setSavingText(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Apenas arquivos PDF são suportados');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error('Arquivo muito grande (máximo 20MB)');
      return;
    }

    setUploading(true);
    try {
      const filePath = `${agentId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('agent-knowledge')
        .upload(filePath, file, { contentType: 'application/pdf' });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('agent-knowledge')
        .getPublicUrl(filePath);

      const { data: docData, error: insertError } = await supabase
        .from('agent_knowledge_documents')
        .insert({
          agent_id: agentId,
          file_name: file.name,
          file_url: urlData.publicUrl,
          file_size: file.size,
          status: 'pending',
        } as any)
        .select('id')
        .single();

      if (insertError) throw insertError;

      toast.success('📄 Documento enviado! Processando...');
      fetchDocs();

      cloudFunctions.invoke('parse-knowledge-document', {
        body: { document_id: (docData as any).id },
      }).then(() => fetchDocs()).catch(() => fetchDocs());

    } catch (err: any) {
      toast.error('Erro no upload: ' + (err.message || ''));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (doc: KnowledgeDoc) => {
    if (!confirm(`Excluir "${doc.file_name}"?`)) return;

    if (doc.file_url) {
      const path = doc.file_url.split('/agent-knowledge/')[1];
      if (path) {
        await supabase.storage.from('agent-knowledge').remove([path]);
      }
    }

    await supabase.from('agent_knowledge_documents').delete().eq('id', doc.id);
    toast.success('Documento excluído');
    fetchDocs();
  };

  const handleRetry = async (doc: KnowledgeDoc) => {
    await supabase
      .from('agent_knowledge_documents')
      .update({ status: 'pending', error_message: null } as any)
      .eq('id', doc.id);
    
    toast.info('Reprocessando...');
    fetchDocs();

    cloudFunctions.invoke('parse-knowledge-document', {
      body: { document_id: doc.id },
    }).then(() => fetchDocs()).catch(() => fetchDocs());
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    pending: { icon: <Clock className="h-3 w-3" />, label: 'Aguardando', color: 'text-amber-500' },
    processing: { icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Processando', color: 'text-blue-500' },
    ready: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Pronto', color: 'text-emerald-500' },
    error: { icon: <AlertCircle className="h-3 w-3" />, label: 'Erro', color: 'text-destructive' },
  };

  const totalChars = docs.filter(d => d.status === 'ready').reduce((sum, d) => sum + (d.extracted_text?.length || 0), 0);

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] text-muted-foreground mb-3">
          Adicione PDFs ou cole textos (petições, laudos, regulamentos) para o agente usar como base de conhecimento.
          <strong> Texto puro é o formato mais eficiente</strong> — a IA entende 100% sem perda.
        </p>

        {totalChars > 0 && (
          <Badge variant="outline" className="text-[10px] mb-3 gap-1">
            <FileText className="h-3 w-3" />
            {docs.filter(d => d.status === 'ready').length} doc(s) · {(totalChars / 1000).toFixed(0)}k caracteres de contexto
          </Badge>
        )}
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-2">
        <div 
          className="border-2 border-dashed rounded-lg p-3 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleUpload}
            className="hidden"
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-1">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-[10px] text-muted-foreground">Enviando...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <p className="text-[10px] font-medium">Upload PDF</p>
            </div>
          )}
        </div>

        <div 
          className="border-2 border-dashed rounded-lg p-3 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
          onClick={() => { setShowTextInput(!showTextInput); setShowAIGenerator(false); }}
        >
          <div className="flex flex-col items-center gap-1">
            <Type className="h-5 w-5 text-muted-foreground" />
            <p className="text-[10px] font-medium">Colar Texto</p>
          </div>
        </div>

        <div 
          className="border-2 border-dashed rounded-lg p-3 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors bg-primary/5"
          onClick={() => { setShowAIGenerator(!showAIGenerator); setShowTextInput(false); }}
        >
          <div className="flex flex-col items-center gap-1">
            <Sparkles className="h-5 w-5 text-primary" />
            <p className="text-[10px] font-medium text-primary">Gerar com IA</p>
          </div>
        </div>
      </div>

      {/* AI Generator */}
      {showAIGenerator && (
        <AIKnowledgeGenerator
          agentId={agentId}
          onSaved={fetchDocs}
          onClose={() => setShowAIGenerator(false)}
        />
      )}

      {/* Text input area */}
      {showTextInput && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <Input
              placeholder="Título (ex: Tabela INSS 2025, Petição modelo...)"
              value={textTitle}
              onChange={e => setTextTitle(e.target.value)}
              className="text-sm"
            />
            <Textarea
              placeholder="Cole aqui o texto completo: petições, regulamentos, tabelas, instruções, regras de negócio..."
              value={textContent}
              onChange={e => setTextContent(e.target.value)}
              rows={8}
              className="text-sm resize-y"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {textContent.length > 0 ? `${(textContent.length / 1000).toFixed(1)}k caracteres` : ''}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setShowTextInput(false); setTextContent(''); setTextTitle(''); }}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={handleSaveText} disabled={savingText || !textContent.trim()}>
                  {savingText ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                  Adicionar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Document list */}
      {docs.length > 0 && (
        <div className="space-y-2">
          {docs.map(doc => {
            const status = statusConfig[doc.status] || statusConfig.pending;
            const isText = doc.file_name.startsWith('📝');
            return (
              <Card key={doc.id}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      {isText ? (
                        <Type className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{doc.file_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`flex items-center gap-1 text-[10px] ${status.color}`}>
                            {status.icon} {status.label}
                          </span>
                          {doc.file_size && (
                            <span className="text-[10px] text-muted-foreground">{formatSize(doc.file_size)}</span>
                          )}
                          {doc.extracted_text && (
                            <span className="text-[10px] text-muted-foreground">
                              {(doc.extracted_text.length / 1000).toFixed(0)}k chars
                            </span>
                          )}
                        </div>
                        {doc.error_message && (
                          <p className="text-[10px] text-destructive mt-1">{doc.error_message}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {doc.status === 'error' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRetry(doc)} title="Tentar novamente">
                          <Loader2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(doc)} title="Excluir">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {docs.length === 0 && !showTextInput && (
        <p className="text-xs text-muted-foreground text-center py-4">
          Nenhum documento adicionado. Cole textos ou envie PDFs para enriquecer as respostas do agente.
        </p>
      )}
    </div>
  );
}