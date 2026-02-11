import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Network, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Search,
  Filter,
  RefreshCw,
  Users
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Contact } from '@/hooks/useContacts';

interface GraphNode {
  id: string;
  name: string;
  classification: string | null;
  instagram: string | null;
  val: number; // Node size
  color: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: string;
  color: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface ContactNetworkGraphProps {
  isOpen: boolean;
  onClose: () => void;
  contacts: Contact[];
  onSelectContact?: (contact: Contact) => void;
}

// Color mapping for classifications
const classificationColors: Record<string, string> = {
  client: '#22c55e',
  non_client: '#6b7280',
  prospect: '#3b82f6',
  partner: '#a855f7',
  supplier: '#f97316',
  default: '#94a3b8',
};

// Color mapping for relationship types
const relationshipColors: Record<string, string> = {
  'Indicação': '#f59e0b',
  'Parceiro': '#a855f7',
  'Mãe': '#ec4899',
  'Pai': '#3b82f6',
  'Esposa': '#f472b6',
  'Marido': '#60a5fa',
  'Filho(a)': '#34d399',
  'Irmão(ã)': '#fb923c',
  'Colega de trabalho': '#6366f1',
  'Amigo(a)': '#14b8a6',
  'Cliente indicado': '#84cc16',
  default: '#94a3b8',
};

export const ContactNetworkGraph: React.FC<ContactNetworkGraphProps> = ({
  isOpen,
  onClose,
  contacts,
  onSelectContact,
}) => {
  const graphRef = useRef<ForceGraphMethods>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [relationshipTypes, setRelationshipTypes] = useState<string[]>([]);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<string>>(new Set());
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  // Fetch all relationships and build graph
  const fetchGraphData = useCallback(async () => {
    if (!contacts.length) return;

    setLoading(true);
    try {
      // Fetch all relationships
      const { data: relationships, error: relError } = await (supabase as any)
        .from('contact_relationships')
        .select('*');

      if (relError) throw relError;

      // Create a map of contacts for quick lookup
      const contactMap = new Map(contacts.map(c => [c.id, c]));

      // Build nodes from contacts that have relationships
      const connectedContactIds = new Set<string>();
      (relationships || []).forEach((rel: any) => {
        connectedContactIds.add(rel.contact_id);
        connectedContactIds.add(rel.related_contact_id);
      });

      const nodes: GraphNode[] = contacts
        .filter(c => connectedContactIds.has(c.id))
        .map(contact => ({
          id: contact.id,
          name: contact.full_name,
          classification: contact.classification,
          instagram: contact.instagram_username,
          val: 1,
          color: classificationColors[contact.classification || 'default'] || classificationColors.default,
        }));

      // Build links from relationships
      const links: GraphLink[] = (relationships || [])
        .filter((rel: any) => contactMap.has(rel.contact_id) && contactMap.has(rel.related_contact_id))
        .map((rel: any) => ({
          source: rel.contact_id,
          target: rel.related_contact_id,
          type: rel.relationship_type,
          color: relationshipColors[rel.relationship_type] || relationshipColors.default,
        }));

      // Count connections per node to adjust size
      const connectionCounts: Record<string, number> = {};
      links.forEach(link => {
        connectionCounts[link.source as string] = (connectionCounts[link.source as string] || 0) + 1;
        connectionCounts[link.target as string] = (connectionCounts[link.target as string] || 0) + 1;
      });

      // Update node sizes based on connections
      nodes.forEach(node => {
        node.val = Math.max(1, (connectionCounts[node.id] || 0) * 2);
      });

      // Extract unique relationship types
      const types = [...new Set(links.map(l => l.type))];
      setRelationshipTypes(types);

      setGraphData({ nodes, links });
    } catch (error) {
      console.error('Error fetching graph data:', error);
    } finally {
      setLoading(false);
    }
  }, [contacts]);

  useEffect(() => {
    if (isOpen) {
      fetchGraphData();
    }
  }, [isOpen, fetchGraphData]);

  // Handle container resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width || 800,
          height: rect.height || 600,
        });
      }
    };

    if (isOpen) {
      setTimeout(updateDimensions, 100);
      window.addEventListener('resize', updateDimensions);
    }

    return () => window.removeEventListener('resize', updateDimensions);
  }, [isOpen]);

  // Filter graph data based on search and filter
  const filteredData = useMemo(() => {
    let { nodes, links } = graphData;

    // Filter by relationship type
    if (filterType !== 'all') {
      links = links.filter(l => l.type === filterType);
      const connectedIds = new Set<string>();
      links.forEach(l => {
        connectedIds.add(l.source as string);
        connectedIds.add(l.target as string);
      });
      nodes = nodes.filter(n => connectedIds.has(n.id));
    }

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchingNodes = nodes.filter(n => 
        n.name.toLowerCase().includes(term) || 
        n.instagram?.toLowerCase().includes(term)
      );
      const matchingIds = new Set(matchingNodes.map(n => n.id));
      
      // Also include nodes connected to matching nodes
      links.forEach(l => {
        if (matchingIds.has(l.source as string)) matchingIds.add(l.target as string);
        if (matchingIds.has(l.target as string)) matchingIds.add(l.source as string);
      });
      
      nodes = nodes.filter(n => matchingIds.has(n.id));
      links = links.filter(l => 
        matchingIds.has(l.source as string) && matchingIds.has(l.target as string)
      );
    }

    return { nodes, links };
  }, [graphData, filterType, searchTerm]);

  // Handle node hover
  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node);
    
    if (node) {
      const connectedNodes = new Set<string>();
      const connectedLinks = new Set<string>();
      
      connectedNodes.add(node.id);
      
      filteredData.links.forEach((link, idx) => {
        if (link.source === node.id || (link.source as any)?.id === node.id) {
          connectedNodes.add((link.target as any)?.id || link.target as string);
          connectedLinks.add(String(idx));
        }
        if (link.target === node.id || (link.target as any)?.id === node.id) {
          connectedNodes.add((link.source as any)?.id || link.source as string);
          connectedLinks.add(String(idx));
        }
      });
      
      setHighlightNodes(connectedNodes);
      setHighlightLinks(connectedLinks);
    } else {
      setHighlightNodes(new Set());
      setHighlightLinks(new Set());
    }
  }, [filteredData.links]);

  // Handle node click
  const handleNodeClick = useCallback((node: GraphNode) => {
    const contact = contacts.find(c => c.id === node.id);
    if (contact && onSelectContact) {
      onSelectContact(contact);
    }
  }, [contacts, onSelectContact]);

  // Zoom controls
  const handleZoomIn = () => graphRef.current?.zoom(1.5, 400);
  const handleZoomOut = () => graphRef.current?.zoom(0.75, 400);
  const handleFitView = () => graphRef.current?.zoomToFit(400);

  // Custom node rendering
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.name;
    const fontSize = 12 / globalScale;
    const nodeSize = Math.sqrt(node.val) * 4;
    
    const isHighlighted = highlightNodes.size === 0 || highlightNodes.has(node.id);
    
    // Draw node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
    ctx.fillStyle = node.color + (isHighlighted ? 'ff' : '33');
    ctx.fill();
    
    if (highlightNodes.has(node.id)) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / globalScale;
      ctx.stroke();
    }
    
    // Draw label
    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isHighlighted ? '#e2e8f0' : '#64748b';
    ctx.fillText(label, node.x, node.y + nodeSize + fontSize);
  }, [highlightNodes]);

  // Custom link rendering
  const linkCanvasObject = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const start = { x: link.source.x, y: link.source.y };
    const end = { x: link.target.x, y: link.target.y };
    
    const linkIdx = filteredData.links.findIndex(l => 
      (l.source === link.source.id || (l.source as any)?.id === link.source.id) &&
      (l.target === link.target.id || (l.target as any)?.id === link.target.id)
    );
    
    const isHighlighted = highlightLinks.size === 0 || highlightLinks.has(String(linkIdx));
    
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = link.color + (isHighlighted ? 'cc' : '22');
    ctx.lineWidth = isHighlighted ? 2 / globalScale : 1 / globalScale;
    ctx.stroke();
    
    // Draw relationship type label
    if (isHighlighted && highlightLinks.size > 0) {
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      const fontSize = 10 / globalScale;
      ctx.font = `${fontSize}px Inter, sans-serif`;
      ctx.fillStyle = link.color;
      ctx.textAlign = 'center';
      ctx.fillText(link.type, midX, midY);
    }
  }, [filteredData.links, highlightLinks]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-4xl p-0 overflow-hidden">
        <div className="flex flex-col h-full">
          <SheetHeader className="px-6 py-4 border-b bg-background">
            <SheetTitle className="flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" />
              Rede de Vínculos
            </SheetTitle>
          </SheetHeader>

          {/* Toolbar */}
          <div className="px-4 py-3 border-b bg-muted/30 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contato..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[180px] h-9">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Tipo de vínculo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os vínculos</SelectItem>
                {relationshipTypes.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={handleZoomIn} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={handleZoomOut} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={handleFitView} title="Ajustar à tela">
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchGraphData} title="Atualizar">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="px-4 py-2 border-b bg-background flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {filteredData.nodes.length} contatos
            </span>
            <span className="flex items-center gap-1">
              <Network className="h-4 w-4" />
              {filteredData.links.length} vínculos
            </span>
            {hoveredNode && (
              <Badge variant="secondary" className="ml-auto">
                {hoveredNode.name}
                {hoveredNode.instagram && ` (@${hoveredNode.instagram})`}
              </Badge>
            )}
          </div>

          {/* Graph container */}
          <div ref={containerRef} className="flex-1 bg-slate-950">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredData.nodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Network className="h-16 w-16 mb-4 opacity-50" />
                <p className="text-lg font-medium">Nenhum vínculo encontrado</p>
                <p className="text-sm">Crie vínculos entre contatos para visualizar a rede</p>
              </div>
            ) : (
              <ForceGraph2D
                ref={graphRef}
                graphData={filteredData}
                width={dimensions.width}
                height={dimensions.height}
                nodeId="id"
                nodeVal="val"
                nodeLabel=""
                nodeCanvasObject={nodeCanvasObject}
                nodePointerAreaPaint={(node, color, ctx) => {
                  const size = Math.sqrt(node.val as number) * 4;
                  ctx.fillStyle = color;
                  ctx.beginPath();
                  ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
                  ctx.fill();
                }}
                linkCanvasObject={linkCanvasObject}
                linkDirectionalParticles={2}
                linkDirectionalParticleWidth={2}
                linkDirectionalParticleColor={(link) => (link as GraphLink).color}
                onNodeHover={(node) => handleNodeHover(node as GraphNode | null)}
                onNodeClick={(node) => handleNodeClick(node as GraphNode)}
                cooldownTicks={100}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
                backgroundColor="transparent"
              />
            )}
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t bg-background overflow-x-auto">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-muted-foreground font-medium">Status:</span>
              <div className="flex items-center gap-3">
                {Object.entries(classificationColors).filter(([k]) => k !== 'default').map(([key, color]) => (
                  <span key={key} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-muted-foreground capitalize">
                      {key === 'client' ? 'Cliente' : 
                       key === 'non_client' ? 'Não-Cliente' : 
                       key === 'prospect' ? 'Prospect' :
                       key === 'partner' ? 'Parceiro' :
                       key === 'supplier' ? 'Fornecedor' : key}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
