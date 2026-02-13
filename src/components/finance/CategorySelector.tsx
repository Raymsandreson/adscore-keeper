import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ExpenseCategory } from '@/hooks/useExpenseCategories';

interface CategorySelectorProps {
  categories: ExpenseCategory[];
  selectedCategoryId: string | null;
  onSelect: (categoryId: string) => void;
}

export function CategorySelector({ categories, selectedCategoryId, onSelect }: CategorySelectorProps) {
  const [expandedParent, setExpandedParent] = useState<string | null>(null);

  const parentCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);

  const getSubcategories = (parentId: string) =>
    categories.filter(c => c.parent_id === parentId);

  // Check if selected category belongs to a parent
  const selectedParentId = useMemo(() => {
    if (!selectedCategoryId) return null;
    const cat = categories.find(c => c.id === selectedCategoryId);
    return cat?.parent_id || null;
  }, [selectedCategoryId, categories]);

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">Categoria</label>
      <div className="border rounded-lg p-2">
        <div className="flex flex-wrap gap-1">
          {parentCategories.map(cat => {
            const subcategories = getSubcategories(cat.id);
            const hasSubcategories = subcategories.length > 0;
            const isExpanded = expandedParent === cat.id;
            const isSubcategorySelected = selectedParentId === cat.id;
            const isDirectlySelected = selectedCategoryId === cat.id && !hasSubcategories;

            return (
              <Button
                key={cat.id}
                variant={isDirectlySelected || isSubcategorySelected ? 'default' : isExpanded ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => {
                  if (hasSubcategories) {
                    setExpandedParent(isExpanded ? null : cat.id);
                  } else {
                    onSelect(cat.id);
                    setExpandedParent(null);
                  }
                }}
                className="h-7 text-xs gap-1 rounded-full"
              >
                <div className={cn("w-2 h-2 rounded-full", cat.color)} />
                {cat.name}
                {hasSubcategories && (
                  <span className="text-[10px] ml-0.5">{isExpanded ? '▼' : '▶'}</span>
                )}
              </Button>
            );
          })}
        </div>

        {expandedParent && (
          <div className="mt-2 pt-2 border-t">
            <p className="text-[10px] text-muted-foreground mb-1.5">Selecione a subcategoria:</p>
            <div className="flex flex-wrap gap-1">
              {getSubcategories(expandedParent).map(sub => (
                <Button
                  key={sub.id}
                  variant={selectedCategoryId === sub.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    onSelect(sub.id);
                  }}
                  className="h-7 text-xs gap-1 rounded-full"
                >
                  <div className={cn("w-2 h-2 rounded-full", sub.color)} />
                  {sub.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
