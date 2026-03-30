import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Search,
  Loader2,
  ExternalLink,
  UserPlus,
  Users,
  Lock,
  ShieldCheck,
  Image as ImageIcon,
  Globe,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface ProfileResult {
  username: string;
  fullName: string;
  biography: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  profilePicUrl: string;
  isVerified: boolean;
  isPrivate: boolean;
  externalUrl: string;
  category: string;
  searchTerm: string;
  profileUrl: string;
}

export function ProfileSearchEngine() {
  const [keyword, setKeyword] = useState('');
  const [maxResults, setMaxResults] = useState(50);
  const [isSearching, setIsSearching] = useState(false);
  const [profiles, setProfiles] = useState<ProfileResult[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [searchStatus, setSearchStatus] = useState('');
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [savingContacts, setSavingContacts] = useState(false);
  const [bioFilter, setBioFilter] = useState('');

  const startSearch = useCallback(async () => {
    if (!keyword.trim()) {
      toast.error('Digite uma palavra-chave para buscar');
      return;
    }

    setIsSearching(true);
    setProfiles([]);
    setSelectedProfiles(new Set());
    setCostUsd(null);
    setSearchStatus('Iniciando busca de perfis...');

    try {
      // Start the search
      const { data: startData, error: startError } = await cloudFunctions.invoke('search-instagram-profiles', {
        body: {
          action: 'start',
          keywords: keyword.split(',').map(k => k.trim()).filter(Boolean),
          maxResults,
        },
      });

      if (startError) throw startError;
      if (!startData?.success) throw new Error(startData?.error || 'Erro ao iniciar busca');

      const runId = startData.runId;
      setSearchStatus('Buscando perfis no Instagram...');

      // Poll for completion
      let attempts = 0;
      const maxAttempts = 60;

      while (attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));

        const { data: statusData, error: statusError } = await cloudFunctions.invoke('search-instagram-profiles', {
          body: { action: 'status', runId },
        });

        if (statusError) throw statusError;

        if (statusData?.isFailed) {
          throw new Error('A busca falhou no Apify');
        }

        if (statusData?.isComplete) {
          setSearchStatus('Carregando resultados...');

          const { data: resultsData, error: resultsError } = await cloudFunctions.invoke('search-instagram-profiles', {
            body: { action: 'results', runId },
          });

          if (resultsError) throw resultsError;

          if (resultsData?.success) {
            setProfiles(resultsData.profiles || []);
            setCostUsd(resultsData.costUsd || null);
            toast.success(`Encontrados ${resultsData.profiles?.length || 0} perfis`);
            setSearchStatus('');
            return;
          }
        }

        setSearchStatus(`Buscando perfis... (${attempts * 5}s)`);
      }

      toast.error('Timeout: a busca demorou mais de 5 minutos');
    } catch (error) {
      console.error('Profile search error:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao buscar perfis');
    } finally {
      setIsSearching(false);
      setSearchStatus('');
    }
  }, [keyword, maxResults]);

  const toggleProfile = (username: string) => {
    setSelectedProfiles(prev => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedProfiles.size === filteredProfiles.length) {
      setSelectedProfiles(new Set());
    } else {
      setSelectedProfiles(new Set(filteredProfiles.map(p => p.username)));
    }
  };

  const saveAsContacts = async () => {
    if (selectedProfiles.size === 0) {
      toast.error('Selecione pelo menos um perfil');
      return;
    }

    setSavingContacts(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      const profilesToSave = profiles.filter(p => selectedProfiles.has(p.username));
      let saved = 0;
      let skipped = 0;

      for (const profile of profilesToSave) {
        // Check if contact already exists
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('instagram_username', profile.username)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        const { error } = await supabase.from('contacts').insert({
          full_name: profile.fullName || profile.username,
          instagram_username: profile.username,
          instagram_url: profile.profileUrl,
          notes: `Bio: ${profile.biography}\n\nCategoria: ${profile.category || 'N/A'}\nSeguidores: ${profile.followersCount}\nBusca: ${profile.searchTerm}`,
          created_by: userId,
        });

        if (!error) saved++;
      }

      toast.success(`${saved} contatos salvos${skipped > 0 ? `, ${skipped} já existiam` : ''}`);
      setSelectedProfiles(new Set());
    } catch (error) {
      console.error('Error saving contacts:', error);
      toast.error('Erro ao salvar contatos');
    } finally {
      setSavingContacts(false);
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  const filteredProfiles = bioFilter.trim()
    ? profiles.filter(p =>
        p.biography?.toLowerCase().includes(bioFilter.toLowerCase()) ||
        p.fullName?.toLowerCase().includes(bioFilter.toLowerCase()) ||
        p.category?.toLowerCase().includes(bioFilter.toLowerCase())
      )
    : profiles;

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Buscar Perfis por Palavra-chave
        </Label>
        <p className="text-xs text-muted-foreground">
          Digite palavras-chave para encontrar perfis no Instagram. Separe múltiplos termos por vírgula.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="Ex: acidente de trabalho, advogado trabalhista..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="flex-1"
            onKeyDown={(e) => e.key === 'Enter' && !isSearching && startSearch()}
          />
          <Input
            type="number"
            value={maxResults}
            onChange={(e) => setMaxResults(Number(e.target.value))}
            className="w-24"
            min={5}
            max={200}
            title="Máx. resultados"
          />
          <Button onClick={startSearch} disabled={isSearching} className="gap-2">
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </Button>
        </div>
      </div>

      {/* Status */}
      {searchStatus && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          <Loader2 className="h-4 w-4 animate-spin" />
          {searchStatus}
        </div>
      )}

      {/* Results */}
      {profiles.length > 0 && (
        <div className="space-y-3">
          {/* Actions Bar */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">
                {filteredProfiles.length} perfis encontrados
              </span>
              {costUsd !== null && (
                <Badge variant="outline" className="text-xs">
                  Custo: ${costUsd.toFixed(4)}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Filtrar por bio/nome..."
                value={bioFilter}
                onChange={(e) => setBioFilter(e.target.value)}
                className="w-56 h-8 text-xs"
              />
              <Button variant="outline" size="sm" onClick={toggleAll}>
                {selectedProfiles.size === filteredProfiles.length ? 'Desmarcar tudo' : 'Selecionar tudo'}
              </Button>
              <Button
                size="sm"
                onClick={saveAsContacts}
                disabled={selectedProfiles.size === 0 || savingContacts}
                className="gap-1"
              >
                {savingContacts ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                Salvar {selectedProfiles.size > 0 ? `(${selectedProfiles.size})` : ''} como Contatos
              </Button>
            </div>
          </div>

          {/* Profile List */}
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {filteredProfiles.map((profile) => (
                <Card
                  key={profile.username}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    selectedProfiles.has(profile.username) ? 'ring-2 ring-primary bg-primary/5' : ''
                  }`}
                  onClick={() => toggleProfile(profile.username)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedProfiles.has(profile.username)}
                        onCheckedChange={() => toggleProfile(profile.username)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1"
                      />
                      <Avatar className="h-12 w-12 flex-shrink-0">
                        <AvatarImage src={profile.profilePicUrl} alt={profile.username} />
                        <AvatarFallback>{profile.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">@{profile.username}</span>
                          {profile.isVerified && (
                            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                          )}
                          {profile.isPrivate && (
                            <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0">
                              <Lock className="h-2.5 w-2.5" />
                              Privado
                            </Badge>
                          )}
                          {profile.category && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {profile.category}
                            </Badge>
                          )}
                        </div>
                        {profile.fullName && (
                          <p className="text-xs text-muted-foreground">{profile.fullName}</p>
                        )}
                        {profile.biography && (
                          <p className="text-xs mt-1 line-clamp-2">{profile.biography}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {formatNumber(profile.followersCount)} seguidores
                          </span>
                          <span className="flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" />
                            {formatNumber(profile.postsCount)} posts
                          </span>
                          {profile.externalUrl && (
                            <span className="flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              Site
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(profile.profileUrl, '_blank');
                        }}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
