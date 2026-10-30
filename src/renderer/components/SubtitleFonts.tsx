import '@fontsource-variable/vazirmatn';
import '@fontsource-variable/inter';
import '@fontsource-variable/cairo';
import '@fontsource-variable/noto-naskh-arabic';
import '@fontsource-variable/noto-kufi-arabic';
import '@fontsource-variable/heebo';
import '@fontsource-variable/noto-sans-jp';
import '@fontsource-variable/noto-sans-kr';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/noto-sans-thai';
import '@fontsource-variable/noto-sans-devanagari';
import { Text, UnstyledButton } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { VIDEO_COMPACT_BAR } from '@shared/transition';
import { GlassScroll } from './PlayerMenu';

const TAIL = ", 'Segoe UI', Tahoma, Arial, sans-serif";

export interface SubFont {
  label: string;
  value: string; // stored in subCfg.font: 'auto' or a CSS font-family stack
  group: string;
  sample: string;
}

const VAZIR = "'Vazirmatn Variable'" + TAIL;
const INTER = "'Inter Variable'" + TAIL;
const HEEBO = "'Heebo Variable'" + TAIL;
const JP = "'Noto Sans JP Variable'" + TAIL;
const KR = "'Noto Sans KR Variable'" + TAIL;
const SC = "'Noto Sans SC Variable'" + TAIL;
const THAI = "'Noto Sans Thai Variable'" + TAIL;
const DEVA = "'Noto Sans Devanagari Variable'" + TAIL;

const FA = '\u0633\u0644\u0627\u0645'; // Persian / Arabic
const HE = '\u05E9\u05DC\u05D5\u05DD'; // Hebrew
const LAT = 'AaYb';

export const SUB_FONT_DEFAULT = 'auto';

// Group order = menu order. Sorted by how often games ship these languages.
export const SUB_FONTS: SubFont[] = [
  { group: 'Automatic', label: 'Auto (by language)', value: 'auto', sample: LAT },

  { group: 'English / Latin / Cyrillic', label: 'Inter', value: INTER, sample: LAT },
  { group: 'English / Latin / Cyrillic', label: 'Segoe UI', value: "'Segoe UI', Arial, sans-serif", sample: LAT },
  { group: 'English / Latin / Cyrillic', label: 'Arial', value: 'Arial, Helvetica, sans-serif', sample: LAT },
  { group: 'English / Latin / Cyrillic', label: 'Verdana', value: 'Verdana, Geneva, sans-serif', sample: LAT },
  { group: 'English / Latin / Cyrillic', label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif', sample: LAT },
  { group: 'English / Latin / Cyrillic', label: 'Georgia (serif)', value: 'Georgia, serif', sample: LAT },
  { group: 'English / Latin / Cyrillic', label: 'Courier New (mono)', value: "'Courier New', monospace", sample: LAT },

  { group: 'Chinese', label: 'Noto Sans SC', value: SC, sample: '\u4F60\u597D' },
  { group: 'Japanese', label: 'Noto Sans JP', value: JP, sample: '\u3042\u30A2\u6F22' },
  { group: 'Korean', label: 'Noto Sans KR', value: KR, sample: '\uAC00\uB098\uB2E4' },

  { group: 'Persian / Arabic', label: 'Vazirmatn', value: VAZIR, sample: FA },
  { group: 'Persian / Arabic', label: 'Cairo', value: "'Cairo Variable'" + TAIL, sample: FA },
  { group: 'Persian / Arabic', label: 'Noto Naskh Arabic', value: "'Noto Naskh Arabic Variable'" + TAIL, sample: FA },
  { group: 'Persian / Arabic', label: 'Noto Kufi Arabic', value: "'Noto Kufi Arabic Variable'" + TAIL, sample: FA },

  { group: 'Thai', label: 'Noto Sans Thai', value: THAI, sample: '\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35' },
  { group: 'Hindi', label: 'Noto Sans Devanagari', value: DEVA, sample: '\u0928\u092E\u0938\u094D\u0924\u0947' },

  { group: 'Hebrew', label: 'Heebo', value: HEEBO, sample: HE }
];

/** Picks a font from the script of the text being shown. */
export function autoSubFont(text: string): string {
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text)) return VAZIR;
  if (/[\u0590-\u05FF]/.test(text)) return HEEBO;
  if (/[\u3040-\u30FF]/.test(text)) return JP; // kana first: Japanese also contains Han
  if (/[\uAC00-\uD7AF]/.test(text)) return KR;
  if (/[\u4E00-\u9FFF]/.test(text)) return SC;
  if (/[\u0E00-\u0E7F]/.test(text)) return THAI;
  if (/[\u0900-\u097F]/.test(text)) return DEVA;
  return INTER;
}

export const resolveSubFont = (value: string, text: string): string =>
  value === 'auto' ? autoSubFont(text) : value;

const dur = VIDEO_COMPACT_BAR.durationMs;
const ease = VIDEO_COMPACT_BAR.cssEasing;

/** Flat, grouped font list. Meant to be the content of a context-menu flyout section. */
export function FontList({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const groups = Array.from(new Set(SUB_FONTS.map((f) => f.group)));
  return (
    <div>
      <style>{`
        .gam-fontopt { display:flex; align-items:center; justify-content:space-between; gap:10px;
          width:100%; padding:6px 8px; border-radius:8px; transition: background ${dur}ms ${ease}; }
        .gam-fontopt:hover { background: rgba(255,255,255,0.09); }
        .gam-fontopt[data-on="true"] { background: rgba(92,124,250,0.22); }
      `}</style>
      <GlassScroll maxHeight={380}>
        {groups.map((g) => (
          <div key={g}>
            <Text size="10px" c="dimmed" tt="uppercase" fw={700} px={8} pt={8} pb={2}>
              {g}
            </Text>
            {SUB_FONTS.filter((f) => f.group === g).map((f) => {
              const fam = f.value === 'auto' ? undefined : f.value;
              const on = f.value === value;
              return (
                <UnstyledButton
                  key={f.label}
                  className="gam-fontopt"
                  data-on={on ? 'true' : 'false'}
                  onClick={() => onChange(f.value)}
                >
                  <span style={{ fontSize: 13, fontFamily: fam }}>{f.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span dir="auto" style={{ fontSize: 13, opacity: 0.65, whiteSpace: 'nowrap', fontFamily: fam }}>
                      {f.sample}
                    </span>
                    {on && <IconCheck size={13} />}
                  </span>
                </UnstyledButton>
              );
            })}
          </div>
        ))}
      </GlassScroll>
    </div>
  );
}