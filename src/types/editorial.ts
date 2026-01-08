export type Platform = "instagram" | "tiktok" | "facebook" | "kwai" | "youtube";
export type PostStatus = "draft" | "scheduled" | "published" | "failed";
export type ContentType = "image" | "video" | "carousel" | "reels" | "story" | "shorts" | "live";

export interface PostTag {
  id: string;
  label: string;
  color: string;
}

export interface PostFile {
  id: string;
  name: string;
  url: string;
  type: "image" | "video" | "document";
}

export interface Post {
  id: string;
  title: string;
  description?: string;
  platform: Platform;
  status: PostStatus;
  scheduled_date: Date;
  scheduled_time: string;
  content_type: ContentType;
  assigned_to?: string;
  hashtags?: string[];
  notes?: string;
  links?: string[];
  files?: PostFile[];
  tags?: PostTag[];
  engagement_likes?: number;
  engagement_comments?: number;
  engagement_shares?: number;
  engagement_reach?: number;
}

export const platformConfig: Record<Platform, { label: string; color: string; bgColor: string }> = {
  instagram: { label: "Instagram", color: "text-pink-500", bgColor: "bg-pink-500/20" },
  tiktok: { label: "TikTok", color: "text-slate-900 dark:text-white", bgColor: "bg-slate-900/20 dark:bg-white/20" },
  facebook: { label: "Facebook", color: "text-blue-600", bgColor: "bg-blue-600/20" },
  kwai: { label: "Kwai", color: "text-orange-500", bgColor: "bg-orange-500/20" },
  youtube: { label: "YouTube", color: "text-red-600", bgColor: "bg-red-600/20" },
};

export const statusConfig: Record<PostStatus, { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Agendado", className: "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  published: { label: "Publicado", className: "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30" },
  failed: { label: "Falhou", className: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30" },
};

export const contentTypeConfig: Record<ContentType, string> = {
  image: "Imagem",
  video: "Vídeo",
  carousel: "Carrossel",
  reels: "Reels",
  story: "Story",
  shorts: "Shorts",
  live: "Live",
};

export const defaultTags: PostTag[] = [
  { id: "1", label: "Post", color: "bg-blue-500" },
  { id: "2", label: "Story", color: "bg-purple-500" },
  { id: "3", label: "Reels", color: "bg-pink-500" },
  { id: "4", label: "Campanha", color: "bg-orange-500" },
  { id: "5", label: "Orgânico", color: "bg-green-500" },
  { id: "6", label: "Patrocinado", color: "bg-yellow-500" },
];
