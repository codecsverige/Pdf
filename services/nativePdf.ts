import * as FileSystem from 'expo-file-system/legacy';
import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { PdfOutput } from './pdfEngine';

type NativeFileResult = {
  uri: string;
  bytes: number;
  pageCount: number;
  originalBytes?: number;
  flattened?: boolean;
};

type NativeRenderResult = {
  uri: string;
  page: number;
  bytes: number;
};

type NativeDownloadResult = {
  uri: string;
  bytes: number;
  folder: string;
};

type NativePdfModule = {
  protectPdf(inputUri: string, outputPath: string, password: string): Promise<NativeFileResult>;
  removePassword(inputUri: string, outputPath: string, password: string): Promise<NativeFileResult>;
  compressPdf(inputUri: string, outputPath: string, mode: 'balanced' | 'strong' | 'extreme'): Promise<NativeFileResult>;
  renderPage(inputUri: string, pageIndex: number, outputPath: string, dpi: number, quality: number, password?: string): Promise<NativeFileResult>;
  renderAllPages(inputUri: string, outputDir: string, dpi: number, quality: number, password?: string): Promise<NativeRenderResult[]>;
  inspectPdf(inputUri: string, password?: string): Promise<{ pageCount: number; encrypted: boolean; title: string; author: string }>;
  saveToDownloads(inputUri: string, fileName: string, mimeType: string): Promise<NativeDownloadResult>;
};

let cachedModule: NativePdfModule | null = null;

function nativeModule(): NativePdfModule {
  if (Platform.OS !== 'android') throw new Error('This native PDF engine is currently available on Android.');
  if (!cachedModule) cachedModule = requireNativeModule<NativePdfModule>('PdfNative');
  return cachedModule;
}

function cachePath(prefix: string, extension: string) {
  if (!FileSystem.cacheDirectory) throw new Error('App cache directory is unavailable.');
  return `${FileSystem.cacheDirectory}${prefix}_${Date.now()}.${extension}`;
}

function toOutput(result: NativeFileResult, fileName: string): PdfOutput {
  return { uri: result.uri, fileName, pageCount: result.pageCount, bytes: result.bytes };
}

export async function compressPdfNative(uri: string, mode: 'balanced' | 'strong' | 'extreme') {
  const fileName = `compressed_${mode}_${Date.now()}.pdf`;
  const output = cachePath(`compressed_${mode}`, 'pdf');
  const result = await nativeModule().compressPdf(uri, output, mode);
  return { ...toOutput(result, fileName), originalBytes: result.originalBytes ?? 0, flattened: Boolean(result.flattened) };
}

export async function protectPdfNative(uri: string, password: string) {
  const fileName = `protected_${Date.now()}.pdf`;
  const result = await nativeModule().protectPdf(uri, cachePath('protected', 'pdf'), password);
  return toOutput(result, fileName);
}

export async function unlockPdfNative(uri: string, password: string) {
  const fileName = `unlocked_${Date.now()}.pdf`;
  const result = await nativeModule().removePassword(uri, cachePath('unlocked', 'pdf'), password);
  return toOutput(result, fileName);
}

export async function renderPreviewPage(uri: string, pageIndex: number, password = '') {
  const output = cachePath(`preview_${pageIndex + 1}`, 'jpg');
  return nativeModule().renderPage(uri, pageIndex, output, 120, 86, password || undefined);
}

export async function renderAllPreviewPages(uri: string, password = '') {
  if (!FileSystem.cacheDirectory) throw new Error('App cache directory is unavailable.');
  const outputDir = `${FileSystem.cacheDirectory}pdf_preview_${Date.now()}`;
  await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
  return nativeModule().renderAllPages(uri, outputDir, 105, 82, password || undefined);
}

export async function pdfToImagesNative(uri: string, password = '') {
  if (!FileSystem.cacheDirectory) throw new Error('App cache directory is unavailable.');
  const outputDir = `${FileSystem.cacheDirectory}pdf_images_${Date.now()}`;
  await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
  return nativeModule().renderAllPages(uri, outputDir, 150, 90, password || undefined);
}

export async function inspectPdfNative(uri: string, password = '') {
  return nativeModule().inspectPdf(uri, password || undefined);
}

export async function saveToDownloadsNative(uri: string, fileName: string, mimeType: string) {
  return nativeModule().saveToDownloads(uri, fileName, mimeType);
}
