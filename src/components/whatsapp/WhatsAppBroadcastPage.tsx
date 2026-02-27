import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Megaphone, ArrowLeft } from 'lucide-react';
import { BroadcastListManager } from './BroadcastListManager';
import { WhatsAppCampaignManager } from './WhatsAppCampaignManager';

export function WhatsAppBroadcastPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-screen flex flex-col">
      <div className="flex items-center gap-3 p-4 border-b bg-card shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <h1 className="text-lg font-semibold">Transmissão & Campanhas</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <Tabs defaultValue="lists" className="w-full max-w-2xl mx-auto">
          <TabsList className="w-full">
            <TabsTrigger value="lists" className="flex-1">
              <Users className="h-4 w-4 mr-1.5" /> Listas
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="flex-1">
              <Megaphone className="h-4 w-4 mr-1.5" /> Campanhas
            </TabsTrigger>
          </TabsList>
          <TabsContent value="lists" className="mt-4">
            <BroadcastListManager />
          </TabsContent>
          <TabsContent value="campaigns" className="mt-4">
            <WhatsAppCampaignManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
