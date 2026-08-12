import * as FileSystem from 'expo-file-system/legacy';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PdfOutput } from './pdfEngine';

async function loadPdf(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return PDFDocument.load(base64, { updateMetadata: false });
}

function decodedBase64Size(base64: string) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export async function signPdf(
  uri: string,
  pageNumber: number,
  svgPath: string,
  sourceWidth: number,
  sourceHeight: number,
): Promise<PdfOutput> {
  if (!svgPath.trim()) throw new Error('Draw a signature first.');
  if (!FileSystem.cacheDirectory) throw new Error('App cache directory is unavailable.');

  const pdf = await loadPdf(uri);
  if (pageNumber < 1 || pageNumber > pdf.getPageCount()) {
    throw new Error(`Page must be between 1 and ${pdf.getPageCount()}.`);
  }

  const page = pdf.getPage(pageNumber - 1);
  const targetWidth = Math.min(page.getWidth() * 0.42, 230);
  const scale = targetWidth / Math.max(1, sourceWidth);
  const targetHeight = sourceHeight * scale;

  page.drawSvgPath(svgPath, {
    x: Math.max(28, page.getWidth() - targetWidth - 42),
    y: Math.max(34, 42 + targetHeight),
    scale,
    borderColor: rgb(0.04, 0.08, 0.16),
    borderWidth: Math.max(1.2, 2 / Math.max(scale, 0.1)),
  });

  const fileName = `signed_${Date.now()}.pdf`;
  const outputUri = `${FileSystem.cacheDirectory}${fileName}`;
  const base64 = await pdf.saveAsBase64({ dataUri: false, useObjectStreams: true });
  await FileSystem.writeAsStringAsync(outputUri, base64, { encoding: FileSystem.EncodingType.Base64 });

  return {
    uri: outputUri,
    fileName,
    pageCount: pdf.getPageCount(),
    bytes: decodedBase64Size(base64),
  };
}
