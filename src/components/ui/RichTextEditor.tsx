import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link2,
  Unlink,
  Maximize2,
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  onExpand?: () => void;
  autoFocus?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = '32px',
  onExpand,
  autoFocus,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-primary underline cursor-pointer' } }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2 text-xs',
          `min-h-[${minHeight}]`
        ),
        style: `min-height: ${minHeight}`,
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      // If content is just empty paragraph, treat as empty
      onChange(html === '<p></p>' ? '' : html);
    },
    autofocus: autoFocus,
  });

  // Sync external value changes
  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    const normalized = currentHtml === '<p></p>' ? '' : currentHtml;
    if (normalized !== value) {
      editor.commands.setContent(value || '');
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

  if (!editor) return null;

  return (
    <div className={cn('border rounded-md overflow-hidden bg-background', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b bg-muted/30 flex-wrap">
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
      {!value && placeholder && (
        <style>{`
          .ProseMirror p.is-editor-empty:first-child::before {
            content: '${placeholder.replace(/'/g, "\\'")}';
            color: hsl(var(--muted-foreground) / 0.6);
            float: left;
            pointer-events: none;
            height: 0;
          }
        `}</style>
      )}
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
