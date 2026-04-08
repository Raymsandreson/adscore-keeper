import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { useRef, useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link2,
  Unlink,
  Maximize2,
  Sparkles,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface RichTextEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  onExpand?: () => void;
  autoFocus?: boolean;
}

const AI_ACTIONS = {
  summarize: { label: 'Resumir', icon: '📝' },
  fix_typos: { label: 'Corrigir erros de digitação', icon: '✏️' },
  humanize: { label: 'Humanizar', icon: '🤝' },
  help_write: { label: 'Ajude-me a escrever', icon: '💡' },
};

const TONE_ACTIONS = {
  formal: 'Formal',
  friendly: 'Amigável',
  funny: 'Engraçado',
  engaging: 'Cativante',
  concise: 'Conciso',
  empathetic: 'Empático',
};

const TRANSLATE_ACTIONS = {
  translate_en: 'Inglês',
  translate_es: 'Espanhol',
  translate_pt: 'Português',
};

const DRAFT_ACTIONS = {
  draft_email: 'E-mail',
  draft_message: 'Mensagem WhatsApp',
  draft_report: 'Relatório',
};

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = '32px',
  onExpand,
  autoFocus,
}: RichTextEditorProps) {
  const isInternalChange = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [aiLoading, setAiLoading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { HTMLAttributes: { class: 'list-disc pl-4' } },
        orderedList: { HTMLAttributes: { class: 'list-decimal pl-4' } },
        listItem: { HTMLAttributes: { class: 'leading-normal' } },
      }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-primary underline cursor-pointer' } }),
      Placeholder.configure({ placeholder: placeholder || '' }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2 text-xs',
        style: `min-height: ${minHeight}`,
      },
    },
    onUpdate: ({ editor: ed }) => {
      isInternalChange.current = true;
      const html = ed.getHTML();
      onChangeRef.current(html === '<p></p>' ? '' : html);
      requestAnimationFrame(() => { isInternalChange.current = false; });
    },
    autofocus: autoFocus,
  });

  useEffect(() => {
    if (!editor || isInternalChange.current) return;
    const currentHtml = editor.getHTML();
    const normalized = currentHtml === '<p></p>' ? '' : currentHtml;
    if (normalized !== value) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL do link:', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const handleAiAction = useCallback(async (action: string) => {
    if (!editor) return;
    const text = editor.getText();
    if (!text.trim()) {
      toast.error('Escreva algo primeiro para usar a IA');
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-text-editor', {
        body: { text, action },
      });
      if (error) throw error;
      if (data?.result) {
        editor.commands.setContent(data.result, { emitUpdate: true });
        toast.success('Texto atualizado pela IA');
      }
    } catch (err: any) {
      console.error('AI editor error:', err);
      toast.error('Erro ao processar com IA');
    } finally {
      setAiLoading(false);
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className={cn('border rounded-md overflow-hidden bg-background', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b bg-muted/30 flex-wrap">
        {/* AI Edition */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={aiLoading}
              className={cn(
                'p-1 rounded hover:bg-accent transition-colors flex items-center gap-0.5 text-xs',
                aiLoading && 'opacity-50'
              )}
              title="AI Edition"
            >
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span className="text-[10px] font-medium hidden sm:inline">AI</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {Object.entries(AI_ACTIONS).map(([key, { label, icon }]) => (
              <DropdownMenuItem key={key} onClick={() => handleAiAction(key)}>
                <span className="mr-2">{icon}</span> {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="mr-2">🎨</span> Mudar tom
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {Object.entries(TONE_ACTIONS).map(([key, label]) => (
                  <DropdownMenuItem key={key} onClick={() => handleAiAction(key)}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="mr-2">🌍</span> Traduzir
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {Object.entries(TRANSLATE_ACTIONS).map(([key, label]) => (
                  <DropdownMenuItem key={key} onClick={() => handleAiAction(key)}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="mr-2">📄</span> Rascunhar como
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {Object.entries(DRAFT_ACTIONS).map(([key, label]) => (
                  <DropdownMenuItem key={key} onClick={() => handleAiAction(key)}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="w-px h-4 bg-border mx-0.5" />

        <ToolBtn
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Negrito"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Itálico"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Sublinhado"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolBtn>
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolBtn
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Lista"
        >
          <List className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Lista numerada"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolBtn>
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolBtn
          active={editor.isActive('link')}
          onClick={editor.isActive('link')
            ? () => editor.chain().focus().unsetLink().run()
            : setLink}
          title={editor.isActive('link') ? 'Remover link' : 'Inserir link'}
        >
          {editor.isActive('link') ? <Unlink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        </ToolBtn>
        {onExpand && (
          <>
            <div className="flex-1" />
            <ToolBtn active={false} onClick={onExpand} title="Expandir">
              <Maximize2 className="h-3.5 w-3.5" />
            </ToolBtn>
          </>
        )}
      </div>
      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'p-1 rounded hover:bg-accent transition-colors',
        active && 'bg-accent text-accent-foreground'
      )}
    >
      {children}
    </button>
  );
}
