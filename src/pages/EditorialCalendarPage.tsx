import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { EditorialCalendar } from "@/components/editorial/EditorialCalendar";

export default function EditorialCalendarPage() {
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
                Gerencie e planeje seus conteúdos orgânicos
              </p>
            </div>
          </div>
        </div>

        {/* Calendar Component */}
        <EditorialCalendar />
      </div>
    </div>
  );
}
