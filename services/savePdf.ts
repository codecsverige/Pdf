import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { saveToDownloadsNative } from './nativePdf';

export type SavePreferences = {
  directoryUri: string | null;
  autoSave: boolean;
};

export type SavedFile = {
  uri: string;
  directoryUri: string;
};

const DEFAULT_PREFERENCES: SavePreferences = {
  directoryUri: null,
  autoSave: false,
};

const preferencesFile = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}pdf-pro-save-preferences.json`
  : null;

function safeFileName(fileName: string, fallback: string) {
  const cleaned = (fileName || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

async function readAsBase64(uri: string) {
  if (!uri) throw new Error('The generated file is missing.');
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('The generated file no longer exists in app cache.');
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

async function writeToDirectory(sourceUri: string, fileName: string, mimeType: string, directoryUri: string) {
  const base64 = await readAsBase64(sourceUri);
  const destination = await FileSystem.StorageAccessFramework.createFileAsync(
    directoryUri,
    safeFileName(fileName, mimeType === 'application/pdf' ? 'document.pdf' : 'file'),
    mimeType,
  );
  await FileSystem.writeAsStringAsync(destination, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return destination;
}

async function writeDirectDownload(sourceUri: string, fileName: string, mimeType: string): Promise<SavedFile | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const saved = await saveToDownloadsNative(sourceUri, safeFileName(fileName, 'PDF-Pro-file'), mimeType);
    return { uri: saved.uri, directoryUri: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/Android 10|Save As/i.test(message)) return null;
    throw error;
  }
}

export async function getSavePreferences(): Promise<SavePreferences> {
  if (!preferencesFile) return DEFAULT_PREFERENCES;
  try {
    const info = await FileSystem.getInfoAsync(preferencesFile);
    if (!info.exists) return DEFAULT_PREFERENCES;
    const raw = await FileSystem.readAsStringAsync(preferencesFile);
    const parsed = JSON.parse(raw) as Partial<SavePreferences>;
    return {
      directoryUri: typeof parsed.directoryUri === 'string' && parsed.directoryUri ? parsed.directoryUri : null,
      autoSave: parsed.autoSave === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function setSavePreferences(preferences: SavePreferences) {
  if (!preferencesFile) return;
  await FileSystem.writeAsStringAsync(preferencesFile, JSON.stringify(preferences));
}

export async function chooseSaveFolder(initialDirectoryUri?: string | null) {
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
    initialDirectoryUri || undefined,
  );
  if (!permission.granted) throw new Error('Folder selection was cancelled.');
  return permission.directoryUri;
}

export async function savePdfToDirectory(sourceUri: string, fileName: string, directoryUri: string): Promise<SavedFile> {
  const uri = await writeToDirectory(sourceUri, safeFileName(fileName, 'document.pdf'), 'application/pdf', directoryUri);
  return { uri, directoryUri };
}

export async function savePdfToPreferredFolder(
  sourceUri: string,
  fileName: string,
  preferredDirectoryUri?: string | null,
): Promise<SavedFile> {
  if (preferredDirectoryUri) {
    try {
      return await savePdfToDirectory(sourceUri, fileName, preferredDirectoryUri);
    } catch {
      // Android can revoke a persisted SAF grant. Fall back to direct Downloads or a fresh picker.
    }
  }

  const direct = await writeDirectDownload(sourceUri, fileName, 'application/pdf');
  if (direct) return direct;

  const directoryUri = await chooseSaveFolder(preferredDirectoryUri);
  return savePdfToDirectory(sourceUri, fileName, directoryUri);
}

export async function savePdfToChosenFolder(sourceUri: string, fileName: string): Promise<SavedFile> {
  const directoryUri = await chooseSaveFolder();
  return savePdfToDirectory(sourceUri, fileName, directoryUri);
}

async function saveImagesToDirectory(images: { uri: string; page: number }[], directoryUri: string) {
  if (!images.length) throw new Error('There are no rendered pages to save.');
  const saved: string[] = [];
  for (const item of images) {
    const name = `page_${item.page.toString().padStart(3, '0')}.jpg`;
    saved.push(await writeToDirectory(item.uri, name, 'image/jpeg', directoryUri));
  }
  return { uris: saved, directoryUri };
}

async function saveImagesDirectly(images: { uri: string; page: number }[]) {
  if (Platform.OS !== 'android' || !images.length) return null;
  const uris: string[] = [];
  try {
    for (const item of images) {
      const name = `PDF-Pro-page_${item.page.toString().padStart(3, '0')}.jpg`;
      const saved = await saveToDownloadsNative(item.uri, name, 'image/jpeg');
      uris.push(saved.uri);
    }
    return { uris, directoryUri: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/Android 10|Save As/i.test(message)) return null;
    throw error;
  }
}

export async function saveImagesToPreferredFolder(
  images: { uri: string; page: number }[],
  preferredDirectoryUri?: string | null,
) {
  if (preferredDirectoryUri) {
    try {
      return await saveImagesToDirectory(images, preferredDirectoryUri);
    } catch {
      // Ask again or use Downloads if the old SAF grant is no longer valid.
    }
  }

  const direct = await saveImagesDirectly(images);
  if (direct) return direct;

  const directoryUri = await chooseSaveFolder(preferredDirectoryUri);
  return saveImagesToDirectory(images, directoryUri);
}

export async function saveImagesToChosenFolder(images: { uri: string; page: number }[]) {
  const directoryUri = await chooseSaveFolder();
  return saveImagesToDirectory(images, directoryUri);
}
