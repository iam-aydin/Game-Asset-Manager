import { useEffect, useState } from 'react';
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
}

export function TextPreview({ libraryId, file }: TextPreviewProps) {
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
        bg="#0d1117"
        style={{
          borderColor: '#30363d',
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
            borderBottom: '1px solid #30363d',
            background: '#161b22'
          }}
        >
          <Text size="xs" fw={600} c="gray.4" style={{ fontFamily: 'monospace' }}>
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
                  root: { backgroundColor: '#0d1117', border: '1px solid #30363d' }
                }}
              />
            )}
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
                color: '#c9d1d9',
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
          <strong key={index} style={{ color: '#f0f6fc', fontWeight: 600 }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return (
          <em key={index} style={{ color: '#c9d1d9' }}>
            {part.slice(1, -1)}
          </em>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={index}
            style={{
              background: 'rgba(110,118,129,0.4)',
              padding: '0.2em 0.4em',
              borderRadius: 6,
              fontSize: '85%',
              fontFamily: 'monospace',
              color: '#f0f6fc'
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
    <Stack gap="xs" style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.7 }}>
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
              c="#f0f6fc"
              pb={4}
              style={{ borderBottom: '1px solid #21262d', marginTop: 12 }}
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
              c="#f0f6fc"
              pb={4}
              style={{ borderBottom: '1px solid #21262d', marginTop: 10 }}
            >
              {renderInline(trimmed.replace(/^##\s+/, ''))}
            </Text>
          );
        }
        if (trimmed.startsWith('### ')) {
          return (
            <Text key={idx} size="md" fw={700} c="#f0f6fc" mt={8}>
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
                borderLeft: '4px solid #30363d',
                color: '#8b949e',
                background: 'rgba(110,118,129,0.05)',
                borderRadius: '0 6px 6px 0'
              }}
            >
              {renderInline(trimmed.replace(/^>\s*/, ''))}
            </Box>
          );
        }

        // Regular Paragraphs
        return (
          <Text key={idx} size="sm" c="#c9d1d9">
            {renderInline(trimmed)}
          </Text>
        );
      })}
    </Stack>
  );
}