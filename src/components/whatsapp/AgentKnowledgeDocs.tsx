import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, Upload, Trash2, Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

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
      // Upload to storage
      const filePath = `${agentId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('agent-knowledge')
        .upload(filePath, file, { contentType: 'application/pdf' });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('agent-knowledge')
        .getPublicUrl(filePath);

      // Create document record
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

      // Trigger parsing
      supabase.functions.invoke('parse-knowledge-document', {
        body: { document_id: (docData as any).id },
      }).then(() => {
        fetchDocs(); // Refresh after processing
      }).catch(err => {
        console.error('Parse error:', err);
        fetchDocs();
      });

    } catch (err: any) {
      toast.error('Erro no upload: ' + (err.message || ''));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (doc: KnowledgeDoc) => {
    if (!confirm(`Excluir "${doc.file_name}"?`)) return;

    // Delete from storage
    const path = doc.file_url.split('/agent-knowledge/')[1];
    if (path) {
      await supabase.storage.from('agent-knowledge').remove([path]);
    }

    // Delete record
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

    supabase.functions.invoke('parse-knowledge-document', {
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
          Faça upload de PDFs (petições, laudos, regulamentos) para o agente usar como base de conhecimento ao responder clientes.
          O conteúdo será extraído e injetado no contexto da IA.
        </p>

        {totalChars > 0 && (
          <Badge variant="outline" className="text-[10px] mb-3 gap-1">
            <FileText className="h-3 w-3" />
            {docs.filter(d => d.status === 'ready').length} doc(s) · {(totalChars / 1000).toFixed(0)}k caracteres de contexto
          </Badge>
        )}
      </div>

      {/* Upload area */}
      <div 
        className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
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
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Enviando...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Clique para enviar PDF</p>
            <p className="text-[10px] text-muted-foreground">Máximo 20MB por arquivo</p>
          </div>
        )}
      </div>

      {/* Document list */}
      {docs.length > 0 && (
        <div className="space-y-2">
          {docs.map(doc => {
            const status = statusConfig[doc.status] || statusConfig.pending;
            return (
              <Card key={doc.id}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <FileText className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
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

      {docs.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          Nenhum documento adicionado. Envie PDFs para enriquecer as respostas do agente.
        </p>
      )}
    </div>
  );
}
