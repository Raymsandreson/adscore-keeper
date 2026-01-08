import { useState, useMemo, useCallback } from "react";
import type { Post, Platform } from "@/types/editorial";

// Mock data for demonstration
const initialMockPosts: Post[] = [
  {
    id: "1",
    title: "Lançamento Nova Coleção",
    description: "Post sobre a nova coleção de verão com foco em sustentabilidade",
    platform: "instagram",
    status: "published",
    scheduled_date: new Date(2026, 0, 5),
    scheduled_time: "10:00",
    content_type: "carousel",
    assigned_to: "Maria Silva",
    hashtags: ["novacoleção", "verão2026", "sustentável"],
    tags: [{ id: "1", label: "Post", color: "bg-blue-500" }],
    engagement_likes: 1250,
    engagement_comments: 89,
    engagement_shares: 45,
    engagement_reach: 15000,
  },
  {
    id: "2",
    title: "Dicas de Styling",
    description: "Vídeo com 5 formas de usar a peça coringa",
    platform: "tiktok",
    status: "scheduled",
    scheduled_date: new Date(2026, 0, 8),
    scheduled_time: "18:00",
    content_type: "video",
    assigned_to: "João Costa",
    hashtags: ["styling", "moda", "dicas"],
    tags: [{ id: "3", label: "Reels", color: "bg-pink-500" }],
  },
  {
    id: "3",
    title: "Bastidores da Produção",
    description: "Story mostrando o processo de criação",
    platform: "instagram",
    status: "draft",
    scheduled_date: new Date(2026, 0, 10),
    scheduled_time: "14:00",
    content_type: "story",
    assigned_to: "Ana Oliveira",
  },
  {
    id: "4",
    title: "Promoção de Janeiro",
    description: "Anúncio da promoção especial de janeiro",
    platform: "facebook",
    status: "published",
    scheduled_date: new Date(2026, 0, 3),
    scheduled_time: "09:00",
    content_type: "image",
    assigned_to: "Maria Silva",
    tags: [{ id: "4", label: "Campanha", color: "bg-orange-500" }],
    engagement_likes: 890,
    engagement_comments: 120,
    engagement_shares: 234,
    engagement_reach: 25000,
  },
  {
    id: "5",
    title: "Live de Lançamento",
    description: "Live com influencer parceira para lançamento",
    platform: "youtube",
    status: "scheduled",
    scheduled_date: new Date(2026, 0, 15),
    scheduled_time: "20:00",
    content_type: "live",
    assigned_to: "João Costa",
  },
  {
    id: "6",
    title: "Depoimento Cliente",
    description: "Post com depoimento de cliente satisfeita",
    platform: "kwai",
    status: "draft",
    scheduled_date: new Date(2026, 0, 12),
    scheduled_time: "11:00",
    content_type: "video",
    assigned_to: "Ana Oliveira",
  },
];

export function useEditorialPosts() {
  const [posts, setPosts] = useState<Post[]>(initialMockPosts);

  const addPost = useCallback((postData: Partial<Post>) => {
    const newPost: Post = {
      id: String(Date.now()),
      title: postData.title || "",
      description: postData.description,
      platform: postData.platform || "instagram",
      status: "draft",
      scheduled_date: postData.scheduled_date || new Date(),
      scheduled_time: postData.scheduled_time || "10:00",
      content_type: postData.content_type || "image",
      assigned_to: postData.assigned_to,
      hashtags: postData.hashtags,
      notes: postData.notes,
      links: postData.links,
      tags: postData.tags,
    };
    setPosts(prev => [...prev, newPost]);
    return newPost;
  }, []);

  const updatePost = useCallback((postId: string, postData: Partial<Post>) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...postData } : p));
  }, []);

  const deletePost = useCallback((postId: string) => {
    setPosts(prev => prev.filter(p => p.id !== postId));
  }, []);

  const stats = useMemo(() => {
    const published = posts.filter(p => p.status === "published");
    return {
      total: posts.length,
      published: published.length,
      scheduled: posts.filter(p => p.status === "scheduled").length,
      draft: posts.filter(p => p.status === "draft").length,
      totalReach: published.reduce((acc, p) => acc + (p.engagement_reach || 0), 0),
      totalEngagement: published.reduce((acc, p) => 
        acc + (p.engagement_likes || 0) + (p.engagement_comments || 0) + (p.engagement_shares || 0), 0
      ),
    };
  }, [posts]);

  return {
    posts,
    addPost,
    updatePost,
    deletePost,
    stats,
  };
}
