import type { FileRecord } from '@shared/types';
import { isAudioExtension, isImageExtension, isVideoExtension } from '@shared/formats';

export type CompareKind = 'model' | 'image' | 'video' | 'audio' | 'text';

const TEXT_EXTS = ['md', 'txt', 'json', 'log', 'yaml', 'yml', 'ini', 'cfg', 'markdown'];

/** Which viewer a file opens with. */
export function compareKind(file: FileRecord): CompareKind {
  if (isVideoExtension(file.ext)) return 'video';
  if (isAudioExtension(file.ext)) return 'audio';
  if (TEXT_EXTS.includes(file.ext.replace(/^\./, '').toLowerCase())) return 'text';
  if (isImageExtension(file.ext)) return 'image';
  return 'model';
}

/** Compare is only offered for exactly two files of the same kind
 *  (two models, two images, two videos, two audio files or two text files). */
export function canCompare(files: FileRecord[]): boolean {
  return files.length === 2 && compareKind(files[0]) === compareKind(files[1]);
}