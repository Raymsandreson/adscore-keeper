import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Tag,
  Utensils,
  Car,
  Bed,
  Fuel,
  Plane,
  Briefcase,
  Package,
  AlertTriangle,
  ChevronRight,
  FolderPlus,
  Link2,
  X
} from 'lucide-react';
import { ExpenseCategory, useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useCategoryApiMappings, availableApiCategories } from '@/hooks/useCategoryApiMappings';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  tag: Tag,
  utensils: Utensils,
  car: Car,
  bed: Bed,
  fuel: Fuel,
  plane: Plane,
  briefcase: Briefcase,
  package: Package,
  'car-taxi-front': Car,
};

const availableIcons = ['tag', 'utensils', 'car', 'bed', 'fuel', 'plane', 'briefcase', 'package'];
const availableColors = [
  'bg-gray-500', 'bg-red-500', 'bg-orange-500', 'bg-amber-500', 
  'bg-yellow-500', 'bg-lime-500', 'bg-green-500', 'bg-emerald-500',
  'bg-teal-500', 'bg-cyan-500', 'bg-sky-500', 'bg-blue-500',
  'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500',
  'bg-pink-500', 'bg-rose-500'
];

interface CategoryFormData {
  name: string;
  icon: string;
  color: string;
  max_limit_per_unit: string;
  limit_unit: string;
  parent_id: string;
  selectedApiCategories: string[];
}

export function ExpenseCategoryManager() {
  const { categories, loading, addCategory, updateCategory, deleteCategory, getCategoryExpenseCount, getParentCategories, getSubcategories } = useExpenseCategories();
  const { mappings, getMappingsForCategory, setMappingsForCategory } = useCategoryApiMappings();
  const [isOpen, setIsOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<ExpenseCategory | null>(null);
  const [expenseCountToDelete, setExpenseCountToDelete] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formData, setFormData] = useState<CategoryFormData>({
    name: '',
    icon: 'tag',
    color: 'bg-gray-500',
    max_limit_per_unit: '',
    limit_unit: '',
    parent_id: '',
    selectedApiCategories: [],
  });

  const parentCategories = getParentCategories();

  // Função para sugerir categorias da API baseado no nome da categoria
  const suggestApiCategories = (categoryName: string): string[] => {
    const name = categoryName.toLowerCase().trim();
    const suggestions: string[] = [];
    
    const mappings: Record<string, string[]> = {
      'alimentação': ['Restaurantes', 'Alimentação', 'Fast Food', 'Cafeterias', 'Supermercado', 'Supermercados', 'Padarias', 'Refeições Fora'],
      'alimentos': ['Restaurantes', 'Alimentação', 'Fast Food', 'Supermercado', 'Supermercados'],
      'comida': ['Restaurantes', 'Alimentação', 'Fast Food', 'Refeições Fora'],
      'restaurante': ['Restaurantes', 'Alimentação', 'Fast Food', 'Cafeterias'],
      'transporte': ['Transporte', 'Transporte Público', 'Táxi', 'Uber', 'Aplicativos de Transporte', 'Estacionamento'],
      'combustível': ['Postos de Combustível', 'Combustível', 'Fuel'],
      'combustivel': ['Postos de Combustível', 'Combustível', 'Fuel'],
      'gasolina': ['Postos de Combustível', 'Combustível'],
      'hospedagem': ['Hotéis', 'Hospedagem', 'Férias'],
      'hotel': ['Hotéis', 'Hospedagem'],
      'viagem': ['Viagem', 'Companhias Aéreas', 'Hotéis', 'Hospedagem', 'Férias'],
      'passagem': ['Viagem', 'Companhias Aéreas'],
      'aéreo': ['Viagem', 'Companhias Aéreas'],
      'saúde': ['Saúde', 'Farmácia', 'Médico', 'Hospitais', 'Dentista'],
      'saude': ['Saúde', 'Farmácia', 'Médico', 'Hospitais', 'Dentista'],
      'farmácia': ['Farmácia', 'Saúde'],
      'farmacia': ['Farmácia', 'Saúde'],
      'entretenimento': ['Entretenimento', 'Cinema', 'Música', 'Jogos', 'Streaming'],
      'lazer': ['Entretenimento', 'Cinema', 'Esportes'],
      'compras': ['Compras', 'Vestuário', 'Eletrônicos', 'Lojas de Departamento', 'Compras Online'],
      'roupa': ['Vestuário', 'Compras'],
      'vestuário': ['Vestuário', 'Compras'],
      'carro': ['Automóvel', 'Manutenção de Veículo', 'Combustível', 'Estacionamento'],
      'veículo': ['Automóvel', 'Manutenção de Veículo', 'Aluguel de Carro'],
      'uber': ['Uber', 'Táxi', 'Aplicativos de Transporte'],
      'táxi': ['Táxi', 'Uber', 'Aplicativos de Transporte'],
      'taxi': ['Táxi', 'Uber', 'Aplicativos de Transporte'],
      'educação': ['Educação', 'Livros', 'Cursos'],
      'educacao': ['Educação', 'Livros', 'Cursos'],
      'curso': ['Educação', 'Cursos'],
      'casa': ['Casa', 'Reforma', 'Móveis', 'Artigos para Casa', 'Aluguel'],
      'moradia': ['Casa', 'Aluguel', 'Utilidades'],
      'serviço': ['Serviços', 'Serviços Profissionais', 'Serviços Digitais'],
      'servico': ['Serviços', 'Serviços Profissionais', 'Serviços Digitais'],
      'assinatura': ['Assinatura', 'Assinaturas', 'Streaming', 'Serviços Digitais'],
      'streaming': ['Streaming', 'Assinatura', 'Assinaturas'],
      'pet': ['Animais de Estimação', 'Pet Shop', 'Veterinário'],
      'animal': ['Animais de Estimação', 'Pet Shop', 'Veterinário'],
      'outros': ['Outros', 'Geral', 'Diversos'],
    };

    // Busca correspondências exatas ou parciais
    for (const [key, values] of Object.entries(mappings)) {
      if (name.includes(key) || key.includes(name)) {
        values.forEach(v => {
          if (!suggestions.includes(v)) suggestions.push(v);
        });
      }
    }

    return suggestions;
  };

  const resetForm = () => {
    setFormData({
      name: '',
      icon: 'tag',
      color: 'bg-gray-500',
      max_limit_per_unit: '',
      limit_unit: '',
      parent_id: '',
      selectedApiCategories: [],
    });
    setEditingCategory(null);
  };

  // Atualiza sugestões quando o nome muda
  useEffect(() => {
    if (!editingCategory && formData.name.length >= 3) {
      const suggestions = suggestApiCategories(formData.name);
      if (suggestions.length > 0 && formData.selectedApiCategories.length === 0) {
        setFormData(prev => ({
          ...prev,
          selectedApiCategories: suggestions
        }));
      }
    }
  }, [formData.name, editingCategory]);

  const handleEdit = (category: ExpenseCategory) => {
    setEditingCategory(category);
    const currentMappings = getMappingsForCategory(category.id);
    setFormData({
      name: category.name,
      icon: category.icon || 'tag',
      color: category.color || 'bg-gray-500',
      max_limit_per_unit: category.max_limit_per_unit !== null && category.max_limit_per_unit !== undefined 
        ? category.max_limit_per_unit.toString() 
        : '',
      limit_unit: category.limit_unit || '',
      parent_id: category.parent_id || '',
      selectedApiCategories: currentMappings.map(m => m.api_category_name),
    });
    setIsOpen(true);
  };

  const handleAddSubcategory = (parentId: string) => {
    resetForm();
    setFormData(prev => ({ ...prev, parent_id: parentId }));
    setIsOpen(true);
  };

  const toggleApiCategory = (apiCategory: string) => {
    setFormData(prev => ({
      ...prev,
      selectedApiCategories: prev.selectedApiCategories.includes(apiCategory)
        ? prev.selectedApiCategories.filter(c => c !== apiCategory)
        : [...prev.selectedApiCategories, apiCategory]
    }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) return;

    const limitUnit = formData.limit_unit && formData.limit_unit !== '' && formData.limit_unit !== 'none'
      ? formData.limit_unit as 'per_transaction' | 'per_day' | 'per_month' 
      : null;
    
    const maxLimit = formData.max_limit_per_unit && formData.max_limit_per_unit.trim() !== '' 
      ? parseFloat(formData.max_limit_per_unit) 
      : null;

    const data: Partial<ExpenseCategory> = {
      name: formData.name,
      icon: formData.icon,
      color: formData.color,
      max_limit_per_unit: maxLimit,
      limit_unit: limitUnit,
      parent_id: formData.parent_id || null,
    };

    console.log('Saving category with data:', data);

    try {
      let categoryId: string;
      
      if (editingCategory) {
        await updateCategory(editingCategory.id, data);
        categoryId = editingCategory.id;
      } else {
        const newCategory = await addCategory(data);
        categoryId = newCategory?.id || '';
      }

      // Save API category mappings
      if (categoryId) {
        await setMappingsForCategory(categoryId, formData.selectedApiCategories);
      }

      setIsOpen(false);
      resetForm();
    } catch (err) {
      console.error('Error saving category:', err);
    }
  };

  const handleDeleteClick = async (category: ExpenseCategory) => {
    setCategoryToDelete(category);
    const count = await getCategoryExpenseCount(category.id);
    setExpenseCountToDelete(count);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async (reassignToCategoryId?: string) => {
    if (!categoryToDelete) return;
    
    setIsDeleting(true);
    try {
      await deleteCategory(categoryToDelete.id, reassignToCategoryId);
      setDeleteDialogOpen(false);
      setCategoryToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const getAvailableCategoriesForReassign = () => {
    if (!categoryToDelete) return [];
    return categories.filter(c => c.id !== categoryToDelete.id && !c.is_system);
  };

  const toggleExpanded = (categoryId: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getLimitLabel = (unit: string | null) => {
    switch (unit) {
      case 'per_transaction': return 'por transação';
      case 'per_day': return 'por dia';
      case 'per_month': return 'por mês';
      default: return '';
    }
  };

  const IconComponent = (iconName: string) => {
    const Icon = iconMap[iconName] || Tag;
    return Icon;
  };

  const renderCategoryItem = (category: ExpenseCategory, isSubcategory = false) => {
    const Icon = IconComponent(category.icon);
    const subcategories = getSubcategories(category.id);
    const hasSubcategories = subcategories.length > 0;
    const isExpanded = expandedCategories.has(category.id);
    const categoryMappings = getMappingsForCategory(category.id);

    return (
      <div key={category.id}>
        <div
          className={`flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors ${isSubcategory ? 'ml-6 border-l-2 border-l-primary/30' : ''}`}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {!isSubcategory && hasSubcategories && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => toggleExpanded(category.id)}
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </Button>
            )}
            {!isSubcategory && !hasSubcategories && <div className="w-6 shrink-0" />}
            <div className={`p-2 rounded-lg ${category.color} text-white shrink-0`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{category.name}</p>
              {category.max_limit_per_unit && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                  Limite: {formatCurrency(category.max_limit_per_unit)} {getLimitLabel(category.limit_unit)}
                </p>
              )}
              {categoryMappings.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {categoryMappings.slice(0, 3).map((m, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs py-0">
                      <Link2 className="h-2.5 w-2.5 mr-1" />
                      {m.api_category_name}
                    </Badge>
                  ))}
                  {categoryMappings.length > 3 && (
                    <Badge variant="outline" className="text-xs py-0">
                      +{categoryMappings.length - 3}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {category.is_system && (
              <Badge variant="outline" className="text-xs">Sistema</Badge>
            )}
            {!isSubcategory && (
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => handleAddSubcategory(category.id)}
                title="Adicionar subcategoria"
              >
                <FolderPlus className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => handleEdit(category)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => handleDeleteClick(category)}
              title={category.is_system ? 'Categoria do sistema' : 'Excluir categoria'}
              disabled={category.is_system}
            >
              <Trash2 className={`h-4 w-4 ${category.is_system ? 'text-muted-foreground' : 'text-destructive'}`} />
            </Button>
          </div>
        </div>

        {!isSubcategory && hasSubcategories && isExpanded && (
          <div className="mt-1 space-y-1">
            {subcategories.map(sub => renderCategoryItem(sub, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Categorias de Despesas
          </CardTitle>
          <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nova Categoria
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingCategory ? 'Editar Categoria' : formData.parent_id ? 'Nova Subcategoria' : 'Nova Categoria'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {!editingCategory && (
                  <div>
                    <Label>Categoria Pai (opcional)</Label>
                    <Select
                      value={formData.parent_id}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, parent_id: value === 'none' ? '' : value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Nenhuma (categoria principal)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma (categoria principal)</SelectItem>
                        {parentCategories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div>
                  <Label>Nome</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Ex: Alimentação"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Ícone</Label>
                    <Select
                      value={formData.icon}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, icon: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableIcons.map((icon) => {
                          const Icon = IconComponent(icon);
                          return (
                            <SelectItem key={icon} value={icon}>
                              <div className="flex items-center gap-2">
                                <Icon className="h-4 w-4" />
                                {icon}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Cor</Label>
                    <Select
                      value={formData.color}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, color: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableColors.map((color) => (
                          <SelectItem key={color} value={color}>
                            <div className="flex items-center gap-2">
                              <div className={`h-4 w-4 rounded ${color}`} />
                              {color.replace('bg-', '').replace('-500', '')}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    Limite de Gasto (opcional)
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Valor Máximo (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.max_limit_per_unit}
                        onChange={(e) => setFormData(prev => ({ ...prev, max_limit_per_unit: e.target.value }))}
                        placeholder="0,00"
                      />
                    </div>
                    <div>
                      <Label>Unidade</Label>
                      <Select
                        value={formData.limit_unit || 'none'}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, limit_unit: value === 'none' ? '' : value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem limite</SelectItem>
                          <SelectItem value="per_transaction">Por transação</SelectItem>
                          <SelectItem value="per_day">Por dia</SelectItem>
                          <SelectItem value="per_month">Por mês</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Link2 className="h-4 w-4 text-primary" />
                    <Label className="text-sm font-medium">Categorias da API (correlação automática)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Selecione as categorias do Pluggy que devem ser automaticamente vinculadas a esta categoria
                  </p>
                  
                  {formData.selectedApiCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {formData.selectedApiCategories.map((cat) => (
                        <Badge 
                          key={cat} 
                          variant="secondary" 
                          className="cursor-pointer hover:bg-destructive/20"
                          onClick={() => toggleApiCategory(cat)}
                        >
                          {cat}
                          <X className="h-3 w-3 ml-1" />
                        </Badge>
                      ))}
                    </div>
                  )}

                  <ScrollArea className="h-40 border rounded-md p-2">
                    <div className="space-y-1">
                      {availableApiCategories.map((apiCat) => {
                        const isChecked = formData.selectedApiCategories.includes(apiCat);
                        return (
                          <label 
                            key={apiCat} 
                            className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted rounded cursor-pointer select-none"
                          >
                            <Checkbox 
                              checked={isChecked}
                              onCheckedChange={() => toggleApiCategory(apiCat)}
                            />
                            <span className="text-sm">{apiCat}</span>
                          </label>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => { setIsOpen(false); resetForm(); }}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSubmit} disabled={!formData.name.trim()}>
                    {editingCategory ? 'Salvar' : 'Criar'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {parentCategories.map((category) => renderCategoryItem(category))}
        </div>
      </CardContent>

      <DeleteCategoryDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        category={categoryToDelete}
        expenseCount={expenseCountToDelete}
        availableCategories={getAvailableCategoriesForReassign()}
        onConfirm={handleDeleteConfirm}
        loading={isDeleting}
      />
    </Card>
  );
}
