import zlib from 'zlib';

export const MAX_UPLOAD_BYTES = 4_500_000;
export const MAX_INFLATE_BYTES = 4 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 250;
export const MAX_EXTRACTED_CHARS = 200_000;

interface ZipEntryRecord {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function xmlToReadableText(xmlContent: string): string {
  return xmlContent
    .replace(/<\/w:p>\s*<\/w:tc>/g, '\t|\t')
    .replace(/<\/w:tc>/g, '\t|\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\n+$/g, '');
}

function isWordTextEntry(entryName: string): boolean {
  return (
    entryName === 'word/document.xml' ||
    entryName.startsWith('word/header') ||
    entryName.startsWith('word/footer')
  );
}

function findCentralDirectoryEntries(buffer: Buffer): ZipEntryRecord[] | null {
  const minEocdSearch = Math.max(0, buffer.length - 65_557);
  let eocdOffset = -1;

  for (let i = buffer.length - 22; i >= minEocdSearch; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    totalEntries > MAX_ZIP_ENTRIES * 4 ||
    centralDirOffset + centralDirSize > buffer.length
  ) {
    return null;
  }

  const entries: ZipEntryRecord[] = [];
  let cursor = centralDirOffset;
  let parsed = 0;

  while (cursor + 46 <= buffer.length && parsed < totalEntries) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    parsed++;
    if (parsed > MAX_ZIP_ENTRIES) {
      throw new Error('Invalid request: ZIP/DOCX archive contains too many entries.');
    }

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraFieldLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    const nameStart = cursor + 46;
    if (nameStart + fileNameLength > buffer.length) break;
    const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString('utf8');

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    cursor = nameStart + fileNameLength + extraFieldLength + commentLength;
  }

  return entries.length > 0 ? entries : null;
}

function inflateZipSlice(
  compressedSlice: Buffer,
  compressionMethod: number
): string {
  if (compressionMethod === 0) {
    if (compressedSlice.length > MAX_INFLATE_BYTES) {
      throw new Error('Invalid request: uncompressed XML entry exceeds safe limit.');
    }
    return compressedSlice.toString('utf8');
  }
  if (compressionMethod === 8) {
    try {
      return zlib
        .inflateRawSync(compressedSlice, { maxOutputLength: MAX_INFLATE_BYTES })
        .toString('utf8');
    } catch (inflateErr: any) {
      if (String(inflateErr?.code) === 'ERR_BUFFER_TOO_LARGE') {
        throw new Error('Invalid request: DOCX content exceeds safe decompression limit.', {
          cause: inflateErr,
        });
      }
      return '';
    }
  }
  return '';
}

export function extractTextFromDocxBuffer(buffer: Buffer): string {
  try {
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('Uploaded DOCX exceeds the 4.5 MB size limit.');
    }

    const textParts: string[] = [];

    // Strategy 1: Authoritative ZIP Central Directory lookup (handles JSZip/Word data descriptors cleanly)
    const centralEntries = findCentralDirectoryEntries(buffer);
    if (centralEntries && centralEntries.length > 0) {
      // Order document.xml first, then headers/footers
      const wordEntries = centralEntries
        .filter(e => isWordTextEntry(e.name))
        .sort((a, b) => {
          if (a.name === 'word/document.xml') return -1;
          if (b.name === 'word/document.xml') return 1;
          return a.name.localeCompare(b.name);
        });

      for (const entry of wordEntries) {
        if (entry.uncompressedSize > MAX_INFLATE_BYTES) {
          throw new Error('Invalid request: archive entry exceeds safe uncompressed size limit.');
        }
        const loc = entry.localHeaderOffset;
        if (loc + 30 > buffer.length || buffer.readUInt32LE(loc) !== 0x04034b50) {
          continue;
        }
        const localNameLen = buffer.readUInt16LE(loc + 26);
        const localExtraLen = buffer.readUInt16LE(loc + 28);
        const dataStart = loc + 30 + localNameLen + localExtraLen;
        if (dataStart > buffer.length) continue;

        const dataEnd = Math.min(buffer.length, dataStart + entry.compressedSize);
        const slice = buffer.subarray(dataStart, dataEnd);
        const xmlContent = inflateZipSlice(slice, entry.compressionMethod);
        if (xmlContent) {
          const plain = xmlToReadableText(xmlContent);
          if (plain) textParts.push(plain);
        }
      }

      if (textParts.length > 0) {
        return textParts.join('\n\n').trim().slice(0, MAX_EXTRACTED_CHARS);
      }
    }

    // Strategy 2: Linear Local File Header scan fallback (if Central Directory is damaged/absent)
    let offset = 0;
    let entryCount = 0;
    while (offset + 30 <= buffer.length) {
      const signature = buffer.readUInt32LE(offset);
      if (signature !== 0x04034b50) {
        offset++;
        continue;
      }

      entryCount++;
      if (entryCount > MAX_ZIP_ENTRIES) {
        throw new Error('Invalid request: ZIP/DOCX archive contains too many entries.');
      }

      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraFieldLength = buffer.readUInt16LE(offset + 28);
      const dataStart = offset + 30 + fileNameLength + extraFieldLength;
      if (dataStart > buffer.length) break;
      if (uncompressedSize > MAX_INFLATE_BYTES) {
        throw new Error('Invalid request: archive entry exceeds safe uncompressed size limit.');
      }

      const entryName = buffer
        .subarray(offset + 30, offset + 30 + fileNameLength)
        .toString('utf8');

      if (isWordTextEntry(entryName)) {
        let compressedSlice = buffer.subarray(
          dataStart,
          Math.min(buffer.length, dataStart + (compressedSize || buffer.length - dataStart))
        );
        if (compressedSize === 0) {
          const nextPk = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
          const nextCd = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
          const candidates = [nextPk, nextCd].filter(x => x > dataStart);
          if (candidates.length > 0) {
            compressedSlice = buffer.subarray(dataStart, Math.min(...candidates));
          }
        }

        let xmlContent = inflateZipSlice(compressedSlice, compressionMethod);
        if (!xmlContent && compressionMethod === 8) {
          const nextHeader = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
          const endIdx = nextHeader > dataStart ? nextHeader : buffer.length;
          for (let trim = 0; trim <= 24 && endIdx - trim > dataStart; trim++) {
            xmlContent = inflateZipSlice(buffer.subarray(dataStart, endIdx - trim), 8);
            if (xmlContent) break;
          }
        }

        if (xmlContent) {
          const plain = xmlToReadableText(xmlContent);
          if (plain) textParts.push(plain);
        }
      }

      offset = dataStart + Math.max(1, compressedSize);
    }

    return textParts.join('\n\n').trim().slice(0, MAX_EXTRACTED_CHARS);
  } catch (err: any) {
    if (String(err?.message || '').includes('Invalid request')) {
      throw err;
    }
    console.warn('DOCX extraction warning:', err?.message || err);
    return '';
  }
}

export function extractTextFromPdfBuffer(buffer: Buffer): string {
  try {
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('Invalid request: PDF exceeds the 4.5 MB size limit.');
    }
    const rawStr = buffer.toString('latin1');
    const chunks: string[] = [];

    const decodePdfLiteral = (s: string) =>
      s
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');

    const extractTextOperators = (streamText: string) => {
      const tjMatches = streamText.match(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g);
      if (tjMatches) {
        for (const m of tjMatches) {
          const inner = m.replace(/\)\s*Tj$/, '').replace(/^\(/, '');
          const decoded = decodePdfLiteral(inner).trim();
          if (decoded) chunks.push(decoded);
        }
      }
      const tjArrayMatches = streamText.match(/\[(.*?)\]\s*TJ/gs);
      if (tjArrayMatches) {
        for (const arr of tjArrayMatches) {
          const parts = arr.match(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g);
          if (parts) {
            const joined = parts
              .map(p => decodePdfLiteral(p.slice(1, -1)))
              .join('')
              .trim();
            if (joined) chunks.push(joined);
          }
        }
      }
    };

    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    let match: RegExpExecArray | null;
    let streamCount = 0;
    while ((match = streamRegex.exec(rawStr)) !== null && streamCount < 400) {
      streamCount++;
      const streamContent = match[1];
      const streamBuf = Buffer.from(streamContent, 'latin1');
      let decompressed = '';
      try {
        decompressed = zlib
          .inflateSync(streamBuf, { maxOutputLength: MAX_INFLATE_BYTES })
          .toString('latin1');
      } catch {
        decompressed = streamContent;
      }
      if (decompressed.includes('Tj') || decompressed.includes('TJ')) {
        extractTextOperators(decompressed);
      }
    }

    const joined = chunks
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
      .trim();

    if (joined.length >= 60) {
      return joined.slice(0, MAX_EXTRACTED_CHARS);
    }

    // Fallback: extract printable ASCII sequences if PDF uses simple literal streams
    const fallbackMatches = rawStr.match(/[A-Za-z0-9][A-Za-z0-9 ,.;:()'"/%-]{18,}/g) || [];
    const filtered = fallbackMatches.filter(
      s => !/^(obj|endobj|stream|endstream|xref|trailer|FlateDecode|FontDescriptor)/.test(s)
    );
    return filtered.join('\n').slice(0, 40000);
  } catch (err: any) {
    if (String(err?.message || '').includes('Invalid request')) {
      throw err;
    }
    console.warn('PDF extraction warning:', err?.message || err);
    return '';
  }
}

export function extractUploadedDocumentText(params: {
  fileName: string;
  mimeType?: string;
  base64Data?: string;
  rawText?: string;
}): string {
  if (params.rawText && params.rawText.trim()) {
    return params.rawText.trim().slice(0, MAX_EXTRACTED_CHARS);
  }
  if (!params.base64Data) return '';

  const compactB64 = params.base64Data.replace(/\s+/g, '');
  if (compactB64.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 16) {
    throw new Error('Invalid request: Uploaded file exceeds the 4.5 MB limit.');
  }

  const buffer = Buffer.from(compactB64, 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Invalid request: Uploaded file exceeds the 4.5 MB limit.');
  }

  const lowerName = params.fileName.toLowerCase();
  const mime = (params.mimeType || '').toLowerCase();

  if (
    lowerName.endsWith('.docx') ||
    mime.includes('wordprocessingml') ||
    mime.includes('msword')
  ) {
    return extractTextFromDocxBuffer(buffer);
  }

  if (lowerName.endsWith('.pdf') || mime.includes('pdf')) {
    return extractTextFromPdfBuffer(buffer);
  }

  return buffer.toString('utf8').trim().slice(0, MAX_EXTRACTED_CHARS);
}
