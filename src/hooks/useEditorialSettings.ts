import { useState, useCallback } from "react";
import type { PostTag, PostStatus } from "@/types/editorial";

interface StatusConfig {
  label: string;
  className: string;
}

const defaultStatusConfig: Record<PostStatus, StatusConfig> = {
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Agendado", className: "bg-blue-500/20 text-blue-600 border-blue-500/30" },
  published: { label: "Publicado", className: "bg-green-500/20 text-green-600 border-green-500/30" },
  failed: { label: "Falhou", className: "bg-red-500/20 text-red-600 border-red-500/30" },
};

const defaultTags: PostTag[] = [
  { id: "1", label: "Post", color: "bg-blue-500" },
  { id: "2", label: "Story", color: "bg-purple-500" },
  { id: "3", label: "Reels", color: "bg-pink-500" },
  { id: "4", label: "Campanha", color: "bg-orange-500" },
  { id: "5", label: "Orgânico", color: "bg-green-500" },
  { id: "6", label: "Patrocinado", color: "bg-yellow-500" },
];

export function useEditorialSettings() {
  const [statusConfig, setStatusConfig] = useState<Record<PostStatus, StatusConfig>>(defaultStatusConfig);
  const [tags, setTags] = useState<PostTag[]>(defaultTags);

  const updateStatusLabel = useCallback((status: PostStatus, label: string) => {
    setStatusConfig(prev => ({
      ...prev,
      [status]: { ...prev[status], label },
    }));
  }, []);

  const addTag = useCallback((label: string, color: string) => {
    const newTag: PostTag = {
      id: String(Date.now()),
      label,
      color,
    };
    setTags(prev => [...prev, newTag]);
    return newTag;
  }, []);

  const updateTag = useCallback((id: string, updates: Partial<PostTag>) => {
    setTags(prev => prev.map(tag => 
      tag.id === id ? { ...tag, ...updates } : tag
    ));
  }, []);

  const deleteTag = useCallback((id: string) => {
    setTags(prev => prev.filter(tag => tag.id !== id));
  }, []);

  return {
    statusConfig,
    tags,
    updateStatusLabel,
    addTag,
    updateTag,
    deleteTag,
  };
}
