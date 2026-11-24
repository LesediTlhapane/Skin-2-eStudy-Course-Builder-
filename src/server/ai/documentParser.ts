import zlib from 'zlib';

export const MAX_UPLOAD_BYTES = 4_500_000;
export const MAX_INFLATE_BYTES = 4 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 250;
export const MAX_EXTRACTED_CHARS = 200_000;

export function extractTextFromDocxBuffer(buffer: Buffer): string {
  try {
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('Uploaded DOCX exceeds the 4.5 MB size limit.');
    }
    let offset = 0;
    let entryCount = 0;
    const textParts: string[] = [];

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

      if (
        entryName === 'word/document.xml' ||
        entryName.startsWith('word/header') ||
        entryName.startsWith('word/footer')
      ) {
        let compressedSlice = buffer.subarray(
          dataStart,
          Math.min(buffer.length, dataStart + (compressedSize || buffer.length - dataStart))
        );
        if (compressedSize === 0) {
          const nextPk = buffer.indexOf(Buffer.from([0x50, 0x4b]), dataStart);
          if (nextPk > dataStart) {
            compressedSlice = buffer.subarray(dataStart, nextPk);
          }
        }

        let xmlContent = '';
        if (compressionMethod === 0) {
          if (compressedSlice.length > MAX_INFLATE_BYTES) {
            throw new Error('Invalid request: uncompressed XML entry exceeds safe limit.');
          }
          xmlContent = compressedSlice.toString('utf8');
        } else if (compressionMethod === 8) {
          try {
            xmlContent = zlib
              .inflateRawSync(compressedSlice, { maxOutputLength: MAX_INFLATE_BYTES })
              .toString('utf8');
          } catch (inflateErr: any) {
            if (String(inflateErr?.code) === 'ERR_BUFFER_TOO_LARGE') {
              throw new Error('Invalid request: DOCX content exceeds safe decompression limit.');
            }
            const nextHeader = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
            const endIdx = nextHeader > dataStart ? nextHeader : buffer.length;
            for (let trim = 0; trim <= 24 && endIdx - trim > dataStart; trim++) {
              try {
                xmlContent = zlib
                  .inflateRawSync(buffer.subarray(dataStart, endIdx - trim), {
                    maxOutputLength: MAX_INFLATE_BYTES,
                  })
                  .toString('utf8');
                break;
              } catch {
                // continue scanning
              }
            }
          }
        }

        if (xmlContent) {
          const plain = xmlContent
            .replace(/<\/w:p>/g, '\n')
            .replace(/<\/w:tr>/g, '\n')
            .replace(/<w:tab\/>/g, '\t')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/\n{3,}/g, '\n\n')
            .trim();
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
