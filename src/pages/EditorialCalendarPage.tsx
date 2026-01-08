import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, CalendarDays, BarChart3 } from "lucide-react";
import { EditorialCalendar } from "@/components/editorial/EditorialCalendar";
import { OrganicPaidCorrelation } from "@/components/editorial/OrganicPaidCorrelation";
import { useEditorialPosts } from "@/hooks/useEditorialPosts";

export default function EditorialCalendarPage() {
  const { posts, addPost, updatePost, deletePost } = useEditorialPosts();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Calendário Editorial</h1>
              <p className="text-muted-foreground">
                Gerencie conteúdos orgânicos e veja o impacto no tráfego pago
              </p>
            </div>
          </div>
        </div>

        {/* Tabs: Calendário / Correlação */}
        <Tabs defaultValue="calendar" className="w-full">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2">
            <TabsTrigger value="calendar" className="gap-2">
              <CalendarDays className="h-4 w-4" />
              Calendário
            </TabsTrigger>
            <TabsTrigger value="correlation" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Correlação Pago
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="mt-6">
            <EditorialCalendar 
              posts={posts}
              onAddPost={addPost}
              onUpdatePost={updatePost}
              onDeletePost={deletePost}
            />
          </TabsContent>

          <TabsContent value="correlation" className="mt-6">
            <OrganicPaidCorrelation posts={posts} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
