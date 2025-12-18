import { useState } from "react";
import { AdCreativeData } from "@/services/metaAPI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ThumbsUp, 
  MessageCircle, 
  Share2, 
  MoreHorizontal,
  Globe,
  Heart,
  Bookmark,
  Send,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

interface AdFeedPreviewProps {
  creative: AdCreativeData;
  pageName?: string;
  isEditing?: boolean;
  editedCreative?: {
    title: string;
    body: string;
    linkDescription: string;
    callToActionType: string;
  };
}

const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: "Saiba mais",
  SHOP_NOW: "Comprar agora",
  SIGN_UP: "Cadastre-se",
  SUBSCRIBE: "Assinar",
  CONTACT_US: "Fale conosco",
  GET_OFFER: "Obter oferta",
  GET_QUOTE: "Solicitar orçamento",
  DOWNLOAD: "Baixar",
  BOOK_TRAVEL: "Reservar",
  WATCH_MORE: "Assistir mais",
  APPLY_NOW: "Candidatar-se",
  BUY_NOW: "Comprar",
  GET_DIRECTIONS: "Ver direções",
  MESSAGE_PAGE: "Enviar mensagem",
  WHATSAPP_MESSAGE: "WhatsApp",
  CALL_NOW: "Ligar agora",
  INSTALL_APP: "Instalar",
  USE_APP: "Usar app",
  PLAY_GAME: "Jogar",
  LISTEN_NOW: "Ouvir agora",
  ORDER_NOW: "Pedir agora",
};

export const AdFeedPreview = ({ 
  creative, 
  pageName = "Sua Página",
  isEditing = false,
  editedCreative
}: AdFeedPreviewProps) => {
  const [activePreview, setActivePreview] = useState<"facebook" | "instagram">("facebook");
  
  const displayBody = isEditing && editedCreative?.body 
    ? editedCreative.body 
    : creative.body || creative.object_story_spec?.link_data?.message || "";
  
  const displayTitle = isEditing && editedCreative?.title 
    ? editedCreative.title 
    : creative.title || "";
  
  const displayLinkDescription = isEditing && editedCreative?.linkDescription 
    ? editedCreative.linkDescription 
    : creative.link_description || "";
  
  const displayCTA = isEditing && editedCreative?.callToActionType 
    ? editedCreative.callToActionType 
    : creative.call_to_action_type || "LEARN_MORE";

  const ctaLabel = CTA_LABELS[displayCTA] || displayCTA.replace(/_/g, " ");

  return (
    <div className="space-y-3">
      {/* Preview Toggle */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant={activePreview === "facebook" ? "default" : "outline"}
          size="sm"
          onClick={() => setActivePreview("facebook")}
          className="text-xs"
        >
          Facebook
        </Button>
        <Button
          variant={activePreview === "instagram" ? "default" : "outline"}
          size="sm"
          onClick={() => setActivePreview("instagram")}
          className="text-xs"
        >
          Instagram
        </Button>
      </div>

      {activePreview === "facebook" ? (
        /* Facebook Feed Preview */
        <div className="bg-background border rounded-lg overflow-hidden shadow-sm max-w-[320px] mx-auto">
          {/* Header */}
          <div className="p-3 flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
              {pageName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1">
                <span className="font-semibold text-sm">{pageName}</span>
                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                  Patrocinado
                </Badge>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Globe className="h-3 w-3" />
                <span>Público</span>
              </div>
            </div>
            <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
          </div>

          {/* Post Text */}
          {displayBody && (
            <div className="px-3 pb-2">
              <p className="text-sm whitespace-pre-wrap line-clamp-3">
                {displayBody}
              </p>
            </div>
          )}

          {/* Image Placeholder */}
          <div className="aspect-square bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center relative">
            {creative.image_url ? (
              <img 
                src={creative.image_url} 
                alt="Ad preview" 
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center text-muted-foreground p-4">
                <div className="w-16 h-16 mx-auto mb-2 rounded-lg bg-muted-foreground/20 flex items-center justify-center">
                  <span className="text-2xl">🖼️</span>
                </div>
                <p className="text-xs">Imagem do anúncio</p>
              </div>
            )}
          </div>

          {/* Link Preview Card */}
          <div className="bg-muted/50 p-3 border-t">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">seusite.com.br</p>
            <p className="font-semibold text-sm line-clamp-2">{displayTitle || "Título do anúncio"}</p>
            {displayLinkDescription && (
              <p className="text-xs text-muted-foreground line-clamp-1">{displayLinkDescription}</p>
            )}
            <Button size="sm" className="mt-2 w-full text-xs h-8">
              {ctaLabel}
            </Button>
          </div>

          {/* Reactions */}
          <div className="px-3 py-2 border-t flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="flex -space-x-1">
                <span className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center text-[8px]">👍</span>
                <span className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[8px]">❤️</span>
              </div>
              <span>1,2 mil</span>
            </div>
            <span>234 comentários · 56 compartilhamentos</span>
          </div>

          {/* Actions */}
          <div className="px-3 py-2 border-t flex items-center justify-around">
            <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
              <ThumbsUp className="h-4 w-4" />
              <span className="text-xs">Curtir</span>
            </button>
            <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
              <MessageCircle className="h-4 w-4" />
              <span className="text-xs">Comentar</span>
            </button>
            <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
              <Share2 className="h-4 w-4" />
              <span className="text-xs">Compartilhar</span>
            </button>
          </div>
        </div>
      ) : (
        /* Instagram Feed Preview */
        <div className="bg-background border rounded-lg overflow-hidden shadow-sm max-w-[320px] mx-auto">
          {/* Header */}
          <div className="p-3 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 via-red-500 to-yellow-500 p-0.5">
              <div className="w-full h-full rounded-full bg-background flex items-center justify-center">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-xs">
                  {pageName.charAt(0).toUpperCase()}
                </div>
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1">
                <span className="font-semibold text-sm">{pageName.toLowerCase().replace(/\s/g, "")}</span>
                <span className="text-[10px] text-muted-foreground">• Patrocinado</span>
              </div>
            </div>
            <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
          </div>

          {/* Image */}
          <div className="aspect-square bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center relative">
            {creative.image_url ? (
              <img 
                src={creative.image_url} 
                alt="Ad preview" 
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center text-muted-foreground p-4">
                <div className="w-16 h-16 mx-auto mb-2 rounded-lg bg-muted-foreground/20 flex items-center justify-center">
                  <span className="text-2xl">🖼️</span>
                </div>
                <p className="text-xs">Imagem do anúncio</p>
              </div>
            )}
            {/* Carousel indicators */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-white" />
              <div className="w-1.5 h-1.5 rounded-full bg-white/50" />
              <div className="w-1.5 h-1.5 rounded-full bg-white/50" />
            </div>
            <button className="absolute left-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 flex items-center justify-center">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 flex items-center justify-center">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* CTA Button */}
          <div className="px-3 py-2 border-t bg-muted/30">
            <Button size="sm" className="w-full text-xs h-8">
              {ctaLabel}
            </Button>
          </div>

          {/* Actions */}
          <div className="px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Heart className="h-6 w-6" />
              <MessageCircle className="h-6 w-6" />
              <Send className="h-6 w-6" />
            </div>
            <Bookmark className="h-6 w-6" />
          </div>

          {/* Likes */}
          <div className="px-3 pb-1">
            <span className="font-semibold text-sm">1.234 curtidas</span>
          </div>

          {/* Caption */}
          <div className="px-3 pb-3">
            <p className="text-sm">
              <span className="font-semibold">{pageName.toLowerCase().replace(/\s/g, "")}</span>{" "}
              <span className="whitespace-pre-wrap line-clamp-2">{displayBody}</span>
            </p>
            {displayBody && displayBody.length > 80 && (
              <button className="text-muted-foreground text-sm">mais</button>
            )}
          </div>
        </div>
      )}

      <p className="text-center text-[10px] text-muted-foreground">
        Preview simulado • Aparência real pode variar
      </p>
    </div>
  );
};