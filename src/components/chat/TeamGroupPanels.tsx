/**
 * Telas de grupo do Chat da Equipe: criar grupo e gerenciar participantes.
 *
 * Vivem fora do TeamDirectChatPanel só por tamanho — são telas DENTRO do painel
 * do chat (voltar devolve pra lista/conversa), nunca diálogo por cima nem
 * página nova.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, Search, Users, UserPlus, UserMinus, LogOut, Check, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface GroupPerson {
  id: string;
  name: string;
  email?: string | null;
}

function getInitials(name: string): string {
  return (name || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function matches(person: GroupPerson, query: string): boolean {
  if (!query) return true;
  return (person.name || '').toLowerCase().includes(query)
    || (person.email || '').toLowerCase().includes(query);
}

/** Lista com busca e seleção múltipla — usada na criação e no "adicionar pessoas". */
function PeoplePicker({
  people,
  selected,
  onToggle,
  emptyLabel,
}: {
  people: GroupPerson[];
  selected: Set<string>;
  onToggle: (person: GroupPerson) => void;
  emptyLabel: string;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = useMemo(() => people.filter((p) => matches(p, query)), [people, query]);

  return (
    <>
      <div className="shrink-0 px-3 py-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pessoa por nome..."
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="divide-y">
          {visible.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">{emptyLabel}</p>
          )}
          {visible.map((p) => {
            const isSelected = selected.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onToggle(p)}
                className={cn(
                  'w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors flex items-center gap-3',
                  isSelected && 'bg-primary/5'
                )}
              >
                <Checkbox checked={isSelected} className="pointer-events-none" />
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/20 text-primary">
                    {getInitials(p.name || p.email || '?')}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.name || p.email}</div>
                  {p.email && p.name && (
                    <div className="text-[10px] text-muted-foreground truncate">{p.email}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );
}

/** Tela "Novo grupo": nome + quem participa. */
export function NewGroupPanel({
  people,
  creating,
  onCancel,
  onCreate,
}: {
  people: GroupPerson[];
  creating: boolean;
  onCancel: () => void;
  onCreate: (name: string, members: GroupPerson[]) => void;
}) {
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = (person: GroupPerson) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(person.id)) next.delete(person.id);
      else next.add(person.id);
      return next;
    });
  };

  const selectedPeople = people.filter((p) => selectedIds.has(p.id));
  const canCreate = !!name.trim() && selectedPeople.length > 0 && !creating;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel} disabled={creating}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">Novo Grupo</span>
      </div>

      <div className="shrink-0 px-3 py-2 border-b">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do grupo (ex.: Mutirão de audiências)"
          className="h-8 text-sm"
          maxLength={80}
          autoFocus
        />
      </div>

      <PeoplePicker
        people={people}
        selected={selectedIds}
        onToggle={toggle}
        emptyLabel="Ninguém encontrado com esse nome."
      />

      <div className="shrink-0 border-t px-3 py-2 space-y-1.5">
        {selectedPeople.length > 0 && (
          <p className="text-[10px] text-muted-foreground truncate" title={selectedPeople.map((p) => p.name).join(', ')}>
            {selectedPeople.map((p) => p.name).join(', ')}
          </p>
        )}
        <Button
          className="w-full h-8 text-xs gap-1"
          disabled={!canCreate}
          onClick={() => onCreate(name, selectedPeople)}
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
          Criar grupo{selectedPeople.length > 0 ? ` (${selectedPeople.length + 1})` : ''}
        </Button>
      </div>
    </div>
  );
}

/** Tela de participantes do grupo aberto: renomear, adicionar, remover e sair. */
export function GroupMembersPanel({
  groupName,
  managed,
  loading,
  busy,
  members,
  candidates,
  currentUserId,
  onBack,
  onRename,
  onAdd,
  onRemove,
  onLeave,
}: {
  groupName: string;
  /** Grupo sincronizado por outra tela (times/relatório/geral): só leitura. */
  managed: boolean;
  loading: boolean;
  busy: boolean;
  members: GroupPerson[];
  candidates: GroupPerson[];
  currentUserId?: string;
  onBack: () => void;
  onRename: (name: string) => void;
  onAdd: (people: GroupPerson[]) => void;
  onRemove: (person: GroupPerson) => void;
  onLeave: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [nameDraft, setNameDraft] = useState(groupName);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const toggle = (person: GroupPerson) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(person.id)) next.delete(person.id);
      else next.add(person.id);
      return next;
    });
  };

  if (adding) {
    const selectedPeople = candidates.filter((p) => selectedIds.has(p.id));
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => { setAdding(false); setSelectedIds(new Set()); }}
            disabled={busy}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium truncate">Adicionar ao {groupName}</span>
        </div>

        <PeoplePicker
          people={candidates}
          selected={selectedIds}
          onToggle={toggle}
          emptyLabel="Todo mundo já está no grupo."
        />

        <div className="shrink-0 border-t px-3 py-2">
          <Button
            className="w-full h-8 text-xs gap-1"
            disabled={selectedPeople.length === 0 || busy}
            onClick={() => { onAdd(selectedPeople); setAdding(false); setSelectedIds(new Set()); }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
            Adicionar{selectedPeople.length > 0 ? ` (${selectedPeople.length})` : ''}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium truncate">Participantes</span>
        <Badge variant="secondary" className="ml-auto text-[9px] h-4 px-1">
          {members.length}
        </Badge>
      </div>

      {managed ? (
        <div className="shrink-0 px-3 py-2 border-b flex items-start gap-2 text-[11px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            <b className="text-foreground">{groupName}</b> é sincronizado pela organização
            (aba Times / relatório diário). Nome e participantes se ajustam por lá.
          </span>
        </div>
      ) : (
        <div className="shrink-0 px-3 py-2 border-b flex items-center gap-1.5">
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            className="h-8 text-sm"
            maxLength={80}
            placeholder="Nome do grupo"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="Salvar nome"
            disabled={busy || !nameDraft.trim() || nameDraft.trim() === groupName}
            onClick={() => onRename(nameDraft)}
          >
            <Check className="h-4 w-4" />
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="divide-y">
            {members.map((p) => {
              const isMe = p.id === currentUserId;
              return (
                <div key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs bg-primary/20 text-primary">
                      {getInitials(p.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {p.name}{isMe && <span className="text-muted-foreground font-normal"> (você)</span>}
                    </div>
                    {p.email && <div className="text-[10px] text-muted-foreground truncate">{p.email}</div>}
                  </div>
                  {!managed && !isMe && (
                    confirmRemoveId === p.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-6 text-[10px] px-2"
                          disabled={busy}
                          onClick={() => { onRemove(p); setConfirmRemoveId(null); }}
                        >
                          Remover
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2"
                          onClick={() => setConfirmRemoveId(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        title={`Remover ${p.name} do grupo`}
                        disabled={busy}
                        onClick={() => setConfirmRemoveId(p.id)}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </Button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {!managed && (
        <div className="shrink-0 border-t px-3 py-2 space-y-1.5">
          <Button
            variant="outline"
            className="w-full h-8 text-xs gap-1"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            <UserPlus className="h-3.5 w-3.5" /> Adicionar pessoas
          </Button>
          {confirmLeave ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="destructive"
                className="flex-1 h-8 text-xs gap-1"
                disabled={busy}
                onClick={() => { setConfirmLeave(false); onLeave(); }}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                Confirmar saída
              </Button>
              <Button variant="ghost" className="h-8 text-xs" onClick={() => setConfirmLeave(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="w-full h-8 text-xs gap-1 text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setConfirmLeave(true)}
            >
              <LogOut className="h-3.5 w-3.5" /> Sair do grupo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
