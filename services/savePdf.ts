import { Directory, File } from 'expo-file-system';

export async function savePdfToChosenFolder(sourceUri: string, fileName: string) {
  if (!sourceUri || !fileName) throw new Error('The generated PDF is missing.');

  const source = new File(sourceUri);
  if (!source.exists) throw new Error('The generated PDF no longer exists in app cache.');

  const directory = await Directory.pickDirectoryAsync();
  const destination = directory.createFile(fileName, 'application/pdf');
  source.copy(destination);
  return destination.uri;
}

export async function saveImagesToChosenFolder(images: { uri: string; page: number }[]) {
  if (!images.length) throw new Error('There are no rendered pages to save.');

  const directory = await Directory.pickDirectoryAsync();
  const saved: string[] = [];

  for (const item of images) {
    const source = new File(item.uri);
    if (!source.exists) throw new Error(`Rendered page ${item.page} no longer exists in app cache.`);
    const name = `page_${item.page.toString().padStart(3, '0')}.jpg`;
    const destination = directory.createFile(name, 'image/jpeg');
    source.copy(destination);
    saved.push(destination.uri);
  }

  return saved;
}
