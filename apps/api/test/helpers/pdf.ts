import zlib from 'node:zlib';
import fc from 'fast-check';

/**
 * Extracts the text drawn with `TJ` operators from every content stream.
 * pdfkit writes standard-font text as hex strings, so decoding them as Latin-1
 * (the WinAnsi code points used here) recovers accented Spanish text too.
 * Each text run lands on its own line.
 *
 * Stream bytes are taken from the dictionary's `/Length`: compressed data may
 * itself end in CR or LF, so trimming end-of-line characters would corrupt it.
 */
export function pdfText(pdf: Buffer): string {
  return pdfPages(pdf).join('\n');
}

/**
 * Text of each page, in order. pdfkit writes one content stream per page, so
 * every stream that draws text is one page.
 */
export function pdfPages(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const pages: string[] = [];
  const keyword = /stream\r?\n/g;
  let match: RegExpExecArray | null;

  while ((match = keyword.exec(raw)) !== null) {
    if (raw.slice(match.index - 3, match.index) === 'end') continue; // "endstream"

    const start = match.index + match[0].length;
    const dictionary = raw.slice(raw.lastIndexOf(' obj', match.index), match.index);
    const declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary);

    let bytes: Buffer;
    if (declared) {
      const length = Number(declared[1]);
      bytes = pdf.subarray(start, start + length);
      keyword.lastIndex = start + length;
    } else {
      const end = raw.indexOf('endstream', start);
      if (end === -1) break;
      bytes = pdf.subarray(start, end);
      keyword.lastIndex = end;
    }

    let content: string;
    try {
      content = zlib.inflateSync(bytes).toString('latin1');
    } catch {
      content = bytes.toString('latin1');
    }

    const lines: string[] = [];
    for (const run of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const pieces = [...(run[1] ?? '').matchAll(/<([0-9a-fA-F]*)>/g)].map((hex) =>
        Buffer.from(hex[1] ?? '', 'hex').toString('latin1'),
      );
      lines.push(pieces.join(''));
    }
    if (lines.length > 0) pages.push(lines.join('\n'));
  }

  return pages;
}

/** Collapses wrapped lines and repeated whitespace into single spaces. */
export const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** DD/MM/YYYY of a UTC calendar day. */
export const formatDay = (date: Date): string =>
  `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;

/** DD/MM/YYYY HH:MM in UTC (the unit suite runs with APP_TIMEZONE=UTC). */
export const formatDateTimeUtc = (date: Date): string =>
  `${formatDay(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

const WORD_CHARS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789áéíóúñÁÉÍÓÚÑ',
];

export const wordArb = fc
  .array(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(''));

/** Space-separated words, at most `maxLength` chars — text that wraps like real prose. */
export const wordsArb = (maxLength: number): fc.Arbitrary<string> =>
  fc
    .array(wordArb, { minLength: 1, maxLength: Math.max(1, Math.ceil(maxLength / 5)) })
    .map((words) => words.join(' ').slice(0, maxLength).trim())
    .filter((text) => text.length > 0);
