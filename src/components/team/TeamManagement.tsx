import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  UserPlus,
  Shield,
  User,
  Mail,
  Clock,
  Trash2,
  Users,
  Loader2,
  Crown,
  Send,
  Eye,
  MessageSquare,
} from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useUserRole } from '@/hooks/useUserRole';
import { MODULE_DEFINITIONS, AccessLevel } from '@/hooks/useModulePermissions';
import { MemberDetailSheet } from './MemberDetailSheet';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface WhatsAppInstanceOption {
  id: string;
  instance_name: string;
}

interface TeamMember {
  id: string;
  user_id: string;
  role: 'admin' | 'member';
  email: string | null;
  full_name: string | null;
  created_at: string;
}

export function TeamManagement() {
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { members, invitations, loading, inviteMember, cancelInvitation, updateMemberRole, removeMember, refetch } = useTeamMembers();
  
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sendingNotifUserId, setSendingNotifUserId] = useState<string | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);

  // Module permissions state
  const [selectedModules, setSelectedModules] = useState<Record<string, AccessLevel>>(() => {
    const init: Record<string, AccessLevel> = {};
    MODULE_DEFINITIONS.forEach(m => { init[m.key] = 'none'; });
    return init;
  });

  // WhatsApp instances
  const [whatsappInstances, setWhatsappInstances] = useState<WhatsAppInstanceOption[]>([]);
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from('whatsapp_instances')
      .select('id, instance_name')
      .eq('is_active', true)
      .order('instance_name')
      .then(({ data }) => setWhatsappInstances((data || []) as WhatsAppInstanceOption[]));
  }, []);

  const filteredMembers = members.filter((member) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      member.full_name?.toLowerCase().includes(term) ||
      member.email?.toLowerCase().includes(term)
    );
  });

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Apenas administradores podem gerenciar a equipe
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleInvite = async () => {
    if (!email.trim()) {
      toast.error('Informe o email');
      return;
    }

    setInviting(true);
    try {
      await inviteMember(email, role);
      toast.success('Convite enviado! O usuário receberá acesso ao fazer cadastro.');
      setEmail('');
      setRole('member');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao enviar convite');
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'member') => {
    try {
      await updateMemberRole(userId, newRole);
      toast.success('Permissão atualizada!');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao atualizar permissão');
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeMember(userId);
      toast.success('Membro removido!');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao remover membro');
    }
  };

  const handleCancelInvite = async (invitationId: string) => {
    try {
      await cancelInvitation(invitationId);
      toast.success('Convite cancelado!');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao cancelar convite');
    }
  };

  const handleSendNotification = async (userId: string, memberName: string) => {
    setSendingNotifUserId(userId);
    try {
      const { data, error } = await cloudFunctions.invoke('trigger-whatsapp-notifications', {
        body: { target_user_id: userId },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`Notificação enviada para ${memberName}`);
      } else {
        toast.error(data?.error || 'Erro ao enviar notificação');
      }
    } catch (e: any) {
      toast.error('Erro ao enviar: ' + e.message);
    } finally {
      setSendingNotifUserId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Invite Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Convidar Membro
          </CardTitle>
          <CardDescription>
            Envie um convite por email. O novo membro receberá acesso ao fazer cadastro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="email@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-40">
              <Label>Permissão</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Membro
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <Crown className="h-4 w-4" />
                      Admin
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleInvite} disabled={inviting}>
                {inviting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Convidar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Convites Pendentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Permissão</TableHead>
                  <TableHead>Expira em</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      {invite.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant={invite.role === 'admin' ? 'default' : 'secondary'}>
                        {invite.role === 'admin' ? 'Admin' : 'Membro'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(invite.expires_at), "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCancelInvite(invite.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Team Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Equipe ({members.length})
            </CardTitle>
            <Input
              placeholder="Buscar membro..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-xs"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membro</TableHead>
                <TableHead>Permissão</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMembers.map((member) => (
                <TableRow 
                  key={member.id} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    setSelectedMember(member);
                    setDetailOpen(true);
                  }}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{member.full_name || 'Sem nome'}</p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={member.role}
                      onValueChange={(v) => handleRoleChange(member.user_id, v as 'admin' | 'member')}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Membro</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(member.created_at), "dd/MM/yyyy", { locale: ptBR })}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Enviar notificação"
                        disabled={sendingNotifUserId === member.user_id}
                        onClick={() => handleSendNotification(member.user_id, member.full_name || member.email || 'Membro')}
                      >
                        {sendingNotifUserId === member.user_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MessageSquare className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedMember(member);
                          setDetailOpen(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação removerá {member.full_name || member.email} da equipe. 
                              O usuário perderá acesso ao sistema.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleRemove(member.user_id)}>
                              Remover
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <MemberDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        member={selectedMember}
        onUpdate={refetch}
      />
    </div>
  );
}
