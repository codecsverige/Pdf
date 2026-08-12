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

type Category = 'Popular' | 'Organize' | 'Convert' | 'Secure' | 'Edit';
type Tone = 'indigo' | 'blue' | 'green' | 'orange' | 'rose';

type SelectedPdf = { uri: string; name: string; size?: number; pages?: number };
type RenderedImage = { uri: string; page: number; bytes: number };
type CompressionResult = PdfOutput & { originalBytes: number; flattened: boolean };
type Tool = { id: ToolId; title: string; subtitle: string; icon: string; category: Category; tone: Tone; native?: boolean };

const TOOLS: Tool[] = [
  { id: 'compress', title: 'Compress', subtitle: 'Shrink PDF size', icon: 'file-percent-outline', category: 'Popular', tone: 'indigo', native: true },
  { id: 'merge', title: 'Merge', subtitle: 'Combine PDFs', icon: 'file-document-multiple-outline', category: 'Popular', tone: 'blue' },
  { id: 'preview', title: 'Viewer', subtitle: 'Read PDF pages', icon: 'file-eye-outline', category: 'Popular', tone: 'green', native: true },
  { id: 'sign', title: 'Sign', subtitle: 'Add signature', icon: 'draw-pen', category: 'Popular', tone: 'orange' },
  { id: 'extract', title: 'Split', subtitle: 'Extract pages', icon: 'file-export-outline', category: 'Organize', tone: 'indigo' },
  { id: 'delete', title: 'Delete', subtitle: 'Remove pages', icon: 'file-remove-outline', category: 'Organize', tone: 'rose' },
  { id: 'reorder', title: 'Reorder', subtitle: 'Change page order', icon: 'sort-variant', category: 'Organize', tone: 'blue' },
  { id: 'rotate', title: 'Rotate', subtitle: 'Rotate pages', icon: 'file-rotate-right-outline', category: 'Organize', tone: 'green' },
  { id: 'images', title: 'Images → PDF', subtitle: 'Photos to PDF', icon: 'image-multiple-outline', category: 'Convert', tone: 'indigo' },
  { id: 'camera', title: 'Scan to PDF', subtitle: 'Camera pages', icon: 'camera-document', category: 'Convert', tone: 'blue' },
  { id: 'pdfImages', title: 'PDF → JPG', subtitle: 'Pages as images', icon: 'file-image-outline', category: 'Convert', tone: 'orange', native: true },
  { id: 'protect', title: 'Protect', subtitle: 'Add password', icon: 'lock-outline', category: 'Secure', tone: 'green', native: true },
  { id: 'unlock', title: 'Unlock', subtitle: 'Remove password', icon: 'lock-open-variant-outline', category: 'Secure', tone: 'blue', native: true },
  { id: 'watermark', title: 'Watermark', subtitle: 'Stamp every page', icon: 'watermark', category: 'Edit', tone: 'indigo' },
  { id: 'numbers', title: 'Page numbers', subtitle: 'Number pages', icon: 'format-list-numbered', category: 'Edit', tone: 'orange' },
];

const CATEGORIES: { id: Category; title: string; icon: string }[] = [
  { id: 'Popular', title: 'Popular tools', icon: 'star-four-points-outline' },
  { id: 'Organize', title: 'Organize pages', icon: 'layers-triple-outline' },
  { id: 'Convert', title: 'Convert', icon: 'swap-horizontal' },
  { id: 'Secure', title: 'Security', icon: 'shield-lock-outline' },
  { id: 'Edit', title: 'Edit & finish', icon: 'pencil-ruler-outline' },
];

const DEFAULT_PREFS: SavePreferences = { directoryUri: null, autoSave: false };

const COLORS = {
  bg: '#F5F7FB',
  surface: '#FFFFFF',
  ink: '#101828',
  muted: '#667085',
  faint: '#98A2B3',
  line: '#E4E7EC',
  indigo: '#4F46E5',
  navy: '#111827',
  green: '#079455',
  red: '#D92D20',
};

function iconTone(tone: Tone) {
  const map = {
    indigo: { bg: '#EEF2FF', fg: '#4F46E5' },
    blue: { bg: '#EFF8FF', fg: '#1570EF' },
    green: { bg: '#ECFDF3', fg: '#079455' },
    orange: { bg: '#FFF6ED', fg: '#E04F16' },
    rose: { bg: '#FFF1F3', fg: '#E31B54' },
  };
  return map[tone];
}

function fmt(bytes?: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function message(error: unknown) {
  const text = error instanceof Error ? error.message : String(error || '');
  if (/password|decrypt|encrypted|security handler/i.test(text)) return 'The PDF is protected or the password is incorrect.';
  return text || 'The operation could not be completed.';
}

function AppIcon({ name, size = 20, color = COLORS.muted }: { name: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
}

export default function ProApp() {
  const [tool, setTool] = useState<ToolId | null>(null);
  const [pdfs, setPdfs] = useState<SelectedPdf[]>([]);
  const [images, setImages] = useState<ImageInput[]>([]);
  const [pages, setPages] = useState('');
  const [watermark, setWatermark] = useState('CONFIDENTIAL');
  const [startAt, setStartAt] = useState('1');
  const [rotation, setRotation] = useState<90 | 180 | 270>(90);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [compression, setCompression] = useState<'balanced' | 'strong' | 'extreme'>('balanced');
  const [signaturePath, setSignaturePath] = useState('');
  const [signatureSize, setSignatureSize] = useState({ width: 320, height: 170 });
  const [signaturePage, setSignaturePage] = useState('1');
  const [previewPage, setPreviewPage] = useState(1);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [result, setResult] = useState<PdfOutput | null>(null);
  const [compressionResult, setCompressionResult] = useState<CompressionResult | null>(null);
  const [rendered, setRendered] = useState<RenderedImage[]>([]);
  const [prefs, setPrefs] = useState<SavePreferences>(DEFAULT_PREFS);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerBusy, setViewerBusy] = useState(false);
  const lastBack = useRef(0);

  const selectedTool = useMemo(() => TOOLS.find(item => item.id === tool) ?? null, [tool]);
  const selectedPdf = pdfs[0];
  const canViewResult = Boolean(result && tool !== 'protect');

  useEffect(() => {
    getSavePreferences().then(setPrefs).catch(() => undefined);
  }, []);

  const reset = useCallback((next: ToolId | null = null) => {
    setTool(next);
    setPdfs([]);
    setImages([]);
    setPages('');
    setWatermark('CONFIDENTIAL');
    setStartAt('1');
    setRotation(90);
    setPassword('');
    setConfirmPassword('');
    setCompression('balanced');
    setSignaturePath('');
    setSignaturePage('1');
    setPreviewPage(1);
    setPreviewUri(null);
    setResult(null);
    setCompressionResult(null);
    setRendered([]);
    setSaveNotice(null);
    setViewerOpen(false);
    setViewerPage(1);
    setViewerUri(null);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewerOpen) {
        setViewerOpen(false);
        return true;
      }
      if (tool) {
        reset(null);
        return true;
      }
      const now = Date.now();
      if (now - lastBack.current < 1700) return false;
      lastBack.current = now;
      ToastAndroid.show('Press back again to exit PDF Pro', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, [reset, tool, viewerOpen]);

  const onSignature = useCallback((path: string, width: number, height: number) => {
    setSignaturePath(path);
    setSignatureSize({ width, height });
  }, []);

  async function persistPrefs(next: SavePreferences) {
    setPrefs(next);
    await setSavePreferences(next);
  }

  async function chooseDefaultFolder() {
    try {
      const directoryUri = await chooseSaveFolder(prefs.directoryUri);
      await persistPrefs({ ...prefs, directoryUri });
      Alert.alert('Folder selected', 'Download will now use your selected folder.');
    } catch (error) {
      if (!/cancel/i.test(message(error))) Alert.alert('Folder not changed', message(error));
    }
  }

  async function toggleAutoSave(value: boolean) {
    await persistPrefs({ ...prefs, autoSave: value });
  }

  async function pickPdf(multiple: boolean) {
    try {
      const response = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple, copyToCacheDirectory: true });
      if (response.canceled || !response.assets?.length) return;
      const next: SelectedPdf[] = response.assets.map(asset => ({ uri: asset.uri, name: asset.name || 'document.pdf', size: asset.size }));
      if (!multiple) {
        try {
          next[0].pages = await getPdfPageCount(next[0].uri);
        } catch (error) {
          if (tool !== 'unlock') throw error;
        }
      }
      setPdfs(next);
      setPreviewPage(1);
      setPreviewUri(null);
      setResult(null);
      setRendered([]);
      setSaveNotice(null);
    } catch (error) {
      Alert.alert('Cannot open PDF', message(error));
    }
  }

  async function pickImages() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Photo access is required.');
      const response = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, orderedSelection: true, selectionLimit: 0, quality: 1 });
      if (response.canceled) return;
      setImages(response.assets.map(asset => ({ uri: asset.uri, width: asset.width, height: asset.height })));
      setResult(null);
    } catch (error) {
      Alert.alert('Could not select images', message(error));
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
      Alert.alert('Camera failed', message(error));
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
  }

  async function autoDownloadPdf(output: PdfOutput) {
    if (!prefs.autoSave) return;
    try {
      const saved = await savePdfToPreferredFolder(output.uri, output.fileName, prefs.directoryUri);
      if (saved.directoryUri && saved.directoryUri !== prefs.directoryUri) await persistPrefs({ ...prefs, directoryUri: saved.directoryUri });
      setSaveNotice(saved.directoryUri ? 'Downloaded automatically to your selected folder' : 'Downloaded automatically to Downloads/PDF Pro');
    } catch (error) {
      setSaveNotice('PDF ready — automatic download failed');
      Alert.alert('PDF ready', message(error));
    }
  }

  async function autoDownloadImages(items: RenderedImage[]) {
    if (!prefs.autoSave || !items.length) return;
    try {
      const saved = await saveImagesToPreferredFolder(items, prefs.directoryUri);
      if (saved.directoryUri && saved.directoryUri !== prefs.directoryUri) await persistPrefs({ ...prefs, directoryUri: saved.directoryUri });
      setSaveNotice(saved.directoryUri ? 'JPG pages downloaded automatically' : 'JPG pages downloaded to Downloads/PDF Pro');
    } catch (error) {
      setSaveNotice('JPG pages ready — automatic download failed');
      Alert.alert('Images ready', message(error));
    }
  }

  async function runTool() {
    if (!tool) return;
    setBusy(true);
    setResult(null);
    setRendered([]);
    setCompressionResult(null);
    setSaveNotice(null);
    try {
      let output: PdfOutput | null = null;
      switch (tool) {
        case 'compress': {
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          const compressed = await compressPdfNative(selectedPdf.uri, compression);
          output = compressed;
          setCompressionResult(compressed);
          break;
        }
        case 'merge':
          output = await mergePdfs(pdfs.map(item => item.uri));
          break;
        case 'extract':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await extractPages(selectedPdf.uri, pages);
          break;
        case 'delete':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await deletePages(selectedPdf.uri, pages);
          break;
        case 'reorder':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await reorderPages(selectedPdf.uri, pages);
          break;
        case 'rotate':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await rotatePages(selectedPdf.uri, pages, rotation);
          break;
        case 'images':
        case 'camera':
          output = await imagesToPdf(images, { pageMode: 'auto', jpegQuality: 0.9, maxImageWidth: 2400, margin: 24 });
          break;
        case 'pdfImages': {
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          const items = await pdfToImagesNative(selectedPdf.uri);
          setRendered(items);
          await autoDownloadImages(items);
          break;
        }
        case 'protect':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          if (password.length < 4) throw new Error('Use at least 4 characters.');
          if (password !== confirmPassword) throw new Error('The passwords do not match.');
          output = await protectPdfNative(selectedPdf.uri, password);
          break;
        case 'unlock':
          if (!selectedPdf) throw new Error('Choose a protected PDF first.');
          if (!password) throw new Error('Enter the current password.');
          output = await unlockPdfNative(selectedPdf.uri, password);
          break;
        case 'sign': {
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          const page = Number(signaturePage);
          if (!Number.isInteger(page) || page < 1) throw new Error('Enter a valid page number.');
          if (!signaturePath) throw new Error('Draw your signature first.');
          output = await signPdf(selectedPdf.uri, page, signaturePath, signatureSize.width, signatureSize.height);
          break;
        }
        case 'watermark':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await watermarkPdf(selectedPdf.uri, watermark.trim());
          break;
        case 'numbers':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          output = await addPageNumbers(selectedPdf.uri, Number(startAt));
          break;
        case 'preview':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          setPreviewUri((await renderPreviewPage(selectedPdf.uri, previewPage - 1)).uri);
          break;
      }
      if (output) {
        setResult(output);
        await autoDownloadPdf(output);
      }
    } catch (error) {
      Alert.alert('Operation failed', message(error));
    } finally {
      setBusy(false);
    }
  }

  async function downloadResult(saveAs = false) {
    if (!result) return;
    setSaving(true);
    try {
      const saved = saveAs
        ? await savePdfToChosenFolder(result.uri, result.fileName)
        : await savePdfToPreferredFolder(result.uri, result.fileName, prefs.directoryUri);
      if (saved.directoryUri && saved.directoryUri !== prefs.directoryUri) await persistPrefs({ ...prefs, directoryUri: saved.directoryUri });
      setSaveNotice(saved.directoryUri ? 'Saved to your selected folder' : 'Downloaded to Downloads/PDF Pro');
      if (Platform.OS === 'android') ToastAndroid.show(saved.directoryUri ? 'PDF saved' : 'Downloaded to Downloads/PDF Pro', ToastAndroid.SHORT);
    } catch (error) {
      if (!/cancel/i.test(message(error))) Alert.alert('Could not save PDF', message(error));
    } finally {
      setSaving(false);
    }
  }

  async function downloadImages(saveAs = false) {
    setSaving(true);
    try {
      const saved = saveAs ? await saveImagesToChosenFolder(rendered) : await saveImagesToPreferredFolder(rendered, prefs.directoryUri);
      if (saved.directoryUri && saved.directoryUri !== prefs.directoryUri) await persistPrefs({ ...prefs, directoryUri: saved.directoryUri });
      setSaveNotice(saved.directoryUri ? `${rendered.length} JPG pages saved` : `${rendered.length} JPG pages downloaded to Downloads/PDF Pro`);
    } catch (error) {
      if (!/cancel/i.test(message(error))) Alert.alert('Could not save images', message(error));
    } finally {
      setSaving(false);
    }
  }

  async function shareResult() {
    if (!result) return;
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: 'Share PDF', UTI: 'com.adobe.pdf' });
    } catch (error) {
      Alert.alert('Could not share PDF', message(error));
    }
  }

  async function renderViewerPage(page: number) {
    if (!result) return;
    setViewerBusy(true);
    try {
      const safe = Math.max(1, Math.min(result.pageCount || 1, page));
      const renderedPage = await renderPreviewPage(result.uri, safe - 1);
      setViewerPage(safe);
      setViewerUri(renderedPage.uri);
    } catch (error) {
      Alert.alert('Preview unavailable', message(error));
      setViewerOpen(false);
    } finally {
      setViewerBusy(false);
    }
  }

  async function openViewer() {
    if (!result || !canViewResult) return;
    setViewerOpen(true);
    setViewerUri(null);
    await renderViewerPage(1);
  }

  const canRun = useMemo(() => {
    if (!tool) return false;
    if (tool === 'images' || tool === 'camera') return images.length > 0;
    if (tool === 'merge') return pdfs.length >= 2;
    return pdfs.length === 1;
  }, [images.length, pdfs.length, tool]);

  const needsPages = tool === 'extract' || tool === 'delete' || tool === 'reorder' || tool === 'rotate';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <TopBar tool={selectedTool} onBack={() => reset(null)} />

        {!tool ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={styles.proPill}><AppIcon name="star-four-points" size={13} color="#C7D2FE" /><Text style={styles.proText}>PDF PRO</Text></View>
                <View style={styles.offlinePill}><View style={styles.onlineDot} /><Text style={styles.offlineText}>ON DEVICE</Text></View>
              </View>
              <Text style={styles.heroTitle}>Powerful PDF tools.{`\n`}No clutter.</Text>
              <Text style={styles.heroBody}>Edit, convert, secure, preview and download files with a clean local workflow.</Text>
              <View style={styles.heroStrip}>
                <HeroChip icon="shield-check-outline" text="Private" />
                <HeroChip icon="flash-outline" text="Fast" />
                <HeroChip icon="cloud-off-outline" text="Offline" />
              </View>
            </View>

            <View style={styles.downloadCard}>
              <View style={styles.downloadIcon}><AppIcon name="download-circle-outline" size={24} color="#4F46E5" /></View>
              <View style={styles.downloadCopy}>
                <Text style={styles.downloadTitle}>Downloads</Text>
                <Text style={styles.downloadSub}>{prefs.directoryUri ? 'Custom folder selected' : 'Default: Downloads/PDF Pro'}</Text>
              </View>
              <Pressable style={styles.changeButton} onPress={chooseDefaultFolder}><Text style={styles.changeText}>Change</Text></Pressable>
              <View style={styles.autoRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.autoTitle}>Auto-download results</Text>
                  <Text style={styles.autoSub}>Save immediately after processing</Text>
                </View>
                <Switch value={prefs.autoSave} onValueChange={toggleAutoSave} trackColor={{ false: '#D0D5DD', true: '#A5B4FC' }} thumbColor={prefs.autoSave ? '#4F46E5' : '#FFFFFF'} />
              </View>
            </View>

            {CATEGORIES.map(category => (
              <View key={category.id} style={styles.section}>
                <View style={styles.sectionHead}><View style={styles.sectionIcon}><AppIcon name={category.icon} size={17} color="#475467" /></View><Text style={styles.sectionTitle}>{category.title}</Text></View>
                <View style={styles.grid}>
                  {TOOLS.filter(item => item.category === category.id).map(item => <ToolCard key={item.id} item={item} onPress={() => reset(item.id)} />)}
                </View>
              </View>
            ))}
          </>
        ) : (
          <View style={styles.workspace}>
            <View style={styles.workspaceHead}>
              <View style={[styles.workspaceIcon, { backgroundColor: iconTone(selectedTool?.tone || 'indigo').bg }]}><AppIcon name={selectedTool?.icon || 'file-outline'} size={26} color={iconTone(selectedTool?.tone || 'indigo').fg} /></View>
              <View style={{ flex: 1 }}><Text style={styles.workspaceTitle}>{selectedTool?.title}</Text><Text style={styles.workspaceSub}>{selectedTool?.subtitle}</Text></View>
              {selectedTool?.native ? <View style={styles.nativeTag}><Text style={styles.nativeText}>NATIVE</Text></View> : null}
            </View>

            {tool === 'images' ? <SelectButton icon="image-plus" text={images.length ? `${images.length} images selected` : 'Choose images'} onPress={pickImages} /> : null}
            {tool === 'camera' ? <SelectButton icon="camera-plus-outline" text={images.length ? `Capture another page • ${images.length} ready` : 'Capture first page'} onPress={capturePage} /> : null}
            {tool !== 'images' && tool !== 'camera' ? <SelectButton icon="file-plus-outline" text={tool === 'merge' ? 'Choose PDF files' : 'Choose PDF'} onPress={() => pickPdf(tool === 'merge')} /> : null}

            {tool === 'camera' && images.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                {images.slice(0, 8).map((item, index) => <Image key={`${item.uri}-${index}`} source={{ uri: item.uri }} style={styles.thumb} />)}
                <Pressable style={styles.removeLast} onPress={() => setImages(current => current.slice(0, -1))}><AppIcon name="undo" size={20} color="#B42318" /><Text style={styles.removeText}>Undo</Text></Pressable>
              </ScrollView>
            ) : null}

            {pdfs.map((pdf, index) => (
              <View key={`${pdf.uri}-${index}`} style={styles.fileRow}>
                <View style={styles.pdfIcon}><AppIcon name="file-pdf-box" size={25} color="#D92D20" /></View>
                <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.fileName} numberOfLines={1}>{pdf.name}</Text><Text style={styles.fileMeta}>{[fmt(pdf.size), pdf.pages ? `${pdf.pages} pages` : ''].filter(Boolean).join(' • ') || 'PDF file'}</Text></View>
                {tool === 'merge' ? <View style={styles.mergeButtons}><Mini icon="arrow-up" onPress={() => movePdf(index, -1)} disabled={index === 0} /><Mini icon="arrow-down" onPress={() => movePdf(index, 1)} disabled={index === pdfs.length - 1} /><Mini icon="close" danger onPress={() => setPdfs(current => current.filter((_, i) => i !== index))} /></View> : null}
              </View>
            ))}

            {tool === 'compress' ? <Segment title="Compression" values={['balanced', 'strong', 'extreme']} value={compression} onChange={value => setCompression(value as typeof compression)} /> : null}
            {needsPages ? <Field label={tool === 'reorder' ? 'New page order' : tool === 'delete' ? 'Pages to delete' : 'Pages'} value={pages} onChange={setPages} placeholder={tool === 'rotate' ? 'Empty = all, or 1-3,5' : tool === 'reorder' ? '3,1,2,4-8' : '1-3,5,8'} /> : null}
            {tool === 'rotate' ? <Segment title="Rotation" values={['90', '180', '270']} value={String(rotation)} onChange={value => setRotation(Number(value) as 90 | 180 | 270)} /> : null}
            {tool === 'protect' || tool === 'unlock' ? <View style={styles.option}><Label icon="key-outline" text={tool === 'protect' ? 'Password' : 'Current password'} /><TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#98A2B3" />{tool === 'protect' ? <TextInput style={[styles.input, { marginTop: 8 }]} secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Repeat password" placeholderTextColor="#98A2B3" /> : null}</View> : null}
            {tool === 'watermark' ? <Field label="Watermark text" value={watermark} onChange={setWatermark} placeholder="CONFIDENTIAL" /> : null}
            {tool === 'numbers' ? <Field label="Start numbering at" value={startAt} onChange={setStartAt} placeholder="1" numeric /> : null}
            {tool === 'sign' ? <View style={styles.option}><Field label="Signature page" value={signaturePage} onChange={setSignaturePage} placeholder="1" numeric /><Text style={styles.tip}>Draw below. The signature is embedded as a clean vector mark.</Text><View style={{ marginTop: 12 }}><SignaturePad onChange={onSignature} /></View></View> : null}

            {tool === 'preview' && selectedPdf ? (
              <View style={styles.previewBox}>
                <View style={styles.previewNav}><Mini icon="chevron-left" onPress={() => { setPreviewPage(value => Math.max(1, value - 1)); setPreviewUri(null); }} disabled={previewPage <= 1} /><Text style={styles.pageCount}>Page {previewPage}{selectedPdf.pages ? ` / ${selectedPdf.pages}` : ''}</Text><Mini icon="chevron-right" onPress={() => { setPreviewPage(value => selectedPdf.pages ? Math.min(selectedPdf.pages, value + 1) : value + 1); setPreviewUri(null); }} disabled={Boolean(selectedPdf.pages && previewPage >= selectedPdf.pages)} /></View>
                {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" /> : <View style={styles.previewEmpty}><AppIcon name="file-eye-outline" size={36} color="#98A2B3" /><Text style={styles.previewEmptyText}>Tap Render page to view it here</Text></View>}
              </View>
            ) : null}

            {tool === 'compress' ? <Tip text="Compression is optimized for scanned/image-heavy PDFs and flattens pages. Selectable text and form fields are not preserved in the compressed copy." /> : null}

            <Pressable style={[styles.processButton, (!canRun || busy) && styles.disabled]} disabled={!canRun || busy} onPress={runTool}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <><AppIcon name="auto-fix" size={20} color="#FFFFFF" /><Text style={styles.processText}>{tool === 'preview' ? 'Render page' : 'Process PDF'}</Text></>}
            </Pressable>

            {compressionResult ? <View style={styles.compressCard}><AppIcon name="chart-line" size={22} color="#1570EF" /><View style={{ marginLeft: 10 }}><Text style={styles.compressTitle}>Compression result</Text><Text style={styles.compressValue}>{fmt(compressionResult.originalBytes)} → {fmt(compressionResult.bytes)}</Text></View></View> : null}

            {rendered.length ? (
              <View style={styles.resultCard}>
                <SuccessHeader title={`${rendered.length} JPG pages ready`} subtitle="Rendered locally on your phone" />
                <View style={styles.imageStrip}>{rendered.slice(0, 3).map(item => <Image key={item.page} source={{ uri: item.uri }} style={styles.resultThumb} />)}{rendered.length > 3 ? <View style={styles.moreThumb}><Text style={styles.moreText}>+{rendered.length - 3}</Text></View> : null}</View>
                {saveNotice ? <Notice text={saveNotice} /> : null}
                <Pressable style={styles.downloadPrimary} onPress={() => downloadImages(false)} disabled={saving}><AppIcon name="download" size={21} color="#FFFFFF" /><Text style={styles.downloadPrimaryText}>Download all</Text></Pressable>
                <Pressable style={styles.saveAsButton} onPress={() => downloadImages(true)} disabled={saving}><AppIcon name="folder-edit-outline" size={19} color="#344054" /><Text style={styles.saveAsText}>Save As…</Text></Pressable>
              </View>
            ) : null}

            {result ? (
              <View style={styles.resultCard}>
                <SuccessHeader title="PDF ready" subtitle="Processed locally and ready to use" />
                <View style={styles.resultFile}><View style={styles.pdfIcon}><AppIcon name="file-pdf-box" size={27} color="#D92D20" /></View><View style={{ flex: 1 }}><Text style={styles.resultName} numberOfLines={1}>{result.fileName}</Text><Text style={styles.fileMeta}>{result.pageCount} page(s) • {fmt(result.bytes)}</Text></View></View>
                {saveNotice ? <Notice text={saveNotice} /> : null}
                <Pressable style={styles.downloadPrimary} onPress={() => downloadResult(false)} disabled={saving}><AppIcon name="download" size={21} color="#FFFFFF" /><Text style={styles.downloadPrimaryText}>{prefs.directoryUri ? 'Download' : 'Download to Downloads'}</Text></Pressable>
                <View style={styles.resultActions}>
                  {canViewResult ? <SmallAction icon="eye-outline" text="View" onPress={openViewer} /> : null}
                  <SmallAction icon="folder-edit-outline" text="Save As" onPress={() => downloadResult(true)} />
                  <SmallAction icon="share-variant-outline" text="Share" onPress={shareResult} />
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal visible={viewerOpen} animationType="slide" onRequestClose={() => setViewerOpen(false)}>
        <SafeAreaView style={styles.viewerSafe}>
          <StatusBar style="dark" />
          <View style={styles.viewerHeader}><Pressable style={styles.backButton} onPress={() => setViewerOpen(false)}><AppIcon name="arrow-left" size={21} color="#101828" /></Pressable><View style={{ flex: 1, marginLeft: 10 }}><Text style={styles.viewerTitle}>PDF Viewer</Text><Text style={styles.viewerSub}>Page {viewerPage}{result?.pageCount ? ` / ${result.pageCount}` : ''}</Text></View><Pressable style={styles.viewerDownload} onPress={() => downloadResult(false)}><AppIcon name="download" size={19} color="#4F46E5" /></Pressable></View>
          <View style={styles.viewerCanvas}>{viewerBusy || !viewerUri ? <ActivityIndicator size="large" color="#4F46E5" /> : <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />}</View>
          <View style={styles.viewerFooter}><Pressable style={[styles.viewerNav, viewerPage <= 1 && styles.disabled]} disabled={viewerPage <= 1 || viewerBusy} onPress={() => renderViewerPage(viewerPage - 1)}><AppIcon name="chevron-left" size={20} color="#344054" /><Text style={styles.viewerNavText}>Previous</Text></Pressable><Pressable style={[styles.viewerNav, Boolean(result?.pageCount && viewerPage >= result.pageCount) && styles.disabled]} disabled={Boolean(result?.pageCount && viewerPage >= result.pageCount) || viewerBusy} onPress={() => renderViewerPage(viewerPage + 1)}><Text style={styles.viewerNavText}>Next</Text><AppIcon name="chevron-right" size={20} color="#344054" /></Pressable></View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function TopBar({ tool, onBack }: { tool: Tool | null; onBack: () => void }) {
  return <View style={styles.topBar}>{tool ? <Pressable style={styles.backButton} onPress={onBack}><AppIcon name="arrow-left" size={21} color="#101828" /></Pressable> : <View style={styles.brandIcon}><AppIcon name="file-document-edit-outline" size={25} color="#FFFFFF" /></View>}<View style={styles.brandCopy}><View style={styles.brandLine}><Text style={styles.brand}>{tool ? tool.title : 'PDF Pro'}</Text>{!tool ? <View style={styles.proBadge}><Text style={styles.proBadgeText}>PRO</Text></View> : null}</View><Text style={styles.brandSub}>{tool ? 'Professional PDF workspace' : 'Private PDF tools on your phone'}</Text></View><View style={styles.localBadge}><AppIcon name="shield-check-outline" size={13} color="#079455" /><Text style={styles.localText}>LOCAL</Text></View></View>;
}

function HeroChip({ icon, text }: { icon: string; text: string }) {
  return <View style={styles.heroChip}><AppIcon name={icon} size={14} color="#E0E7FF" /><Text style={styles.heroChipText}>{text}</Text></View>;
}

function ToolCard({ item, onPress }: { item: Tool; onPress: () => void }) {
  const tone = iconTone(item.tone);
  return <Pressable style={({ pressed }) => [styles.toolCard, pressed && styles.pressed]} onPress={onPress}><View style={styles.toolTop}><View style={[styles.toolIcon, { backgroundColor: tone.bg }]}><AppIcon name={item.icon} size={22} color={tone.fg} /></View>{item.native ? <View style={styles.tinyNative}><Text style={styles.tinyNativeText}>N</Text></View> : <AppIcon name="chevron-right" size={17} color="#D0D5DD" />}</View><Text style={styles.toolTitle}>{item.title}</Text><Text style={styles.toolSub}>{item.subtitle}</Text></Pressable>;
}

function SelectButton({ icon, text, onPress }: { icon: string; text: string; onPress: () => void }) {
  return <Pressable style={({ pressed }) => [styles.selectButton, pressed && styles.pressed]} onPress={onPress}><View style={styles.selectCircle}><AppIcon name={icon} size={22} color="#4F46E5" /></View><Text style={styles.selectText}>{text}</Text><AppIcon name="chevron-right" size={20} color="#818CF8" /></Pressable>;
}

function Mini({ icon, onPress, disabled, danger }: { icon: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return <Pressable style={[styles.mini, danger && styles.miniDanger, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><AppIcon name={icon} size={17} color={danger ? '#B42318' : '#475467'} /></Pressable>;
}

function Label({ icon, text }: { icon: string; text: string }) {
  return <View style={styles.labelRow}><AppIcon name={icon} size={15} color="#667085" /><Text style={styles.label}>{text}</Text></View>;
}

function Field({ label, value, onChange, placeholder, numeric }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; numeric?: boolean }) {
  return <View style={styles.option}><Label icon="form-textbox" text={label} /><TextInput style={styles.input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#98A2B3" keyboardType={numeric ? 'number-pad' : 'default'} autoCapitalize="none" /></View>;
}

function Segment({ title, values, value, onChange }: { title: string; values: string[]; value: string; onChange: (value: string) => void }) {
  return <View style={styles.option}><Label icon="tune-variant" text={title} /><View style={styles.segments}>{values.map(item => <Pressable key={item} style={[styles.segment, value === item && styles.segmentActive]} onPress={() => onChange(item)}><Text style={[styles.segmentText, value === item && styles.segmentTextActive]}>{item[0].toUpperCase() + item.slice(1)}</Text></Pressable>)}</View></View>;
}

function Tip({ text }: { text: string }) {
  return <View style={styles.tipBox}><AppIcon name="information-outline" size={16} color="#475467" /><Text style={styles.tipText}>{text}</Text></View>;
}

function SuccessHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <View style={styles.successHead}><View style={styles.successIcon}><AppIcon name="check" size={15} color="#FFFFFF" /></View><View style={{ flex: 1 }}><Text style={styles.successTitle}>{title}</Text><Text style={styles.successSub}>{subtitle}</Text></View></View>;
}

function Notice({ text }: { text: string }) {
  return <View style={styles.notice}><AppIcon name="check-circle-outline" size={16} color="#079455" /><Text style={styles.noticeText}>{text}</Text></View>;
}

function SmallAction({ icon, text, onPress }: { icon: string; text: string; onPress: () => void }) {
  return <Pressable style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]} onPress={onPress}><AppIcon name={icon} size={19} color="#344054" /><Text style={styles.smallActionText}>{text}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  page: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 54 },
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginBottom: 14 },
  brandIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' },
  backButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, alignItems: 'center', justifyContent: 'center' },
  brandCopy: { flex: 1, marginLeft: 10 },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brand: { color: COLORS.ink, fontSize: 19, fontWeight: '900', letterSpacing: -0.35 },
  brandSub: { color: COLORS.muted, fontSize: 10.5, marginTop: 2, fontWeight: '600' },
  proBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: '#EEF2FF' },
  proBadgeText: { color: '#4F46E5', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  localBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 999, backgroundColor: '#ECFDF3', borderWidth: 1, borderColor: '#ABEFC6' },
  localText: { color: '#079455', fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  hero: { backgroundColor: '#111827', borderRadius: 24, padding: 20, marginBottom: 13, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  proPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(99,102,241,0.18)' },
  proText: { color: '#C7D2FE', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  offlinePill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#32D583' },
  offlineText: { color: '#98A2B3', fontSize: 8.5, fontWeight: '900', letterSpacing: 0.6 },
  heroTitle: { color: '#FFFFFF', fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -0.8 },
  heroBody: { color: '#C7CDD8', fontSize: 12.5, lineHeight: 18.5, marginTop: 9, maxWidth: 330 },
  heroStrip: { flexDirection: 'row', gap: 7, marginTop: 17 },
  heroChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.07)' },
  heroChipText: { color: '#E5E7EB', fontSize: 9.5, fontWeight: '800' },
  downloadCard: { backgroundColor: COLORS.surface, borderRadius: 18, borderWidth: 1, borderColor: COLORS.line, padding: 13, marginBottom: 22, shadowColor: '#101828', shadowOpacity: 0.04, shadowRadius: 10, elevation: 1 },
  downloadIcon: { position: 'absolute', left: 13, top: 13, width: 40, height: 40, borderRadius: 12, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  downloadCopy: { marginLeft: 50, minHeight: 40, justifyContent: 'center', paddingRight: 66 },
  downloadTitle: { color: COLORS.ink, fontSize: 13.5, fontWeight: '900' },
  downloadSub: { color: COLORS.muted, fontSize: 9.5, marginTop: 3 },
  changeButton: { position: 'absolute', right: 13, top: 18, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F2F4F7' },
  changeText: { color: '#344054', fontSize: 9.5, fontWeight: '900' },
  autoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 11, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#F0F1F4' },
  autoTitle: { color: '#344054', fontSize: 11, fontWeight: '800' },
  autoSub: { color: COLORS.faint, fontSize: 9, marginTop: 2 },
  section: { marginBottom: 21 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 },
  sectionIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#EAECF0', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  toolCard: { flexGrow: 1, flexBasis: '47%', minWidth: 145, minHeight: 116, padding: 12, borderRadius: 16, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, shadowColor: '#101828', shadowOpacity: 0.025, shadowRadius: 7, elevation: 1 },
  toolTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  toolIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tinyNative: { width: 20, height: 20, borderRadius: 7, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  tinyNativeText: { color: '#667085', fontSize: 8, fontWeight: '900' },
  toolTitle: { color: COLORS.ink, fontSize: 13.2, fontWeight: '900' },
  toolSub: { color: COLORS.muted, fontSize: 9.8, marginTop: 3 },
  workspace: { backgroundColor: COLORS.surface, borderRadius: 22, borderWidth: 1, borderColor: COLORS.line, padding: 15, shadowColor: '#101828', shadowOpacity: 0.04, shadowRadius: 12, elevation: 1 },
  workspaceHead: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 16 },
  workspaceIcon: { width: 50, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  workspaceTitle: { color: COLORS.ink, fontSize: 20, fontWeight: '900', letterSpacing: -0.35 },
  workspaceSub: { color: COLORS.muted, fontSize: 10.5, marginTop: 3 },
  nativeTag: { paddingHorizontal: 7, paddingVertical: 5, backgroundColor: '#F2F4F7', borderRadius: 7 },
  nativeText: { color: '#667085', fontSize: 7.8, fontWeight: '900' },
  selectButton: { minHeight: 58, borderRadius: 15, backgroundColor: '#F5F7FF', borderWidth: 1, borderColor: '#C7D2FE', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 9 },
  selectCircle: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  selectText: { flex: 1, color: '#3730A3', fontSize: 12, fontWeight: '900' },
  fileRow: { flexDirection: 'row', alignItems: 'center', padding: 10, marginTop: 9, borderRadius: 13, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#EAECF0' },
  pdfIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  fileName: { color: COLORS.ink, fontSize: 11.5, fontWeight: '800' },
  fileMeta: { color: COLORS.faint, fontSize: 9.2, marginTop: 3 },
  mergeButtons: { flexDirection: 'row', gap: 4, marginLeft: 5 },
  mini: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#EAECF0', alignItems: 'center', justifyContent: 'center' },
  miniDanger: { backgroundColor: '#FEE4E2' },
  thumb: { width: 68, height: 88, borderRadius: 10, backgroundColor: '#EAECF0', marginRight: 7 },
  removeLast: { width: 68, height: 88, borderRadius: 10, backgroundColor: '#FEF3F2', alignItems: 'center', justifyContent: 'center', gap: 5 },
  removeText: { color: '#B42318', fontSize: 9, fontWeight: '800' },
  option: { marginTop: 15 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  label: { color: '#344054', fontSize: 10.5, fontWeight: '900' },
  input: { minHeight: 47, borderRadius: 12, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 12, color: COLORS.ink, fontSize: 12.5 },
  segments: { flexDirection: 'row', gap: 6 },
  segment: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: COLORS.line, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  segmentText: { color: '#475467', fontSize: 9.8, fontWeight: '900' },
  segmentTextActive: { color: '#FFFFFF' },
  tip: { color: COLORS.muted, fontSize: 9.5, lineHeight: 14, marginTop: 8 },
  tipBox: { flexDirection: 'row', gap: 6, padding: 10, borderRadius: 11, backgroundColor: '#F2F4F7', marginTop: 12 },
  tipText: { flex: 1, color: COLORS.muted, fontSize: 9.4, lineHeight: 14 },
  previewBox: { marginTop: 15 },
  previewNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  pageCount: { color: '#344054', fontSize: 10.5, fontWeight: '900' },
  previewImage: { width: '100%', height: 390, borderRadius: 13, backgroundColor: '#EAECF0' },
  previewEmpty: { height: 230, borderRadius: 13, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center', gap: 7 },
  previewEmptyText: { color: COLORS.muted, fontSize: 10 },
  processButton: { minHeight: 54, borderRadius: 14, backgroundColor: COLORS.navy, marginTop: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, shadowColor: '#111827', shadowOpacity: 0.14, shadowRadius: 9, elevation: 3 },
  processText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  compressCard: { flexDirection: 'row', alignItems: 'center', marginTop: 13, padding: 12, borderRadius: 13, backgroundColor: '#EFF8FF', borderWidth: 1, borderColor: '#B2DDFF' },
  compressTitle: { color: '#175CD3', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  compressValue: { color: '#1849A9', fontSize: 15, fontWeight: '900', marginTop: 2 },
  resultCard: { marginTop: 14, borderRadius: 17, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: '#FFFFFF', padding: 14 },
  successHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  successIcon: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  successTitle: { color: '#05603A', fontSize: 13, fontWeight: '900' },
  successSub: { color: '#079455', fontSize: 9.3, marginTop: 2 },
  resultFile: { flexDirection: 'row', alignItems: 'center', marginTop: 11, padding: 9, borderRadius: 12, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#EAECF0' },
  resultName: { color: COLORS.ink, fontSize: 11.5, fontWeight: '800' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 8, borderRadius: 9, backgroundColor: '#ECFDF3', marginTop: 9 },
  noticeText: { flex: 1, color: '#067647', fontSize: 9.2, fontWeight: '800' },
  downloadPrimary: { minHeight: 49, marginTop: 11, borderRadius: 12, backgroundColor: '#4F46E5', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  downloadPrimaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  saveAsButton: { minHeight: 44, marginTop: 7, borderRadius: 11, borderWidth: 1, borderColor: COLORS.line, backgroundColor: '#F9FAFB', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  saveAsText: { color: '#344054', fontSize: 10.5, fontWeight: '900' },
  resultActions: { flexDirection: 'row', gap: 7, marginTop: 7 },
  smallAction: { flex: 1, minHeight: 43, borderRadius: 11, borderWidth: 1, borderColor: COLORS.line, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 },
  smallActionText: { color: '#344054', fontSize: 9.7, fontWeight: '900' },
  imageStrip: { flexDirection: 'row', gap: 7, marginTop: 11 },
  resultThumb: { width: 56, height: 74, borderRadius: 8, backgroundColor: '#EAECF0' },
  moreThumb: { width: 56, height: 74, borderRadius: 8, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  moreText: { color: COLORS.muted, fontSize: 11, fontWeight: '900' },
  viewerSafe: { flex: 1, backgroundColor: '#F5F7FB' },
  viewerHeader: { minHeight: 62, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.line, backgroundColor: '#FFFFFF' },
  viewerTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '900' },
  viewerSub: { color: COLORS.muted, fontSize: 9.5, marginTop: 2 },
  viewerDownload: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  viewerCanvas: { flex: 1, margin: 12, borderRadius: 15, backgroundColor: '#EAECF0', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerFooter: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  viewerNav: { flex: 1, minHeight: 46, borderRadius: 11, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: COLORS.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  viewerNavText: { color: '#344054', fontSize: 10.5, fontWeight: '900' },
});
