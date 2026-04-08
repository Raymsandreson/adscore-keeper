import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
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
  INSERT_CHECK_LIST_COMMAND,
} from '@lexical/list';

import { AutoLinkNode, LinkNode, $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';

import { $getNearestNodeOfType } from '@lexical/utils';

import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  ListChecks,
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
    listitemChecked: 'lexical-listitem-checked',
    listitemUnchecked: 'lexical-listitem-unchecked',
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
  onCustomPrompt,
}: {
  onExpand?: () => void;
  aiLoading: boolean;
  onAiAction: (action: string) => void;
  onCustomPrompt: () => void;
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
          setBlockType(type === 'number' ? 'ol' : type === 'check' ? 'check' : 'ul');
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

  const toggleList = useCallback((type: 'ul' | 'ol' | 'check') => {
    if (type === 'check') {
      if (blockType === 'check') {
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      } else {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
      }
      return;
    }
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
    <div className="sticky top-0 z-20 flex shrink-0 items-center gap-0.5 border-b bg-background/95 px-1.5 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/85 flex-wrap">
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onCustomPrompt}>
            <span className="mr-2">💬</span> Prompt personalizado
          </DropdownMenuItem>
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
      <ToolBtn active={blockType === 'check'} onClick={() => toggleList('check')} title="Checklist">
        <ListChecks className="h-3.5 w-3.5" />
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
  }, [value, editor, lastEmittedHtml]);

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

// ─── AI Suggestion Cards ─────────────────────────────────
function AiSuggestionCards({
  options,
  onSelect,
  onRegenerate,
  onDismiss,
  loading,
}: {
  options: string[];
  onSelect: (text: string) => void;
  onRegenerate: () => void;
  onDismiss: () => void;
  loading: boolean;
}) {
  return (
    <div className="border-t bg-muted/20 p-2 space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
          <Sparkles className="h-3 w-3" /> Escolha uma opção:
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          ✕ Fechar
        </button>
      </div>
      {options.map((opt, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(opt)}
          className="w-full text-left p-2 rounded-md border bg-background hover:bg-accent hover:border-primary/30 transition-colors text-xs leading-relaxed line-clamp-4 cursor-pointer"
        >
          <span className="text-[10px] font-semibold text-primary mr-1">Opção {i + 1}:</span>
          {opt}
        </button>
      ))}
      <button
        type="button"
        onClick={onRegenerate}
        disabled={loading}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent border border-dashed transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>🔄</span>}
        Regerar
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────
function RichTextEditorComponent({
  value,
  onChange,
  placeholder,
  className,
  minHeight = '32px',
  onExpand,
  autoFocus,
}: RichTextEditorProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOptions, setAiOptions] = useState<string[]>([]);
  const [lastAiAction, setLastAiAction] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editorRef = useRef<LexicalEditor | null>(null);
  const lastEmittedHtml = useRef(value || '');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAiText = useRef('');

  const initialConfig = useRef({
    namespace: 'RichTextEditor',
    theme: editorTheme,
    onError: (error: Error) => console.error('Lexical error:', error),
    nodes: [ListNode, ListItemNode, LinkNode, AutoLinkNode],
  }).current;

  const flushEditorHtml = useCallback((editor: LexicalEditor) => {
    editor.getEditorState().read(() => {
      const html = $generateHtmlFromNodes(editor);
      const root = $getRoot();
      const text = root.getTextContent().trim();
      const output = text === '' ? '' : html;
      lastEmittedHtml.current = output;
      onChangeRef.current(output);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }

      const editor = editorRef.current;
      if (editor) {
        flushEditorHtml(editor);
      }
    };
  }, [flushEditorHtml]);

  const handleEditorChange = useCallback(
    (_editorState: EditorState, editor: LexicalEditor) => {
      editorRef.current = editor;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        flushEditorHtml(editor);
      }, 500);
    },
    [flushEditorHtml],
  );

  const handleBlur = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    flushEditorHtml(editor);
  }, [flushEditorHtml]);

  const handleExpand = useCallback(() => {
    const editor = editorRef.current;
    if (editor) {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      flushEditorHtml(editor);
    }

    onExpand?.();
  }, [flushEditorHtml, onExpand]);

  const fetchAiOptions = useCallback(async (action: string, text: string, customPrompt?: string) => {
    setAiLoading(true);
    setLastAiAction(action);
    lastAiText.current = text;
    try {
      const body: Record<string, string> = { text, action };
      if (customPrompt) body.custom_prompt = customPrompt;
      const { data, error } = await supabase.functions.invoke('ai-text-editor', { body });
      if (error) throw error;
      if (data?.options && data.options.length > 0) {
        setAiOptions(data.options);
      } else {
        toast.error('Nenhuma sugestão retornada');
      }
    } catch (err: any) {
      console.error('AI editor error:', err);
      toast.error('Erro ao processar com IA');
    } finally {
      setAiLoading(false);
    }
  }, []);

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

      await fetchAiOptions(action, text);
    },
    [fetchAiOptions],
  );

  const handleCustomPrompt = useCallback(() => {
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

    const userPrompt = window.prompt('Como você quer que a IA edite o texto?');
    if (!userPrompt?.trim()) return;

    fetchAiOptions('custom', text, userPrompt.trim());
  }, [fetchAiOptions]);

  const handleSelectOption = useCallback((text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      p.append($createTextNode(text));
      root.append(p);
    });
    setAiOptions([]);
    setLastAiAction(null);
    toast.success('Texto aplicado!');
  }, []);

  const handleRegenerate = useCallback(() => {
    if (lastAiAction && lastAiText.current) {
      fetchAiOptions(lastAiAction, lastAiText.current);
    }
  }, [lastAiAction, fetchAiOptions]);

  return (
    <div className={cn('flex flex-col rounded-md border bg-background resize-y', className)} style={{ minHeight, overflow: 'auto' }}>
      <LexicalComposer initialConfig={initialConfig}>
        <ToolbarPlugin onExpand={onExpand ? handleExpand : undefined} aiLoading={aiLoading} onAiAction={handleAiAction} onCustomPrompt={handleCustomPrompt} />
        <div className="relative flex-1">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="lexical-editor h-full px-3 py-2 text-xs focus:outline-none"
                style={{ minHeight: '24px' }}
                onBlur={handleBlur}
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
        {aiOptions.length > 0 && (
          <AiSuggestionCards
            options={aiOptions}
            onSelect={handleSelectOption}
            onRegenerate={handleRegenerate}
            onDismiss={() => { setAiOptions([]); setLastAiAction(null); }}
            loading={aiLoading}
          />
        )}
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <OnChangePlugin onChange={handleEditorChange} ignoreSelectionChange />
        <SyncPlugin value={value} lastEmittedHtml={lastEmittedHtml} />
        {autoFocus && <AutoFocusPlugin />}
        <EditorRefPlugin editorRef={editorRef} />
      </LexicalComposer>
    </div>
  );
}

export const RichTextEditor = memo(RichTextEditorComponent);

// ─── Editor Ref Plugin ───────────────────────────────────
function EditorRefPlugin({ editorRef }: { editorRef: React.MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  return null;
}
