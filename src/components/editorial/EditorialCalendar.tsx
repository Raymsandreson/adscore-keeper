import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus,
  Instagram,
  Facebook,
  Filter
} from "lucide-react";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PostDialog } from "./PostDialog";
import { PostDetailSheet } from "./PostDetailSheet";

export interface Post {
  id: string;
  title: string;
  description?: string;
  platform: "instagram" | "facebook";
  status: "draft" | "scheduled" | "published" | "failed";
  scheduled_date: Date;
  scheduled_time: string;
  content_type: "image" | "video" | "carousel" | "reels" | "story";
  assigned_to?: string;
  hashtags?: string[];
  notes?: string;
  engagement_likes?: number;
  engagement_comments?: number;
  engagement_shares?: number;
  engagement_reach?: number;
}

const statusColors = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  published: "bg-green-500/20 text-green-400 border-green-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

const statusLabels = {
  draft: "Rascunho",
  scheduled: "Agendado",
  published: "Publicado",
  failed: "Falhou",
};

const platformIcons = {
  instagram: Instagram,
  facebook: Facebook,
};

const platformColors = {
  instagram: "text-pink-500",
  facebook: "text-blue-500",
};

interface EditorialCalendarProps {
  posts: Post[];
  onAddPost: (post: Partial<Post>) => void;
  onUpdatePost: (postId: string, post: Partial<Post>) => void;
  onDeletePost: (postId: string) => void;
}

export function EditorialCalendar({ posts, onAddPost, onUpdatePost, onDeletePost }: EditorialCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 0, 1));
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      if (platformFilter !== "all" && post.platform !== platformFilter) return false;
      if (statusFilter !== "all" && post.status !== statusFilter) return false;
      return true;
    });
  }, [posts, platformFilter, statusFilter]);

  const getPostsForDay = (day: Date) => {
    return filteredPosts.filter(post => isSameDay(post.scheduled_date, day));
  };

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const handlePostClick = (post: Post) => {
    setSelectedPost(post);
    setIsDetailSheetOpen(true);
  };

  const handleNewPost = (date?: Date) => {
    setSelectedPost(date ? { scheduled_date: date } as Post : null);
    setIsPostDialogOpen(true);
  };

  const handleSavePost = (postData: Partial<Post>) => {
    if (selectedPost?.id) {
      onUpdatePost(selectedPost.id, postData);
    } else {
      onAddPost(postData);
    }
    setIsPostDialogOpen(false);
    setSelectedPost(null);
  };

  const handleDeletePost = (postId: string) => {
    onDeletePost(postId);
    setIsDetailSheetOpen(false);
    setSelectedPost(null);
  };

  // Calculate stats
  const stats = useMemo(() => {
    const monthPosts = posts.filter(p => isSameMonth(p.scheduled_date, currentDate));
    return {
      total: monthPosts.length,
      published: monthPosts.filter(p => p.status === "published").length,
      scheduled: monthPosts.filter(p => p.status === "scheduled").length,
      draft: monthPosts.filter(p => p.status === "draft").length,
      totalReach: monthPosts.reduce((acc, p) => acc + (p.engagement_reach || 0), 0),
      totalEngagement: monthPosts.reduce((acc, p) => 
        acc + (p.engagement_likes || 0) + (p.engagement_comments || 0) + (p.engagement_shares || 0), 0
      ),
    };
  }, [posts, currentDate]);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Posts no Mês</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Publicados</p>
            <p className="text-2xl font-bold text-green-400">{stats.published}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Alcance Total</p>
            <p className="text-2xl font-bold">{(stats.totalReach / 1000).toFixed(1)}k</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Engajamento</p>
            <p className="text-2xl font-bold">{(stats.totalEngagement / 1000).toFixed(1)}k</p>
          </CardContent>
        </Card>
      </div>

      {/* Calendar Card */}
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div className="flex items-center gap-4">
            <CardTitle className="text-xl">Calendário Editorial</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={handlePrevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-lg font-medium min-w-[180px] text-center capitalize">
                {format(currentDate, "MMMM yyyy", { locale: ptBR })}
              </span>
              <Button variant="ghost" size="icon" onClick={handleNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Plataforma" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="scheduled">Agendado</SelectItem>
                <SelectItem value="published">Publicado</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => handleNewPost()} className="gap-2">
              <Plus className="h-4 w-4" />
              Novo Post
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Day names header */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(day => (
              <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, idx) => {
              const dayPosts = getPostsForDay(day);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const isToday = isSameDay(day, new Date(2026, 0, 8)); // Mock "today"

              return (
                <div
                  key={idx}
                  className={cn(
                    "min-h-[120px] p-2 rounded-lg border border-border/30 transition-colors",
                    isCurrentMonth ? "bg-background/50" : "bg-muted/20 opacity-50",
                    isToday && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn(
                      "text-sm font-medium",
                      isToday && "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center"
                    )}>
                      {format(day, "d")}
                    </span>
                    {isCurrentMonth && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5 opacity-0 hover:opacity-100 transition-opacity"
                        onClick={() => handleNewPost(day)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {dayPosts.slice(0, 3).map(post => {
                      const PlatformIcon = platformIcons[post.platform];
                      return (
                        <div
                          key={post.id}
                          onClick={() => handlePostClick(post)}
                          className={cn(
                            "text-xs p-1.5 rounded cursor-pointer transition-all hover:scale-[1.02]",
                            statusColors[post.status]
                          )}
                        >
                          <div className="flex items-center gap-1">
                            <PlatformIcon className={cn("h-3 w-3", platformColors[post.platform])} />
                            <span className="truncate flex-1">{post.title}</span>
                          </div>
                        </div>
                      );
                    })}
                    {dayPosts.length > 3 && (
                      <div className="text-xs text-muted-foreground text-center">
                        +{dayPosts.length - 3} mais
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border/30">
            <span className="text-sm text-muted-foreground">Legenda:</span>
            {Object.entries(statusLabels).map(([key, label]) => (
              <Badge key={key} variant="outline" className={statusColors[key as keyof typeof statusColors]}>
                {label}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <PostDialog
        open={isPostDialogOpen}
        onOpenChange={setIsPostDialogOpen}
        post={selectedPost}
        onSave={handleSavePost}
      />

      <PostDetailSheet
        open={isDetailSheetOpen}
        onOpenChange={setIsDetailSheetOpen}
        post={selectedPost}
        onEdit={() => {
          setIsDetailSheetOpen(false);
          setIsPostDialogOpen(true);
        }}
        onDelete={handleDeletePost}
      />
    </div>
  );
}
