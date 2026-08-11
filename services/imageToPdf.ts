import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { PDFDocument, PageSizes } from 'pdf-lib';
import type { PdfOutput } from './pdfEngine';

export type ImageInput = {
  uri: string;
  width?: number;
  height?: number;
};

export type ImageToPdfOptions = {
  margin?: number;
  jpegQuality?: number;
  maxImageWidth?: number;
  pageMode?: 'auto' | 'portrait' | 'landscape';
};

function decodedBase64Size(base64: string) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function fitInside(sourceWidth: number, sourceHeight: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale };
}

function pageSizeFor(width: number, height: number, mode: ImageToPdfOptions['pageMode']): [number, number] {
  const [a4Width, a4Height] = PageSizes.A4;
  if (mode === 'portrait') return [a4Width, a4Height];
  if (mode === 'landscape') return [a4Height, a4Width];
  return width > height ? [a4Height, a4Width] : [a4Width, a4Height];
}

export async function imagesToPdf(
  images: ImageInput[],
  options: ImageToPdfOptions = {},
): Promise<PdfOutput> {
  if (!images.length) throw new Error('Choose at least one image.');
  if (!FileSystem.cacheDirectory) throw new Error('App cache directory is unavailable.');

  const margin = Math.max(0, options.margin ?? 28);
  const quality = Math.max(0.2, Math.min(1, options.jpegQuality ?? 0.9));
  const maxImageWidth = Math.max(600, options.maxImageWidth ?? 2200);
  const mode = options.pageMode ?? 'auto';
  const pdf = await PDFDocument.create({ updateMetadata: false });

  for (const image of images) {
    const actions: ImageManipulator.Action[] = [];
    if (image.width && image.width > maxImageWidth) {
      actions.push({ resize: { width: maxImageWidth } });
    }

    const normalized = await ImageManipulator.manipulateAsync(image.uri, actions, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (!normalized.base64) throw new Error('Could not read one of the selected images.');

    const embedded = await pdf.embedJpg(normalized.base64);
    const [pageWidth, pageHeight] = pageSizeFor(embedded.width, embedded.height, mode);
    const page = pdf.addPage([pageWidth, pageHeight]);
    const fitted = fitInside(
      embedded.width,
      embedded.height,
      pageWidth - margin * 2,
      pageHeight - margin * 2,
    );

    page.drawImage(embedded, {
      x: (pageWidth - fitted.width) / 2,
      y: (pageHeight - fitted.height) / 2,
      width: fitted.width,
      height: fitted.height,
    });
  }

  const fileName = `images_${Date.now()}.pdf`;
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
