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
  | 'preview'
  | 'sign'
  | 'extract'
  | 'delete'
  | 'reorder'
  | 'rotate'
  | 'images'
  | 'camera'
  | 'pdfImages'
  | 'protect'
  | 'unlock'
  | 'watermark'
  | 'numbers';

type TabId = 'Popular' | 'Convert' | 'Organize' | 'Secure' | 'Edit';
type ScreenId = 'home' | 'files' | 'tools' | 'settings';
type Tone = 'red' | 'blue' | 'green' | 'orange' | 'violet' | 'teal' | 'pink';
type SelectedPdf = { uri: string; name: string; size?: number; pages?: number };
type RenderedImage = { uri: string; page: number; bytes: number };
type CompressionResult = PdfOutput & { originalBytes: number; flattened: boolean };
type Tool = {
  id: ToolId;
  title: string;
  subtitle: string;
  icon: string;
  tone: Tone;
  tabs: TabId[];
  native?: boolean;
};
type HistoryEntry = {
  id: string;
  tool: ToolId;
  title: string;
  output: PdfOutput;
  createdAt: number;
  previewable: boolean;
};

const BRAND = '#F04452';
const INK = '#111827';
const MUTED = '#667085';
const LINE = '#E7EAF0';
const BG = '#F7F8FC';
const SURFACE = '#FFFFFF';
const DEFAULT_PREFS: SavePreferences = { directoryUri: null, autoSave: false };

const TOOLS: Tool[] = [
  { id: 'compress', title: 'Compress', subtitle: 'Reduce PDF size', icon: 'file-percent-outline', tone: 'pink', tabs: ['Popular'], native: true },
  { id: 'merge', title: 'Merge', subtitle: 'Combine PDFs', icon: 'file-document-multiple-outline', tone: 'orange', tabs: ['Popular', 'Organize'] },
  { id: 'preview', title: 'Viewer', subtitle: 'Read PDF pages', icon: 'file-eye-outline', tone: 'blue', tabs: ['Popular'], native: true },
  { id: 'sign', title: 'Sign', subtitle: 'Add signature', icon: 'draw-pen', tone: 'violet', tabs: ['Popular', 'Edit'] },
  { id: 'images', title: 'Images to PDF', subtitle: 'Photos to PDF', icon: 'image-multiple-outline', tone: 'blue', tabs: ['Popular', 'Convert'] },
  { id: 'camera', title: 'Scan to PDF', subtitle: 'Camera pages', icon: 'scanner', tone: 'teal', tabs: ['Popular', 'Convert'] },
  { id: 'extract', title: 'Split', subtitle: 'Extract pages', icon: 'content-cut', tone: 'green', tabs: ['Organize'] },
  { id: 'delete', title: 'Delete pages', subtitle: 'Remove pages', icon: 'file-remove-outline', tone: 'red', tabs: ['Organize'] },
  { id: 'reorder', title: 'Reorder', subtitle: 'Change page order', icon: 'sort-variant', tone: 'blue', tabs: ['Organize'] },
  { id: 'rotate', title: 'Rotate', subtitle: 'Rotate pages', icon: 'file-rotate-right-outline', tone: 'green', tabs: ['Organize'] },
  { id: 'pdfImages', title: 'PDF to JPG', subtitle: 'Pages as images', icon: 'file-image-outline', tone: 'orange', tabs: ['Convert'], native: true },
  { id: 'protect', title: 'Protect', subtitle: 'Add password', icon: 'lock-outline', tone: 'orange', tabs: ['Secure'], native: true },
  { id: 'unlock', title: 'Unlock', subtitle: 'Remove password', icon: 'lock-open-variant-outline', tone: 'blue', tabs: ['Secure'], native: true },
  { id: 'watermark', title: 'Watermark', subtitle: 'Stamp every page', icon: 'watermark', tone: 'violet', tabs: ['Edit'] },
  { id: 'numbers', title: 'Page numbers', subtitle: 'Number pages', icon: 'format-list-numbered', tone: 'orange', tabs: ['Edit'] },
];

const TABS: { id: TabId; icon: string; color: string }[] = [
  { id: 'Popular', icon: 'fire', color: BRAND },
  { id: 'Convert', icon: 'swap-horizontal', color: '#2563EB' },
  { id: 'Organize', icon: 'view-grid-outline', color: '#16A34A' },
  { id: 'Secure', icon: 'shield-check-outline', color: '#7C3AED' },
  { id: 'Edit', icon: 'pencil-outline', color: '#F97316' },
];

function tone(t: Tone) {
  const map = {
    red: { bg: '#FFF0F1', fg: '#E11D48' },
    blue: { bg: '#EEF6FF', fg: '#2563EB' },
    green: { bg: '#ECFDF3', fg: '#16A34A' },
    orange: { bg: '#FFF5E8', fg: '#F97316' },
    violet: { bg: '#F3EEFF', fg: '#7C3AED' },
    teal: { bg: '#EAFBFA', fg: '#0F9F9A' },
    pink: { bg: '#FFF0F6', fg: '#EC4899' },
  };
  return map[t];
}

function fmt(bytes?: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorText(error: unknown) {
  const text = error instanceof Error ? error.message : String(error || '');
  if (/password|decrypt|encrypted|security handler/i.test(text)) return 'The PDF is protected or the password is incorrect.';
  return text || 'The operation could not be completed.';
}

function Icon({ name, size = 21, color = MUTED }: { name: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
}

export default function DashboardApp() {
  const [screen, setScreen] = useState<ScreenId>('home');
  const [activeTab, setActiveTab] = useState<TabId>('Popular');
  const [search, setSearch] = useState('');
  const [tool, setTool] = useState<ToolId | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
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
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSource, setViewerSource] = useState<PdfOutput | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerBusy, setViewerBusy] = useState(false);
  const lastBack = useRef(0);

  const selectedTool = useMemo(() => TOOLS.find(item => item.id === tool) ?? null, [tool]);
  const selectedPdf = pdfs[0];
  const needsPages = tool === 'extract' || tool === 'delete' || tool === 'reorder' || tool === 'rotate';
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return TOOLS.filter(item => `${item.title} ${item.subtitle}`.toLowerCase().includes(query));
  }, [search]);
  const categoryTools = useMemo(() => TOOLS.filter(item => item.tabs.includes(activeTab)), [activeTab]);

  useEffect(() => {
    getSavePreferences().then(setPrefs).catch(() => undefined);
  }, []);

  const resetWorkspace = useCallback((nextTool: ToolId | null = null) => {
    setTool(nextTool);
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
  }, []);

  const openTool = useCallback((id: ToolId) => {
    setQuickOpen(false);
    resetWorkspace(id);
  }, [resetWorkspace]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewerOpen) {
        setViewerOpen(false);
        return true;
      }
      if (quickOpen) {
        setQuickOpen(false);
        return true;
      }
      if (tool) {
        resetWorkspace(null);
        return true;
      }
      if (screen !== 'home') {
        setScreen('home');
        return true;
      }
      const now = Date.now();
      if (now - lastBack.current < 1700) return false;
      lastBack.current = now;
      ToastAndroid.show('Press back again to exit PDF Pro', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, [quickOpen, resetWorkspace, screen, tool, viewerOpen]);

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
      const uri = await chooseSaveFolder(prefs.directoryUri);
      await persistPrefs({ ...prefs, directoryUri: uri });
      Alert.alert('Folder selected', 'Save and auto-download will use this folder.');
    } catch (error) {
      if (!/cancel/i.test(errorText(error))) Alert.alert('Folder not changed', errorText(error));
    }
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
      setResult(null);
      setRendered([]);
      setPreviewPage(1);
      setPreviewUri(null);
      setSaveNotice(null);
    } catch (error) {
      Alert.alert('Cannot open PDF', errorText(error));
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
      Alert.alert('Could not select images', errorText(error));
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
      Alert.alert('Camera failed', errorText(error));
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

  function rememberOutput(output: PdfOutput, sourceTool: ToolId) {
    const item = TOOLS.find(entry => entry.id === sourceTool);
    setHistory(current => [
      {
        id: `${Date.now()}-${Math.random()}`,
        tool: sourceTool,
        title: item?.title || 'PDF',
        output,
        createdAt: Date.now(),
        previewable: sourceTool !== 'protect',
      },
      ...current,
    ].slice(0, 12));
  }

  async function autoDownloadPdf(output: PdfOutput) {
    if (!prefs.autoSave) return;
    try {
      const saved = await savePdfToPreferredFolder(output.uri, output.fileName, prefs.directoryUri);
      if (saved.directoryUri && saved.directoryUri !== prefs.directoryUri) await persistPrefs({ ...prefs, directoryUri: saved.directoryUri });
      setSaveNotice(saved.directoryUri ? 'Downloaded automatically' : 'Downloaded to Downloads/PDF Pro');
    } catch (error) {
      setSaveNotice('PDF ready — automatic download failed');
      Alert.alert('PDF ready', errorText(error));
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
      Alert.alert('Images ready', errorText(error));
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
          if (!watermark.trim()) throw new Error('Enter watermark text.');
          output = await watermarkPdf(selectedPdf.uri, watermark.trim());
          break;
        case 'numbers': {
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          const number = Number(startAt);
          if (!Number.isInteger(number) || number < 0) throw new Error('Start number must be 0 or greater.');
          output = await addPageNumbers(selectedPdf.uri, number);
          break;
        }
        case 'preview':
          if (!selectedPdf) throw new Error('Choose a PDF first.');
          setPreviewUri((await renderPreviewPage(selectedPdf.uri, previewPage - 1)).uri);
          break;
      }
      if (output) {
        setResult(output);
        rememberOutput(output, tool);
        await autoDownloadPdf(output);
      }
    } catch (error) {
      Alert.alert('Operation failed', errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function downloadOutput(output: PdfOutput, saveAs = false) {
    setSaving(true);
    try {
      const saved = saveAs
        ? await savePdfToChosenFolder(output.uri, output.fileName)
        : await savePdfToPreferredFolder(output.uri, output.fileName, prefs.directoryUri);
      if (saved.directoryUri && saved.directoryUri !== prefs.directoryUri) await persistPrefs({ ...prefs, directoryUri: saved.directoryUri });
      setSaveNotice(saved.directoryUri ? 'Saved to your selected folder' : 'Downloaded to Downloads/PDF Pro');
      if (Platform.OS === 'android') ToastAndroid.show(saved.directoryUri ? 'PDF saved' : 'Downloaded to Downloads/PDF Pro', ToastAndroid.SHORT);
    } catch (error) {
      if (!/cancel/i.test(errorText(error))) Alert.alert('Could not save PDF', errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function downloadRendered(saveAs = false) {
    setSaving(true);
    try {
      const saved = saveAs ? await saveImagesToChosenFolder(rendered) : await saveImagesToPreferredFolder(rendered, prefs.directoryUri);
      if (saved.directoryUri && saved.directoryUri !== prefs.directoryUri) await persistPrefs({ ...prefs, directoryUri: saved.directoryUri });
      setSaveNotice(saved.directoryUri ? `${rendered.length} JPG pages saved` : `${rendered.length} JPG pages downloaded`);
    } catch (error) {
      if (!/cancel/i.test(errorText(error))) Alert.alert('Could not save images', errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function shareOutput(output: PdfOutput) {
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
      await Sharing.shareAsync(output.uri, { mimeType: 'application/pdf', dialogTitle: 'Share PDF', UTI: 'com.adobe.pdf' });
    } catch (error) {
      Alert.alert('Could not share PDF', errorText(error));
    }
  }

  async function renderViewerPage(output: PdfOutput, page: number) {
    setViewerBusy(true);
    try {
      const safe = Math.max(1, Math.min(output.pageCount || 1, page));
      const renderedPage = await renderPreviewPage(output.uri, safe - 1);
      setViewerPage(safe);
      setViewerUri(renderedPage.uri);
    } catch (error) {
      Alert.alert('Preview unavailable', errorText(error));
      setViewerOpen(false);
    } finally {
      setViewerBusy(false);
    }
  }

  async function openViewer(output: PdfOutput) {
    setViewerSource(output);
    setViewerPage(1);
    setViewerUri(null);
    setViewerOpen(true);
    await renderViewerPage(output, 1);
  }

  const canRun = useMemo(() => {
    if (!tool) return false;
    if (tool === 'images' || tool === 'camera') return images.length > 0;
    if (tool === 'merge') return pdfs.length >= 2;
    return pdfs.length === 1;
  }, [images.length, pdfs.length, tool]);

  function actionLabel() {
    const map: Record<ToolId, string> = {
      compress: 'Compress PDF', merge: 'Merge PDFs', preview: 'Render page', sign: 'Apply signature', extract: 'Split PDF', delete: 'Delete pages',
      reorder: 'Apply order', rotate: 'Rotate pages', images: 'Create PDF', camera: 'Create scanned PDF', pdfImages: 'Convert to JPG', protect: 'Protect PDF',
      unlock: 'Unlock PDF', watermark: 'Add watermark', numbers: 'Add page numbers',
    };
    return tool ? map[tool] : 'Run';
  }

  if (tool && selectedTool) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <ToolHeader tool={selectedTool} onBack={() => resetWorkspace(null)} />
        <ScrollView contentContainerStyle={styles.workspacePage} keyboardShouldPersistTaps="handled">
          <View style={styles.workspaceIntro}>
            <View style={[styles.workspaceIcon, { backgroundColor: tone(selectedTool.tone).bg }]}>
              <Icon name={selectedTool.icon} size={28} color={tone(selectedTool.tone).fg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.workspaceTitle}>{selectedTool.title}</Text>
              <Text style={styles.workspaceSub}>{selectedTool.subtitle}</Text>
            </View>
            {selectedTool.native ? <View style={styles.localTag}><Text style={styles.localTagText}>LOCAL</Text></View> : null}
          </View>

          {tool === 'images' ? <SelectButton icon="image-plus" label={images.length ? `${images.length} images selected` : 'Choose images'} onPress={pickImages} /> : null}
          {tool === 'camera' ? <SelectButton icon="camera-plus-outline" label={images.length ? `Capture another page · ${images.length} ready` : 'Capture first page'} onPress={capturePage} /> : null}
          {tool !== 'images' && tool !== 'camera' ? <SelectButton icon="file-plus-outline" label={tool === 'merge' ? 'Choose PDF files' : 'Choose PDF'} onPress={() => pickPdf(tool === 'merge')} /> : null}

          {tool === 'camera' && images.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbScroll}>
              {images.slice(0, 8).map((item, index) => <Image key={`${item.uri}-${index}`} source={{ uri: item.uri }} style={styles.thumb} />)}
              <Pressable style={styles.undoCard} onPress={() => setImages(current => current.slice(0, -1))}><Icon name="undo" color="#B42318" /><Text style={styles.undoText}>Undo</Text></Pressable>
            </ScrollView>
          ) : null}

          {pdfs.map((pdf, index) => (
            <View key={`${pdf.uri}-${index}`} style={styles.fileRow}>
              <View style={styles.pdfBadge}><Icon name="file-pdf-box" size={27} color={BRAND} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.fileName} numberOfLines={1}>{pdf.name}</Text>
                <Text style={styles.fileMeta}>{[fmt(pdf.size), pdf.pages ? `${pdf.pages} pages` : ''].filter(Boolean).join(' · ') || 'PDF file'}</Text>
              </View>
              {tool === 'merge' ? (
                <View style={styles.rowActions}>
                  <Mini icon="arrow-up" onPress={() => movePdf(index, -1)} disabled={index === 0} />
                  <Mini icon="arrow-down" onPress={() => movePdf(index, 1)} disabled={index === pdfs.length - 1} />
                  <Mini icon="close" danger onPress={() => setPdfs(current => current.filter((_, i) => i !== index))} />
                </View>
              ) : null}
            </View>
          ))}

          {tool === 'compress' ? (
            <OptionCard title="Compression level" icon="tune-variant">
              <View style={styles.segments}>
                {(['balanced', 'strong', 'extreme'] as const).map(value => <Segment key={value} label={value} active={compression === value} onPress={() => setCompression(value)} />)}
              </View>
              <Hint text="Best for scanned or image-heavy PDFs. Compression creates a flattened visual copy." />
            </OptionCard>
          ) : null}

          {needsPages ? (
            <OptionCard title={tool === 'reorder' ? 'New page order' : tool === 'delete' ? 'Pages to delete' : 'Pages'} icon="format-list-numbered">
              <TextInput value={pages} onChangeText={setPages} style={styles.input} placeholder={tool === 'rotate' ? 'Empty = all, or 1-3,5' : tool === 'reorder' ? 'Example: 3,1,2,4-8' : 'Example: 1-3,5,8'} placeholderTextColor="#98A2B3" />
            </OptionCard>
          ) : null}

          {tool === 'rotate' ? <View style={styles.segments}>{([90, 180, 270] as const).map(value => <Segment key={value} label={`${value}°`} active={rotation === value} onPress={() => setRotation(value)} />)}</View> : null}

          {tool === 'protect' || tool === 'unlock' ? (
            <OptionCard title={tool === 'protect' ? 'Password' : 'Current password'} icon="key-outline">
              <TextInput value={password} onChangeText={setPassword} style={styles.input} placeholder="Password" placeholderTextColor="#98A2B3" secureTextEntry />
              {tool === 'protect' ? <TextInput value={confirmPassword} onChangeText={setConfirmPassword} style={[styles.input, { marginTop: 9 }]} placeholder="Repeat password" placeholderTextColor="#98A2B3" secureTextEntry /> : null}
            </OptionCard>
          ) : null}

          {tool === 'sign' ? (
            <OptionCard title="Signature" icon="draw-pen">
              <TextInput value={signaturePage} onChangeText={setSignaturePage} style={styles.input} placeholder="Page 1" placeholderTextColor="#98A2B3" keyboardType="number-pad" />
              <View style={{ marginTop: 12 }}><SignaturePad onChange={onSignature} /></View>
            </OptionCard>
          ) : null}

          {tool === 'watermark' ? <OptionCard title="Watermark text" icon="watermark"><TextInput value={watermark} onChangeText={setWatermark} style={styles.input} maxLength={80} /></OptionCard> : null}
          {tool === 'numbers' ? <OptionCard title="Start numbering at" icon="numeric"><TextInput value={startAt} onChangeText={setStartAt} style={styles.input} keyboardType="number-pad" /></OptionCard> : null}

          {tool === 'preview' && selectedPdf ? (
            <OptionCard title="PDF Viewer" icon="file-eye-outline">
              <View style={styles.pageNav}>
                <Mini icon="chevron-left" disabled={previewPage <= 1} onPress={() => { setPreviewPage(p => Math.max(1, p - 1)); setPreviewUri(null); }} />
                <Text style={styles.pageNavText}>Page {previewPage}{selectedPdf.pages ? ` / ${selectedPdf.pages}` : ''}</Text>
                <Mini icon="chevron-right" disabled={Boolean(selectedPdf.pages && previewPage >= selectedPdf.pages)} onPress={() => { setPreviewPage(p => selectedPdf.pages ? Math.min(selectedPdf.pages, p + 1) : p + 1); setPreviewUri(null); }} />
              </View>
              {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" /> : <View style={styles.previewEmpty}><Icon name="file-eye-outline" size={38} color="#98A2B3" /><Text style={styles.previewEmptyText}>Tap Render page to preview it here.</Text></View>}
            </OptionCard>
          ) : null}

          <Pressable style={[styles.runButton, (!canRun || busy) && styles.disabled]} disabled={!canRun || busy} onPress={runTool}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <><Icon name="flash" color="#FFFFFF" size={20} /><Text style={styles.runText}>{actionLabel()}</Text></>}
          </Pressable>

          {compressionResult ? (
            <View style={styles.compressionCard}>
              <Icon name="chart-box-outline" color="#2563EB" size={25} />
              <View style={{ flex: 1, marginLeft: 10 }}><Text style={styles.compressionTitle}>Compression result</Text><Text style={styles.compressionNumbers}>{fmt(compressionResult.originalBytes)} → {fmt(compressionResult.bytes)}</Text><Text style={styles.compressionMeta}>{compressionResult.originalBytes ? `${Math.max(0, Math.round((1 - compressionResult.bytes / compressionResult.originalBytes) * 100))}% smaller` : 'Compressed copy created'}</Text></View>
            </View>
          ) : null}

          {rendered.length ? (
            <View style={styles.resultCard}>
              <ResultHeader title={`${rendered.length} JPG page(s) ready`} subtitle="Rendered locally on your device" />
              <View style={styles.imageStrip}>{rendered.slice(0, 4).map(item => <Image key={item.page} source={{ uri: item.uri }} style={styles.resultThumb} />)}</View>
              {saveNotice ? <Notice text={saveNotice} /> : null}
              <View style={styles.resultActions}>
                <Action icon="download" label="Download all" primary onPress={() => downloadRendered(false)} disabled={saving} />
                <Action icon="folder-edit-outline" label="Save As" onPress={() => downloadRendered(true)} disabled={saving} />
              </View>
            </View>
          ) : null}

          {result ? (
            <View style={styles.resultCard}>
              <ResultHeader title="PDF ready" subtitle="Processed locally and ready to use" />
              <View style={styles.resultFile}>
                <View style={styles.resultPdfIcon}><Icon name="file-pdf-box" size={30} color="#DC2626" /></View>
                <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.resultName} numberOfLines={1}>{result.fileName}</Text><Text style={styles.resultMeta}>{result.pageCount} page(s) · {fmt(result.bytes)}</Text></View>
              </View>
              {saveNotice ? <Notice text={saveNotice} /> : null}
              {tool === 'protect' ? <Hint text="Protected PDFs are saved directly. Reopen them with the password before previewing." /> : null}
              <Pressable style={styles.downloadMain} onPress={() => downloadOutput(result, false)} disabled={saving}>
                <Icon name="download" color="#FFFFFF" /><Text style={styles.downloadMainText}>Download</Text>
              </Pressable>
              <View style={styles.resultActions}>
                {tool !== 'protect' ? <Action icon="eye-outline" label="View" onPress={() => openViewer(result)} /> : null}
                <Action icon="folder-edit-outline" label="Save As" onPress={() => downloadOutput(result, true)} disabled={saving} />
                <Action icon="share-variant-outline" label="Share" onPress={() => shareOutput(result)} />
              </View>
            </View>
          ) : null}
        </ScrollView>
        <ViewerModal open={viewerOpen} output={viewerSource} page={viewerPage} uri={viewerUri} busy={viewerBusy} onClose={() => setViewerOpen(false)} onPage={p => viewerSource && renderViewerPage(viewerSource, p)} onDownload={() => viewerSource && downloadOutput(viewerSource, false)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.shell}>
        <ScrollView contentContainerStyle={styles.homePage} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Header />

          {screen === 'home' ? (
            <>
              <SearchBar value={search} onChange={setSearch} />
              {search.trim() ? (
                <View style={styles.searchSection}>
                  <SectionTitle title={`Search results · ${searchResults.length}`} />
                  <View style={styles.toolGrid}>{searchResults.map(item => <ToolTile key={item.id} item={item} onPress={() => openTool(item.id)} />)}</View>
                  {!searchResults.length ? <EmptyState icon="magnify-close" title="No tool found" text="Try words like merge, sign, protect or image." /> : null}
                </View>
              ) : (
                <>
                  <Hero onStart={() => openTool('compress')} />
                  <TabStrip active={activeTab} onChange={setActiveTab} />
                  <View style={styles.toolGrid}>{categoryTools.map(item => <ToolTile key={item.id} item={item} onPress={() => openTool(item.id)} />)}</View>
                  {activeTab === 'Popular' ? (
                    <>
                      <Pressable style={styles.moreTools} onPress={() => setScreen('tools')}><View style={styles.moreIcon}><Icon name="view-grid-plus-outline" color="#7C3AED" /></View><View style={{ flex: 1 }}><Text style={styles.moreTitle}>More tools</Text><Text style={styles.moreSub}>Explore all PDF features</Text></View><Icon name="chevron-right" color="#A4ACB8" /></Pressable>
                      <RecentSection history={history.slice(0, 3)} onSeeAll={() => setScreen('files')} onView={entry => openViewer(entry.output)} onDownload={entry => downloadOutput(entry.output, false)} />
                    </>
                  ) : null}
                </>
              )}
            </>
          ) : null}

          {screen === 'files' ? (
            <View style={styles.screenSection}>
              <ScreenTitle title="Files" subtitle="PDFs created during this session" icon="folder-multiple-outline" />
              {history.length ? history.map(entry => <HistoryRow key={entry.id} entry={entry} onView={() => entry.previewable ? openViewer(entry.output) : undefined} onDownload={() => downloadOutput(entry.output, false)} onShare={() => shareOutput(entry.output)} />) : <EmptyState icon="file-clock-outline" title="No processed files yet" text="Your generated PDFs will appear here while the app is open." />}
            </View>
          ) : null}

          {screen === 'tools' ? (
            <View style={styles.screenSection}>
              <ScreenTitle title="All tools" subtitle="Everything that actually works in PDF Pro" icon="view-grid-outline" />
              <TabStrip active={activeTab} onChange={setActiveTab} />
              <View style={styles.toolGrid}>{categoryTools.map(item => <ToolTile key={item.id} item={item} onPress={() => openTool(item.id)} />)}</View>
            </View>
          ) : null}

          {screen === 'settings' ? (
            <View style={styles.screenSection}>
              <ScreenTitle title="Settings" subtitle="Storage, privacy and workflow" icon="cog-outline" />
              <View style={styles.settingsCard}>
                <SettingRow icon="folder-download-outline" title="Download folder" subtitle={prefs.directoryUri ? 'Custom folder selected' : 'Downloads/PDF Pro'} action="Change" onPress={chooseDefaultFolder} />
                <View style={styles.settingDivider} />
                <View style={styles.settingSwitchRow}><View style={styles.settingIcon}><Icon name="download-circle-outline" color="#2563EB" /></View><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Auto-download</Text><Text style={styles.settingSub}>Save every result right after processing</Text></View><Switch value={prefs.autoSave} onValueChange={value => persistPrefs({ ...prefs, autoSave: value })} trackColor={{ false: '#D7DCE5', true: '#FDA4AF' }} thumbColor={prefs.autoSave ? BRAND : '#FFFFFF'} /></View>
              </View>
              <View style={styles.privacyCard}><View style={styles.privacyIcon}><Icon name="shield-lock-outline" color="#059669" size={25} /></View><View style={{ flex: 1 }}><Text style={styles.privacyTitle}>Local-first processing</Text><Text style={styles.privacyText}>The current PDF tools run on the device. PDF Pro does not expose placeholder OCR or fake cloud features.</Text></View></View>
            </View>
          ) : null}
        </ScrollView>

        <BottomNav screen={screen} onChange={value => { setScreen(value); setSearch(''); }} onQuick={() => setQuickOpen(true)} />
      </View>

      <QuickSheet open={quickOpen} onClose={() => setQuickOpen(false)} onTool={openTool} />
      <ViewerModal open={viewerOpen} output={viewerSource} page={viewerPage} uri={viewerUri} busy={viewerBusy} onClose={() => setViewerOpen(false)} onPage={p => viewerSource && renderViewerPage(viewerSource, p)} onDownload={() => viewerSource && downloadOutput(viewerSource, false)} />
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <View style={styles.logoStack}>
        <View style={styles.logoBack} />
        <View style={styles.logoFront}><Text style={styles.logoText}>PDF</Text></View>
      </View>
      <View style={{ flex: 1 }}><Text style={styles.brand}><Text style={{ color: BRAND }}>PDF</Text> Pro</Text><Text style={styles.brandSub}>Fast · Private · Professional</Text></View>
      <View style={styles.proAvatar}><Icon name="crown-outline" size={19} color="#FFFFFF" /></View>
    </View>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <View style={styles.searchBar}><Icon name="magnify" size={26} color="#7D8798" /><TextInput value={value} onChangeText={onChange} style={styles.searchInput} placeholder="Search PDF tools" placeholderTextColor="#A3AABA" /><View style={styles.filterButton}><Icon name="tune-variant" size={20} color="#7D8798" /></View></View>;
}

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroGlowPink} /><View style={styles.heroGlowBlue} /><View style={styles.heroDotOne} /><View style={styles.heroDotTwo} />
      <View style={styles.heroCopy}>
        <Text style={styles.heroTitle}>All your PDF tools,{`\n`}simple and powerful.</Text>
        <Text style={styles.heroText}>Create, organize, secure and convert documents in seconds.</Text>
        <Pressable style={styles.heroButton} onPress={onStart}><Text style={styles.heroButtonText}>Get started</Text><Icon name="arrow-right" color={INK} /></Pressable>
      </View>
      <View style={styles.heroArt}>
        <View style={styles.heroPaper}><View style={styles.fold} /><View style={styles.pdfLabel}><Text style={styles.pdfLabelText}>PDF</Text></View><View style={[styles.paperLine, { width: 60 }]} /><View style={[styles.paperLine, { width: 72 }]} /><View style={[styles.paperLine, { width: 48 }]} /></View>
        <View style={[styles.floatBadge, styles.floatImage]}><Icon name="image-outline" color="#FFFFFF" size={23} /></View>
        <View style={[styles.floatBadge, styles.floatLock]}><Icon name="shield-check-outline" color="#FFFFFF" size={22} /></View>
      </View>
    </View>
  );
}

function TabStrip({ active, onChange }: { active: TabId; onChange: (value: TabId) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{TABS.map(tab => { const selected = active === tab.id; return <Pressable key={tab.id} style={[styles.tab, selected && { borderColor: tab.color, backgroundColor: `${tab.color}0D` }]} onPress={() => onChange(tab.id)}><Icon name={tab.icon} size={18} color={selected ? tab.color : '#667085'} /><Text style={[styles.tabText, selected && { color: tab.color }]}>{tab.id}</Text></Pressable>; })}</ScrollView>;
}

function ToolTile({ item, onPress }: { item: Tool; onPress: () => void }) {
  const c = tone(item.tone);
  return (
    <Pressable style={({ pressed }) => [styles.toolTile, pressed && styles.pressed]} onPress={onPress}>
      <View style={[styles.toolTileIcon, { backgroundColor: c.bg }]}><Icon name={item.icon} size={28} color={c.fg} /></View>
      <Text style={styles.toolTileTitle} numberOfLines={1}>{item.title}</Text>
      <Text style={styles.toolTileSub} numberOfLines={1}>{item.subtitle}</Text>
      {item.native ? <View style={styles.nativeDot}><Icon name="shield-check" size={11} color="#059669" /></View> : null}
    </Pressable>
  );
}

function RecentSection({ history, onSeeAll, onView, onDownload }: { history: HistoryEntry[]; onSeeAll: () => void; onView: (entry: HistoryEntry) => void; onDownload: (entry: HistoryEntry) => void }) {
  return (
    <View style={styles.recentSection}>
      <View style={styles.recentHeader}><Text style={styles.recentTitle}>Recent files</Text><Pressable onPress={onSeeAll}><Text style={styles.seeAll}>See all</Text></Pressable></View>
      {history.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentStrip}>{history.map(entry => <Pressable key={entry.id} style={styles.recentCard} onPress={() => entry.previewable && onView(entry)}><View style={styles.recentPdf}><Text style={styles.recentPdfText}>PDF</Text></View><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.recentName} numberOfLines={1}>{entry.output.fileName}</Text><Text style={styles.recentMeta}>{fmt(entry.output.bytes)} · {entry.output.pageCount} pages</Text></View><Pressable hitSlop={8} onPress={() => onDownload(entry)}><Icon name="download-outline" size={19} color="#667085" /></Pressable></Pressable>)}</ScrollView> : <View style={styles.recentEmpty}><Icon name="file-plus-outline" color="#98A2B3" /><Text style={styles.recentEmptyText}>Processed PDFs will appear here.</Text></View>}
    </View>
  );
}

function ScreenTitle({ title, subtitle, icon }: { title: string; subtitle: string; icon: string }) {
  return <View style={styles.screenTitleRow}><View style={styles.screenTitleIcon}><Icon name={icon} color="#475467" /></View><View><Text style={styles.screenTitle}>{title}</Text><Text style={styles.screenSubtitle}>{subtitle}</Text></View></View>;
}

function SectionTitle({ title }: { title: string }) { return <Text style={styles.sectionTitle}>{title}</Text>; }

function HistoryRow({ entry, onView, onDownload, onShare }: { entry: HistoryEntry; onView: () => void; onDownload: () => void; onShare: () => void }) {
  return <View style={styles.historyRow}><Pressable style={styles.historyMain} onPress={onView}><View style={styles.historyPdf}><Text style={styles.historyPdfText}>PDF</Text></View><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.historyName} numberOfLines={1}>{entry.output.fileName}</Text><Text style={styles.historyMeta}>{entry.title} · {fmt(entry.output.bytes)} · {entry.output.pageCount} pages</Text></View></Pressable><Pressable style={styles.historyAction} onPress={onDownload}><Icon name="download-outline" color="#475467" /></Pressable><Pressable style={styles.historyAction} onPress={onShare}><Icon name="share-variant-outline" color="#475467" /></Pressable></View>;
}

function SettingRow({ icon, title, subtitle, action, onPress }: { icon: string; title: string; subtitle: string; action: string; onPress: () => void }) {
  return <View style={styles.settingSwitchRow}><View style={styles.settingIcon}><Icon name={icon} color="#2563EB" /></View><View style={{ flex: 1 }}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingSub}>{subtitle}</Text></View><Pressable style={styles.settingButton} onPress={onPress}><Text style={styles.settingButtonText}>{action}</Text></Pressable></View>;
}

function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <View style={styles.emptyState}><View style={styles.emptyIcon}><Icon name={icon} size={31} color="#7C3AED" /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text></View>;
}

function BottomNav({ screen, onChange, onQuick }: { screen: ScreenId; onChange: (value: ScreenId) => void; onQuick: () => void }) {
  const item = (id: ScreenId, icon: string, label: string) => <Pressable style={styles.navItem} onPress={() => onChange(id)}><Icon name={icon} size={24} color={screen === id ? BRAND : '#667085'} /><Text style={[styles.navLabel, screen === id && styles.navLabelActive]}>{label}</Text></Pressable>;
  return <View style={styles.bottomNav}>{item('home', 'home-variant-outline', 'Home')}{item('files', 'folder-outline', 'Files')}<Pressable style={styles.fab} onPress={onQuick}><Icon name="plus" size={32} color="#FFFFFF" /></Pressable>{item('tools', 'view-grid-outline', 'Tools')}{item('settings', 'cog-outline', 'Settings')}</View>;
}

function QuickSheet({ open, onClose, onTool }: { open: boolean; onClose: () => void; onTool: (tool: ToolId) => void }) {
  const options: { id: ToolId; title: string; subtitle: string; icon: string; tone: Tone }[] = [
    { id: 'images', title: 'Images to PDF', subtitle: 'Pick photos', icon: 'image-multiple-outline', tone: 'pink' },
    { id: 'camera', title: 'Scan to PDF', subtitle: 'Use camera', icon: 'scanner', tone: 'teal' },
    { id: 'merge', title: 'Merge PDFs', subtitle: 'Combine files', icon: 'file-document-multiple-outline', tone: 'orange' },
    { id: 'preview', title: 'Open PDF', subtitle: 'View pages', icon: 'file-eye-outline', tone: 'blue' },
  ];
  return <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.sheetBackdrop} onPress={onClose}><Pressable style={styles.sheet} onPress={() => undefined}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Quick actions</Text><Pressable style={styles.sheetClose} onPress={onClose}><Icon name="close" /></Pressable></View><View style={styles.sheetGrid}>{options.map(option => { const c = tone(option.tone); return <Pressable key={option.id} style={styles.sheetOption} onPress={() => onTool(option.id)}><View style={[styles.sheetOptionIcon, { backgroundColor: c.bg }]}><Icon name={option.icon} size={26} color={c.fg} /></View><Text style={styles.sheetOptionTitle}>{option.title}</Text><Text style={styles.sheetOptionSub}>{option.subtitle}</Text></Pressable>; })}</View></Pressable></Pressable></Modal>;
}

function ToolHeader({ tool, onBack }: { tool: Tool; onBack: () => void }) {
  return <View style={styles.toolHeader}><Pressable style={styles.backButton} onPress={onBack}><Icon name="arrow-left" color={INK} /></Pressable><View style={{ flex: 1 }}><Text style={styles.toolHeaderTitle}>{tool.title}</Text><Text style={styles.toolHeaderSub}>PDF Pro · Local workflow</Text></View><View style={styles.headerShield}><Icon name="shield-check-outline" color="#059669" /></View></View>;
}

function SelectButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return <Pressable style={({ pressed }) => [styles.selectButton, pressed && styles.pressed]} onPress={onPress}><View style={styles.selectIcon}><Icon name={icon} size={24} color="#2563EB" /></View><Text style={styles.selectLabel}>{label}</Text><Icon name="chevron-right" color="#98A2B3" /></Pressable>;
}

function OptionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return <View style={styles.optionCard}><View style={styles.optionTitleRow}><Icon name={icon} size={18} color="#667085" /><Text style={styles.optionTitle}>{title}</Text></View>{children}</View>;
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable style={[styles.segment, active && styles.segmentActive]} onPress={onPress}><Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label[0].toUpperCase() + label.slice(1)}</Text></Pressable>;
}

function Mini({ icon, onPress, danger, disabled }: { icon: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return <Pressable style={[styles.mini, danger && styles.miniDanger, disabled && styles.disabled]} disabled={disabled} onPress={onPress}><Icon name={icon} size={17} color={danger ? '#B42318' : '#475467'} /></Pressable>;
}

function Hint({ text }: { text: string }) { return <View style={styles.hint}><Icon name="information-outline" size={15} color="#667085" /><Text style={styles.hintText}>{text}</Text></View>; }
function Notice({ text }: { text: string }) { return <View style={styles.notice}><Icon name="check-circle-outline" size={17} color="#059669" /><Text style={styles.noticeText}>{text}</Text></View>; }
function ResultHeader({ title, subtitle }: { title: string; subtitle: string }) { return <View style={styles.resultHeader}><View style={styles.successCircle}><Icon name="check" size={15} color="#FFFFFF" /></View><View><Text style={styles.resultTitle}>{title}</Text><Text style={styles.resultSubtitle}>{subtitle}</Text></View></View>; }

function Action({ icon, label, onPress, primary, disabled }: { icon: string; label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return <Pressable style={[styles.action, primary && styles.actionPrimary, disabled && styles.disabled]} disabled={disabled} onPress={onPress}><Icon name={icon} size={19} color={primary ? '#FFFFFF' : '#344054'} /><Text style={[styles.actionText, primary && { color: '#FFFFFF' }]}>{label}</Text></Pressable>;
}

function ViewerModal({ open, output, page, uri, busy, onClose, onPage, onDownload }: { open: boolean; output: PdfOutput | null; page: number; uri: string | null; busy: boolean; onClose: () => void; onPage: (page: number) => void; onDownload: () => void }) {
  return <Modal visible={open} animationType="slide" onRequestClose={onClose}><SafeAreaView style={styles.viewerSafe}><StatusBar style="dark" /><View style={styles.viewerHeader}><Pressable style={styles.backButton} onPress={onClose}><Icon name="arrow-left" color={INK} /></Pressable><View style={{ flex: 1 }}><Text style={styles.viewerTitle}>PDF preview</Text><Text style={styles.viewerSub}>Page {page}{output?.pageCount ? ` / ${output.pageCount}` : ''}</Text></View><Pressable style={styles.viewerDownload} onPress={onDownload}><Icon name="download" color="#FFFFFF" /></Pressable></View><View style={styles.viewerCanvas}>{busy || !uri ? <ActivityIndicator size="large" color={BRAND} /> : <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" />}</View><View style={styles.viewerFooter}><Pressable style={[styles.viewerNav, page <= 1 && styles.disabled]} disabled={page <= 1 || busy} onPress={() => onPage(page - 1)}><Icon name="chevron-left" /><Text style={styles.viewerNavText}>Previous</Text></Pressable><Pressable style={[styles.viewerNav, Boolean(output?.pageCount && page >= output.pageCount) && styles.disabled]} disabled={Boolean(output?.pageCount && page >= output.pageCount) || busy} onPress={() => onPage(page + 1)}><Text style={styles.viewerNavText}>Next</Text><Icon name="chevron-right" /></Pressable></View></SafeAreaView></Modal>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  shell: { flex: 1 },
  homePage: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 112 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 12 },
  logoStack: { width: 47, height: 47, position: 'relative' },
  logoBack: { position: 'absolute', width: 38, height: 38, borderRadius: 10, backgroundColor: '#FDA4AF', left: 7, top: 1, transform: [{ rotate: '5deg' }] },
  logoFront: { position: 'absolute', width: 39, height: 42, borderRadius: 10, backgroundColor: BRAND, left: 1, top: 4, alignItems: 'center', justifyContent: 'center', shadowColor: BRAND, shadowOpacity: 0.2, shadowRadius: 8, elevation: 3 },
  logoText: { color: '#FFFFFF', fontWeight: '1000', fontSize: 14 },
  brand: { color: INK, fontSize: 25, fontWeight: '1000', letterSpacing: -0.7 },
  brandSub: { color: '#98A2B3', fontSize: 9.5, fontWeight: '700', marginTop: 2 },
  proAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center', shadowColor: '#7C3AED', shadowOpacity: 0.2, shadowRadius: 8, elevation: 3 },
  searchBar: { minHeight: 53, borderRadius: 17, backgroundColor: SURFACE, borderWidth: 1, borderColor: LINE, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 14, shadowColor: '#101828', shadowOpacity: 0.025, shadowRadius: 8, elevation: 1 },
  searchInput: { flex: 1, minHeight: 48, paddingHorizontal: 10, color: INK, fontSize: 13.5, fontWeight: '600' },
  filterButton: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  hero: { height: 224, borderRadius: 25, backgroundColor: '#5B4AE8', overflow: 'hidden', padding: 19, marginBottom: 14, shadowColor: '#5B4AE8', shadowOpacity: 0.16, shadowRadius: 16, elevation: 4 },
  heroGlowPink: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: '#FF4D6D', left: -70, top: -90, opacity: 0.82 },
  heroGlowBlue: { position: 'absolute', width: 240, height: 240, borderRadius: 120, backgroundColor: '#1597F3', right: -80, bottom: -110, opacity: 0.75 },
  heroDotOne: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF', opacity: 0.8, right: 38, top: 36 },
  heroDotTwo: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFFFFF', opacity: 0.75, right: 124, bottom: 30 },
  heroCopy: { width: '64%', zIndex: 2 },
  heroTitle: { color: '#FFFFFF', fontSize: 25, lineHeight: 31, fontWeight: '1000', letterSpacing: -0.7 },
  heroText: { color: '#F3F4FF', fontSize: 11.8, lineHeight: 17, fontWeight: '600', marginTop: 9 },
  heroButton: { alignSelf: 'flex-start', marginTop: 17, minHeight: 39, borderRadius: 20, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14 },
  heroButtonText: { color: INK, fontWeight: '900', fontSize: 11.5 },
  heroArt: { position: 'absolute', width: 120, height: 160, right: 12, top: 31, transform: [{ rotate: '4deg' }] },
  heroPaper: { position: 'absolute', width: 94, height: 126, borderRadius: 16, backgroundColor: '#F9FAFF', right: 9, top: 18, padding: 14, shadowColor: '#111827', shadowOpacity: 0.15, shadowRadius: 10, elevation: 5 },
  fold: { position: 'absolute', width: 24, height: 24, right: 0, top: 0, backgroundColor: '#DADDFB', borderBottomLeftRadius: 12 },
  pdfLabel: { width: 46, height: 29, borderRadius: 8, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 13 },
  pdfLabelText: { color: '#FFFFFF', fontWeight: '1000', fontSize: 12 },
  paperLine: { height: 6, backgroundColor: '#D7D9EB', borderRadius: 3, marginBottom: 8 },
  floatBadge: { position: 'absolute', width: 45, height: 45, borderRadius: 13, alignItems: 'center', justifyContent: 'center', shadowColor: '#111827', shadowOpacity: 0.18, shadowRadius: 8, elevation: 4 },
  floatImage: { backgroundColor: '#8B5CF6', right: -1, top: 2, transform: [{ rotate: '9deg' }] },
  floatLock: { backgroundColor: '#22C55E', left: 0, bottom: 0, transform: [{ rotate: '-8deg' }] },
  tabs: { gap: 7, paddingBottom: 12 },
  tab: { minHeight: 39, borderRadius: 19, borderWidth: 1, borderColor: LINE, backgroundColor: SURFACE, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  tabText: { color: '#667085', fontSize: 10.5, fontWeight: '900' },
  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  toolTile: { width: '48.7%', minHeight: 118, borderRadius: 18, backgroundColor: SURFACE, borderWidth: 1, borderColor: '#E8EAF0', padding: 13, position: 'relative', shadowColor: '#101828', shadowOpacity: 0.035, shadowRadius: 10, elevation: 1 },
  toolTileIcon: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  toolTileTitle: { color: INK, fontSize: 13.3, fontWeight: '1000' },
  toolTileSub: { color: '#8B94A5', fontSize: 9.7, fontWeight: '600', marginTop: 3 },
  nativeDot: { position: 'absolute', right: 10, top: 10, width: 20, height: 20, borderRadius: 10, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  moreTools: { minHeight: 63, backgroundColor: SURFACE, borderWidth: 1, borderColor: LINE, borderRadius: 17, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  moreIcon: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#F3EEFF', alignItems: 'center', justifyContent: 'center' },
  moreTitle: { color: INK, fontSize: 12.5, fontWeight: '1000' },
  moreSub: { color: '#98A2B3', fontSize: 9.5, marginTop: 2 },
  recentSection: { marginTop: 18 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  recentTitle: { color: INK, fontSize: 16, fontWeight: '1000' },
  seeAll: { color: BRAND, fontSize: 10.5, fontWeight: '900' },
  recentStrip: { gap: 8 },
  recentCard: { width: 255, minHeight: 67, borderRadius: 16, backgroundColor: SURFACE, borderWidth: 1, borderColor: LINE, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  recentPdf: { width: 38, height: 46, borderRadius: 8, backgroundColor: '#FFF0F1', alignItems: 'center', justifyContent: 'center' },
  recentPdfText: { color: BRAND, fontSize: 10, fontWeight: '1000' },
  recentName: { color: INK, fontSize: 11.3, fontWeight: '900' },
  recentMeta: { color: '#98A2B3', fontSize: 8.8, marginTop: 3 },
  recentEmpty: { minHeight: 60, borderRadius: 16, borderWidth: 1, borderColor: LINE, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13 },
  recentEmptyText: { color: '#98A2B3', fontSize: 10.5, fontWeight: '600' },
  searchSection: { paddingTop: 4 },
  sectionTitle: { color: INK, fontSize: 16, fontWeight: '1000', marginBottom: 11 },
  screenSection: { paddingTop: 3 },
  screenTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  screenTitleIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: '#EEF0F4', alignItems: 'center', justifyContent: 'center' },
  screenTitle: { color: INK, fontSize: 21, fontWeight: '1000' },
  screenSubtitle: { color: '#98A2B3', fontSize: 9.8, marginTop: 2 },
  historyRow: { minHeight: 72, backgroundColor: SURFACE, borderRadius: 16, borderWidth: 1, borderColor: LINE, marginBottom: 9, flexDirection: 'row', alignItems: 'center', padding: 9 },
  historyMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  historyPdf: { width: 39, height: 48, borderRadius: 9, backgroundColor: '#FFF0F1', alignItems: 'center', justifyContent: 'center' },
  historyPdfText: { color: BRAND, fontWeight: '1000', fontSize: 10 },
  historyName: { color: INK, fontSize: 11.8, fontWeight: '900' },
  historyMeta: { color: '#98A2B3', fontSize: 8.9, marginTop: 3 },
  historyAction: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#F5F6F8', alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  settingsCard: { backgroundColor: SURFACE, borderRadius: 18, borderWidth: 1, borderColor: LINE, padding: 12 },
  settingSwitchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58 },
  settingIcon: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#EEF6FF', alignItems: 'center', justifyContent: 'center' },
  settingTitle: { color: INK, fontSize: 12.3, fontWeight: '900' },
  settingSub: { color: '#98A2B3', fontSize: 9.4, marginTop: 2 },
  settingButton: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F2F4F7' },
  settingButtonText: { color: '#475467', fontSize: 9.5, fontWeight: '900' },
  settingDivider: { height: 1, backgroundColor: '#F0F1F4', marginVertical: 2 },
  privacyCard: { marginTop: 12, backgroundColor: '#ECFDF3', borderRadius: 18, borderWidth: 1, borderColor: '#ABEFC6', padding: 14, flexDirection: 'row', gap: 11 },
  privacyIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: '#D1FADF', alignItems: 'center', justifyContent: 'center' },
  privacyTitle: { color: '#065F46', fontSize: 12.5, fontWeight: '1000' },
  privacyText: { color: '#047857', fontSize: 9.8, lineHeight: 14.5, marginTop: 4 },
  emptyState: { minHeight: 210, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyIcon: { width: 62, height: 62, borderRadius: 20, backgroundColor: '#F3EEFF', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: INK, fontSize: 15, fontWeight: '1000' },
  emptyText: { color: '#98A2B3', fontSize: 10.5, lineHeight: 16, textAlign: 'center', marginTop: 5, maxWidth: 260 },
  bottomNav: { position: 'absolute', left: 10, right: 10, bottom: 8, height: 72, borderRadius: 24, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: LINE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 5, shadowColor: '#101828', shadowOpacity: 0.1, shadowRadius: 18, elevation: 8 },
  navItem: { width: 56, alignItems: 'center', justifyContent: 'center', gap: 3 },
  navLabel: { color: '#667085', fontSize: 8.6, fontWeight: '800' },
  navLabelActive: { color: BRAND },
  fab: { width: 57, height: 57, borderRadius: 29, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center', marginTop: -26, borderWidth: 5, borderColor: '#FFE4E7', shadowColor: BRAND, shadowOpacity: 0.35, shadowRadius: 10, elevation: 9 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.44)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: SURFACE, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, paddingBottom: 34 },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#D0D5DD', alignSelf: 'center', marginBottom: 14 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { flex: 1, color: INK, fontSize: 20, fontWeight: '1000' },
  sheetClose: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  sheetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sheetOption: { width: '48.5%', minHeight: 112, borderRadius: 18, borderWidth: 1, borderColor: LINE, padding: 13 },
  sheetOptionIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
  sheetOptionTitle: { color: INK, fontSize: 12.5, fontWeight: '1000' },
  sheetOptionSub: { color: '#98A2B3', fontSize: 9.4, marginTop: 2 },
  toolHeader: { minHeight: 64, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: LINE },
  backButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  toolHeaderTitle: { color: INK, fontSize: 17, fontWeight: '1000' },
  toolHeaderSub: { color: '#98A2B3', fontSize: 9, marginTop: 1 },
  headerShield: { width: 37, height: 37, borderRadius: 12, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  workspacePage: { padding: 15, paddingBottom: 55 },
  workspaceIntro: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 15 },
  workspaceIcon: { width: 53, height: 53, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  workspaceTitle: { color: INK, fontSize: 20, fontWeight: '1000' },
  workspaceSub: { color: '#98A2B3', fontSize: 10.5, marginTop: 2 },
  localTag: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, backgroundColor: '#ECFDF3' },
  localTagText: { color: '#059669', fontSize: 8, fontWeight: '1000' },
  selectButton: { minHeight: 62, borderRadius: 17, borderWidth: 1, borderColor: '#D8E5FF', backgroundColor: '#F7FAFF', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#E8F1FF', alignItems: 'center', justifyContent: 'center' },
  selectLabel: { flex: 1, color: '#1D4ED8', fontSize: 12, fontWeight: '900' },
  thumbScroll: { marginTop: 10 },
  thumb: { width: 70, height: 92, borderRadius: 11, backgroundColor: '#EAECF0', marginRight: 7 },
  undoCard: { width: 70, height: 92, borderRadius: 11, backgroundColor: '#FFF1F3', alignItems: 'center', justifyContent: 'center', gap: 4 },
  undoText: { color: '#B42318', fontSize: 9, fontWeight: '900' },
  fileRow: { marginTop: 9, minHeight: 61, borderRadius: 15, borderWidth: 1, borderColor: LINE, backgroundColor: SURFACE, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  pdfBadge: { width: 40, height: 44, borderRadius: 11, backgroundColor: '#FFF0F1', alignItems: 'center', justifyContent: 'center' },
  fileName: { color: INK, fontSize: 11.7, fontWeight: '900' },
  fileMeta: { color: '#98A2B3', fontSize: 9, marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: 3 },
  mini: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  miniDanger: { backgroundColor: '#FFF1F3' },
  optionCard: { marginTop: 13, borderRadius: 17, backgroundColor: SURFACE, borderWidth: 1, borderColor: LINE, padding: 13 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 },
  optionTitle: { color: '#344054', fontSize: 11.2, fontWeight: '1000' },
  input: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 12, color: INK, fontSize: 13 },
  segments: { flexDirection: 'row', gap: 7 },
  segment: { flex: 1, minHeight: 41, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: '#F8F9FB', alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: INK, borderColor: INK },
  segmentText: { color: '#667085', fontSize: 10, fontWeight: '900' },
  segmentTextActive: { color: '#FFFFFF' },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 },
  hintText: { color: '#667085', fontSize: 9.5, lineHeight: 14, flex: 1 },
  pageNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  pageNavText: { color: '#344054', fontSize: 10.5, fontWeight: '900' },
  previewImage: { width: '100%', height: 410, borderRadius: 14, backgroundColor: '#EAECF0' },
  previewEmpty: { height: 230, borderRadius: 14, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center', gap: 8 },
  previewEmptyText: { color: '#98A2B3', fontSize: 10.2 },
  runButton: { minHeight: 54, borderRadius: 16, backgroundColor: INK, marginTop: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: INK, shadowOpacity: 0.14, shadowRadius: 10, elevation: 3 },
  runText: { color: '#FFFFFF', fontSize: 13, fontWeight: '1000' },
  compressionCard: { marginTop: 12, borderRadius: 16, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', padding: 13, flexDirection: 'row', alignItems: 'center' },
  compressionTitle: { color: '#1D4ED8', fontSize: 9.5, fontWeight: '1000', textTransform: 'uppercase' },
  compressionNumbers: { color: '#1E3A8A', fontSize: 16, fontWeight: '1000', marginTop: 2 },
  compressionMeta: { color: '#2563EB', fontSize: 9.5, marginTop: 1 },
  resultCard: { marginTop: 13, borderRadius: 19, backgroundColor: SURFACE, borderWidth: 1, borderColor: '#ABEFC6', padding: 14, shadowColor: '#065F46', shadowOpacity: 0.04, shadowRadius: 10, elevation: 1 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  successCircle: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  resultTitle: { color: '#065F46', fontSize: 13, fontWeight: '1000' },
  resultSubtitle: { color: '#039855', fontSize: 9, marginTop: 1 },
  resultFile: { minHeight: 57, borderRadius: 14, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#EAECF0', marginTop: 11, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  resultPdfIcon: { width: 39, height: 39, borderRadius: 11, backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center' },
  resultName: { color: INK, fontSize: 11.5, fontWeight: '900' },
  resultMeta: { color: '#98A2B3', fontSize: 8.8, marginTop: 2 },
  downloadMain: { minHeight: 49, borderRadius: 14, backgroundColor: BRAND, marginTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, shadowColor: BRAND, shadowOpacity: 0.2, shadowRadius: 10, elevation: 3 },
  downloadMainText: { color: '#FFFFFF', fontSize: 12, fontWeight: '1000' },
  resultActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  action: { flexGrow: 1, flexBasis: '31%', minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: '#F9FAFB', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8 },
  actionPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  actionText: { color: '#344054', fontSize: 9.6, fontWeight: '900' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 10, backgroundColor: '#ECFDF3' },
  noticeText: { color: '#047857', fontSize: 9.2, fontWeight: '800', flex: 1 },
  imageStrip: { flexDirection: 'row', gap: 6, marginTop: 10 },
  resultThumb: { width: 56, height: 73, borderRadius: 9, backgroundColor: '#EAECF0' },
  viewerSafe: { flex: 1, backgroundColor: '#F3F4F6' },
  viewerHeader: { minHeight: 64, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, borderBottomWidth: 1, borderBottomColor: LINE },
  viewerTitle: { color: INK, fontSize: 16, fontWeight: '1000' },
  viewerSub: { color: '#98A2B3', fontSize: 9, marginTop: 1 },
  viewerDownload: { width: 39, height: 39, borderRadius: 12, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  viewerCanvas: { flex: 1, margin: 12, borderRadius: 18, backgroundColor: '#DDE1E8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  viewerImage: { width: '100%', height: '100%' },
  viewerFooter: { minHeight: 70, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: LINE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  viewerNav: { minWidth: 118, minHeight: 43, borderRadius: 12, borderWidth: 1, borderColor: LINE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  viewerNavText: { color: '#344054', fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
});
