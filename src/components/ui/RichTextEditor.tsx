import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';

import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  SELECTION_CHANGE_COMMAND,
  $createParagraphNode,
  $createTextNode,
  type EditorState,
  type LexicalEditor,
} from 'lexical';

import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';

import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode,
  ListItemNode,
} from '@lexical/list';

import { AutoLinkNode, LinkNode, $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';

import { $getNearestNodeOfType } from '@lexical/utils';

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
  Strikethrough,
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

// ─── Theme ───────────────────────────────────────────────
const editorTheme = {
  paragraph: 'lexical-paragraph',
  text: {
    bold: 'lexical-bold',
    italic: 'lexical-italic',
    underline: 'lexical-underline',
    strikethrough: 'lexical-strikethrough',
  },
  list: {
    nested: { listitem: 'lexical-nested-listitem' },
    ol: 'lexical-list-ol',
    ul: 'lexical-list-ul',
    listitem: 'lexical-listitem',
  },
  link: 'lexical-link',
};

// ─── AI Actions ──────────────────────────────────────────
const AI_ACTIONS = {
  summarize: { label: 'Resumir', icon: '📝' },
  fix_typos: { label: 'Corrigir erros', icon: '✏️' },
  humanize: { label: 'Humanizar', icon: '🤝' },
  help_write: { label: 'Ajude-me a escrever', icon: '💡' },
};

const TONE_ACTIONS: Record<string, string> = {
  formal: 'Formal',
  friendly: 'Amigável',
  funny: 'Engraçado',
  engaging: 'Cativante',
  concise: 'Conciso',
  empathetic: 'Empático',
};

const TRANSLATE_ACTIONS: Record<string, string> = {
  translate_en: 'Inglês',
  translate_es: 'Espanhol',
  translate_pt: 'Português',
};

const DRAFT_ACTIONS: Record<string, string> = {
  draft_email: 'E-mail',
  draft_message: 'Mensagem WhatsApp',
  draft_report: 'Relatório',
};

// ─── Props ───────────────────────────────────────────────
interface RichTextEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  onExpand?: () => void;
  autoFocus?: boolean;
}

// ─── Toolbar Plugin ──────────────────────────────────────
function ToolbarPlugin({
  onExpand,
  aiLoading,
  onAiAction,
}: {
  onExpand?: () => void;
  aiLoading: boolean;
  onAiAction: (action: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [blockType, setBlockType] = useState('paragraph');

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat('bold'));
      setIsItalic(selection.hasFormat('italic'));
      setIsUnderline(selection.hasFormat('underline'));
      setIsStrikethrough(selection.hasFormat('strikethrough'));

      const anchorNode = selection.anchor.getNode();
      const element = anchorNode.getKey() === 'root'
        ? anchorNode
        : anchorNode.getTopLevelElementOrThrow();
      const elementKey = element.getKey();
      const elementDOM = editor.getElementByKey(elementKey);

      if (elementDOM !== null) {
        if ($isListNode(element)) {
          const parentList = $getNearestNodeOfType(anchorNode, ListNode);
          const type = parentList ? parentList.getListType() : element.getListType();
          setBlockType(type === 'number' ? 'ol' : 'ul');
        } else {
          setBlockType('paragraph');
        }
      }

      // Check for link
      const node = selection.anchor.getNode();
      const parent = node.getParent();
      setIsLink($isLinkNode(parent) || $isLinkNode(node));
    }
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        updateToolbar();
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor, updateToolbar]);

  const insertLink = useCallback(() => {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    } else {
      const url = window.prompt('URL do link:');
      if (url) {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
      }
    }
  }, [editor, isLink]);

  const toggleList = useCallback((type: 'ul' | 'ol') => {
    if (blockType === type) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(
        type === 'ul' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
        undefined,
      );
    }
  }, [editor, blockType]);

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 border-b bg-muted/30 flex-wrap">
      {/* AI Edition */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={aiLoading}
            className={cn(
              'p-1 rounded hover:bg-accent transition-colors flex items-center gap-0.5 text-xs',
              aiLoading && 'opacity-50',
            )}
            title="AI Edition"
          >
            {aiLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span className="text-[10px] font-medium hidden sm:inline">AI</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {Object.entries(AI_ACTIONS).map(([key, { label, icon }]) => (
            <DropdownMenuItem key={key} onClick={() => onAiAction(key)}>
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
                <DropdownMenuItem key={key} onClick={() => onAiAction(key)}>
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
                <DropdownMenuItem key={key} onClick={() => onAiAction(key)}>
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
                <DropdownMenuItem key={key} onClick={() => onAiAction(key)}>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="w-px h-4 bg-border mx-0.5" />

      <ToolBtn active={isBold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} title="Negrito">
        <Bold className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={isItalic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} title="Itálico">
        <Italic className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={isUnderline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} title="Sublinhado">
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={isStrikethrough} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')} title="Tachado">
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolBtn>

      <div className="w-px h-4 bg-border mx-0.5" />

      <ToolBtn active={blockType === 'ul'} onClick={() => toggleList('ul')} title="Lista">
        <List className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={blockType === 'ol'} onClick={() => toggleList('ol')} title="Lista numerada">
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolBtn>

      <div className="w-px h-4 bg-border mx-0.5" />

      <ToolBtn active={isLink} onClick={insertLink} title={isLink ? 'Remover link' : 'Inserir link'}>
        {isLink ? <Unlink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
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
  );
}

// ─── Sync Plugin (external value → editor, skip internal changes) ────
function SyncPlugin({ value, lastEmittedHtml }: { value: string; lastEmittedHtml: React.MutableRefObject<string> }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // If the incoming value matches what we last emitted, skip (it's our own echo)
    if (value === lastEmittedHtml.current) return;
    // Also skip empty equivalents
    const normalizedValue = (!value || value === '<p></p>') ? '' : value;
    const normalizedEmitted = (!lastEmittedHtml.current || lastEmittedHtml.current === '<p></p>') ? '' : lastEmittedHtml.current;
    if (normalizedValue === normalizedEmitted) return;

    lastEmittedHtml.current = value;

    editor.update(
      () => {
        const root = $getRoot();
        if (!value || value === '<p></p>' || value.trim() === '') {
          root.clear();
          root.append($createParagraphNode());
          return;
        }
        const parser = new DOMParser();
        const dom = parser.parseFromString(value, 'text/html');
        const nodes = $generateNodesFromDOM(editor, dom);
        root.clear();
        nodes.forEach((node) => root.append(node));
      },
      { tag: 'external-sync' },
    );
  }, [value, editor]);

  return null;
}


// ─── Tool Button ─────────────────────────────────────────
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
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = '32px',
  onExpand,
  autoFocus,
}: RichTextEditorProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editorRef = useRef<LexicalEditor | null>(null);
  const lastEmittedHtml = useRef(value || '');

  const initialConfig = {
    namespace: 'RichTextEditor',
    theme: editorTheme,
    onError: (error: Error) => console.error('Lexical error:', error),
    nodes: [ListNode, ListItemNode, LinkNode, AutoLinkNode],
  };

  const handleEditorChange = useCallback(
    (editorState: EditorState, editor: LexicalEditor) => {
      editorRef.current = editor;
      editorState.read(() => {
        const html = $generateHtmlFromNodes(editor);
        const root = $getRoot();
        const text = root.getTextContent().trim();
        const output = text === '' ? '' : html;
        lastEmittedHtml.current = output;
        onChangeRef.current(output);
      });
    },
    [],
  );

  const handleAiAction = useCallback(
    async (action: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      let text = '';
      editor.getEditorState().read(() => {
        text = $getRoot().getTextContent().trim();
      });

      if (!text) {
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
          editor.update(() => {
            const root = $getRoot();
            root.clear();
            const p = $createParagraphNode();
            p.append($createTextNode(data.result));
            root.append(p);
          });
          toast.success('Texto atualizado pela IA');
        }
      } catch (err: any) {
        console.error('AI editor error:', err);
        toast.error('Erro ao processar com IA');
      } finally {
        setAiLoading(false);
      }
    },
    [],
  );

  return (
    <div className={cn('border rounded-md overflow-hidden bg-background', className)}>
      <LexicalComposer initialConfig={initialConfig}>
        <ToolbarPlugin onExpand={onExpand} aiLoading={aiLoading} onAiAction={handleAiAction} />
        <div className="relative" style={{ minHeight }}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="lexical-editor px-3 py-2 text-xs focus:outline-none"
                style={{ minHeight }}
              />
            }
            placeholder={
              placeholder ? (
                <div className="lexical-placeholder absolute top-2 left-3 text-xs text-muted-foreground/50 pointer-events-none select-none">
                  {placeholder}
                </div>
              ) : null
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <OnChangePlugin onChange={handleEditorChange} ignoreSelectionChange />
        <SyncPlugin value={value} lastEmittedHtml={lastEmittedHtml} />
        {autoFocus && <AutoFocusPlugin />}
        <EditorRefPlugin editorRef={editorRef} />
      </LexicalComposer>
    </div>
  );
}

// ─── Editor Ref Plugin ───────────────────────────────────
function EditorRefPlugin({ editorRef }: { editorRef: React.MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  return null;
}
