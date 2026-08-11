import { Directory, File } from 'expo-file-system';

/**
 * Opens the native folder picker and copies a generated local PDF into
 * the directory selected by the user. Returns the destination URI.
 */
export async function savePdfToChosenFolder(sourceUri: string, fileName: string) {
  if (!sourceUri || !fileName) throw new Error('The generated PDF is missing.');

  const source = new File(sourceUri);
  if (!source.exists) throw new Error('The generated PDF no longer exists in app cache.');

  const directory = await Directory.pickDirectoryAsync();
  const destination = directory.createFile(fileName, 'application/pdf');
  source.copy(destination);
  return destination.uri;
}
