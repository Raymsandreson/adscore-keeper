import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, MessageSquare, Send, RefreshCw, Copy, CheckCircle2, UserPlus, Mail } from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { toast } from 'sonner';

interface BridgeReply {
  comment: string;
  dm: string;
  comment_alternatives?: string[];
  dm_alternatives?: string[];
}

interface BridgeContactCardProps {
  contact: {
    username: string;
    type?: string;
    relationship?: string;
    info?: string;
  };
  reply?: BridgeReply;
  postUrl: string;
  isSaved: boolean;
  isSaving: boolean;
  onSave: () => void;
  onRegenerate: (username: string) => void;
  isRegenerating: boolean;
}

export function BridgeContactCard({
  contact,
  reply,
  postUrl,
  isSaved,
  isSaving,
  onSave,
  onRegenerate,
  isRegenerating,
}: BridgeContactCardProps) {
  const username = contact.username?.replace('@', '') || '';
  const [editedComment, setEditedComment] = useState(reply?.comment || '');
  const [editedDm, setEditedDm] = useState(reply?.dm || '');
  const [sendingComment, setSendingComment] = useState(false);
  const [sendingDm, setSendingDm] = useState(false);
  const [commentSent, setCommentSent] = useState(false);
  const [dmSent, setDmSent] = useState(false);
  const [showAlts, setShowAlts] = useState(false);

  // Sync when reply changes
  if (reply?.comment && reply.comment !== editedComment && !commentSent) {
    setEditedComment(reply.comment);
  }
  if (reply?.dm && reply.dm !== editedDm && !dmSent) {
    setEditedDm(reply.dm);
  }

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  const handleSendComment = async () => {
    if (!editedComment.trim()) return;
    setSendingComment(true);
    try {
      const { data, error } = await cloudFunctions.invoke('instagram-bridge-action', {
        body: { action: 'comment', postUrl, message: editedComment.trim() },
      });
      if (error) throw error;
      if (data?.success) {
        setCommentSent(true);
        toast.success('Comentário enviado para processamento!');
      } else {
        toast.error(data?.error || 'Erro ao enviar comentário');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar comentário');
    } finally {
      setSendingComment(false);
    }
  };

  const handleSendDm = async () => {
    if (!editedDm.trim()) return;
    setSendingDm(true);
    try {
      const { data, error } = await cloudFunctions.invoke('instagram-bridge-action', {
        body: { action: 'dm', username, message: editedDm.trim() },
      });
      if (error) throw error;
      if (data?.success) {
        setDmSent(true);
        toast.success(`DM enviada para @${username}!`);
      } else {
        toast.error(data?.error || 'Erro ao enviar DM');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar DM');
    } finally {
      setSendingDm(false);
    }
  };

  return (
    <div className="border rounded-lg p-3 bg-background space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] shrink-0">{contact.type || 'contato'}</Badge>
            <span className="text-sm font-medium truncate">@{username}</span>
          </div>
          {(contact.relationship || contact.info) && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {contact.relationship || contact.info}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isSaved ? (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <CheckCircle2 className="h-3 w-3" /> Salvo
            </Badge>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={isSaving} onClick={onSave}>
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
              Cadastrar
            </Button>
          )}
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0"
            disabled={isRegenerating}
            onClick={() => onRegenerate(username)}
            title="Regenerar respostas"
          >
            {isRegenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Comment reply section */}
      {reply && (
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium flex items-center gap-1">
                <MessageSquare className="h-3 w-3 text-blue-500" /> Comentário público
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => handleCopy(editedComment, 'Comentário')}>
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  size="sm" variant="default" className="h-6 px-2 text-[10px] gap-1"
                  disabled={sendingComment || commentSent || !editedComment.trim()}
                  onClick={handleSendComment}
                >
                  {sendingComment ? <Loader2 className="h-3 w-3 animate-spin" /> : commentSent ? <CheckCircle2 className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                  {commentSent ? 'Enviado' : 'Enviar'}
                </Button>
              </div>
            </div>
            <Textarea
              value={editedComment}
              onChange={(e) => setEditedComment(e.target.value)}
              rows={2}
              className="text-xs resize-none"
              placeholder="Comentário para responder no post..."
            />
          </div>

          {/* DM section */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium flex items-center gap-1">
                <Mail className="h-3 w-3 text-purple-500" /> Direct (DM)
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => handleCopy(editedDm, 'DM')}>
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  size="sm" variant="secondary" className="h-6 px-2 text-[10px] gap-1"
                  disabled={sendingDm || dmSent || !editedDm.trim()}
                  onClick={handleSendDm}
                >
                  {sendingDm ? <Loader2 className="h-3 w-3 animate-spin" /> : dmSent ? <CheckCircle2 className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                  {dmSent ? 'Enviada' : 'Enviar DM'}
                </Button>
              </div>
            </div>
            <Textarea
              value={editedDm}
              onChange={(e) => setEditedDm(e.target.value)}
              rows={3}
              className="text-xs resize-none"
              placeholder="Mensagem direta para enviar..."
            />
          </div>

          {/* Alternatives toggle */}
          {(reply.comment_alternatives?.length || reply.dm_alternatives?.length) ? (
            <div>
              <Button
                size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground w-full"
                onClick={() => setShowAlts(!showAlts)}
              >
                {showAlts ? '▲ Ocultar alternativas' : '▼ Ver alternativas'}
              </Button>
              {showAlts && (
                <div className="space-y-1 mt-1">
                  {reply.comment_alternatives?.map((alt, i) => (
                    <div key={`c-${i}`} className="flex items-center gap-1 p-1.5 rounded bg-muted/50">
                      <span className="text-[10px] flex-1">{alt}</span>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => { setEditedComment(alt); toast.info('Alternativa selecionada'); }}>
                        ✓
                      </Button>
                    </div>
                  ))}
                  {reply.dm_alternatives?.map((alt, i) => (
                    <div key={`d-${i}`} className="flex items-center gap-1 p-1.5 rounded bg-purple-50 dark:bg-purple-950/20">
                      <span className="text-[10px] flex-1">{alt}</span>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => { setEditedDm(alt); toast.info('Alternativa DM selecionada'); }}>
                        ✓
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Loading state when no reply yet */}
      {!reply && (
        <p className="text-[10px] text-muted-foreground italic">Gerando respostas pela IA...</p>
      )}
    </div>
  );
}
