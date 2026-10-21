import { useEffect, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip
} from '@mantine/core';
import { IconCopy, IconCheck } from '@tabler/icons-react';
import type { FileRecord } from '@shared/types';

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

export function TextPreview({ libraryId, file, actions }: TextPreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');
  const [copied, setCopied] = useState(false);

  const isMarkdown = ['md', 'markdown'].includes(file.ext.toLowerCase());

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

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

  return (
    <Box h="100%" w="100%" p="md" style={{ boxSizing: 'border-box' }}>
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
            {file.filename}
          </Text>

          <Group gap="xs">
            {isMarkdown && (
              <SegmentedControl
                size="xs"
                value={viewMode}
                onChange={(val) => setViewMode(val as 'preview' | 'raw')}
                data={[
                  { label: 'Preview', value: 'preview' },
                  { label: 'Raw', value: 'raw' }
                ]}
                styles={{
                  root: { backgroundColor: C.bg, border: `1px solid ${C.border}` }
                }}
              />
            )}
            {actions}
            <Tooltip label={copied ? 'Copied!' : 'Copy content'}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleCopy}>
                {copied ? <IconCheck size={14} color="#48bb78" /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Content Viewer */}
        <ScrollArea h="calc(100% - 45px)" type="auto" offsetScrollbars p="lg">
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
              {content}
            </Box>
          )}
        </ScrollArea>
      </Paper>
    </Box>
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