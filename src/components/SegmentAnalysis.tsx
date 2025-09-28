import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lightbulb, TrendingDown, TrendingUp, ExternalLink, Eye } from "lucide-react";

interface SegmentData {
  id: string;
  name: string;
  cpc: number;
  ctr: number;
  cpm: number;
  conversionRate: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  imageUrl?: string;
  previewUrl?: string;
  type?: 'creative' | 'audience' | 'keyword';
}

interface AIsuggestion {
  type: 'critical' | 'warning' | 'opportunity';
  metric: string;
  suggestion: string;
  impact: string;
}

const SegmentAnalysis = () => {
  const [selectedSegment, setSelectedSegment] = useState<SegmentData | null>(null);

  // Dados simulados de criativos
  const creativeData: SegmentData[] = [
    {
      id: "creative_1",
      name: "Vídeo Promocional - Black Friday",
      cpc: 2.35,
      ctr: 1.8,
      cpm: 28.50,
      conversionRate: 2.1,
      spend: 1250.00,
      impressions: 43850,
      clicks: 789,
      conversions: 17,
      imageUrl: "https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?w=300&h=200&fit=crop",
      previewUrl: "https://facebook.com/ads/library/preview/123456",
      type: 'creative'
    },
    {
      id: "creative_2", 
      name: "Carrossel de Produtos",
      cpc: 1.89,
      ctr: 2.4,
      cpm: 22.10,
      conversionRate: 3.2,
      spend: 980.50,
      impressions: 44350,
      clicks: 1065,
      conversions: 34,
      imageUrl: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=300&h=200&fit=crop",
      previewUrl: "https://facebook.com/ads/library/preview/234567",
      type: 'creative'
    },
    {
      id: "creative_3",
      name: "Story Interativo",
      cpc: 3.20,
      ctr: 1.2,
      cpm: 35.80,
      conversionRate: 1.5,
      spend: 450.00,
      impressions: 12580,
      clicks: 151,
      conversions: 2,
      imageUrl: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=300&h=200&fit=crop",
      previewUrl: "https://facebook.com/ads/library/preview/345678",
      type: 'creative'
    },
    {
      id: "creative_4",
      name: "Vídeo Testemunhal",
      cpc: 1.65,
      ctr: 3.1,
      cpm: 19.80,
      conversionRate: 4.8,
      spend: 2150.00,
      impressions: 108590,
      clicks: 3366,
      conversions: 162,
      imageUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=300&h=200&fit=crop",
      previewUrl: "https://facebook.com/ads/library/preview/456789",
      type: 'creative'
    },
    {
      id: "creative_5",
      name: "Imagem Estática - Desconto",
      cpc: 2.95,
      ctr: 1.4,
      cpm: 31.20,
      conversionRate: 1.9,
      spend: 680.00,
      impressions: 21795,
      clicks: 305,
      conversions: 6,
      imageUrl: "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=300&h=200&fit=crop",
      previewUrl: "https://facebook.com/ads/library/preview/567890",
      type: 'creative'
    },
    {
      id: "creative_6",
      name: "GIF Animado - Produto",
      cpc: 2.20,
      ctr: 2.6,
      cpm: 25.40,
      conversionRate: 3.7,
      spend: 1540.00,
      impressions: 60630,
      clicks: 1576,
      conversions: 58,
      imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&h=200&fit=crop",
      previewUrl: "https://facebook.com/ads/library/preview/678901",
      type: 'creative'
    }
  ];

  // Dados simulados de públicos
  const audienceData: SegmentData[] = [
    {
      id: "audience_1",
      name: "Lookalike 1% - Compradores",
      cpc: 1.95,
      ctr: 2.8,
      cpm: 18.40,
      conversionRate: 4.1,
      spend: 2100.00,
      impressions: 114130,
      clicks: 3195,
      conversions: 131,
      type: 'audience'
    },
    {
      id: "audience_2",
      name: "Interesses - Moda Feminina 25-45",
      cpc: 2.15,
      ctr: 2.1,
      cpm: 24.80,
      conversionRate: 2.8,
      spend: 1580.30,
      impressions: 63720,
      clicks: 1338,
      conversions: 37,
      type: 'audience'
    },
    {
      id: "audience_3",
      name: "Remarketing - Visitantes 30d",
      cpc: 1.25,
      ctr: 3.5,
      cpm: 12.90,
      conversionRate: 5.2,
      spend: 890.00,
      impressions: 68992,
      clicks: 2415,
      conversions: 125,
      type: 'audience'
    },
    {
      id: "audience_4",
      name: "Lookalike 3% - Engajamento",
      cpc: 2.45,
      ctr: 2.2,
      cpm: 26.90,
      conversionRate: 2.6,
      spend: 1320.00,
      impressions: 49070,
      clicks: 1079,
      conversions: 28,
      type: 'audience'
    },
    {
      id: "audience_5",
      name: "Interesses - Beleza e Cuidados",
      cpc: 1.80,
      ctr: 3.2,
      cpm: 16.50,
      conversionRate: 3.9,
      spend: 1650.00,
      impressions: 100000,
      clicks: 3200,
      conversions: 125,
      type: 'audience'
    },
    {
      id: "audience_6",
      name: "Custom - Base de Leads",
      cpc: 1.35,
      ctr: 4.1,
      cpm: 14.20,
      conversionRate: 6.8,
      spend: 950.00,
      impressions: 66900,
      clicks: 2743,
      conversions: 187,
      type: 'audience'
    },
    {
      id: "audience_7",
      name: "Comportamental - Compras Online",
      cpc: 2.65,
      ctr: 1.9,
      cpm: 29.40,
      conversionRate: 2.3,
      spend: 780.00,
      impressions: 26530,
      clicks: 504,
      conversions: 12,
      type: 'audience'
    }
  ];

  // Dados simulados de palavras-chave (para campanhas de busca)
  const keywordData: SegmentData[] = [
    {
      id: "keyword_1",
      name: "vestido feminino",
      cpc: 1.80,
      ctr: 3.2,
      cpm: 15.60,
      conversionRate: 4.5,
      spend: 450.00,
      impressions: 28846,
      clicks: 923,
      conversions: 42,
      type: 'keyword'
    },
    {
      id: "keyword_2",
      name: "roupa social feminina",
      cpc: 2.45,
      ctr: 2.1,
      cpm: 28.90,
      conversionRate: 3.1,
      spend: 680.50,
      impressions: 23552,
      clicks: 495,
      conversions: 15,
      type: 'keyword'
    },
    {
      id: "keyword_3",
      name: "blusa feminina",
      cpc: 1.35,
      ctr: 4.1,
      cpm: 12.80,
      conversionRate: 5.2,
      spend: 320.00,
      impressions: 25000,
      clicks: 1025,
      conversions: 53,
      type: 'keyword'
    },
    {
      id: "keyword_4",
      name: "calça jeans feminina",
      cpc: 2.10,
      ctr: 2.8,
      cpm: 21.50,
      conversionRate: 3.8,
      spend: 580.00,
      impressions: 26980,
      clicks: 755,
      conversions: 29,
      type: 'keyword'
    },
    {
      id: "keyword_5",
      name: "sapato feminino",
      cpc: 2.95,
      ctr: 1.7,
      cpm: 33.20,
      conversionRate: 2.1,
      spend: 420.00,
      impressions: 12650,
      clicks: 215,
      conversions: 5,
      type: 'keyword'
    },
    {
      id: "keyword_6",
      name: "bolsa feminina",
      cpc: 1.55,
      ctr: 3.6,
      cpm: 14.90,
      conversionRate: 4.2,
      spend: 390.00,
      impressions: 26180,
      clicks: 943,
      conversions: 40,
      type: 'keyword'
    },
    {
      id: "keyword_7",
      name: "moda feminina",
      cpc: 3.40,
      ctr: 1.3,
      cpm: 38.50,
      conversionRate: 1.8,
      spend: 510.00,
      impressions: 13240,
      clicks: 172,
      conversions: 3,
      type: 'keyword'
    },
    {
      id: "keyword_8",
      name: "roupas femininas online",
      cpc: 1.90,
      ctr: 2.9,
      cpm: 19.20,
      conversionRate: 3.5,
      spend: 640.00,
      impressions: 33330,
      clicks: 966,
      conversions: 34,
      type: 'keyword'
    }
  ];

  const generateAISuggestions = (segment: SegmentData): AIsuggestion[] => {
    const suggestions: AIsuggestion[] = [];

    // Análise de CPC
    if (segment.cpc > 2.5) {
      suggestions.push({
        type: 'critical',
        metric: 'CPC',
        suggestion: 'CPC muito alto. Teste novos públicos com menor concorrência e otimize lances automáticos.',
        impact: 'Redução estimada de 30-40% no CPC'
      });
    }

    // Análise de CTR
    if (segment.ctr < 2.0) {
      suggestions.push({
        type: 'warning',
        metric: 'CTR',
        suggestion: 'CTR baixo indica criativo pouco atrativo. Teste novos formatos, cores e call-to-actions.',
        impact: 'Aumento esperado de 50-80% no CTR'
      });
    }

    // Análise de Taxa de Conversão
    if (segment.conversionRate < 2.5) {
      suggestions.push({
        type: 'opportunity',
        metric: 'Conversão',
        suggestion: 'Melhore a landing page, adicione urgência e facilite o checkout.',
        impact: 'Potencial aumento de 25-60% nas conversões'
      });
    }

    // Oportunidades para bom desempenho
    if (segment.ctr > 2.5 && segment.conversionRate > 3.0) {
      suggestions.push({
        type: 'opportunity',
        metric: 'Escala',
        suggestion: 'Excelente performance! Aumente o budget gradualmente para escalar resultados.',
        impact: 'Potencial de 2-3x mais vendas mantendo eficiência'
      });
    }

    return suggestions;
  };

  const getStatusColor = (value: number, metric: string) => {
    switch (metric) {
      case 'cpc':
        return value <= 2.0 ? 'bg-green-100 text-green-800' : value <= 3.0 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
      case 'ctr':
        return value >= 2.5 ? 'bg-green-100 text-green-800' : value >= 1.5 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
      case 'conversion':
        return value >= 3.0 ? 'bg-green-100 text-green-800' : value >= 2.0 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const SegmentCard = ({ segment, onClick }: { segment: SegmentData; onClick: () => void }) => (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      {segment.imageUrl && segment.type === 'creative' && (
        <div className="relative">
          <img 
            src={segment.imageUrl} 
            alt={segment.name}
            className="w-full h-32 object-cover rounded-t-lg"
          />
          {segment.previewUrl && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2 h-7 px-2"
              onClick={(e) => {
                e.stopPropagation();
                window.open(segment.previewUrl, '_blank');
              }}
            >
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
          )}
        </div>
      )}
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-gray-900">{segment.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-600">CPC:</span>
            <Badge className={getStatusColor(segment.cpc, 'cpc')}>
              R$ {segment.cpc.toFixed(2)}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">CTR:</span>
            <Badge className={getStatusColor(segment.ctr, 'ctr')}>
              {segment.ctr.toFixed(1)}%
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Conv:</span>
            <Badge className={getStatusColor(segment.conversionRate, 'conversion')}>
              {segment.conversionRate.toFixed(1)}%
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Gasto:</span>
            <span className="font-medium">R$ {segment.spend.toFixed(0)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 text-xs">
            <Lightbulb className="h-3 w-3 mr-1" />
            Ver Sugestões IA
          </Button>
          {segment.previewUrl && segment.type === 'creative' && (
            <Button
              variant="outline"
              size="sm"
              className="px-2"
              onClick={(e) => {
                e.stopPropagation();
                window.open(segment.previewUrl, '_blank');
              }}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const SuggestionCard = ({ suggestion }: { suggestion: AIsuggestion }) => (
    <Card className="mb-3">
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-full ${
            suggestion.type === 'critical' ? 'bg-red-100' : 
            suggestion.type === 'warning' ? 'bg-yellow-100' : 'bg-green-100'
          }`}>
            {suggestion.type === 'opportunity' ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className={`h-4 w-4 ${
                suggestion.type === 'critical' ? 'text-red-600' : 'text-yellow-600'
              }`} />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={suggestion.type === 'critical' ? 'destructive' : 
                            suggestion.type === 'warning' ? 'secondary' : 'default'}>
                {suggestion.metric}
              </Badge>
              <span className={`text-xs font-medium ${
                suggestion.type === 'critical' ? 'text-red-600' : 
                suggestion.type === 'warning' ? 'text-yellow-600' : 'text-green-600'
              }`}>
                {suggestion.type === 'critical' ? 'CRÍTICO' : 
                 suggestion.type === 'warning' ? 'ATENÇÃO' : 'OPORTUNIDADE'}
              </span>
            </div>
            <p className="text-sm text-gray-700 mb-2">{suggestion.suggestion}</p>
            <p className="text-xs text-gray-500 font-medium">{suggestion.impact}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-gray-900">
          Análise Detalhada por Segmentos
        </h2>
        <p className="text-gray-600">
          Analise performance individual e receba sugestões personalizadas de IA
        </p>
      </div>

      <Tabs defaultValue="creatives" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="creatives">Criativos</TabsTrigger>
          <TabsTrigger value="audiences">Públicos</TabsTrigger>
          <TabsTrigger value="keywords">Palavras-chave</TabsTrigger>
        </TabsList>

        <TabsContent value="creatives" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {creativeData.map((creative) => (
              <SegmentCard 
                key={creative.id} 
                segment={creative} 
                onClick={() => setSelectedSegment(creative)}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="audiences" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {audienceData.map((audience) => (
              <SegmentCard 
                key={audience.id} 
                segment={audience} 
                onClick={() => setSelectedSegment(audience)}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="keywords" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {keywordData.map((keyword) => (
              <SegmentCard 
                key={keyword.id} 
                segment={keyword} 
                onClick={() => setSelectedSegment(keyword)}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {selectedSegment && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                Sugestões de IA para: {selectedSegment.name}
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => setSelectedSegment(null)}>
                Fechar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {generateAISuggestions(selectedSegment).map((suggestion, index) => (
                <SuggestionCard key={index} suggestion={suggestion} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SegmentAnalysis;