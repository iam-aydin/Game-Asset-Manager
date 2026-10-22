import { forwardRef, useRef, type KeyboardEvent, type ReactNode } from 'react';

const FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const TEXT = 'var(--mantine-color-text)';

// The colored layer and the textarea must use EXACTLY the same box, font and
// line height, or the colors drift away from the characters you type.
const SHARED = {
  margin: 0,
  padding: 16,
  boxSizing: 'border-box',
  fontFamily: FONT,
  fontSize: 13,
  lineHeight: 1.6,
  letterSpacing: 'normal',
  tabSize: 2,
  whiteSpace: 'pre'
} as const;

const CSS = `
.gam-hl-input::selection {
  background: var(
    --wh3d-selection-bg,
    color-mix(in srgb, var(--mantine-primary-color-filled, var(--mantine-color-indigo-6)) 50%, transparent)
  );
  color: transparent;
}
`;

interface HighlightedEditorProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  /** Returns the colored version of the text (e.g. <HtmlSourceText content={t} />).
   *  Leave out for a plain editor. */
  render?: (text: string) => ReactNode;
}

/**
 * Text editor that keeps syntax colors while you type. A transparent
 * textarea sits on top of a colored copy of the same text; the copy scrolls
 * with the textarea. Lines do not wrap in this mode so both layers always line up.
 */
export const HighlightedEditor = forwardRef<HTMLTextAreaElement, HighlightedEditorProps>(
  function HighlightedEditor({ value, onChange, onKeyDown, placeholder, render }, ref) {
    const backRef = useRef<HTMLPreElement>(null);

    // Plain editor (no colors): a normal wrapping textarea.
    if (!render) {
      return (
        <textarea
          ref={ref}
          className="gam-text-select"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            flex: 1,
            minHeight: 0,
            width: '100%',
            boxSizing: 'border-box',
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: TEXT,
            padding: 16,
            fontFamily: FONT,
            fontSize: 13,
            lineHeight: 1.6
          }}
        />
      );
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab types two spaces instead of leaving the box.
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const el = e.currentTarget;
        // execCommand keeps Ctrl+Z working; setRangeText is the fallback.
        if (!document.execCommand('insertText', false, '  ')) {
          el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
          onChange(el.value);
        }
        return;
      }
      onKeyDown?.(e);
    };

    return (
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <style>{CSS}</style>

        {/* Colored copy of the text (a trailing space keeps a final empty line) */}
        <pre
          ref={backRef}
          aria-hidden
          style={{
            ...SHARED,
            position: 'absolute',
            top: 0,
            left: 0,
            minWidth: '100%',
            color: TEXT,
            pointerEvents: 'none',
            willChange: 'transform'
          }}
        >
          {render(value + ' ')}
        </pre>

        {/* The real editor: invisible text, visible caret and selection */}
        <textarea
          ref={ref}
          className="gam-hl-input"
          value={value}
          wrap="off"
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (backRef.current) {
              backRef.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            ...SHARED,
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'transparent',
            caretColor: TEXT,
            overflow: 'auto',
            zIndex: 1
          }}
        />
      </div>
    );
  }
);
