import { useState, useMemo } from 'react';
import { WhatsAppMessage } from '@/hooks/useWhatsAppMessages';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Image, FileText, Mic, Video, Download, GalleryHorizontalEnd, Loader2, CheckSquare, Square, Cloud } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { bindDownload } from '@/lib/downloadFile';
import { mediaThumb, handleMediaThumbError } from '@/lib/whatsappMediaTransform';
import { LazyVideo } from '@/components/whatsapp/LazyVideo';
import { toast } from 'sonner';

interface Props {
  messages: WhatsAppMessage[];
  leadId?: string | null;
  onSendToDrive?: (msgs: WhatsAppMessage[]) => Promise<void> | void;
}

type TabKey = 'images' | 'videos' | 'audios' | 'docs';

export function WhatsAppMediaGallery({ messages, leadId, onSendToDrive }: Props) {
  const [open, setOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<TabKey>('images');
  const [sending, setSending] = useState(false);

  const images = useMemo(() => messages.filter(m => m.message_type === 'image' && m.media_url), [messages]);
  const videos = useMemo(() => messages.filter(m => m.message_type === 'video' && m.media_url), [messages]);
  const audios = useMemo(() => messages.filter(m => m.message_type === 'audio' && m.media_url), [messages]);
  const docs = useMemo(() => messages.filter(m => m.message_type === 'document' && m.media_url), [messages]);

  const currentList: WhatsAppMessage[] = tab === 'images' ? images : tab === 'videos' ? videos : tab === 'audios' ? audios : docs;
  const totalMedia = images.length + videos.length + audios.length + docs.length;

  const canSendToDrive = !!leadId && !!onSendToDrive;
  const selectedMessages = useMemo(
    () => messages.filter(m => selected.has(String(m.id))),
    [messages, selected],
  );

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelectedInTab = currentList.length > 0 && currentList.every(m => selected.has(String(m.id)));
  const toggleAllInTab = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelectedInTab) {
        currentList.forEach(m => next.delete(String(m.id)));
      } else {
        currentList.forEach(m => next.add(String(m.id)));
      }
      return next;
    });
  };

  const selectAllEverywhere = () => {
    setSelected(new Set(messages.filter(m => m.media_url).map(m => String(m.id))));
  };

  const clearSelection = () => setSelected(new Set());

  const enterSelectionMode = () => {
    setSelectionMode(true);
  };
  const exitSelectionMode = () => {
    setSelectionMode(false);
    clearSelection();
  };

  const handleSend = async () => {
    if (!onSendToDrive || selectedMessages.length === 0) return;
    setSending(true);
    try {
      await onSendToDrive(selectedMessages);
      exitSelectionMode();
      setOpen(false);
    } catch (e: any) {
      toast.error(`Erro ao enviar: ${e?.message || e}`);
    } finally {
      setSending(false);
    }
  };

  const SelectionBadge = ({ id }: { id: string }) => {
    if (!selectionMode) return null;
    const checked = selected.has(id);
    return (
      <div className="absolute top-1 left-1 z-10 bg-background/90 rounded p-0.5 shadow">
        <Checkbox checked={checked} onCheckedChange={() => toggle(id)} />
      </div>
    );
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 relative" onClick={() => setOpen(true)}>
            <GalleryHorizontalEnd className="h-3.5 w-3.5" />
            {totalMedia > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                {totalMedia > 99 ? '99+' : totalMedia}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Mídias da conversa</TooltipContent>
      </Tooltip>

      <Sheet open={open} onOpenChange={(nextOpen) => {
        if (lightboxUrl && !nextOpen) return;
        setOpen(nextOpen);
        if (!nextOpen) exitSelectionMode();
      }}>
        <SheetContent className="w-[380px] sm:w-[440px] p-0 flex flex-col">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle className="text-base flex items-center justify-between gap-2">
              <span>Mídias, docs e links</span>
              {canSendToDrive && (
                selectionMode ? (
                  <Button size="sm" variant="ghost" onClick={exitSelectionMode} className="h-7 text-xs">
                    Cancelar
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={enterSelectionMode} className="h-7 text-xs gap-1">
                    <CheckSquare className="h-3.5 w-3.5" /> Selecionar
                  </Button>
                )
              )}
            </SheetTitle>
          </SheetHeader>

          {selectionMode && (
            <div className="mx-4 mb-2 flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="secondary" onClick={toggleAllInTab} className="h-7 text-xs gap-1">
                {allSelectedInTab ? <Square className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
                {allSelectedInTab ? 'Limpar aba' : 'Todos da aba'}
              </Button>
              <Button size="sm" variant="ghost" onClick={selectAllEverywhere} className="h-7 text-xs">
                Todas as mídias
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection} className="h-7 text-xs" disabled={selected.size === 0}>
                Limpar
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">{selected.size} selecionado(s)</span>
            </div>
          )}

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex flex-col flex-1 min-h-0">
            <TabsList className="mx-4 mb-2 grid grid-cols-4 h-9">
              <TabsTrigger value="images" className="text-xs gap-1">
                <Image className="h-3 w-3" /> {images.length}
              </TabsTrigger>
              <TabsTrigger value="videos" className="text-xs gap-1">
                <Video className="h-3 w-3" /> {videos.length}
              </TabsTrigger>
              <TabsTrigger value="audios" className="text-xs gap-1">
                <Mic className="h-3 w-3" /> {audios.length}
              </TabsTrigger>
              <TabsTrigger value="docs" className="text-xs gap-1">
                <FileText className="h-3 w-3" /> {docs.length}
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 px-4 pb-4">
              <TabsContent value="images" className="mt-0">
                {images.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhuma imagem</p>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {images.map(msg => {
                      const id = String(msg.id);
                      const checked = selected.has(id);
                      return (
                        <button
                          key={msg.id}
                          type="button"
                          onClick={() => selectionMode ? toggle(id) : setLightboxUrl(msg.media_url!)}
                          className={`relative group aspect-square rounded-md overflow-hidden bg-muted cursor-pointer ${checked ? 'ring-2 ring-primary' : ''}`}
                        >
                          <SelectionBadge id={id} />
                          <img src={mediaThumb(msg.media_url!)} alt="" className="w-full h-full object-cover" loading="lazy" onError={handleMediaThumbError} />
                          {!selectionMode && (
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end justify-between p-1 opacity-0 group-hover:opacity-100">
                              <span className="text-[9px] text-white font-medium">{format(new Date(msg.created_at), 'dd/MM/yy')}</span>
                              <Download className="h-3.5 w-3.5 text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="videos" className="mt-0 space-y-2">
                {videos.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum vídeo</p>
                ) : (
                  videos.map(msg => {
                    const id = String(msg.id);
                    const checked = selected.has(id);
                    return (
                      <div key={msg.id} className={`relative rounded-lg overflow-hidden border ${checked ? 'ring-2 ring-primary' : ''}`}>
                        {selectionMode && (
                          <div className="absolute top-1 left-1 z-10 bg-background/90 rounded p-0.5 shadow">
                            <Checkbox checked={checked} onCheckedChange={() => toggle(id)} />
                          </div>
                        )}
                        {selectionMode ? (
                          <button type="button" onClick={() => toggle(id)} className="w-full h-[140px] bg-muted flex items-center justify-center">
                            <Video className="h-6 w-6 text-muted-foreground" />
                          </button>
                        ) : (
                          <LazyVideo
                            src={msg.media_url!}
                            mimeType={msg.media_type || 'video/mp4'}
                            className="w-full max-h-[200px]"
                            posterClassName="w-full h-[140px] rounded"
                          />
                        )}
                        <div className="flex items-center justify-between px-2 py-1 bg-muted/50">
                          <span className="text-[10px] text-muted-foreground">{format(new Date(msg.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}</span>
                          <button type="button" onClick={bindDownload(msg.media_url!)}><Download className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" /></button>
                        </div>
                      </div>
                    );
                  })
                )}
              </TabsContent>

              <TabsContent value="audios" className="mt-0 space-y-2">
                {audios.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum áudio</p>
                ) : (
                  audios.map(msg => {
                    const id = String(msg.id);
                    const checked = selected.has(id);
                    return (
                      <div key={msg.id} className={`flex items-center gap-2 p-2 rounded-lg border bg-card ${checked ? 'ring-2 ring-primary' : ''}`}>
                        {selectionMode && <Checkbox checked={checked} onCheckedChange={() => toggle(id)} />}
                        <audio controls className="flex-1 h-8" preload="metadata">
                          <source
                            src={msg.media_url!}
                            type={(!msg.media_type || msg.media_type === 'application/octet-stream') ? 'audio/ogg' : msg.media_type}
                          />
                          <source src={msg.media_url!} type="audio/mpeg" />
                          <source src={msg.media_url!} />
                        </audio>
                        <span className="text-[10px] text-muted-foreground shrink-0">{format(new Date(msg.created_at), "dd/MM HH:mm")}</span>
                      </div>
                    );
                  })
                )}
              </TabsContent>

              <TabsContent value="docs" className="mt-0 space-y-2">
                {docs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum documento</p>
                ) : (
                  docs.map(msg => {
                    const id = String(msg.id);
                    const checked = selected.has(id);
                    return (
                      <button
                        key={msg.id}
                        type="button"
                        onClick={() => selectionMode ? toggle(id) : setLightboxUrl(msg.media_url!)}
                        className={`flex w-full items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left cursor-pointer ${checked ? 'ring-2 ring-primary' : ''}`}
                      >
                        {selectionMode && <Checkbox checked={checked} onCheckedChange={() => toggle(id)} />}
                        <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{msg.message_text || msg.media_type || 'Documento'}</p>
                          <p className="text-[10px] text-muted-foreground">{format(new Date(msg.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}</p>
                        </div>
                        {!selectionMode && <Download className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </button>
                    );
                  })
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>

          {selectionMode && canSendToDrive && (
            <div className="border-t p-3 bg-background">
              <Button
                onClick={handleSend}
                disabled={sending || selected.size === 0}
                className="w-full gap-2"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                Enviar {selected.size > 0 ? `${selected.size} ` : ''}para o Drive
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <MediaLightbox url={lightboxUrl} title="Documento" onClose={() => setLightboxUrl(null)} />
    </>
  );
}
