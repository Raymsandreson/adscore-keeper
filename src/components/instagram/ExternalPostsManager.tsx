import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Search,
  RefreshCw,
  Filter,
  ExternalLink,
  Loader2,
  Link2,
  FileText,
} from 'lucide-react';
import { useExternalPosts } from '@/hooks/useExternalPosts';
import { ExternalPostCard } from './ExternalPostCard';
import { ExternalPostDialog } from './ExternalPostDialog';
import { LinkLeadToPostDialog } from './LinkLeadToPostDialog';

export function ExternalPostsManager() {
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [leadFilter, setLeadFilter] = useState<string>('all');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [linkLeadDialogOpen, setLinkLeadDialogOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  const hasLeadFilter = leadFilter === 'with' ? true : leadFilter === 'without' ? false : null;

  const { posts, isLoading, fetchPosts, addPost, deletePost, linkToLead, addNewsLink, removeNewsLink, updatePost, fetchCommentsForPost } = useExternalPosts({
    platform: platformFilter,
    hasLead: hasLeadFilter,
    searchTerm,
  });

  const handleAddPost = async (url: string, platform: string) => {
    const result = await addPost(url, platform);
    if (result) {
      setAddDialogOpen(false);
    }
  };

  const handleLinkLead = (postId: string) => {
    setSelectedPostId(postId);
    setLinkLeadDialogOpen(true);
  };

  const handleLeadLinked = async (leadId: string | null) => {
    if (selectedPostId) {
      await linkToLead(selectedPostId, leadId);
      setLinkLeadDialogOpen(false);
      setSelectedPostId(null);
    }
  };

  const selectedPost = posts.find(p => p.id === selectedPostId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">
              <ExternalLink className="h-5 w-5 text-primary" />
              Posts Externos
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button onClick={() => setAddDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Adicionar Post
              </Button>
              <Button variant="outline" size="sm" onClick={fetchPosts} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por URL, autor ou título..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Plataforma" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="tiktok">TikTok</SelectItem>
                <SelectItem value="other">Outras</SelectItem>
              </SelectContent>
            </Select>
            <Select value={leadFilter} onValueChange={setLeadFilter}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <Link2 className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Lead" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="with">Com Lead</SelectItem>
                <SelectItem value="without">Sem Lead</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{posts.length}</div>
              <div className="text-xs text-muted-foreground">Total Posts</div>
            </div>
            <div className="bg-pink-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-pink-600">
                {posts.filter(p => p.platform === 'instagram').length}
              </div>
              <div className="text-xs text-muted-foreground">Instagram</div>
            </div>
            <div className="bg-green-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-600">
                {posts.filter(p => p.lead_id).length}
              </div>
              <div className="text-xs text-muted-foreground">Com Lead</div>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {posts.reduce((sum, p) => sum + (p.comments_count || 0), 0)}
              </div>
              <div className="text-xs text-muted-foreground">Comentários</div>
            </div>
          </div>

          {/* Posts List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhum post externo encontrado</p>
              <Button variant="outline" className="mt-4" onClick={() => setAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Adicionar primeiro post
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4">
                {posts.map((post) => (
                  <ExternalPostCard
                    key={post.id}
                    post={post}
                    onDelete={() => deletePost(post.id)}
                    onLinkLead={() => handleLinkLead(post.id)}
                    onAddNewsLink={(link) => addNewsLink(post.id, link)}
                    onRemoveNewsLink={(link) => removeNewsLink(post.id, link)}
                    onUpdateNotes={(notes) => updatePost(post.id, { notes })}
                    onFetchComments={() => fetchCommentsForPost(post.url)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Add Post Dialog */}
      <ExternalPostDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSave={handleAddPost}
      />

      {/* Link Lead Dialog */}
      <LinkLeadToPostDialog
        open={linkLeadDialogOpen}
        onOpenChange={setLinkLeadDialogOpen}
        currentLeadId={selectedPost?.lead_id || null}
        postUrl={selectedPost?.url || ''}
        onLink={handleLeadLinked}
      />
    </div>
  );
}
