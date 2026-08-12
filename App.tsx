import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import SignaturePad from './components/SignaturePad';
import { imagesToPdf } from './services/imageToPdf';
import type { ImageInput } from './services/imageToPdf';
import {
  compressPdfNative,
  pdfToImagesNative,
  protectPdfNative,
  renderPreviewPage,
  unlockPdfNative,
} from './services/nativePdf';
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
import {
  chooseSaveFolder,
  getSavePreferences,
  saveImagesToChosenFolder,
  saveImagesToPreferredFolder,
  savePdfToChosenFolder,
  savePdfToPreferredFolder,
  setSavePreferences,
} from './services/savePdf';
import type { SavePreferences } from './services/savePdf';
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
  badge?: string;
  tone: 'blue' | 'violet' | 'green' | 'amber' | 'rose';
};

type RenderedImage = { uri: string; page: number; bytes: number };

type CompressionResult = PdfOutput & {
  originalBytes: number;
  flattened: boolean;
};

const TOOLS: ToolDefinition[] = [
  { id: 'compress', title: 'Compress PDF', description: 'Reduce scanned and image-heavy PDFs.', icon: 'file-percent-outline', category: 'Popular', badge: 'Native', tone: 'blue' },
  { id: 'merge', title: 'Merge PDF', description: 'Combine multiple PDFs in your chosen order.', icon: 'file-document-multiple-outline', category: 'Popular', tone: 'violet' },
  { id: 'preview', title: 'PDF Viewer', description: 'Inspect pages before or after editing.', icon: 'file-eye-outline', category: 'Popular', badge: 'Native', tone: 'green' },
  { id: 'sign', title: 'Sign PDF', description: 'Draw and place a clean vector signature.', icon: 'draw-pen', category: 'Popular', tone: 'amber' },
  { id: 'extract', title: 'Extract / Split', description: 'Create a PDF from selected pages.', icon: 'file-export-outline', category: 'Organize', tone: 'blue' },
  { id: 'delete', title: 'Delete pages', description: 'Remove pages while preserving the rest.', icon: 'file-remove-outline', category: 'Organize', tone: 'rose' },
  { id: 'reorder', title: 'Reorder pages', description: 'Build a PDF with a new page order.', icon: 'sort-variant', category: 'Organize', tone: 'violet' },
  { id: 'rotate', title: 'Rotate pages', description: 'Rotate all pages or a selected range.', icon: 'file-rotate-right-outline', category: 'Organize', tone: 'green' },
  { id: 'images', title: 'Images to PDF', description: 'Turn selected photos into one PDF.', icon: 'image-multiple-outline', category: 'Convert', tone: 'violet' },
  { id: 'camera', title: 'Camera to PDF', description: 'Capture document pages and create a PDF.', icon: 'camera-document', category: 'Convert', tone: 'blue' },
  { id: 'pdfImages', title: 'PDF to JPG', description: 'Render every page as a high-quality JPG.', icon: 'file-image-outline', category: 'Convert', badge: 'Native', tone: 'amber' },
  { id: 'protect', title: 'Protect PDF', description: 'Add password protection to a document.', icon: 'lock-outline', category: 'Secure', badge: 'Native', tone: 'green' },
  { id: 'unlock', title: 'Remove password', description: 'Unlock a PDF when you know its password.', icon: 'lock-open-variant-outline', category: 'Secure', badge: 'Native', tone: 'blue' },
  { id: 'watermark', title: 'Watermark', description: 'Burn visible text into every page.', icon: 'watermark', category: 'Edit & Sign', tone: 'violet' },
  { id: 'numbers', title: 'Page numbers', description: 'Add permanent numbering to every page.', icon: 'format-list-numbered', category: 'Edit & Sign', tone: 'amber' },
];

const CATEGORIES: { id: Category; subtitle: string; icon: string }[] = [
  { id: 'Popular', subtitle: 'Everyday PDF essentials', icon: 'star-four-points-outline' },
  { id: 'Organize', subtitle: 'Control pages precisely', icon: 'layers-triple-outline' },
  { id: 'Convert', subtitle: 'Move between PDF and images', icon: 'swap-horizontal' },
  { id: 'Secure', subtitle: 'Protect sensitive files locally', icon: 'shield-lock-outline' },
  { id: 'Edit & Sign', subtitle: 'Finish documents professionally', icon: 'pencil-ruler-outline' },
];

const DEFAULT_SAVE_PREFS: SavePreferences = { directoryUri: null, autoSave: false };

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

function folderStatus(uri: string | null) {
  if (!uri) return 'No default folder selected';
  try {
    const decoded = decodeURIComponent(uri);
    const last = decoded.split('/').pop()?.split(':').pop();
    return last ? `Default folder: ${last}` : 'Default folder ready';
  } catch {
    return 'Default folder ready';
  }
}

function toneStyle(tone: ToolDefinition['tone']) {
  const map = {
    blue: { bg: '#eaf2ff', fg: '#2563eb' },
    violet: { bg: '#f1edff', fg: '#7c3aed' },
    green: { bg: '#e9f9f1', fg: '#059669' },
    amber: { bg: '#fff6df', fg: '#d97706' },
    rose: { bg: '#fff0f2', fg: '#e11d48' },
  };
  return map[tone];
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
  const [savePrefs, setSavePrefs] = useState<SavePreferences>(DEFAULT_SAVE_PREFS);
  const [lastSaveMessage, setLastSaveMessage] = useState<string | null>(null);
  const [resultPreviewOpen, setResultPreviewOpen] = useState(false);
  const [resultPreviewPage, setResultPreviewPage] = useState(1);
  const [resultPreviewUri, setResultPreviewUri] = useState<string | null>(null);
  const [resultPreviewBusy, setResultPreviewBusy] = useState(false);
  const lastBackAt = useRef(0);

  const selectedTool = useMemo(() => TOOLS.find(item => item.id === tool) ?? null, [tool]);
  const selectedPdf = pdfs[0];
  const canPreviewResult = Boolean(result && tool !== 'protect');

  useEffect(() => {
    let active = true;
    getSavePreferences()
      .then(preferences => {
        if (active) setSavePrefs(preferences);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (resultPreviewOpen) {
        setResultPreviewOpen(false);
        return true;
      }
      if (tool) {
        resetWorkspace(null);
        return true;
      }
      const now = Date.now();
      if (now - lastBackAt.current < 1800) return false;
      lastBackAt.current = now;
      ToastAndroid.show('Press back again to exit PDF Pro', ToastAndroid.SHORT);
      return true;
    });
    return () => subscription.remove();
  }, [tool, resultPreviewOpen]);

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
    setLastSaveMessage(null);
    setResultPreviewOpen(false);
    setResultPreviewPage(1);
    setResultPreviewUri(null);
    setTool(nextTool);
  }

  async function persistSavePrefs(next: SavePreferences) {
    setSavePrefs(next);
    await setSavePreferences(next);
  }

  async function configureSaveFolder() {
    try {
      const directoryUri = await chooseSaveFolder(savePrefs.directoryUri);
      await persistSavePrefs({ ...savePrefs, directoryUri });
      Alert.alert('Folder saved', 'PDF Pro will use this folder for Quick Save.');
    } catch (error) {
      if (!/cancel/i.test(errorMessage(error))) Alert.alert('Folder not changed', errorMessage(error));
    }
  }

  async function toggleAutoSave(enabled: boolean) {
    try {
      let directoryUri = savePrefs.directoryUri;
      if (enabled && !directoryUri) directoryUri = await chooseSaveFolder();
      await persistSavePrefs({ directoryUri, autoSave: enabled });
    } catch (error) {
      if (!/cancel/i.test(errorMessage(error))) Alert.alert('Could not change auto-save', errorMessage(error));
    }
  }

  async function rememberDirectory(directoryUri: string) {
    if (directoryUri === savePrefs.directoryUri) return;
    await persistSavePrefs({ ...savePrefs, directoryUri });
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
        setSignaturePage('1');
      } else {
        setPdfs(selected);
      }
      setPreviewPage(1);
      setPreviewUri(null);
      setRenderedImages([]);
      setCompressionInfo(null);
      setResult(null);
      setLastSaveMessage(null);
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
      setLastSaveMessage(null);
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
      setLastSaveMessage(null);
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

  async function autoSavePdf(output: PdfOutput) {
    if (!savePrefs.autoSave) return;
    try {
      const saved = await savePdfToPreferredFolder(output.uri, output.fileName, savePrefs.directoryUri);
      await rememberDirectory(saved.directoryUri);
      setLastSaveMessage('Saved automatically to your default folder');
    } catch (error) {
      setLastSaveMessage('PDF created, but auto-save needs your attention');
      Alert.alert('PDF created', `The document is ready, but it could not be auto-saved. ${errorMessage(error)}`);
    }
  }

  async function autoSaveImages(pages: RenderedImage[]) {
    if (!savePrefs.autoSave || !pages.length) return;
    try {
      const saved = await saveImagesToPreferredFolder(pages, savePrefs.directoryUri);
      await rememberDirectory(saved.directoryUri);
      setLastSaveMessage(`${pages.length} JPG page(s) saved automatically`);
    } catch (error) {
      setLastSaveMessage('JPG pages created, but auto-save needs your attention');
      Alert.alert('Images created', `The JPG pages are ready, but they could not be auto-saved. ${errorMessage(error)}`);
    }
  }

  async function runTool() {
    if (!tool) return;
    setBusy(true);
    setResult(null);
    setRenderedImages([]);
    setCompressionInfo(null);
    setLastSaveMessage(null);

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
        case 'pdfImages': {
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          const pages = await pdfToImagesNative(selectedPdf.uri);
          setRenderedImages(pages);
          await autoSaveImages(pages);
          break;
        }
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
          if (!signaturePath) throw new Error('Draw a signature first.');
          output = await signPdf(selectedPdf.uri, page, signaturePath, signatureSize.width, signatureSize.height);
          break;
        }
        case 'watermark':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          if (!watermark.trim()) throw new Error('Enter watermark text.');
          output = await watermarkPdf(selectedPdf.uri, watermark.trim());
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
      if (output) {
        setResult(output);
        await autoSavePdf(output);
      }
    } catch (error) {
      Alert.alert('Operation failed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveResult(chooseNewFolder: boolean) {
    if (!result) return;
    setSaving(true);
    try {
      const saved = chooseNewFolder
        ? await savePdfToChosenFolder(result.uri, result.fileName)
        : await savePdfToPreferredFolder(result.uri, result.fileName, savePrefs.directoryUri);
      await rememberDirectory(saved.directoryUri);
      setLastSaveMessage(chooseNewFolder ? 'Saved to the folder you selected' : 'Saved with Quick Save');
      Alert.alert('Saved', 'The PDF is now in your selected folder.');
    } catch (error) {
      if (!/cancel/i.test(errorMessage(error))) Alert.alert('Could not save PDF', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveRenderedImages(chooseNewFolder: boolean) {
    setSaving(true);
    try {
      const saved = chooseNewFolder
        ? await saveImagesToChosenFolder(renderedImages)
        : await saveImagesToPreferredFolder(renderedImages, savePrefs.directoryUri);
      await rememberDirectory(saved.directoryUri);
      setLastSaveMessage(`${renderedImages.length} JPG page(s) saved`);
      Alert.alert('Saved', `${renderedImages.length} JPG page(s) were saved.`);
    } catch (error) {
      if (!/cancel/i.test(errorMessage(error))) Alert.alert('Could not save images', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function shareResult() {
    if (!result) return;
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share PDF',
        UTI: 'com.adobe.pdf',
      });
    } catch (error) {
      Alert.alert('Could not share PDF', errorMessage(error));
    }
  }

  async function renderResultPreview(page: number) {
    if (!result) return;
    setResultPreviewBusy(true);
    try {
      const safePage = Math.max(1, Math.min(result.pageCount || 1, page));
      const rendered = await renderPreviewPage(result.uri, safePage - 1);
      setResultPreviewPage(safePage);
      setResultPreviewUri(rendered.uri);
    } catch (error) {
      Alert.alert('Preview unavailable', errorMessage(error));
      setResultPreviewOpen(false);
    } finally {
      setResultPreviewBusy(false);
    }
  }

  async function openResultPreview() {
    if (!result || !canPreviewResult) return;
    setResultPreviewOpen(true);
    setResultPreviewUri(null);
    await renderResultPreview(1);
  }

  const canRun = useMemo(() => {
    if (!tool) return false;
    if (tool === 'images' || tool === 'camera') return images.length > 0;
    if (tool === 'merge') return pdfs.length >= 2;
    return pdfs.length === 1;
  }, [tool, images.length, pdfs.length]);

  function actionLabel() {
    const labels: Partial<Record<ToolId, string>> = {
      compress: 'Compress PDF',
      merge: 'Merge PDFs',
      extract: 'Extract pages',
      delete: 'Delete pages',
      reorder: 'Apply new order',
      rotate: 'Rotate pages',
      images: 'Create PDF',
      camera: 'Create camera PDF',
      pdfImages: 'Render all pages',
      protect: 'Protect PDF',
      unlock: 'Remove password',
      sign: 'Apply signature',
      watermark: 'Apply watermark',
      numbers: 'Add page numbers',
      preview: 'Render page',
    };
    return labels[tool ?? 'merge'] ?? 'Run';
  }

  const needsPages = tool === 'extract' || tool === 'delete' || tool === 'reorder' || tool === 'rotate';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          {tool ? (
            <Pressable style={styles.roundButton} onPress={() => resetWorkspace(null)} hitSlop={10}>
              <AppIcon name="arrow-left" size={21} color="#162033" />
            </Pressable>
          ) : (
            <View style={styles.brandMark}>
              <AppIcon name="file-document-edit-outline" size={25} color="#ffffff" />
            </View>
          )}
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>{tool ? selectedTool?.title : 'PDF Pro'}</Text>
            <Text style={styles.brandSubtitle}>{tool ? 'Private on-device workflow' : 'Fast • Private • Professional'}</Text>
          </View>
          <View style={styles.localBadge}>
            <AppIcon name="shield-check-outline" size={14} color="#047857" />
            <Text style={styles.localBadgeText}>LOCAL</Text>
          </View>
        </View>

        {!tool ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroGlowOne} />
              <View style={styles.heroGlowTwo} />
              <View style={styles.heroPill}>
                <AppIcon name="lightning-bolt-outline" size={15} color="#c7d2fe" />
                <Text style={styles.heroPillText}>PDF WORKSPACE</Text>
              </View>
              <Text style={styles.heroTitle}>Your PDF toolkit, without the clutter.</Text>
              <Text style={styles.heroText}>Compress, organize, convert, secure and sign files locally with clear results and real save controls.</Text>
              <View style={styles.heroStats}>
                <HeroStat icon="cloud-off-outline" label="Offline" />
                <HeroStat icon="lock-check-outline" label="Private" />
                <HeroStat icon="flash-outline" label="Fast" />
              </View>
            </View>

            <View style={styles.saveSetupCard}>
              <View style={styles.saveSetupIcon}>
                <AppIcon name="folder-cog-outline" size={24} color="#4f46e5" />
              </View>
              <View style={styles.saveSetupCopy}>
                <Text style={styles.saveSetupTitle}>Smart saving</Text>
                <Text style={styles.saveSetupText}>{folderStatus(savePrefs.directoryUri)}</Text>
              </View>
              <Pressable style={styles.textButton} onPress={configureSaveFolder}>
                <Text style={styles.textButtonLabel}>Choose</Text>
              </Pressable>
              <View style={styles.autoSaveRow}>
                <View>
                  <Text style={styles.autoSaveTitle}>Auto-save</Text>
                  <Text style={styles.autoSaveSub}>Save immediately after processing</Text>
                </View>
                <Switch
                  value={savePrefs.autoSave}
                  onValueChange={toggleAutoSave}
                  trackColor={{ false: '#d8deea', true: '#a5b4fc' }}
                  thumbColor={savePrefs.autoSave ? '#4f46e5' : '#ffffff'}
                />
              </View>
            </View>

            {CATEGORIES.map(category => {
              const categoryTools = TOOLS.filter(item => item.category === category.id);
              return (
                <View key={category.id} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionIcon}>
                      <AppIcon name={category.icon} size={18} color="#475569" />
                    </View>
                    <View>
                      <Text style={styles.sectionTitle}>{category.id}</Text>
                      <Text style={styles.sectionSubtitle}>{category.subtitle}</Text>
                    </View>
                  </View>
                  <View style={styles.grid}>
                    {categoryTools.map(item => (
                      <ToolCard key={item.id} tool={item} onPress={() => resetWorkspace(item.id)} />
                    ))}
                  </View>
                </View>
              );
            })}

            <View style={styles.privacyCard}>
              <View style={styles.privacyIcon}>
                <AppIcon name="shield-lock-outline" size={23} color="#047857" />
              </View>
              <View style={styles.privacyCopy}>
                <Text style={styles.privacyTitle}>Built around useful tools, not fake menus</Text>
                <Text style={styles.privacyText}>Features stay hidden until they have a real local engine. Your ordinary PDF operations do not need a remote upload.</Text>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.workspace}>
            <View style={styles.workspaceHeader}>
              <View style={[styles.largeIcon, selectedTool ? { backgroundColor: toneStyle(selectedTool.tone).bg } : null]}>
                <AppIcon name={selectedTool?.icon || 'file-outline'} size={28} color={selectedTool ? toneStyle(selectedTool.tone).fg : '#2563eb'} />
              </View>
              <View style={styles.workspaceCopy}>
                <Text style={styles.workspaceTitle}>{selectedTool?.title}</Text>
                <Text style={styles.workspaceDescription}>{selectedTool?.description}</Text>
              </View>
            </View>

            {tool === 'images' ? (
              <>
                <SelectButton icon="image-plus" label={images.length ? 'Choose different images' : 'Choose images'} onPress={pickImages} />
                {images.length > 0 ? <InfoRow title={`${images.length} image(s) selected`} detail="Selection order becomes page order." icon="image-multiple-outline" /> : null}
              </>
            ) : tool === 'camera' ? (
              <>
                <SelectButton icon="camera-plus-outline" label={images.length ? 'Capture another page' : 'Capture first page'} onPress={capturePage} />
                {images.length > 0 ? (
                  <View style={styles.filePanel}>
                    <View style={styles.fileBadge}><AppIcon name="camera-outline" size={17} color="#475569" /></View>
                    <View style={styles.fileText}>
                      <Text style={styles.fileName}>{images.length} captured page(s)</Text>
                      <Text style={styles.fileMeta}>Pages will be exported in capture order.</Text>
                    </View>
                    <View style={styles.rowActions}>
                      <MiniButton icon="undo" onPress={() => setImages(current => current.slice(0, -1))} />
                      <MiniButton icon="trash-can-outline" onPress={() => setImages([])} danger />
                    </View>
                  </View>
                ) : null}
                {images.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbScroller}>
                    {images.slice(0, 8).map((item, index) => <Image key={`${item.uri}-${index}`} source={{ uri: item.uri }} style={styles.captureThumb} />)}
                  </ScrollView>
                ) : null}
              </>
            ) : (
              <>
                <SelectButton icon="file-plus-outline" label={tool === 'merge' ? 'Choose PDF files' : 'Choose PDF'} onPress={() => pickPdf(tool === 'merge')} />
                {pdfs.map((pdf, index) => (
                  <View key={`${pdf.uri}-${index}`} style={styles.filePanel}>
                    <View style={styles.fileBadge}><Text style={styles.fileBadgeText}>{index + 1}</Text></View>
                    <View style={styles.fileText}>
                      <Text style={styles.fileName} numberOfLines={1}>{pdf.name}</Text>
                      <Text style={styles.fileMeta}>{[formatBytes(pdf.size), pdf.pages ? `${pdf.pages} pages` : ''].filter(Boolean).join(' • ') || 'PDF document'}</Text>
                    </View>
                    {tool === 'merge' ? (
                      <View style={styles.mergeControls}>
                        <MiniButton icon="arrow-up" onPress={() => movePdf(index, -1)} disabled={index === 0} />
                        <MiniButton icon="arrow-down" onPress={() => movePdf(index, 1)} disabled={index === pdfs.length - 1} />
                        <MiniButton icon="close" onPress={() => removePdf(index)} danger />
                      </View>
                    ) : null}
                  </View>
                ))}
              </>
            )}

            {tool === 'compress' ? (
              <View style={styles.optionBlock}>
                <FieldLabel text="Compression quality" icon="tune-variant" />
                <View style={styles.segmentRow}>
                  {(['balanced', 'strong', 'extreme'] as const).map(mode => (
                    <Pressable key={mode} style={[styles.segment, compressionMode === mode && styles.segmentActive]} onPress={() => setCompressionMode(mode)}>
                      <Text style={[styles.segmentText, compressionMode === mode && styles.segmentTextActive]}>{mode[0].toUpperCase() + mode.slice(1)}</Text>
                    </Pressable>
                  ))}
                </View>
                <Hint text="Best for scanned and image-heavy PDFs. Compression flattens pages visually, so selectable text and form fields are not preserved in the compressed copy." />
              </View>
            ) : null}

            {needsPages ? (
              <View style={styles.optionBlock}>
                <FieldLabel text={tool === 'reorder' ? 'New page order' : tool === 'delete' ? 'Pages to delete' : 'Pages'} icon="format-list-numbered" />
                <TextInput
                  style={styles.input}
                  value={pageExpression}
                  onChangeText={setPageExpression}
                  placeholder={tool === 'rotate' ? 'Empty = all pages, or 1-3,5' : tool === 'reorder' ? 'Example: 3,1,2,4-8' : 'Example: 1-3,5,8'}
                  placeholderTextColor="#98a2b3"
                  autoCapitalize="none"
                />
                <Hint text="Ranges and comma-separated page numbers are supported." />
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
                <FieldLabel text={tool === 'protect' ? 'New password' : 'Current password'} icon="key-outline" />
                <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="Password" placeholderTextColor="#98a2b3" />
                {tool === 'protect' ? <TextInput style={[styles.input, styles.secondInput]} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" placeholder="Repeat password" placeholderTextColor="#98a2b3" /> : null}
              </View>
            ) : null}

            {tool === 'sign' ? (
              <View style={styles.optionBlock}>
                <FieldLabel text="Signature page" icon="file-sign" />
                <TextInput style={styles.input} value={signaturePage} onChangeText={setSignaturePage} keyboardType="number-pad" placeholder="1" placeholderTextColor="#98a2b3" />
                <Hint text="The signature is placed near the lower-right area of the selected page." />
                <View style={styles.signatureSpace}><SignaturePad onChange={handleSignatureChange} /></View>
              </View>
            ) : null}

            {tool === 'watermark' ? (
              <View style={styles.optionBlock}>
                <FieldLabel text="Watermark text" icon="watermark" />
                <TextInput style={styles.input} value={watermark} onChangeText={setWatermark} maxLength={80} />
                <Hint text="Text is embedded permanently into every page." />
              </View>
            ) : null}

            {tool === 'numbers' ? (
              <View style={styles.optionBlock}>
                <FieldLabel text="Start numbering at" icon="numeric" />
                <TextInput style={styles.input} value={startAt} onChangeText={setStartAt} keyboardType="number-pad" />
              </View>
            ) : null}

            {tool === 'preview' && selectedPdf ? (
              <View style={styles.optionBlock}>
                <View style={styles.previewNav}>
                  <MiniButton icon="chevron-left" onPress={() => { setPreviewPage(current => Math.max(1, current - 1)); setPreviewUri(null); }} disabled={previewPage <= 1} />
                  <Text style={styles.previewPageText}>Page {previewPage}{selectedPdf.pages ? ` / ${selectedPdf.pages}` : ''}</Text>
                  <MiniButton icon="chevron-right" onPress={() => { setPreviewPage(current => selectedPdf.pages ? Math.min(selectedPdf.pages, current + 1) : current + 1); setPreviewUri(null); }} disabled={Boolean(selectedPdf.pages && previewPage >= selectedPdf.pages)} />
                </View>
                {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" /> : <View style={styles.previewEmpty}><AppIcon name="file-eye-outline" size={34} color="#94a3b8" /><Text style={styles.previewEmptyText}>Render the selected page to preview it.</Text></View>}
              </View>
            ) : null}

            <Pressable style={[styles.primaryButton, (!canRun || busy) && styles.disabled]} onPress={runTool} disabled={!canRun || busy}>
              {busy ? <ActivityIndicator color="#ffffff" /> : <><AppIcon name="play-circle-outline" size={20} color="#ffffff" /><Text style={styles.primaryButtonText}>{actionLabel()}</Text></>}
            </Pressable>

            {compressionInfo ? (
              <View style={styles.statsCard}>
                <View style={styles.statsIcon}><AppIcon name="chart-box-outline" size={20} color="#2563eb" /></View>
                <View style={styles.statsCopy}>
                  <Text style={styles.statsTitle}>Compression result</Text>
                  <Text style={styles.statsNumber}>{formatBytes(compressionInfo.originalBytes)} → {formatBytes(compressionInfo.bytes)}</Text>
                  <Text style={styles.statsText}>{compressionInfo.originalBytes > 0 ? `${Math.max(0, Math.round((1 - compressionInfo.bytes / compressionInfo.originalBytes) * 100))}% smaller` : 'Compressed copy created'}</Text>
                </View>
              </View>
            ) : null}

            {renderedImages.length > 0 ? (
              <View style={styles.resultCard}>
                <View style={styles.successRow}><View style={styles.successDot}><AppIcon name="check" size={15} color="#ffffff" /></View><Text style={styles.resultTitle}>{renderedImages.length} JPG page(s) ready</Text></View>
                <Text style={styles.resultMeta}>High-quality page renders were created locally.</Text>
                <View style={styles.imageStrip}>
                  {renderedImages.slice(0, 3).map(item => <Image key={item.page} source={{ uri: item.uri }} style={styles.resultThumb} />)}
                  {renderedImages.length > 3 ? <View style={styles.moreThumb}><Text style={styles.moreThumbText}>+{renderedImages.length - 3}</Text></View> : null}
                </View>
                {lastSaveMessage ? <SaveNotice text={lastSaveMessage} /> : null}
                <View style={styles.actionGrid}>
                  <ResultAction icon="content-save-outline" label="Quick Save" onPress={() => saveRenderedImages(false)} disabled={saving} />
                  <ResultAction icon="folder-edit-outline" label="Save As" onPress={() => saveRenderedImages(true)} disabled={saving} />
                </View>
              </View>
            ) : null}

            {result ? (
              <View style={styles.resultCard}>
                <View style={styles.successRow}>
                  <View style={styles.successDot}><AppIcon name="check" size={15} color="#ffffff" /></View>
                  <View style={styles.resultHeadingCopy}>
                    <Text style={styles.resultTitle}>PDF ready</Text>
                    <Text style={styles.resultMeta}>Processed locally and ready to use</Text>
                  </View>
                </View>
                <View style={styles.resultFileRow}>
                  <View style={styles.resultFileIcon}><AppIcon name="file-pdf-box" size={29} color="#dc2626" /></View>
                  <View style={styles.fileText}>
                    <Text style={styles.resultName} numberOfLines={1}>{result.fileName}</Text>
                    <Text style={styles.resultFileMeta}>{result.pageCount} page(s) • {formatBytes(result.bytes)}</Text>
                  </View>
                </View>
                {lastSaveMessage ? <SaveNotice text={lastSaveMessage} /> : null}
                {tool === 'protect' ? <Hint text="Protected PDFs cannot be previewed inside PDF Pro without reopening them with the password. Save or share the protected copy directly." /> : null}
                <View style={styles.actionGrid}>
                  {canPreviewResult ? <ResultAction icon="eye-outline" label="Preview" onPress={openResultPreview} /> : null}
                  <ResultAction icon="content-save-outline" label="Quick Save" onPress={() => saveResult(false)} disabled={saving} />
                  <ResultAction icon="folder-edit-outline" label="Save As" onPress={() => saveResult(true)} disabled={saving} />
                  <ResultAction icon="share-variant-outline" label="Share" onPress={shareResult} />
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal visible={resultPreviewOpen} animationType="slide" onRequestClose={() => setResultPreviewOpen(false)}>
        <SafeAreaView style={styles.modalSafeArea}>
          <StatusBar style="dark" />
          <View style={styles.modalHeader}>
            <Pressable style={styles.roundButton} onPress={() => setResultPreviewOpen(false)}>
              <AppIcon name="arrow-left" size={21} color="#162033" />
            </Pressable>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.modalTitle}>Result preview</Text>
              <Text style={styles.modalSubtitle}>Page {resultPreviewPage}{result?.pageCount ? ` / ${result.pageCount}` : ''}</Text>
            </View>
            <View style={styles.localBadge}><AppIcon name="shield-check-outline" size={14} color="#047857" /><Text style={styles.localBadgeText}>LOCAL</Text></View>
          </View>
          <View style={styles.modalViewer}>
            {resultPreviewBusy || !resultPreviewUri ? <ActivityIndicator size="large" color="#4f46e5" /> : <Image source={{ uri: resultPreviewUri }} style={styles.modalImage} resizeMode="contain" />}
          </View>
          <View style={styles.modalFooter}>
            <Pressable style={[styles.modalNavButton, resultPreviewPage <= 1 && styles.disabled]} disabled={resultPreviewPage <= 1 || resultPreviewBusy} onPress={() => renderResultPreview(resultPreviewPage - 1)}>
              <AppIcon name="chevron-left" size={21} color="#344054" /><Text style={styles.modalNavText}>Previous</Text>
            </Pressable>
            <Pressable style={[styles.modalNavButton, Boolean(result?.pageCount && resultPreviewPage >= result.pageCount) && styles.disabled]} disabled={Boolean(result?.pageCount && resultPreviewPage >= result.pageCount) || resultPreviewBusy} onPress={() => renderResultPreview(resultPreviewPage + 1)}>
              <Text style={styles.modalNavText}>Next</Text><AppIcon name="chevron-right" size={21} color="#344054" />
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function AppIcon({ name, size = 20, color = '#344054' }: { name: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
}

function HeroStat({ icon, label }: { icon: string; label: string }) {
  return <View style={styles.heroStat}><AppIcon name={icon} size={15} color="#dbeafe" /><Text style={styles.heroStatText}>{label}</Text></View>;
}

function ToolCard({ tool, onPress }: { tool: ToolDefinition; onPress: () => void }) {
  const tone = toneStyle(tool.tone);
  return (
    <Pressable style={({ pressed }) => [styles.toolCard, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.cardTop}>
        <View style={[styles.toolIcon, { backgroundColor: tone.bg }]}><AppIcon name={tool.icon} size={23} color={tone.fg} /></View>
        {tool.badge ? <View style={styles.nativeBadge}><Text style={styles.nativeBadgeText}>{tool.badge}</Text></View> : <AppIcon name="chevron-right" size={18} color="#c2c8d0" />}
      </View>
      <Text style={styles.toolTitle}>{tool.title}</Text>
      <Text style={styles.toolDescription}>{tool.description}</Text>
    </Pressable>
  );
}

function SelectButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return <Pressable style={({ pressed }) => [styles.selectButton, pressed && styles.pressed]} onPress={onPress}><View style={styles.selectIconCircle}><AppIcon name={icon} size={22} color="#4f46e5" /></View><Text style={styles.selectText}>{label}</Text><AppIcon name="chevron-right" size={20} color="#818cf8" /></Pressable>;
}

function MiniButton({ icon, onPress, danger, disabled }: { icon: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return <Pressable style={[styles.miniButton, danger && styles.miniDanger, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><AppIcon name={icon} size={17} color={danger ? '#b42318' : '#475467'} /></Pressable>;
}

function FieldLabel({ text, icon }: { text: string; icon: string }) {
  return <View style={styles.fieldLabelRow}><AppIcon name={icon} size={16} color="#667085" /><Text style={styles.fieldLabel}>{text}</Text></View>;
}

function Hint({ text }: { text: string }) {
  return <View style={styles.hintRow}><AppIcon name="information-outline" size={15} color="#667085" /><Text style={styles.help}>{text}</Text></View>;
}

function InfoRow({ title, detail, icon }: { title: string; detail: string; icon: string }) {
  return <View style={styles.filePanel}><View style={styles.fileBadge}><AppIcon name={icon} size={18} color="#475467" /></View><View style={styles.fileText}><Text style={styles.fileName}>{title}</Text><Text style={styles.fileMeta}>{detail}</Text></View></View>;
}

function ResultAction({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable style={({ pressed }) => [styles.resultAction, pressed && !disabled && styles.pressed, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><AppIcon name={icon} size={20} color="#344054" /><Text style={styles.resultActionText}>{label}</Text></Pressable>;
}

function SaveNotice({ text }: { text: string }) {
  return <View style={styles.saveNotice}><AppIcon name="check-circle-outline" size={17} color="#047857" /><Text style={styles.saveNoticeText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f7fb' },
  container: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 60 },
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginBottom: 18 },
  brandMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  roundButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e4e7ec', alignItems: 'center', justifyContent: 'center' },
  brandCopy: { flex: 1, marginLeft: 11 },
  brandName: { color: '#101828', fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  brandSubtitle: { color: '#667085', fontSize: 11.5, marginTop: 2, fontWeight: '600' },
  localBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999, backgroundColor: '#ecfdf3', borderWidth: 1, borderColor: '#abefc6' },
  localBadgeText: { color: '#047857', fontSize: 8.5, fontWeight: '900', letterSpacing: 0.5 },
  hero: { position: 'relative', overflow: 'hidden', backgroundColor: '#111827', borderRadius: 26, padding: 22, marginBottom: 16 },
  heroGlowOne: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: '#4338ca', opacity: 0.34, right: -70, top: -75 },
  heroGlowTwo: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: '#0ea5e9', opacity: 0.14, left: -50, bottom: -60 },
  heroPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.09)', marginBottom: 16 },
  heroPillText: { color: '#c7d2fe', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.8 },
  heroTitle: { color: '#ffffff', fontSize: 29, lineHeight: 35, fontWeight: '900', letterSpacing: -0.8, maxWidth: 330 },
  heroText: { color: '#cbd5e1', marginTop: 11, fontSize: 13.5, lineHeight: 20.5, maxWidth: 340 },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 18, flexWrap: 'wrap' },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroStatText: { color: '#e5e7eb', fontSize: 10.5, fontWeight: '800' },
  saveSetupCard: { backgroundColor: '#ffffff', borderRadius: 20, borderWidth: 1, borderColor: '#e4e7ec', padding: 14, marginBottom: 26, shadowColor: '#101828', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 1 },
  saveSetupIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center', position: 'absolute', left: 14, top: 14 },
  saveSetupCopy: { marginLeft: 52, minHeight: 42, justifyContent: 'center', paddingRight: 68 },
  saveSetupTitle: { color: '#101828', fontSize: 14, fontWeight: '900' },
  saveSetupText: { color: '#667085', fontSize: 10.5, marginTop: 3 },
  textButton: { position: 'absolute', right: 14, top: 18, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: '#f2f4f7' },
  textButtonLabel: { color: '#344054', fontWeight: '900', fontSize: 10.5 },
  autoSaveRow: { marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f1f4', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  autoSaveTitle: { color: '#344054', fontWeight: '800', fontSize: 12 },
  autoSaveSub: { color: '#98a2b3', fontSize: 9.5, marginTop: 2 },
  section: { marginBottom: 26 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 11 },
  sectionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#eaecf0', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { color: '#101828', fontSize: 16.5, fontWeight: '900', letterSpacing: -0.2 },
  sectionSubtitle: { color: '#98a2b3', fontSize: 10.5, marginTop: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  toolCard: { flexGrow: 1, flexBasis: '47%', minWidth: 150, minHeight: 148, backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1, borderColor: '#e4e7ec', padding: 14, shadowColor: '#101828', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.035, shadowRadius: 10, elevation: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 13 },
  toolIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  nativeBadge: { backgroundColor: '#f2f4f7', paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7 },
  nativeBadgeText: { color: '#667085', fontSize: 8, fontWeight: '900' },
  toolTitle: { color: '#101828', fontSize: 14.5, fontWeight: '900', letterSpacing: -0.15 },
  toolDescription: { color: '#667085', fontSize: 11.2, lineHeight: 16.5, marginTop: 5 },
  privacyCard: { flexDirection: 'row', backgroundColor: '#ecfdf3', borderRadius: 18, borderWidth: 1, borderColor: '#abefc6', padding: 15 },
  privacyIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#d1fadf', alignItems: 'center', justifyContent: 'center' },
  privacyCopy: { flex: 1, marginLeft: 11 },
  privacyTitle: { color: '#065f46', fontSize: 13, fontWeight: '900' },
  privacyText: { color: '#047857', fontSize: 10.7, lineHeight: 16, marginTop: 4 },
  workspace: { backgroundColor: '#ffffff', borderRadius: 24, borderWidth: 1, borderColor: '#e4e7ec', padding: 17, shadowColor: '#101828', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.035, shadowRadius: 15, elevation: 1 },
  workspaceHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 19 },
  largeIcon: { width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  workspaceCopy: { flex: 1, marginLeft: 13 },
  workspaceTitle: { color: '#101828', fontSize: 21, fontWeight: '900', letterSpacing: -0.4 },
  workspaceDescription: { color: '#667085', fontSize: 11.8, lineHeight: 17.5, marginTop: 3 },
  selectButton: { minHeight: 64, borderWidth: 1, borderColor: '#c7d2fe', backgroundColor: '#f5f7ff', borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  selectIconCircle: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#e0e7ff', alignItems: 'center', justifyContent: 'center' },
  selectText: { color: '#3730a3', fontWeight: '900', fontSize: 13, flex: 1 },
  filePanel: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 14, borderWidth: 1, borderColor: '#eaecf0', padding: 11, marginTop: 10 },
  fileBadge: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#eaecf0', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  fileBadgeText: { color: '#475467', fontWeight: '900', fontSize: 11.5 },
  fileText: { flex: 1, minWidth: 0 },
  fileName: { color: '#101828', fontWeight: '800', fontSize: 12.5 },
  fileMeta: { color: '#98a2b3', fontSize: 9.8, marginTop: 3 },
  mergeControls: { flexDirection: 'row', gap: 4, marginLeft: 6 },
  rowActions: { flexDirection: 'row', gap: 5, marginLeft: 7 },
  miniButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#eaecf0', alignItems: 'center', justifyContent: 'center' },
  miniDanger: { backgroundColor: '#fee4e2' },
  optionBlock: { marginTop: 18 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  fieldLabel: { color: '#344054', fontSize: 11.5, fontWeight: '900' },
  input: { minHeight: 49, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 13, paddingHorizontal: 13, backgroundColor: '#ffffff', color: '#101828', fontSize: 13.5 },
  secondInput: { marginTop: 8 },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 7 },
  help: { color: '#667085', fontSize: 10.2, lineHeight: 15.5, flex: 1 },
  segmentRow: { flexDirection: 'row', gap: 7, marginTop: 4 },
  segment: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#e4e7ec', backgroundColor: '#f9fafb' },
  segmentActive: { borderColor: '#4f46e5', backgroundColor: '#4f46e5' },
  segmentText: { color: '#475467', fontSize: 10.8, fontWeight: '900' },
  segmentTextActive: { color: '#ffffff' },
  signatureSpace: { marginTop: 14 },
  thumbScroller: { marginTop: 10 },
  captureThumb: { width: 72, height: 92, borderRadius: 11, backgroundColor: '#eaecf0', marginRight: 8 },
  previewNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  previewPageText: { color: '#344054', fontSize: 11.5, fontWeight: '900' },
  previewImage: { width: '100%', height: 420, borderRadius: 14, backgroundColor: '#eaecf0' },
  previewEmpty: { height: 250, borderRadius: 14, backgroundColor: '#f2f4f7', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 8 },
  previewEmptyText: { color: '#667085', fontSize: 11, textAlign: 'center' },
  primaryButton: { marginTop: 22, minHeight: 55, borderRadius: 15, backgroundColor: '#111827', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', shadowColor: '#111827', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.14, shadowRadius: 10, elevation: 3 },
  primaryButtonText: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  statsCard: { marginTop: 15, borderRadius: 16, padding: 14, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', flexDirection: 'row', alignItems: 'center' },
  statsIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  statsCopy: { marginLeft: 10, flex: 1 },
  statsTitle: { color: '#1d4ed8', fontSize: 9.5, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.65 },
  statsNumber: { color: '#1e3a8a', fontSize: 17, fontWeight: '900', marginTop: 3 },
  statsText: { color: '#2563eb', fontSize: 10.5, marginTop: 2, fontWeight: '700' },
  resultCard: { marginTop: 15, borderRadius: 18, padding: 15, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#d1fadf', shadowColor: '#065f46', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.035, shadowRadius: 12, elevation: 1 },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  successDot: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#12b76a', alignItems: 'center', justifyContent: 'center' },
  resultHeadingCopy: { flex: 1 },
  resultTitle: { color: '#065f46', fontWeight: '900', fontSize: 13.5 },
  resultMeta: { color: '#039855', fontSize: 9.8, marginTop: 2 },
  resultFileRow: { marginTop: 13, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 13, padding: 10, borderWidth: 1, borderColor: '#eaecf0' },
  resultFileIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#fff1f1', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  resultName: { color: '#101828', fontWeight: '800', fontSize: 12.2 },
  resultFileMeta: { color: '#98a2b3', fontSize: 9.7, marginTop: 3 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  resultAction: { flexGrow: 1, flexBasis: '45%', minHeight: 47, borderRadius: 12, backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e4e7ec', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  resultActionText: { color: '#344054', fontWeight: '900', fontSize: 10.5 },
  saveNotice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#ecfdf3', borderRadius: 10 },
  saveNoticeText: { color: '#047857', fontSize: 9.7, fontWeight: '800', flex: 1 },
  imageStrip: { flexDirection: 'row', gap: 7, marginTop: 12 },
  resultThumb: { width: 58, height: 76, borderRadius: 9, backgroundColor: '#eaecf0' },
  moreThumb: { width: 58, height: 76, borderRadius: 9, backgroundColor: '#f2f4f7', alignItems: 'center', justifyContent: 'center' },
  moreThumbText: { color: '#667085', fontWeight: '900', fontSize: 12 },
  modalSafeArea: { flex: 1, backgroundColor: '#f6f7fb' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e4e7ec', backgroundColor: '#ffffff' },
  modalHeaderCopy: { flex: 1, marginLeft: 11 },
  modalTitle: { color: '#101828', fontSize: 16, fontWeight: '900' },
  modalSubtitle: { color: '#667085', fontSize: 10.5, marginTop: 2 },
  modalViewer: { flex: 1, margin: 14, borderRadius: 18, overflow: 'hidden', backgroundColor: '#e9edf3', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#d0d5dd' },
  modalImage: { width: '100%', height: '100%' },
  modalFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  modalNavButton: { flex: 1, minHeight: 48, borderRadius: 13, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#d0d5dd', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  modalNavText: { color: '#344054', fontSize: 11, fontWeight: '900' },
});
