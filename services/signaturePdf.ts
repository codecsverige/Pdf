import * as FileSystem from 'expo-file-system/legacy';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PdfOutput } from './pdfEngine';
import type { SignaturePlacement } from '../components/SignaturePlacementEditor';

async function loadPdf(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return PDFDocument.load(base64, { updateMetadata: false });
}

function decodedBase64Size(base64: string) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

type ParsedPoint = { command: 'M' | 'L'; x: number; y: number };

function trimSvgPath(path: string, fallbackWidth: number, fallbackHeight: number) {
  const points: ParsedPoint[] = [];
  const regex = /([ML])\s*(-?\d+(?:\.\d+)?)\s*(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path))) points.push({ command: match[1] as 'M' | 'L', x: Number(match[2]), y: Number(match[3]) });
  if (!points.length) return { path, width: Math.max(1, fallbackWidth), height: Math.max(1, fallbackHeight) };

  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  const margin = 2;
  const width = Math.max(1, maxX - minX + margin * 2);
  const height = Math.max(1, maxY - minY + margin * 2);
  const trimmed = points.map(p => `${p.command} ${(p.x - minX + margin).toFixed(2)} ${(p.y - minY + margin).toFixed(2)}`).join(' ');
  return { path: trimmed, width, height };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function signPdf(
  uri: string,
  pageNumber: number,
  svgPath: string,
  sourceWidth: number,
  sourceHeight: number,
  placement: SignaturePlacement = { x: 0.60, y: 0.76, width: 0.32 },
): Promise<PdfOutput> {
  if (!svgPath.trim()) throw new Error('Draw a signature first.');
  if (!FileSystem.cacheDirectory) throw new Error('App cache directory is unavailable.');

  const pdf = await loadPdf(uri);
  if (pageNumber < 1 || pageNumber > pdf.getPageCount()) throw new Error(`Page must be between 1 and ${pdf.getPageCount()}.`);

  const page = pdf.getPage(pageNumber - 1);
  const trimmed = trimSvgPath(svgPath, sourceWidth, sourceHeight);
  const widthFraction = clamp(placement.width, 0.14, 0.72);
  const targetWidth = page.getWidth() * widthFraction;
  const scale = targetWidth / Math.max(1, trimmed.width);
  const targetHeight = trimmed.height * scale;

  const x = clamp(placement.x, 0, Math.max(0, 1 - widthFraction)) * page.getWidth();
  const maxTopFraction = Math.max(0, 1 - targetHeight / page.getHeight());
  const topFraction = clamp(placement.y, 0, maxTopFraction);
  const y = page.getHeight() - topFraction * page.getHeight();

  page.drawSvgPath(trimmed.path, {
    x,
    y,
    scale,
    borderColor: rgb(0.04, 0.08, 0.16),
    borderWidth: Math.max(1.15, 1.8 / Math.max(scale, 0.1)),
  });

  const fileName = `signed_${Date.now()}.pdf`;
  const outputUri = `${FileSystem.cacheDirectory}${fileName}`;
  const base64 = await pdf.saveAsBase64({ dataUri: false, useObjectStreams: true });
  await FileSystem.writeAsStringAsync(outputUri, base64, { encoding: FileSystem.EncodingType.Base64 });

  return { uri: outputUri, fileName, pageCount: pdf.getPageCount(), bytes: decodedBase64Size(base64) };
}
