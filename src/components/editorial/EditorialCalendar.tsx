import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus,
  Filter,
  GripVertical,
  Settings
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
import { PlatformIcon } from "./PlatformIcon";
import { SettingsDialog } from "./SettingsDialog";
import { useEditorialSettings } from "@/hooks/useEditorialSettings";

import type { Post, Platform, PostStatus, PostTag, ChecklistItemStatus } from "@/types/editorial";
import { platformConfig, defaultChecklistStatusConfig } from "@/types/editorial";

// Re-export Post type for backward compatibility
export type { Post } from "@/types/editorial";

interface EditorialCalendarProps {
  posts: Post[];
  onAddPost: (post: Partial<Post>) => Post;
  onUpdatePost: (postId: string, post: Partial<Post>) => void;
  onDeletePost: (postId: string) => void;
}

export function EditorialCalendar({ posts, onAddPost, onUpdatePost, onDeletePost }: EditorialCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 0, 1));
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activePlatformTab, setActivePlatformTab] = useState<string>("all");
  const [draggedPost, setDraggedPost] = useState<Post | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [checklistStatusFilter, setChecklistStatusFilter] = useState<ChecklistItemStatus | "all">("all");
  
  const { statusConfig, tags, checklistStatusConfig, updateStatusLabel, updateChecklistStatusLabel, addTag, updateTag, deleteTag } = useEditorialSettings();

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      if (activePlatformTab !== "all" && post.platform !== activePlatformTab) return false;
      if (platformFilter !== "all" && post.platform !== platformFilter) return false;
      if (statusFilter !== "all" && post.status !== statusFilter) return false;
      
      // Filtro por status do checklist
      if (checklistStatusFilter !== "all") {
        if (!post.checklist || post.checklist.length === 0) return false;
        const hasMatchingItem = post.checklist.some(item => item.status === checklistStatusFilter);
        if (!hasMatchingItem) return false;
      }
      
      return true;
    });
  }, [posts, platformFilter, statusFilter, activePlatformTab, checklistStatusFilter]);

  const getPostsForDay = useCallback((day: Date) => {
    return filteredPosts.filter(post => isSameDay(post.scheduled_date, day));
  }, [filteredPosts]);

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const handlePostClick = (post: Post, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedPost(post);
    setIsDetailSheetOpen(true);
  };

  const handleDayClick = (day: Date) => {
    if (!isSameMonth(day, currentDate)) return;
    setSelectedDate(day);
    setSelectedPost({ scheduled_date: day } as Post);
    setIsPostDialogOpen(true);
  };

  const handleNewPost = (date?: Date) => {
    setSelectedDate(date || null);
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
    setSelectedDate(null);
  };

  const handleDeletePost = (postId: string) => {
    onDeletePost(postId);
    setIsDetailSheetOpen(false);
    setSelectedPost(null);
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, post: Post) => {
    setDraggedPost(post);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", post.id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetDate: Date) => {
    e.preventDefault();
    if (draggedPost && !isSameDay(draggedPost.scheduled_date, targetDate)) {
      onUpdatePost(draggedPost.id, { scheduled_date: targetDate });
    }
    setDraggedPost(null);
  };

  const handleDragEnd = () => {
    setDraggedPost(null);
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

  const platforms: Platform[] = ["instagram", "tiktok", "facebook", "kwai", "youtube"];

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
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.published}</p>
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

      {/* Platform Tabs */}
      <Tabs value={activePlatformTab} onValueChange={setActivePlatformTab} className="w-full">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="all" className="gap-2">
              Todas
            </TabsTrigger>
            {platforms.map(platform => (
              <TabsTrigger key={platform} value={platform} className="gap-2">
                <PlatformIcon platform={platform} className="h-4 w-4" />
                <span className="hidden sm:inline">{platformConfig[platform].label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          
        </div>

        {/* Calendar Card */}
        <Card className="bg-card/50 backdrop-blur border-border/50 mt-4">
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
                Nova Atividade
              </Button>
              <Button variant="outline" size="icon" onClick={() => setIsSettingsOpen(true)}>
                <Settings className="h-4 w-4" />
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
                const isToday = isSameDay(day, new Date(2026, 0, 8));

                return (
                  <div
                    key={idx}
                    onClick={() => handleDayClick(day)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, day)}
                    className={cn(
                      "min-h-[120px] p-2 rounded-lg border border-border/30 transition-colors cursor-pointer",
                      isCurrentMonth ? "bg-background/50 hover:bg-muted/50" : "bg-muted/20 opacity-50",
                      isToday && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                      draggedPost && isCurrentMonth && "hover:bg-primary/10"
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
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNewPost(day);
                          }}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {dayPosts.map(post => (
                        <div
                          key={post.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, post)}
                          onDragEnd={handleDragEnd}
                          onClick={(e) => handlePostClick(post, e)}
                          className={cn(
                            "text-xs p-1.5 rounded cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] group/post",
                            statusConfig[post.status]?.className
                          )}
                        >
                          <div className="flex items-center gap-1">
                            <GripVertical className="h-3 w-3 opacity-0 group-hover/post:opacity-50" />
                            <PlatformIcon platform={post.platform} className="h-3 w-3" />
                            <span className="truncate flex-1">{post.title}</span>
                          </div>
                          {post.tags && post.tags.length > 0 && (
                            <div className="flex gap-0.5 mt-0.5 ml-4">
                              {post.tags.slice(0, 2).map(tag => (
                                <span key={tag.id} className={cn("w-2 h-2 rounded-full", tag.color)} />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend - Checklist Status */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border/30 flex-wrap">
              <span className="text-sm text-muted-foreground">Legenda:</span>
              {Object.entries(checklistStatusConfig).map(([status, config]) => (
                <Badge 
                  key={status}
                  variant="outline" 
                  className={cn(
                    "gap-1 text-xs", 
                    config.color, 
                    "text-white border-0"
                  )}
                >
                  {config.label}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </Tabs>

      {/* Dialogs */}
      <PostDialog
        open={isPostDialogOpen}
        onOpenChange={setIsPostDialogOpen}
        post={selectedPost}
        onSave={handleSavePost}
        defaultPlatform={activePlatformTab !== "all" ? activePlatformTab as Platform : undefined}
        availableTags={tags}
        checklistStatusConfig={checklistStatusConfig}
        onAddTag={addTag}
        onUpdateTag={updateTag}
        onDeleteTag={deleteTag}
      />

      <PostDetailSheet
        open={isDetailSheetOpen}
        onOpenChange={setIsDetailSheetOpen}
        post={selectedPost}
        statusConfig={statusConfig}
        onEdit={() => {
          setIsDetailSheetOpen(false);
          setIsPostDialogOpen(true);
        }}
        onDelete={handleDeletePost}
      />

      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        statusConfig={statusConfig}
        tags={tags}
        checklistStatusConfig={checklistStatusConfig}
        onUpdateStatusLabel={updateStatusLabel}
        onUpdateChecklistStatusLabel={updateChecklistStatusLabel}
        onAddTag={addTag}
        onUpdateTag={updateTag}
        onDeleteTag={deleteTag}
      />
    </div>
  );
}
