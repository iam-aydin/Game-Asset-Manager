import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  useComputedColorScheme
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconCheck, IconClipboardText, IconPencil } from '@tabler/icons-react';
import type { FileRecord } from '@shared/types';
import { ipc } from '../ipc-client';
import { isIniLikeExtension, tokenizeIni, type IniTokenType } from '../util/ini-tokens';
import { isLicenseFilename, publishLicense } from '../util/use-sidecar-license';
import { TextContextMenu } from './TextContextMenu';
import { HtmlPreview } from './HtmlPreview';
import { HtmlSourceText } from './HtmlSource';
import { HighlightedEditor } from './HighlightedEditor';

interface TextPreviewProps {
  libraryId: string;
  file: FileRecord;
  /** Extra header buttons (e.g. expand / mini player), shown just left of the
   *  copy button. */
  actions?: ReactNode;
}

// Every color comes from Mantine theme variables so the viewer follows the
// selected theme (and light / dark) instead of a fixed black palette.
const C = {
  bg: 'var(--mantine-color-body)',
  headerBg: 'var(--mantine-color-default-hover)',
  border: 'var(--mantine-color-default-border)',
  text: 'var(--mantine-color-text)',
  dimmed: 'var(--mantine-color-dimmed)',
  codeBg: 'color-mix(in srgb, var(--mantine-color-text) 14%, transparent)',
  quoteBg: 'color-mix(in srgb, var(--mantine-color-text) 5%, transparent)'
};

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

// Text you can drag-select, with an I-beam cursor and a highlight taken from
// the active theme. A theme can set --wh3d-selection-bg for a custom color;
// otherwise it is the theme's primary accent (neon pink in Cyberpunk) at 50%.
const SELECTION_CSS = `
.gam-text-select,
.gam-text-select * {
  cursor: text;
  -webkit-user-select: text;
  user-select: text;
}
.gam-text-select ::selection,
.gam-text-select::selection {
  background: var(
    --wh3d-selection-bg,
    color-mix(in srgb, var(--mantine-primary-color-filled, var(--mantine-color-indigo-6)) 50%, transparent)
  );
  color: var(--mantine-color-text);
}
`;

export function TextPreview({ libraryId, file, actions }: TextPreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 'preview' = Preview (markdown) / Rendered (html); 'raw' = Raw / Source.
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');
  const [copied, setCopied] = useState(false);

  // Right-click menu (Copy / Select all) over the text viewer.
  const viewerRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);

  // File editing: the pencil edits the open file itself (txt, ini, md, html...)
  // and Save / Ctrl+S writes it back to disk.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const ext = file.ext.toLowerCase();
  const isMarkdown = ['md', 'markdown'].includes(ext);
  const isHtml = ['html', 'htm', 'xhtml'].includes(ext);
  const isIni = isIniLikeExtension(file.ext);
  const isLicenseFile = isLicenseFilename(file.filename);
  const dirty = draft !== (content ?? '');

  // Opening another file or folder closes the editor and the menu, and every
  // file starts in its rendered view (Preview / Rendered).
  useEffect(() => {
    setEditing(false);
    setMenu(null);
    setViewMode('preview');
  }, [libraryId, file.id]);

  // Put the cursor in the box when the editor opens.
  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const fileUrl = `wh3d-file://${libraryId}/${file.id}`;

    fetch(fileUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (active) {
          setContent(text);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError((err as Error).message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [libraryId, file.id]);

  const copyText = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopy = () => copyText(content ?? '');

  // Select only the text inside the viewer (not the whole app window).
  const selectAllText = () => {
    const el = viewerRef.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const startEdit = () => {
    setDraft(content ?? '');
    setEditing(true);
  };

  const pasteIntoDraft = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        notifications.show({ color: 'yellow', message: 'The clipboard is empty.' });
        return;
      }
      setDraft(clip);
      editorRef.current?.focus();
    } catch {
      notifications.show({
        color: 'yellow',
        message: 'Could not read the clipboard. Paste the text into the box (Ctrl+V).'
      });
    }
  };

  const saveEdit = async () => {
    if (!editing || saving || !dirty) return;
    setSaving(true);
    try {
      // Writes `draft` to <folder>/<this file's name>, overwriting the file.
      const result = await ipc.writeSidecarLicense(
        libraryId,
        file.parentDir,
        file.filename,
        draft
      );
      if (!result.ok) {
        notifications.show({
          color: 'red',
          title: 'Could not save file',
          message: result.error
        });
        return;
      }
      // Show the new text right away (rendered / source views read `content`).
      setContent(draft);
      // If this file is the folder's license, tell the metadata panel too.
      if (isLicenseFile) publishLicense(libraryId, file.parentDir, draft, file.filename);
      setEditing(false);
    } catch (err) {
      // Shows the real reason (for example a missing IPC function) instead of
      // failing silently.
      notifications.show({
        color: 'red',
        title: 'Could not save file',
        message: (err as Error).message
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Center h="100%">
        <Loader size="sm" color="indigo" />
      </Center>
    );
  }

  if (error) {
    return (
      <Center h="100%">
        <Text size="sm" c="red.4">
          Failed to load text file: {error}
        </Text>
      </Center>
    );
  }

  // HTML shown rendered (inside the sandboxed iframe). The Source view of an
  // HTML file is just the normal text viewer below.
  const showHtmlRendered = isHtml && viewMode === 'preview' && !!content;

  return (
    <Box h="100%" w="100%" p="md" style={{ boxSizing: 'border-box' }}>
      <style>{SELECTION_CSS}</style>
      <Paper
        withBorder
        h="100%"
        bg={C.bg}
        style={{
          borderColor: C.border,
          borderRadius: 8,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header Bar */}
        <Group
          justify="space-between"
          px="md"
          py={8}
          style={{
            borderBottom: `1px solid ${C.border}`,
            background: C.headerBg
          }}
        >
          <Text size="xs" fw={600} c="dimmed" style={{ fontFamily: 'monospace' }}>
            {editing ? `Editing · ${file.filename}` : file.filename}
          </Text>

          <Group gap="xs">
            {(isMarkdown || isHtml) && !editing && (
              <SegmentedControl
                size="xs"
                value={viewMode}
                onChange={(val) => setViewMode(val as 'preview' | 'raw')}
                data={
                  isHtml
                    ? [
                        { label: 'Rendered', value: 'preview' },
                        { label: 'Source', value: 'raw' }
                      ]
                    : [
                        { label: 'Preview', value: 'preview' },
                        { label: 'Raw', value: 'raw' }
                      ]
                }
                styles={{
                  root: { backgroundColor: C.bg, border: `1px solid ${C.border}` }
                }}
              />
            )}
            {!editing && (
              <Tooltip label="Edit this file" withinPortal>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={startEdit}
                  aria-label="Edit file"
                >
                  <IconPencil size={14} />
                </ActionIcon>
              </Tooltip>
            )}
            {actions}
            <Tooltip label={copied ? 'Copied!' : 'Copy content'}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleCopy}>
                {copied ? <IconCheck size={14} color="#48bb78" /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {editing ? (
          // File editor: fills the card in place of the viewer.
          <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <HighlightedEditor
              ref={editorRef}
              value={draft}
              onChange={setDraft}
              render={
                isHtml
                  ? (t) => <HtmlSourceText content={t} />
                  : isIni
                    ? (t) => <IniText content={t} />
                    : undefined
              }
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                  e.preventDefault();
                  e.stopPropagation();
                  void saveEdit();
                } else if (e.key === 'Escape' && !dirty) {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              placeholder="Type here…"
            />
            <Group
              justify="space-between"
              px="md"
              py={8}
              wrap="nowrap"
              style={{ borderTop: `1px solid ${C.border}`, background: C.headerBg }}
            >
              <Text size="xs" c="dimmed" truncate>
                Saving overwrites this file. Ctrl+S to save.
              </Text>
              <Group gap={6} wrap="nowrap">
                {!draft.trim() && (
                  <Button
                    size="compact-xs"
                    variant="default"
                    leftSection={<IconClipboardText size={12} />}
                    onClick={() => void pasteIntoDraft()}
                    disabled={saving}
                  >
                    Paste
                  </Button>
                )}
                <Button
                  size="compact-xs"
                  variant="default"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  size="compact-xs"
                  onClick={() => void saveEdit()}
                  loading={saving}
                  disabled={!dirty}
                >
                  Save
                </Button>
              </Group>
            </Group>
          </Box>
        ) : showHtmlRendered ? (
          /* Rendered HTML: sandboxed iframe, no scripts, no network */
          <Box h="calc(100% - 45px)" style={{ minHeight: 0 }}>
            <HtmlPreview libraryId={libraryId} file={file} content={content ?? ''} />
          </Box>
        ) : (
        /* Content Viewer (also the Source view of HTML files) */
        <ScrollArea
          h="calc(100% - 45px)"
          type="auto"
          offsetScrollbars
          p="lg"
          classNames={{ viewport: 'gam-text-select' }}
          viewportRef={viewerRef}
          viewportProps={{
            tabIndex: 0,
            style: { outline: 'none' },
            onKeyDown: (e) => {
              // Ctrl+A selects just the preview text, not the whole window.
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                selectAllText();
              }
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({
              x: e.clientX,
              y: e.clientY,
              hasSelection: !!window.getSelection()?.toString()
            });
          }}
        >
          {!content ? (
            <Text c="dimmed" fs="italic" size="sm">
              File is empty.
            </Text>
          ) : isMarkdown && viewMode === 'preview' ? (
            <MarkdownRenderer content={content} />
          ) : (
            <Box
              component="pre"
              m={0}
              style={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: 13,
                lineHeight: 1.6,
                color: C.text,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {isIni ? (
                <IniText content={content} />
              ) : isHtml ? (
                <HtmlSourceText content={content} />
              ) : (
                content
              )}
            </Box>
          )}
        </ScrollArea>
        )}
      </Paper>

      {menu && (
        <TextContextMenu
          x={menu.x}
          y={menu.y}
          hasSelection={menu.hasSelection}
          onCopy={() => copyText(window.getSelection()?.toString() || content || '')}
          onSelectAll={selectAllText}
          onClose={() => setMenu(null)}
        />
      )}
    </Box>
  );
}

// Files bigger than this render as plain text: one <span> per token gets heavy.
const HIGHLIGHT_MAX_CHARS = 300_000;

type InkColor = Exclude<IniTokenType, 'plain'>;

const INI_DARK: Record<InkColor, string> = {
  comment: '#7f848e',
  section: '#e5c07b',
  key: '#61afef',
  punct: '#abb2bf',
  string: '#98c379',
  number: '#d19a66',
  bool: '#c678dd',
  value: 'inherit'
};

const INI_LIGHT: Record<InkColor, string> = {
  comment: '#6b7280',
  section: '#986801',
  key: '#0b5cad',
  punct: '#6b7280',
  string: '#2e7d32',
  number: '#b45309',
  bool: '#7e3fbf',
  value: 'inherit'
};

/** Syntax-highlighted INI text. Same characters as the file, only colored. */
function IniText({ content }: { content: string }) {
  const scheme = useComputedColorScheme('dark');
  const palette = scheme === 'light' ? INI_LIGHT : INI_DARK;
  const lines = useMemo(
    () => (content.length > HIGHLIGHT_MAX_CHARS ? null : tokenizeIni(content)),
    [content]
  );

  if (!lines) return <>{content}</>;

  return (
    <>
      {lines.map((tokens, i) => (
        <Fragment key={i}>
          {tokens.map((t, j) =>
            t.type === 'plain' ? (
              t.text
            ) : (
              <span
                key={j}
                style={{
                  color: palette[t.type],
                  fontStyle: t.type === 'comment' ? 'italic' : undefined,
                  fontWeight: t.type === 'section' ? 600 : undefined
                }}
              >
                {t.text}
              </span>
            )
          )}
          {i < lines.length - 1 ? '\n' : ''}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Lightweight GitHub-style Markdown Renderer
 */
function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n');

  // Simple inline parser for bold, italic, code, and escape slashes
  const renderInline = (text: string) => {
    // Unescape escaped periods like "1\." -> "1."
    let cleaned = text.replace(/\\([.\\*_\-\[\]()#+!])/g, '$1');

    // Parse inline patterns
    const parts = cleaned.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);

    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={index} style={{ color: C.text, fontWeight: 600 }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return (
          <em key={index} style={{ color: C.text }}>
            {part.slice(1, -1)}
          </em>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={index}
            style={{
              background: C.codeBg,
              padding: '0.2em 0.4em',
              borderRadius: 6,
              fontSize: '85%',
              fontFamily: 'monospace',
              color: C.text
            }}
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  return (
    <Stack gap="xs" style={{ color: C.text, fontSize: 14, lineHeight: 1.7 }}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return <Box key={idx} h={8} />;
        }

        // Headers
        if (trimmed.startsWith('# ')) {
          return (
            <Text
              key={idx}
              size="xl"
              fw={700}
              c={C.text}
              pb={4}
              style={{ borderBottom: `1px solid ${C.border}`, marginTop: 12 }}
            >
              {renderInline(trimmed.replace(/^#\s+/, ''))}
            </Text>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <Text
              key={idx}
              size="lg"
              fw={700}
              c={C.text}
              pb={4}
              style={{ borderBottom: `1px solid ${C.border}`, marginTop: 10 }}
            >
              {renderInline(trimmed.replace(/^##\s+/, ''))}
            </Text>
          );
        }
        if (trimmed.startsWith('### ')) {
          return (
            <Text key={idx} size="md" fw={700} c={C.text} mt={8}>
              {renderInline(trimmed.replace(/^###\s+/, ''))}
            </Text>
          );
        }

        // Blockquotes
        if (trimmed.startsWith('>')) {
          return (
            <Box
              key={idx}
              pl="md"
              py={4}
              style={{
                borderLeft: `4px solid ${C.border}`,
                color: C.dimmed,
                background: C.quoteBg,
                borderRadius: '0 6px 6px 0'
              }}
            >
              {renderInline(trimmed.replace(/^>\s*/, ''))}
            </Box>
          );
        }

        // Regular Paragraphs
        return (
          <Text key={idx} size="sm" c={C.text}>
            {renderInline(trimmed)}
          </Text>
        );
      })}
    </Stack>
  );
}