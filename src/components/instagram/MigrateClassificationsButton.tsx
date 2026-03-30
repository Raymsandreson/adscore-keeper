import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export const MigrateClassificationsButton = () => {
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<{
    migrated: number;
    created: number;
    updated: number;
    errors: number;
  } | null>(null);

  const handleMigrate = async () => {
    setMigrating(true);
    setResult(null);

    try {
      const { data, error } = await cloudFunctions.invoke("migrate-classifications");

      if (error) {
        throw error;
      }

      if (data?.success) {
        setResult({
          migrated: data.migrated,
          created: data.created,
          updated: data.updated,
          errors: data.errors,
        });
        toast.success(`Migração concluída! ${data.migrated} registros processados.`);
      } else {
        throw new Error(data?.error || "Erro desconhecido");
      }
    } catch (error: any) {
      console.error("Migration error:", error);
      toast.error(`Erro na migração: ${error.message}`);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        onClick={handleMigrate}
        disabled={migrating}
        variant="outline"
        className="gap-2"
      >
        {migrating ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        {migrating ? "Migrando..." : "Migrar Classificações Legadas"}
      </Button>

      {result && (
        <div className="text-sm bg-muted p-3 rounded-md space-y-1">
          <p className="font-medium text-foreground">Resultado da migração:</p>
          <ul className="text-muted-foreground space-y-0.5">
            <li>✓ Total processado: {result.migrated}</li>
            <li>✓ Contatos criados: {result.created}</li>
            <li>✓ Contatos atualizados: {result.updated}</li>
            {result.errors > 0 && (
              <li className="text-destructive">✗ Erros: {result.errors}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
