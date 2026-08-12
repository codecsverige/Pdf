import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import SignaturePad from './components/SignaturePad';
import {
  addPageNumbers,
  deletePages,
  extractPages,
  getPdfPageCount,
  mergePdfs,
  reorderPages,
  rotatePages,
  watermarkPdf,
} from './services/pdfEngine';
import type { PdfOutput } from './services/pdfEngine';
import { imagesToPdf } from './services/imageToPdf';
import type { ImageInput } from './services/imageToPdf';
import {
  compressPdfNative,
  pdfToImagesNative,
  protectPdfNative,
  renderPreviewPage,
  unlockPdfNative,
} from './services/nativePdf';
import { saveImagesToChosenFolder, savePdfToChosenFolder } from './services/savePdf';
import { signPdf } from './services/signaturePdf';

type ToolId =
  | 'compress'
  | 'merge'
  | 'extract'
  | 'delete'
  | 'reorder'
  | 'rotate'
  | 'images'
  | 'camera'
  | 'pdfImages'
  | 'protect'
  | 'unlock'
  | 'sign'
  | 'watermark'
  | 'numbers'
  | 'preview';

type Category = 'Popular' | 'Organize' | 'Convert' | 'Secure' | 'Edit & Sign';

type SelectedPdf = {
  uri: string;
  name: string;
  size?: number;
  pages?: number;
};

type ToolDefinition = {
  id: ToolId;
  title: string;
  description: string;
  icon: string;
  category: Category;
  note?: string;
};

type RenderedImage = { uri: string; page: number; bytes: number };

type CompressionResult = PdfOutput & {
  originalBytes: number;
  flattened: boolean;
};

const TOOLS: ToolDefinition[] = [
  { id: 'compress', title: 'Compress PDF', description: 'Make scanned and image-heavy PDFs much smaller.', icon: '↓', category: 'Popular', note: 'Android native' },
  { id: 'merge', title: 'Merge PDF', description: 'Combine multiple PDFs in your chosen order.', icon: '+', category: 'Popular' },
  { id: 'preview', title: 'PDF Viewer', description: 'Render and inspect pages before editing.', icon: '◉', category: 'Popular', note: 'Android native' },
  { id: 'sign', title: 'Sign PDF', description: 'Draw a signature and stamp it as vector ink.', icon: '✎', category: 'Popular' },
  { id: 'extract', title: 'Extract / Split', description: 'Create a new PDF from selected pages.', icon: '⇲', category: 'Organize' },
  { id: 'delete', title: 'Delete pages', description: 'Remove unwanted pages while keeping the rest.', icon: '−', category: 'Organize' },
  { id: 'reorder', title: 'Reorder pages', description: 'Create a PDF using a new page order.', icon: '↕', category: 'Organize' },
  { id: 'rotate', title: 'Rotate pages', description: 'Rotate every page or only selected pages.', icon: '↻', category: 'Organize' },
  { id: 'images', title: 'Images to PDF', description: 'Turn selected photos into an A4 PDF.', icon: '▧', category: 'Convert' },
  { id: 'camera', title: 'Camera to PDF', description: 'Capture pages with the camera and create one PDF.', icon: '⌁', category: 'Convert' },
  { id: 'pdfImages', title: 'PDF to JPG', description: 'Render every PDF page as a high-quality JPG.', icon: '▤', category: 'Convert', note: 'Android native' },
  { id: 'protect', title: 'Protect PDF', description: 'Require a password before the PDF can be opened.', icon: '●', category: 'Secure', note: 'Android native' },
  { id: 'unlock', title: 'Remove password', description: 'Create an unlocked copy when you know the password.', icon: '○', category: 'Secure', note: 'Android native' },
  { id: 'watermark', title: 'Watermark', description: 'Burn a visible text watermark into every page.', icon: 'W', category: 'Edit & Sign' },
  { id: 'numbers', title: 'Page numbers', description: 'Add permanent page numbers to every page.', icon: '#', category: 'Edit & Sign' },
];

const CATEGORIES: Category[] = ['Popular', 'Organize', 'Convert', 'Secure', 'Edit & Sign'];

function formatBytes(bytes?: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error || '');
  if (/password|decrypt|encrypted|security handler/i.test(text)) {
    return 'This PDF is protected or the password is incorrect.';
  }
  return text || 'The PDF operation failed.';
}

export default function App() {
  const [tool, setTool] = useState<ToolId | null>(null);
  const [pdfs, setPdfs] = useState<SelectedPdf[]>([]);
  const [images, setImages] = useState<ImageInput[]>([]);
  const [pageExpression, setPageExpression] = useState('');
  const [watermark, setWatermark] = useState('CONFIDENTIAL');
  const [startAt, setStartAt] = useState('1');
  const [rotation, setRotation] = useState<90 | 180 | 270>(90);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [compressionMode, setCompressionMode] = useState<'balanced' | 'strong' | 'extreme'>('balanced');
  const [signaturePath, setSignaturePath] = useState('');
  const [signatureSize, setSignatureSize] = useState({ width: 320, height: 170 });
  const [signaturePage, setSignaturePage] = useState('1');
  const [previewPage, setPreviewPage] = useState(1);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [renderedImages, setRenderedImages] = useState<RenderedImage[]>([]);
  const [compressionInfo, setCompressionInfo] = useState<CompressionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PdfOutput | null>(null);

  const selectedTool = useMemo(() => TOOLS.find(item => item.id === tool) ?? null, [tool]);
  const selectedPdf = pdfs[0];

  const handleSignatureChange = useCallback((path: string, width: number, height: number) => {
    setSignaturePath(path);
    setSignatureSize({ width, height });
  }, []);

  function resetWorkspace(nextTool: ToolId | null = tool) {
    setPdfs([]);
    setImages([]);
    setPageExpression('');
    setWatermark('CONFIDENTIAL');
    setStartAt('1');
    setRotation(90);
    setPassword('');
    setConfirmPassword('');
    setCompressionMode('balanced');
    setSignaturePath('');
    setSignaturePage('1');
    setPreviewPage(1);
    setPreviewUri(null);
    setRenderedImages([]);
    setCompressionInfo(null);
    setResult(null);
    setTool(nextTool);
  }

  async function pickPdf(multiple: boolean) {
    try {
      const response = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        multiple,
        copyToCacheDirectory: true,
      });
      if (response.canceled || !response.assets?.length) return;

      const selected: SelectedPdf[] = response.assets.map(asset => ({
        uri: asset.uri,
        name: asset.name || 'document.pdf',
        size: asset.size,
      }));

      if (!multiple) {
        try {
          selected[0].pages = await getPdfPageCount(selected[0].uri);
        } catch (error) {
          if (tool !== 'unlock') throw error;
        }
        setPdfs([selected[0]]);
        if (selected[0].pages) setSignaturePage(String(Math.min(1, selected[0].pages)));
      } else {
        setPdfs(selected);
      }
      setPreviewPage(1);
      setPreviewUri(null);
      setRenderedImages([]);
      setCompressionInfo(null);
      setResult(null);
    } catch (error) {
      Alert.alert('Cannot open PDF', errorMessage(error));
    }
  }

  async function pickImages() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Photo access is required.');
      const response = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: 0,
        quality: 1,
      });
      if (response.canceled) return;
      setImages(response.assets.map(asset => ({ uri: asset.uri, width: asset.width, height: asset.height })));
      setResult(null);
    } catch (error) {
      Alert.alert('Could not select images', errorMessage(error));
    }
  }

  async function capturePage() {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Camera access is required.');
      const response = await ImagePicker.launchCameraAsync({ quality: 1 });
      if (response.canceled || !response.assets?.length) return;
      const asset = response.assets[0];
      setImages(current => [...current, { uri: asset.uri, width: asset.width, height: asset.height }]);
      setResult(null);
    } catch (error) {
      Alert.alert('Camera failed', errorMessage(error));
    }
  }

  function movePdf(index: number, direction: -1 | 1) {
    setPdfs(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setResult(null);
  }

  function removePdf(index: number) {
    setPdfs(current => current.filter((_, itemIndex) => itemIndex !== index));
    setResult(null);
  }

  async function runTool() {
    if (!tool) return;
    setBusy(true);
    setResult(null);
    setRenderedImages([]);
    setCompressionInfo(null);

    try {
      let output: PdfOutput | null = null;
      switch (tool) {
        case 'compress': {
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          const compressed = await compressPdfNative(selectedPdf.uri, compressionMode);
          output = compressed;
          setCompressionInfo(compressed);
          break;
        }
        case 'merge':
          output = await mergePdfs(pdfs.map(item => item.uri));
          break;
        case 'extract':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await extractPages(selectedPdf.uri, pageExpression);
          break;
        case 'delete':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await deletePages(selectedPdf.uri, pageExpression);
          break;
        case 'reorder':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await reorderPages(selectedPdf.uri, pageExpression);
          break;
        case 'rotate':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await rotatePages(selectedPdf.uri, pageExpression, rotation);
          break;
        case 'images':
        case 'camera':
          output = await imagesToPdf(images, { pageMode: 'auto', jpegQuality: 0.9, maxImageWidth: 2400, margin: 24 });
          break;
        case 'pdfImages':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          setRenderedImages(await pdfToImagesNative(selectedPdf.uri));
          break;
        case 'protect':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          if (password.length < 4) throw new Error('Use a password with at least 4 characters.');
          if (password !== confirmPassword) throw new Error('The two passwords do not match.');
          output = await protectPdfNative(selectedPdf.uri, password);
          break;
        case 'unlock':
          if (!selectedPdf) throw new Error('Choose a protected PDF first.');
          if (!password) throw new Error('Enter the current PDF password.');
          output = await unlockPdfNative(selectedPdf.uri, password);
          break;
        case 'sign': {
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          const page = Number(signaturePage);
          if (!Number.isInteger(page) || page < 1) throw new Error('Enter a valid page number.');
          output = await signPdf(selectedPdf.uri, page, signaturePath, signatureSize.width, signatureSize.height);
          break;
        }
        case 'watermark':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await watermarkPdf(selectedPdf.uri, watermark);
          break;
        case 'numbers': {
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          const firstNumber = Number(startAt);
          if (!Number.isInteger(firstNumber) || firstNumber < 0) throw new Error('Start number must be 0 or greater.');
          output = await addPageNumbers(selectedPdf.uri, firstNumber);
          break;
        }
        case 'preview':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          setPreviewUri((await renderPreviewPage(selectedPdf.uri, previewPage - 1)).uri);
          break;
      }
      if (output) setResult(output);
    } catch (error) {
      Alert.alert('Operation failed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveResult() {
    if (!result) return;
    setSaving(true);
    try {
      await savePdfToChosenFolder(result.uri, result.fileName);
      Alert.alert('Saved', 'The PDF was copied to the folder you selected.');
    } catch (error) {
      Alert.alert('Could not save PDF', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveRenderedImages() {
    setSaving(true);
    try {
      await saveImagesToChosenFolder(renderedImages);
      Alert.alert('Saved', `${renderedImages.length} JPG page(s) were saved to the selected folder.`);
    } catch (error) {
      Alert.alert('Could not save images', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function shareResult() {
    if (!result) return;
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
      await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: 'Share PDF', UTI: 'com.adobe.pdf' });
    } catch (error) {
      Alert.alert('Could not share PDF', errorMessage(error));
    }
  }

  const canRun = useMemo(() => {
    if (!tool) return false;
    if (tool === 'images' || tool === 'camera') return images.length > 0;
    if (tool === 'merge') return pdfs.length >= 2;
    return pdfs.length === 1;
  }, [tool, images.length, pdfs.length]);

  function actionLabel() {
    const labels: Partial<Record<ToolId, string>> = {
      compress: 'Compress PDF', merge: 'Merge PDFs', extract: 'Extract pages', delete: 'Delete pages',
      reorder: 'Apply new order', rotate: 'Rotate pages', images: 'Create PDF', camera: 'Create camera PDF',
      pdfImages: 'Render all pages', protect: 'Protect PDF', unlock: 'Remove password', sign: 'Apply signature',
      watermark: 'Apply watermark', numbers: 'Add page numbers', preview: 'Render page',
    };
    return labels[tool ?? 'merge'] ?? 'Run';
  }

  const needsPages = tool === 'extract' || tool === 'delete' || tool === 'reorder' || tool === 'rotate';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>P</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>PDF Pro</Text>
            <Text style={styles.brandSubtitle}>Private tools. Local processing.</Text>
          </View>
          {tool ? <Pressable style={styles.backButton} onPress={() => resetWorkspace(null)}><Text style={styles.backText}>Tools</Text></Pressable> : null}
        </View>

        {!tool ? (
          <>
            <View style={styles.hero}>
              <View style={styles.privatePill}><Text style={styles.privatePillText}>● OFFLINE FIRST</Text></View>
              <Text style={styles.heroTitle}>Everything you actually need for PDF files.</Text>
              <Text style={styles.heroText}>Compress, organize, convert, protect and sign documents without sending ordinary files to a remote service.</Text>
            </View>

            {CATEGORIES.map(category => {
              const categoryTools = TOOLS.filter(item => item.category === category);
              return (
                <View key={category} style={styles.section}>
                  <Text style={styles.sectionTitle}>{category}</Text>
                  <View style={styles.grid}>
                    {categoryTools.map(item => (
                      <Pressable key={item.id} style={styles.toolCard} onPress={() => resetWorkspace(item.id)}>
                        <View style={styles.cardTop}>
                          <View style={styles.toolIcon}><Text style={styles.toolIconText}>{item.icon}</Text></View>
                          {item.note ? <Text style={styles.nativeBadge}>{item.note}</Text> : null}
                        </View>
                        <Text style={styles.toolTitle}>{item.title}</Text>
                        <Text style={styles.toolDescription}>{item.description}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}

            <View style={styles.truthCard}>
              <Text style={styles.truthTitle}>No fake buttons</Text>
              <Text style={styles.truthText}>OCR and full Acrobat-style text rewriting are intentionally absent until they can meet the same reliability standard as the tools above.</Text>
            </View>
          </>
        ) : (
          <View style={styles.workspace}>
            <View style={styles.workspaceHeader}>
              <View style={styles.largeIcon}><Text style={styles.largeIconText}>{selectedTool?.icon}</Text></View>
              <View style={styles.workspaceCopy}>
                <Text style={styles.workspaceTitle}>{selectedTool?.title}</Text>
                <Text style={styles.workspaceDescription}>{selectedTool?.description}</Text>
              </View>
            </View>

            {tool === 'images' ? (
              <>
                <SelectButton label={images.length ? 'Choose different images' : 'Choose images'} onPress={pickImages} />
                {images.length > 0 ? <InfoRow title={`${images.length} image(s) selected`} detail="Selection order becomes page order." /> : null}
              </>
            ) : tool === 'camera' ? (
              <>
                <SelectButton label={images.length ? 'Capture another page' : 'Capture first page'} onPress={capturePage} />
                {images.length > 0 ? (
                  <View style={styles.filePanel}>
                    <Text style={styles.fileName}>{images.length} captured page(s)</Text>
                    <View style={styles.rowActions}>
                      <MiniButton label="Undo last" onPress={() => setImages(current => current.slice(0, -1))} />
                      <MiniButton label="Clear" onPress={() => setImages([])} danger />
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <SelectButton label={tool === 'merge' ? 'Choose PDF files' : 'Choose PDF'} onPress={() => pickPdf(tool === 'merge')} />
                {pdfs.map((pdf, index) => (
                  <View key={`${pdf.uri}-${index}`} style={styles.filePanel}>
                    <View style={styles.fileBadge}><Text style={styles.fileBadgeText}>{index + 1}</Text></View>
                    <View style={styles.fileText}>
                      <Text style={styles.fileName} numberOfLines={1}>{pdf.name}</Text>
                      <Text style={styles.fileMeta}>{[formatBytes(pdf.size), pdf.pages ? `${pdf.pages} pages` : ''].filter(Boolean).join(' • ') || 'PDF document'}</Text>
                    </View>
                    {tool === 'merge' ? (
                      <View style={styles.mergeControls}>
                        <MiniButton label="↑" onPress={() => movePdf(index, -1)} disabled={index === 0} />
                        <MiniButton label="↓" onPress={() => movePdf(index, 1)} disabled={index === pdfs.length - 1} />
                        <MiniButton label="×" onPress={() => removePdf(index)} danger />
                      </View>
                    ) : null}
                  </View>
                ))}
              </>
            )}

            {tool === 'compress' ? (
              <View style={styles.optionBlock}>
                <FieldLabel text="Compression" />
                <View style={styles.segmentRow}>
                  {(['balanced', 'strong', 'extreme'] as const).map(mode => (
                    <Pressable key={mode} style={[styles.segment, compressionMode === mode && styles.segmentActive]} onPress={() => setCompressionMode(mode)}>
                      <Text style={[styles.segmentText, compressionMode === mode && styles.segmentTextActive]}>{mode[0].toUpperCase() + mode.slice(1)}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.help}>Best for scanned/image PDFs. Compression flattens each page visually, so selectable text and form fields are not preserved in the compressed copy.</Text>
              </View>
            ) : null}

            {needsPages ? (
              <View style={styles.optionBlock}>
                <FieldLabel text={tool === 'reorder' ? 'New page order' : tool === 'delete' ? 'Pages to delete' : 'Pages'} />
                <TextInput
                  style={styles.input}
                  value={pageExpression}
                  onChangeText={setPageExpression}
                  placeholder={tool === 'rotate' ? 'Empty = all pages, or 1-3,5' : tool === 'reorder' ? 'Example: 3,1,2,4-8' : 'Example: 1-3,5,8'}
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                />
                <Text style={styles.help}>Ranges and comma-separated page numbers are supported.</Text>
              </View>
            ) : null}

            {tool === 'rotate' ? (
              <View style={styles.segmentRow}>
                {[90, 180, 270].map(value => (
                  <Pressable key={value} style={[styles.segment, rotation === value && styles.segmentActive]} onPress={() => setRotation(value as 90 | 180 | 270)}>
                    <Text style={[styles.segmentText, rotation === value && styles.segmentTextActive]}>{value}°</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {tool === 'protect' || tool === 'unlock' ? (
              <View style={styles.optionBlock}>
                <FieldLabel text={tool === 'protect' ? 'New password' : 'Current password'} />
                <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
                {tool === 'protect' ? <TextInput style={[styles.input, styles.secondInput]} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" placeholder="Repeat password" placeholderTextColor="#94a3b8" /> : null}
              </View>
            ) : null}

            {tool === 'sign' ? (
              <View style={styles.optionBlock}>
                <FieldLabel text="Page number" />
                <TextInput style={styles.input} value={signaturePage} onChangeText={setSignaturePage} keyboardType="number-pad" />
                <Text style={styles.help}>The signature is placed near the lower-right area of the selected page.</Text>
                <View style={styles.signatureSpace}><SignaturePad onChange={handleSignatureChange} /></View>
              </View>
            ) : null}

            {tool === 'watermark' ? (
              <View style={styles.optionBlock}>
                <FieldLabel text="Watermark text" />
                <TextInput style={styles.input} value={watermark} onChangeText={setWatermark} maxLength={80} />
                <Text style={styles.help}>Current text watermark uses the built-in PDF Latin font.</Text>
              </View>
            ) : null}

            {tool === 'numbers' ? (
              <View style={styles.optionBlock}>
                <FieldLabel text="Start numbering at" />
                <TextInput style={styles.input} value={startAt} onChangeText={setStartAt} keyboardType="number-pad" />
              </View>
            ) : null}

            {tool === 'preview' && selectedPdf ? (
              <View style={styles.optionBlock}>
                <View style={styles.previewNav}>
                  <MiniButton label="Previous" onPress={() => { setPreviewPage(current => Math.max(1, current - 1)); setPreviewUri(null); }} disabled={previewPage <= 1} />
                  <Text style={styles.previewPageText}>Page {previewPage}{selectedPdf.pages ? ` / ${selectedPdf.pages}` : ''}</Text>
                  <MiniButton label="Next" onPress={() => { setPreviewPage(current => selectedPdf.pages ? Math.min(selectedPdf.pages, current + 1) : current + 1); setPreviewUri(null); }} disabled={Boolean(selectedPdf.pages && previewPage >= selectedPdf.pages)} />
                </View>
                {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" /> : <View style={styles.previewEmpty}><Text style={styles.previewEmptyText}>Render the selected page to preview it.</Text></View>}
              </View>
            ) : null}

            <Pressable style={[styles.primaryButton, (!canRun || busy) && styles.disabled]} onPress={runTool} disabled={!canRun || busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{actionLabel()}</Text>}
            </Pressable>

            {compressionInfo ? (
              <View style={styles.statsCard}>
                <Text style={styles.statsTitle}>Compression result</Text>
                <Text style={styles.statsNumber}>{formatBytes(compressionInfo.originalBytes)} → {formatBytes(compressionInfo.bytes)}</Text>
                <Text style={styles.statsText}>{compressionInfo.originalBytes > 0 ? `${Math.max(0, Math.round((1 - compressionInfo.bytes / compressionInfo.originalBytes) * 100))}% smaller` : 'Compressed copy created'}</Text>
              </View>
            ) : null}

            {renderedImages.length > 0 ? (
              <View style={styles.resultCard}>
                <Text style={styles.resultTitle}>{renderedImages.length} JPG page(s) ready</Text>
                <Text style={styles.resultMeta}>High-quality page renders were created locally.</Text>
                <Pressable style={styles.saveButton} onPress={saveRenderedImages} disabled={saving}>{saving ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.saveButtonText}>Save all to folder</Text>}</Pressable>
              </View>
            ) : null}

            {result ? (
              <View style={styles.resultCard}>
                <View style={styles.successRow}><View style={styles.successDot}><Text style={styles.successDotText}>✓</Text></View><Text style={styles.resultTitle}>PDF ready</Text></View>
                <Text style={styles.resultName} numberOfLines={1}>{result.fileName}</Text>
                <Text style={styles.resultMeta}>{result.pageCount} page(s) • {formatBytes(result.bytes)}</Text>
                <View style={styles.resultActions}>
                  <Pressable style={styles.saveButton} onPress={saveResult} disabled={saving}>{saving ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.saveButtonText}>Save to folder</Text>}</Pressable>
                  <Pressable style={styles.shareButton} onPress={shareResult}><Text style={styles.shareButtonText}>Share</Text></Pressable>
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SelectButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable style={styles.selectButton} onPress={onPress}><Text style={styles.selectIcon}>＋</Text><Text style={styles.selectText}>{label}</Text></Pressable>;
}

function MiniButton({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return <Pressable style={[styles.miniButton, danger && styles.miniDanger, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><Text style={[styles.miniText, danger && styles.miniDangerText]}>{label}</Text></Pressable>;
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

function InfoRow({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.filePanel}><View style={styles.fileText}><Text style={styles.fileName}>{title}</Text><Text style={styles.fileMeta}>{detail}</Text></View></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f7fb' },
  container: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 52 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  brandMark: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#fff', fontSize: 21, fontWeight: '900' },
  brandCopy: { flex: 1, marginLeft: 11 },
  brandName: { color: '#0f172a', fontSize: 20, fontWeight: '900' },
  brandSubtitle: { color: '#64748b', fontSize: 11, marginTop: 1 },
  backButton: { borderRadius: 10, backgroundColor: '#e2e8f0', paddingHorizontal: 13, paddingVertical: 9 },
  backText: { color: '#334155', fontWeight: '800', fontSize: 13 },
  hero: { backgroundColor: '#0f172a', borderRadius: 24, padding: 22, marginBottom: 26 },
  privatePill: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: '#1e293b', marginBottom: 16 },
  privatePillText: { color: '#93c5fd', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  heroTitle: { color: '#fff', fontSize: 28, lineHeight: 34, fontWeight: '900', maxWidth: 330 },
  heroText: { color: '#cbd5e1', marginTop: 12, fontSize: 14, lineHeight: 21 },
  section: { marginBottom: 24 },
  sectionTitle: { color: '#0f172a', fontSize: 17, fontWeight: '900', marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  toolCard: { width: '48.5%', minHeight: 154, backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', padding: 14 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  toolIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  toolIconText: { color: '#1d4ed8', fontSize: 18, fontWeight: '900' },
  nativeBadge: { color: '#64748b', fontSize: 8, fontWeight: '800', backgroundColor: '#f1f5f9', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6 },
  toolTitle: { color: '#0f172a', fontSize: 15, fontWeight: '900' },
  toolDescription: { color: '#64748b', fontSize: 11.5, lineHeight: 17, marginTop: 5 },
  truthCard: { borderRadius: 18, padding: 16, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#bbf7d0' },
  truthTitle: { color: '#166534', fontWeight: '900', fontSize: 14 },
  truthText: { color: '#15803d', fontSize: 12, lineHeight: 18, marginTop: 5 },
  workspace: { backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#e2e8f0', padding: 18 },
  workspaceHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  largeIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  largeIconText: { color: '#1d4ed8', fontSize: 23, fontWeight: '900' },
  workspaceCopy: { flex: 1, marginLeft: 13 },
  workspaceTitle: { color: '#0f172a', fontSize: 22, fontWeight: '900' },
  workspaceDescription: { color: '#64748b', fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  selectButton: { minHeight: 62, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#93c5fd', backgroundColor: '#eff6ff', borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  selectIcon: { color: '#1d4ed8', fontSize: 20, fontWeight: '800' },
  selectText: { color: '#1d4ed8', fontWeight: '900', fontSize: 14 },
  filePanel: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 11, marginTop: 10 },
  fileBadge: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  fileBadgeText: { color: '#475569', fontWeight: '900', fontSize: 12 },
  fileText: { flex: 1, minWidth: 0 },
  fileName: { color: '#0f172a', fontWeight: '800', fontSize: 13 },
  fileMeta: { color: '#64748b', fontSize: 10.5, marginTop: 3 },
  mergeControls: { flexDirection: 'row', gap: 4, marginLeft: 6 },
  rowActions: { flexDirection: 'row', gap: 6, marginLeft: 8 },
  miniButton: { minWidth: 34, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: '#e2e8f0', alignItems: 'center' },
  miniText: { color: '#334155', fontSize: 11, fontWeight: '900' },
  miniDanger: { backgroundColor: '#fee2e2' },
  miniDangerText: { color: '#b91c1c' },
  optionBlock: { marginTop: 18 },
  fieldLabel: { color: '#334155', fontSize: 12, fontWeight: '900', marginBottom: 7 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 13, paddingHorizontal: 13, backgroundColor: '#fff', color: '#0f172a', fontSize: 14 },
  secondInput: { marginTop: 8 },
  help: { color: '#64748b', fontSize: 10.5, lineHeight: 16, marginTop: 7 },
  segmentRow: { flexDirection: 'row', gap: 7, marginTop: 4 },
  segment: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  segmentActive: { borderColor: '#2563eb', backgroundColor: '#2563eb' },
  segmentText: { color: '#475569', fontSize: 11.5, fontWeight: '900' },
  segmentTextActive: { color: '#fff' },
  signatureSpace: { marginTop: 14 },
  previewNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  previewPageText: { color: '#334155', fontSize: 12, fontWeight: '900' },
  previewImage: { width: '100%', height: 420, borderRadius: 14, backgroundColor: '#e2e8f0' },
  previewEmpty: { height: 250, borderRadius: 14, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center', padding: 20 },
  previewEmptyText: { color: '#64748b', fontSize: 12, textAlign: 'center' },
  primaryButton: { marginTop: 22, minHeight: 54, borderRadius: 15, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  disabled: { opacity: 0.4 },
  statsCard: { marginTop: 15, borderRadius: 16, padding: 15, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe' },
  statsTitle: { color: '#1e40af', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7 },
  statsNumber: { color: '#1e3a8a', fontSize: 19, fontWeight: '900', marginTop: 6 },
  statsText: { color: '#2563eb', fontSize: 12, marginTop: 3, fontWeight: '700' },
  resultCard: { marginTop: 15, borderRadius: 17, padding: 15, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  successDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  successDotText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  resultTitle: { color: '#166534', fontWeight: '900', fontSize: 14 },
  resultName: { color: '#14532d', fontWeight: '700', fontSize: 12, marginTop: 8 },
  resultMeta: { color: '#15803d', fontSize: 10.5, marginTop: 3 },
  resultActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  saveButton: { flex: 1, minHeight: 43, borderRadius: 11, backgroundColor: '#fff', borderWidth: 1, borderColor: '#86efac', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  saveButtonText: { color: '#166534', fontWeight: '900', fontSize: 12 },
  shareButton: { minWidth: 92, minHeight: 43, borderRadius: 11, backgroundColor: '#166534', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  shareButtonText: { color: '#fff', fontWeight: '900', fontSize: 12 },
});
