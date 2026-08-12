import * as FileSystem from 'expo-file-system/legacy';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export type PdfOutput = {
  uri: string;
  fileName: string;
  pageCount: number;
  bytes: number;
};

function decodedBase64Size(base64: string) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

async function loadPdf(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  try {
    return await PDFDocument.load(base64, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/encrypt/i.test(message)) {
      throw new Error('This PDF is password protected. Unlock it first, then try again.');
    }
    throw new Error(message || 'This PDF could not be opened.');
  }
}

async function persistPdf(pdf: PDFDocument, prefix: string): Promise<PdfOutput> {
  if (!FileSystem.cacheDirectory) throw new Error('App cache directory is unavailable.');
  if (pdf.getPageCount() < 1) throw new Error('A PDF must contain at least one page.');

  const fileName = `${prefix}_${Date.now()}.pdf`;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  const base64 = await pdf.saveAsBase64({ dataUri: false, useObjectStreams: true });
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    uri,
    fileName,
    pageCount: pdf.getPageCount(),
    bytes: decodedBase64Size(base64),
  };
}

export async function getPdfPageCount(uri: string) {
  return (await loadPdf(uri)).getPageCount();
}

export function parsePageSelection(expression: string, maxPages: number): number[] {
  const source = expression.replace(/\s+/g, '');
  if (!source) throw new Error('Enter pages, for example 1-3,5.');
  const result: number[] = [];

  for (const token of source.split(',')) {
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = start <= end ? 1 : -1;
      for (let value = start; value !== end + step; value += step) {
        if (value < 1 || value > maxPages) throw new Error(`Page ${value} is outside 1-${maxPages}.`);
        result.push(value - 1);
      }
    } else {
      if (!/^\d+$/.test(token)) throw new Error(`Invalid page expression: ${token}`);
      const value = Number(token);
      if (value < 1 || value > maxPages) throw new Error(`Page ${value} is outside 1-${maxPages}.`);
      result.push(value - 1);
    }
  }

  if (!result.length) throw new Error('No valid pages selected.');
  return result;
}

export async function mergePdfs(uris: string[]): Promise<PdfOutput> {
  if (uris.length < 2) throw new Error('Choose at least two PDF files.');
  const output = await PDFDocument.create({ updateMetadata: false });

  for (const uri of uris) {
    const source = await loadPdf(uri);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
  }

  return persistPdf(output, 'merged');
}

export async function extractPages(uri: string, expression: string): Promise<PdfOutput> {
  const source = await loadPdf(uri);
  const indices = parsePageSelection(expression, source.getPageCount());
  const output = await PDFDocument.create({ updateMetadata: false });
  const pages = await output.copyPages(source, indices);
  pages.forEach(page => output.addPage(page));
  return persistPdf(output, 'extracted');
}

export async function deletePages(uri: string, expression: string): Promise<PdfOutput> {
  const source = await loadPdf(uri);
  const total = source.getPageCount();
  const toDelete = new Set(parsePageSelection(expression, total));
  const keep = source.getPageIndices().filter(index => !toDelete.has(index));

  if (!keep.length) throw new Error('You cannot delete every page in the PDF.');

  const output = await PDFDocument.create({ updateMetadata: false });
  const pages = await output.copyPages(source, keep);
  pages.forEach(page => output.addPage(page));
  return persistPdf(output, 'pages_removed');
}

export async function reorderPages(uri: string, expression: string): Promise<PdfOutput> {
  const source = await loadPdf(uri);
  const total = source.getPageCount();
  const indices = parsePageSelection(expression, total);

  if (indices.length !== total || new Set(indices).size !== total) {
    throw new Error(`Use every page exactly once. This file has ${total} pages.`);
  }

  const output = await PDFDocument.create({ updateMetadata: false });
  const pages = await output.copyPages(source, indices);
  pages.forEach(page => output.addPage(page));
  return persistPdf(output, 'reordered');
}

export async function rotatePages(uri: string, expression = '', delta: 90 | 180 | 270 = 90) {
  const pdf = await loadPdf(uri);
  const total = pdf.getPageCount();
  const indices = expression.trim()
    ? parsePageSelection(expression, total)
    : Array.from({ length: total }, (_, index) => index);

  for (const index of new Set(indices)) {
    const page = pdf.getPage(index);
    page.setRotation(degrees(((page.getRotation().angle || 0) + delta) % 360));
  }

  return persistPdf(pdf, 'rotated');
}

export async function addPageNumbers(uri: string, startAt = 1) {
  const pdf = await loadPdf(uri);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  pdf.getPages().forEach((page, index) => {
    const text = String(startAt + index);
    const size = 10;
    const width = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: (page.getWidth() - width) / 2,
      y: 18,
      size,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });
  });

  return persistPdf(pdf, 'numbered');
}

export async function watermarkPdf(uri: string, watermark: string) {
  const text = watermark.trim();
  if (!text) throw new Error('Enter watermark text.');

  const pdf = await loadPdf(uri);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const page of pdf.getPages()) {
    const size = Math.max(24, Math.min(52, page.getWidth() / 9));
    let textWidth = 0;
    try {
      textWidth = font.widthOfTextAtSize(text, size);
    } catch {
      throw new Error('Text watermark currently supports Latin characters only.');
    }

    page.drawText(text, {
      x: Math.max(20, (page.getWidth() - textWidth * 0.7) / 2),
      y: page.getHeight() / 2,
      size,
      font,
      color: rgb(0.2, 0.2, 0.2),
      opacity: 0.18,
      rotate: degrees(35),
    });
  }

  return persistPdf(pdf, 'watermarked');
}
