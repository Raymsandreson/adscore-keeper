import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, User, Mail, Save, Loader2, Scale } from "lucide-react";

const TREATMENT_OPTIONS = [
  { value: 'none', label: 'Nenhum' },
  { value: 'Dr.', label: 'Dr.' },
  { value: 'Dra.', label: 'Dra.' },
  { value: 'Sr.', label: 'Sr.' },
  { value: 'Sra.', label: 'Sra.' },
  { value: 'Prof.', label: 'Prof.' },
  { value: 'Profa.', label: 'Profa.' },
];
const GENDER_OPTIONS = [
  { value: 'none', label: 'Não informado' },
  { value: 'male', label: 'Masculino' },
  { value: 'female', label: 'Feminino' },
];

const ProfilePage = () => {
  const navigate = useNavigate();
  const { user, profile, updateProfile, loading } = useAuthContext();
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [treatmentTitle, setTreatmentTitle] = useState((profile as any)?.treatment_title || "none");
  const [gender, setGender] = useState((profile as any)?.gender || "none");
  const [oabNumber, setOabNumber] = useState((profile as any)?.oab_number || "");
  const [oabUf, setOabUf] = useState((profile as any)?.oab_uf || "");
  const [isSaving, setIsSaving] = useState(false);

  const getInitials = () => {
    if (profile?.full_name) {
      return profile.full_name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.slice(0, 2).toUpperCase() || 'U';
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    setIsSaving(true);
    const { error } = await updateProfile({ 
      full_name: fullName.trim(),
      treatment_title: treatmentTitle === 'none' ? null : treatmentTitle,
      gender: gender === 'none' ? null : gender,
      oab_number: oabNumber.trim() || null,
      oab_uf: oabUf.trim() || null,
    } as any);
    
    if (error) {
      toast.error("Erro ao salvar perfil", { description: error.message });
    } else {
      toast.success("Perfil atualizado com sucesso!");
    }
    setIsSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-dashboard p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Meu Perfil</h1>
            <p className="text-muted-foreground text-sm">Gerencie suas informações pessoais</p>
          </div>
        </div>

        {/* Profile Card */}
        <Card>
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <Avatar className="h-24 w-24">
                <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
                  {getInitials()}
                </AvatarFallback>
              </Avatar>
            </div>
            <CardTitle>{profile?.full_name || "Usuário"}</CardTitle>
            <CardDescription>{user?.email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="fullName" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Nome completo
              </Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Seu nome completo"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Pronome de tratamento
              </Label>
              <Select value={treatmentTitle} onValueChange={setTreatmentTitle}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {TREATMENT_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Usado para identificação automática nas mensagens do WhatsApp
                {treatmentTitle !== 'none' && fullName ? (
                  <span className="block mt-1 font-medium text-foreground">
                    Prévia: {treatmentTitle} {fullName}
                  </span>
                ) : null}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Gênero
              </Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Usado para definir o pronome de tratamento padrão (Dr./Dra.) no WhatsApp
              </p>
            </div>

            {/* OAB Fields */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Scale className="h-4 w-4" />
                OAB (opcional)
              </Label>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Input
                    value={oabNumber}
                    onChange={(e) => setOabNumber(e.target.value)}
                    placeholder="Número da OAB"
                  />
                </div>
                <Select value={oabUf} onValueChange={setOabUf}>
                  <SelectTrigger>
                    <SelectValue placeholder="UF" />
                  </SelectTrigger>
                  <SelectContent>
                    {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => (
                      <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Cadastre sua OAB para identificação automática como advogado interno nos processos
              </p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Telefone / WhatsApp
              </Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
              />
              <p className="text-xs text-muted-foreground">
                Usado para receber notificações automáticas de movimentação processual
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </Label>
              <Input
                id="email"
                value={user?.email || ""}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">O email não pode ser alterado</p>
            </div>

            <Button 
              onClick={handleSave} 
              disabled={isSaving}
              className="w-full"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Salvar alterações
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Account Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Informações da Conta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-muted-foreground">ID do usuário</span>
              <span className="text-sm font-mono">{user?.id?.slice(0, 8)}...</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-muted-foreground">Criado em</span>
              <span className="text-sm">
                {profile?.created_at 
                  ? new Date(profile.created_at).toLocaleDateString('pt-BR')
                  : "-"
                }
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-muted-foreground">Última atualização</span>
              <span className="text-sm">
                {profile?.updated_at 
                  ? new Date(profile.updated_at).toLocaleDateString('pt-BR')
                  : "-"
                }
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProfilePage;
