import zlib from 'zlib';

export function extractTextFromDocxBuffer(buffer: Buffer): string {
  try {
    let offset = 0;
    const textParts: string[] = [];

    while (offset + 30 <= buffer.length) {
      const signature = buffer.readUInt32LE(offset);
      if (signature !== 0x04034b50) {
        offset++;
        continue;
      }

      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraFieldLength = buffer.readUInt16LE(offset + 28);
      const dataStart = offset + 30 + fileNameLength + extraFieldLength;
      if (dataStart > buffer.length) break;

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
          xmlContent = compressedSlice.toString('utf8');
        } else if (compressionMethod === 8) {
          try {
            xmlContent = zlib.inflateRawSync(compressedSlice).toString('utf8');
          } catch {
            const nextHeader = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
            const endIdx = nextHeader > dataStart ? nextHeader : buffer.length;
            for (let trim = 0; trim <= 24 && endIdx - trim > dataStart; trim++) {
              try {
                xmlContent = zlib
                  .inflateRawSync(buffer.subarray(dataStart, endIdx - trim))
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

    return textParts.join('\n\n').trim();
  } catch (err) {
    console.warn('DOCX extraction warning:', err);
    return '';
  }
}

export function extractTextFromPdfBuffer(buffer: Buffer): string {
  try {
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
    while ((match = streamRegex.exec(rawStr)) !== null) {
      const streamContent = match[1];
      const streamBuf = Buffer.from(streamContent, 'latin1');
      let decompressed = '';
      try {
        decompressed = zlib.inflateSync(streamBuf).toString('latin1');
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
      return joined;
    }

    // Fallback: extract printable ASCII sequences if PDF uses simple literal streams
    const fallbackMatches = rawStr.match(/[A-Za-z0-9][A-Za-z0-9 ,.;:()'"/%-]{18,}/g) || [];
    const filtered = fallbackMatches.filter(
      s => !/^(obj|endobj|stream|endstream|xref|trailer|FlateDecode|FontDescriptor)/.test(s)
    );
    return filtered.join('\n').slice(0, 40000);
  } catch (err) {
    console.warn('PDF extraction warning:', err);
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
    return params.rawText.trim();
  }
  if (!params.base64Data) return '';

  const buffer = Buffer.from(params.base64Data, 'base64');
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

  return buffer.toString('utf8').trim();
}
