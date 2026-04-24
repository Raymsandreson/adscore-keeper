import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Paperclip,
  Image as ImageIcon,
  Video,
  FileText,
  Link2,
  X,
  Upload,
  ExternalLink,
  Trash2,
  Loader2,
} from 'lucide-react';

interface Attachment {
  id?: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size?: number;
  attachment_type: string;
  link_url?: string;
  link_title?: string;
}

interface ActivityNotesFieldProps {
  value: string;
  onChange: (v: string) => void;
  activityId?: string | null;
  placeholder?: string;
  label?: string;
}

export function ActivityNotesField({ value, onChange, activityId, placeholder, label }: ActivityNotesFieldProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activityId) fetchAttachments();
    else setAttachments([]);
  }, [activityId]);

  const fetchAttachments = async () => {
    if (!activityId) return;
    const { data } = await supabase
      .from('activity_attachments')
      .select('*')
      .eq('activity_id', activityId)
      .order('created_at', { ascending: true });
    if (data) setAttachments(data as any);
  };

  const getAttachmentType = (mimeType: string): string => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
  };

  const uploadFiles = async (filesArr: File[]) => {
    if (!filesArr.length) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      for (const file of filesArr) {
        const fileExt = (file.name.split('.').pop() || 'bin').toLowerCase();
        const filePath = `${activityId || 'temp'}/${crypto.randomUUID()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('activity-attachments')
          .upload(filePath, file, { contentType: file.type || undefined });

        if (uploadError) {
          toast.error(`Erro ao enviar ${file.name}`);
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('activity-attachments')
          .getPublicUrl(filePath);

        const attachmentType = getAttachmentType(file.type);

        const newAttachment: Attachment = {
          file_url: publicUrl,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          attachment_type: attachmentType,
        };

        if (activityId) {
          const { data, error } = await supabase
            .from('activity_attachments')
            .insert({
              activity_id: activityId,
              file_url: publicUrl,
              file_name: file.name,
              file_type: file.type,
              file_size: file.size,
              attachment_type: attachmentType,
              created_by: user?.id,
            })
            .select()
            .single();
          if (!error && data) newAttachment.id = data.id;
        }

        setAttachments(prev => [...prev, newAttachment]);
      }
      toast.success('Arquivo(s) enviado(s)!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao enviar arquivo');
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Paste (Ctrl+V) — captura imagens e arquivos do clipboard
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) {
            if (f.name === 'image.png' || !f.name) {
              const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
              files.push(new File([f], `colado-${Date.now()}.${ext}`, { type: f.type }));
            } else {
              files.push(f);
            }
          }
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      uploadFiles(files);
    };
    el.addEventListener('paste', handlePaste as any);
    return () => el.removeEventListener('paste', handlePaste as any);
  }, [activityId]);

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      setIsDragging(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) uploadFiles(files);
  };


  const handleAddLink = async () => {
    if (!linkUrl.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    
    const newAttachment: Attachment = {
      file_url: linkUrl,
      file_name: linkTitle || linkUrl,
      file_type: 'link',
      attachment_type: 'link',
      link_url: linkUrl,
      link_title: linkTitle || undefined,
    };

    if (activityId) {
      const { data, error } = await supabase
        .from('activity_attachments')
        .insert({
          activity_id: activityId,
          file_url: linkUrl,
          file_name: linkTitle || linkUrl,
          file_type: 'link',
          attachment_type: 'link',
          link_url: linkUrl,
          link_title: linkTitle || null,
          created_by: user?.id,
        })
        .select()
        .single();
      if (!error && data) newAttachment.id = data.id;
    }

    setAttachments(prev => [...prev, newAttachment]);
    setLinkUrl('');
    setLinkTitle('');
    setShowLinkInput(false);
  };

  const handleRemoveAttachment = async (idx: number) => {
    const att = attachments[idx];
    if (att.id) {
      await supabase.from('activity_attachments').delete().eq('id', att.id);
    }
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'image': return <ImageIcon className="h-3.5 w-3.5 text-green-500" />;
      case 'video': return <Video className="h-3.5 w-3.5 text-purple-500" />;
      case 'link': return <Link2 className="h-3.5 w-3.5 text-blue-500" />;
      default: return <FileText className="h-3.5 w-3.5 text-orange-500" />;
    }
  };

  return (
    <div>
      {label && <Label>{label}</Label>}
      <RichTextEditor
        value={value}
        onChange={onChange}
        placeholder={placeholder || 'Notas adicionais...'}
        minHeight="60px"
      />

      {/* Attachment toolbar */}
      <div className="flex items-center gap-1 mt-1.5">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          className="hidden"
          onChange={handleFileUpload}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          Anexar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.accept = 'image/*';
              fileInputRef.current.click();
              setTimeout(() => {
                if (fileInputRef.current) fileInputRef.current.accept = 'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';
              }, 100);
            }
          }}
          disabled={uploading}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          Foto
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.accept = 'video/*';
              fileInputRef.current.click();
              setTimeout(() => {
                if (fileInputRef.current) fileInputRef.current.accept = 'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';
              }, 100);
            }
          }}
          disabled={uploading}
        >
          <Video className="h-3.5 w-3.5" />
          Vídeo
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => setShowLinkInput(!showLinkInput)}
        >
          <Link2 className="h-3.5 w-3.5" />
          Link
        </Button>
      </div>

      {/* Link input */}
      {showLinkInput && (
        <div className="flex gap-1.5 mt-1.5">
          <Input
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 h-7 text-xs"
          />
          <Input
            value={linkTitle}
            onChange={e => setLinkTitle(e.target.value)}
            placeholder="Título (opcional)"
            className="flex-1 h-7 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={handleAddLink}
            disabled={!linkUrl.trim()}
          >
            Adicionar
          </Button>
        </div>
      )}

      {/* Attachments list */}
      {attachments.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {attachments.map((att, idx) => (
            <div key={att.id || idx} className="flex items-center gap-2 p-1.5 rounded border bg-muted/30">
              {att.attachment_type === 'image' && (
                <img src={att.file_url} alt={att.file_name} className="h-10 w-10 object-cover rounded flex-shrink-0" />
              )}
              {att.attachment_type !== 'image' && (
                <div className="h-10 w-10 flex items-center justify-center rounded bg-muted flex-shrink-0">
                  {getIcon(att.attachment_type)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{att.link_title || att.file_name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {att.attachment_type === 'link' ? att.link_url : formatFileSize(att.file_size as number)}
                </p>
              </div>
              <a
                href={att.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0 text-destructive"
                onClick={() => handleRemoveAttachment(idx)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
