import { ExternalLink } from "lucide-react";

interface CommentTextWithMentionsProps {
  text: string | null;
  className?: string;
}

/**
 * Renders comment text with clickable @mentions that link to Instagram profiles
 */
export const CommentTextWithMentions = ({ text, className = "" }: CommentTextWithMentionsProps) => {
  if (!text) return null;

  // Regex to match @username patterns
  const mentionRegex = /@([a-zA-Z0-9._]+)/g;
  
  // Split text into parts, keeping mentions as separate items
  const parts: Array<{ type: 'text' | 'mention'; content: string }> = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      });
    }
    
    // Add the mention
    parts.push({
      type: 'mention',
      content: match[1] // Just the username without @
    });
    
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last mention
  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }

  // If no mentions found, just return plain text
  if (parts.length === 0) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (part.type === 'mention') {
          return (
            <a
              key={index}
              href={`https://instagram.com/${part.content}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-medium inline-flex items-center gap-0.5 group"
              onClick={(e) => e.stopPropagation()}
            >
              @{part.content}
              <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-70 transition-opacity" />
            </a>
          );
        }
        return <span key={index}>{part.content}</span>;
      })}
    </span>
  );
};

