import { useState } from 'react';
import { WhatsAppMessage } from '@/hooks/useWhatsAppMessages';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Image, FileText, Mic, Video, Download, ExternalLink, GalleryHorizontalEnd } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  messages: WhatsAppMessage[];
}

export function WhatsAppMediaGallery({ messages }: Props) {
  const [open, setOpen] = useState(false);

  const images = messages.filter(m => m.message_type === 'image' && m.media_url);
  const videos = messages.filter(m => m.message_type === 'video' && m.media_url);
  const audios = messages.filter(m => m.message_type === 'audio' && m.media_url);
  const docs = messages.filter(m => m.message_type === 'document' && m.media_url);

  const totalMedia = images.length + videos.length + audios.length + docs.length;

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

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[380px] sm:w-[420px] p-0">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle className="text-base">Mídias, docs e links</SheetTitle>
          </SheetHeader>

          <Tabs defaultValue="images" className="flex flex-col h-[calc(100%-60px)]">
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
                    {images.map(msg => (
                      <a key={msg.id} href={msg.media_url!} target="_blank" rel="noopener noreferrer" className="relative group aspect-square rounded-md overflow-hidden bg-muted">
                        <img src={msg.media_url!} alt="" className="w-full h-full object-cover" loading="lazy" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end justify-between p-1 opacity-0 group-hover:opacity-100">
                          <span className="text-[9px] text-white font-medium">{format(new Date(msg.created_at), 'dd/MM/yy')}</span>
                          <Download className="h-3.5 w-3.5 text-white" />
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="videos" className="mt-0 space-y-2">
                {videos.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum vídeo</p>
                ) : (
                  videos.map(msg => (
                    <div key={msg.id} className="rounded-lg overflow-hidden border">
                      <video controls className="w-full max-h-[200px]" preload="none">
                        <source src={msg.media_url!} type={msg.media_type || 'video/mp4'} />
                      </video>
                      <div className="flex items-center justify-between px-2 py-1 bg-muted/50">
                        <span className="text-[10px] text-muted-foreground">{format(new Date(msg.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}</span>
                        <a href={msg.media_url!} download target="_blank" rel="noopener noreferrer"><Download className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" /></a>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="audios" className="mt-0 space-y-2">
                {audios.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum áudio</p>
                ) : (
                  audios.map(msg => (
                    <div key={msg.id} className="flex items-center gap-2 p-2 rounded-lg border bg-card">
                      <audio controls className="flex-1 h-8" preload="none">
                        <source src={msg.media_url!} type={msg.media_type || 'audio/ogg'} />
                      </audio>
                      <span className="text-[10px] text-muted-foreground shrink-0">{format(new Date(msg.created_at), "dd/MM HH:mm")}</span>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="docs" className="mt-0 space-y-2">
                {docs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum documento</p>
                ) : (
                  docs.map(msg => (
                    <a key={msg.id} href={msg.media_url!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                      <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{msg.message_text || msg.media_type || 'Documento'}</p>
                        <p className="text-[10px] text-muted-foreground">{format(new Date(msg.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}</p>
                      </div>
                      <Download className="h-4 w-4 text-muted-foreground shrink-0" />
                    </a>
                  ))
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}
