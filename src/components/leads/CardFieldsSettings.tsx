import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RotateCcw, LayoutGrid, Phone, Mail, Tag, DollarSign, UserCheck, Users, Calendar, Cloud, MapPin } from 'lucide-react';
import { CardFieldsConfig } from '@/hooks/useCardFieldsSettings';

interface CardFieldsSettingsProps {
  config: CardFieldsConfig;
  onUpdateField: (field: keyof CardFieldsConfig, value: boolean) => void;
  onReset: () => void;
}

const FIELD_OPTIONS: { key: keyof CardFieldsConfig; label: string; icon: React.ReactNode }[] = [
  { key: 'phone', label: 'Telefone', icon: <Phone className="h-4 w-4" /> },
  { key: 'email', label: 'Email', icon: <Mail className="h-4 w-4" /> },
  { key: 'campaign', label: 'Campanha', icon: <Tag className="h-4 w-4" /> },
  { key: 'conversionValue', label: 'Valor da Conversão', icon: <DollarSign className="h-4 w-4" /> },
  { key: 'followerBadge', label: 'Badge de Seguidor', icon: <UserCheck className="h-4 w-4" /> },
  { key: 'classification', label: 'Classificação do Cliente', icon: <Users className="h-4 w-4" /> },
  { key: 'createdAt', label: 'Data de Criação', icon: <Calendar className="h-4 w-4" /> },
  { key: 'syncStatus', label: 'Status de Sincronização', icon: <Cloud className="h-4 w-4" /> },
  { key: 'state', label: 'Estado (UF)', icon: <MapPin className="h-4 w-4" /> },
  { key: 'city', label: 'Cidade', icon: <MapPin className="h-4 w-4" /> },
];

export function CardFieldsSettings({ config, onUpdateField, onReset }: CardFieldsSettingsProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Campos Visíveis nos Cards</CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Restaurar Padrão
          </Button>
        </div>
        <CardDescription>
          Escolha quais informações serão exibidas nos cards do pipeline de leads
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELD_OPTIONS.map((field) => (
            <div
              key={field.key}
              className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="text-muted-foreground">{field.icon}</div>
                <Label htmlFor={field.key} className="cursor-pointer font-medium">
                  {field.label}
                </Label>
              </div>
              <Switch
                id={field.key}
                checked={config[field.key]}
                onCheckedChange={(checked) => onUpdateField(field.key, checked)}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
