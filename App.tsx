import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import { savePdfToChosenFolder } from './services/savePdf';

type ToolId =
  | 'merge'
  | 'extract'
  | 'delete'
  | 'reorder'
  | 'rotate'
  | 'watermark'
  | 'numbers'
  | 'images'
  | 'scan';

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
};

const TOOLS: ToolDefinition[] = [
  { id: 'merge', title: 'Merge PDF', description: 'Combine several PDFs in the exact order you choose.', icon: '⊕' },
  { id: 'extract', title: 'Extract pages', description: 'Create a new PDF from selected pages.', icon: '⇲' },
  { id: 'delete', title: 'Delete pages', description: 'Remove unwanted pages and keep the rest.', icon: '−' },
  { id: 'reorder', title: 'Reorder pages', description: 'Build a new PDF with a custom page order.', icon: '↕' },
  { id: 'rotate', title: 'Rotate pages', description: 'Rotate all pages or only the pages you select.', icon: '↻' },
  { id: 'watermark', title: 'Watermark', description: 'Burn a visible text watermark into every page.', icon: 'W' },
  { id: 'numbers', title: 'Page numbers', description: 'Add permanent page numbers to the PDF.', icon: '#' },
  { id: 'images', title: 'Images to PDF', description: 'Turn multiple photos into one A4 PDF.', icon: '▧' },
  { id: 'scan', title: 'Camera to PDF', description: 'Capture document pages with the camera and create a PDF.', icon: '⌁' },
];

function formatBytes(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The PDF operation failed.';
}

export default function App() {
  const [tool, setTool] = useState<ToolId | null>(null);
  const [pdfs, setPdfs] = useState<SelectedPdf[]>([]);
  const [images, setImages] = useState<ImageInput[]>([]);
  const [pageExpression, setPageExpression] = useState('');
  const [watermark, setWatermark] = useState('CONFIDENTIAL');
  const [startAt, setStartAt] = useState('1');
  const [rotation, setRotation] = useState<90 | 180 | 270>(90);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PdfOutput | null>(null);

  const selectedTool = useMemo(() => TOOLS.find(item => item.id === tool) ?? null, [tool]);

  function clearWorkspace(nextTool: ToolId | null = tool) {
    setPdfs([]);
    setImages([]);
    setPageExpression('');
    setWatermark('CONFIDENTIAL');
    setStartAt('1');
    setRotation(90);
    setResult(null);
    setTool(nextTool);
  }

  function openTool(id: ToolId) {
    clearWorkspace(id);
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
        selected[0].pages = await getPdfPageCount(selected[0].uri);
        setPdfs([selected[0]]);
      } else {
        setPdfs(selected);
      }
      setResult(null);
    } catch (error) {
      Alert.alert('Cannot open PDF', errorMessage(error));
    }
  }

  async function pickImages() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Photo access is required to create a PDF from images.');
        return;
      }

      const response = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        orderedSelection: true,
        quality: 1,
        selectionLimit: 0,
      });
      if (response.canceled) return;

      setImages(
        response.assets.map(asset => ({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
        })),
      );
      setResult(null);
    } catch (error) {
      Alert.alert('Could not select images', errorMessage(error));
    }
  }

  async function capturePage() {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Camera access is required to capture a document page.');
        return;
      }

      const response = await ImagePicker.launchCameraAsync({ quality: 1 });
      if (response.canceled || !response.assets?.length) return;

      const asset = response.assets[0];
      setImages(current => [
        ...current,
        { uri: asset.uri, width: asset.width, height: asset.height },
      ]);
      setResult(null);
    } catch (error) {
      Alert.alert('Camera failed', errorMessage(error));
    }
  }

  function removePdf(index: number) {
    setPdfs(current => current.filter((_, itemIndex) => itemIndex !== index));
    setResult(null);
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

  async function runTool() {
    if (!tool) return;
    setBusy(true);
    setResult(null);

    try {
      let output: PdfOutput;
      switch (tool) {
        case 'merge':
          output = await mergePdfs(pdfs.map(item => item.uri));
          break;
        case 'extract':
          if (!pdfs[0]) throw new Error('Choose a PDF first.');
          output = await extractPages(pdfs[0].uri, pageExpression);
          break;
        case 'delete':
          if (!pdfs[0]) throw new Error('Choose a PDF first.');
          output = await deletePages(pdfs[0].uri, pageExpression);
          break;
        case 'reorder':
          if (!pdfs[0]) throw new Error('Choose a PDF first.');
          output = await reorderPages(pdfs[0].uri, pageExpression);
          break;
        case 'rotate':
          if (!pdfs[0]) throw new Error('Choose a PDF first.');
          output = await rotatePages(pdfs[0].uri, pageExpression, rotation);
          break;
        case 'watermark':
          if (!pdfs[0]) throw new Error('Choose a PDF first.');
          output = await watermarkPdf(pdfs[0].uri, watermark);
          break;
        case 'numbers': {
          if (!pdfs[0]) throw new Error('Choose a PDF first.');
          const firstNumber = Number(startAt);
          if (!Number.isInteger(firstNumber) || firstNumber < 0) {
            throw new Error('Start number must be a whole number of 0 or greater.');
          }
          output = await addPageNumbers(pdfs[0].uri, firstNumber);
          break;
        }
        case 'images':
        case 'scan':
          output = await imagesToPdf(images, {
            pageMode: 'auto',
            jpegQuality: 0.88,
            maxImageWidth: 2200,
            margin: 28,
          });
          break;
        default:
          throw new Error('Unknown tool.');
      }
      setResult(output);
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
      const destination = await savePdfToChosenFolder(result.uri, result.fileName);
      if (destination) Alert.alert('Saved', 'The PDF was copied to the folder you selected.');
    } catch (error) {
      Alert.alert('Could not save PDF', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function shareResult() {
    if (!result) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'Use “Save to folder” to keep the generated PDF.');
        return;
      }
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share PDF',
        UTI: 'com.adobe.pdf',
      });
    } catch (error) {
      Alert.alert('Could not share PDF', errorMessage(error));
    }
  }

  function actionLabel() {
    switch (tool) {
      case 'merge': return 'Merge PDFs';
      case 'extract': return 'Extract pages';
      case 'delete': return 'Delete pages';
      case 'reorder': return 'Reorder pages';
      case 'rotate': return 'Rotate pages';
      case 'watermark': return 'Apply watermark';
      case 'numbers': return 'Add page numbers';
      case 'images': return 'Create PDF';
      case 'scan': return 'Create scanned PDF';
      default: return 'Run';
    }
  }

  const canRun =
    tool === 'images' || tool === 'scan'
      ? images.length > 0
      : tool === 'merge'
        ? pdfs.length >= 2
        : pdfs.length === 1;

  const usesPageExpression = tool === 'extract' || tool === 'delete' || tool === 'reorder' || tool === 'rotate';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.eyebrow}>OFFLINE PDF TOOLKIT</Text>
            <Text style={styles.title}>PDF Pro Tools</Text>
          </View>
          {tool ? (
            <Pressable style={styles.headerButton} onPress={() => clearWorkspace(null)}>
              <Text style={styles.headerButtonText}>All tools</Text>
            </Pressable>
          ) : null}
        </View>

        {!tool ? (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroTitle}>Real PDF editing, on your phone</Text>
              <Text style={styles.heroText}>
                Files are processed locally. Choose a tool, create the result, then save or share it.
              </Text>
            </View>

            <View style={styles.toolGrid}>
              {TOOLS.map(item => (
                <Pressable key={item.id} style={styles.toolCard} onPress={() => openTool(item.id)}>
                  <View style={styles.toolIcon}>
                    <Text style={styles.toolIconText}>{item.icon}</Text>
                  </View>
                  <Text style={styles.toolTitle}>{item.title}</Text>
                  <Text style={styles.toolDescription}>{item.description}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.footerNote}>
              Password removal, OCR and full text editing are not shown because this build does not pretend to provide features it cannot perform reliably.
            </Text>
          </>
        ) : (
          <View style={styles.workspace}>
            <View style={styles.workspaceHeading}>
              <View style={styles.workspaceIcon}>
                <Text style={styles.workspaceIconText}>{selectedTool?.icon}</Text>
              </View>
              <View style={styles.workspaceHeadingText}>
                <Text style={styles.workspaceTitle}>{selectedTool?.title}</Text>
                <Text style={styles.workspaceDescription}>{selectedTool?.description}</Text>
              </View>
            </View>

            {tool === 'images' ? (
              <>
                <Pressable style={styles.selectButton} onPress={pickImages}>
                  <Text style={styles.selectButtonText}>{images.length ? 'Choose different images' : 'Choose images'}</Text>
                </Pressable>
                {images.length > 0 ? (
                  <View style={styles.selectionCard}>
                    <Text style={styles.selectionTitle}>{images.length} image(s) selected</Text>
                    <Text style={styles.selectionMeta}>Selection order becomes PDF page order.</Text>
                  </View>
                ) : null}
              </>
            ) : tool === 'scan' ? (
              <>
                <Pressable style={styles.selectButton} onPress={capturePage}>
                  <Text style={styles.selectButtonText}>{images.length ? 'Capture another page' : 'Capture first page'}</Text>
                </Pressable>
                {images.length > 0 ? (
                  <View style={styles.selectionCard}>
                    <Text style={styles.selectionTitle}>{images.length} captured page(s)</Text>
                    <View style={styles.inlineActions}>
                      <Pressable style={styles.minorButton} onPress={() => setImages(current => current.slice(0, -1))}>
                        <Text style={styles.minorButtonText}>Remove last</Text>
                      </Pressable>
                      <Pressable style={styles.minorButton} onPress={() => setImages([])}>
                        <Text style={styles.minorButtonText}>Clear</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Pressable style={styles.selectButton} onPress={() => pickPdf(tool === 'merge')}>
                  <Text style={styles.selectButtonText}>{tool === 'merge' ? 'Choose PDF files' : 'Choose PDF'}</Text>
                </Pressable>

                {pdfs.map((pdf, index) => (
                  <View key={`${pdf.uri}-${index}`} style={styles.fileRow}>
                    <View style={styles.fileOrderBadge}>
                      <Text style={styles.fileOrderText}>{index + 1}</Text>
                    </View>
                    <View style={styles.fileInfo}>
                      <Text style={styles.fileName} numberOfLines={1}>{pdf.name}</Text>
                      <Text style={styles.fileMeta}>
                        {[formatBytes(pdf.size), pdf.pages ? `${pdf.pages} pages` : ''].filter(Boolean).join(' • ') || 'PDF file'}
                      </Text>
                    </View>
                    {tool === 'merge' ? (
                      <View style={styles.fileActions}>
                        <Pressable disabled={index === 0} onPress={() => movePdf(index, -1)} hitSlop={8}>
                          <Text style={[styles.fileActionText, index === 0 && styles.muted]}>↑</Text>
                        </Pressable>
                        <Pressable disabled={index === pdfs.length - 1} onPress={() => movePdf(index, 1)} hitSlop={8}>
                          <Text style={[styles.fileActionText, index === pdfs.length - 1 && styles.muted]}>↓</Text>
                        </Pressable>
                        <Pressable onPress={() => removePdf(index)} hitSlop={8}>
                          <Text style={styles.removeText}>×</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ))}
              </>
            )}

            {usesPageExpression ? (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>
                  {tool === 'reorder' ? 'New page order' : tool === 'delete' ? 'Pages to delete' : 'Pages'}
                </Text>
                <TextInput
                  value={pageExpression}
                  onChangeText={setPageExpression}
                  placeholder={
                    tool === 'rotate'
                      ? 'Leave empty for all pages, or 1-3,5'
                      : tool === 'reorder'
                        ? 'Example: 3,1,2,4-8'
                        : 'Example: 1-3,5,8'
                  }
                  placeholderTextColor="#94a3b8"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.helpText}>Page numbers start at 1. Commas and ranges are supported.</Text>
              </View>
            ) : null}

            {tool === 'rotate' ? (
              <View style={styles.segmentRow}>
                {[90, 180, 270].map(value => (
                  <Pressable
                    key={value}
                    style={[styles.segment, rotation === value && styles.segmentActive]}
                    onPress={() => setRotation(value as 90 | 180 | 270)}
                  >
                    <Text style={[styles.segmentText, rotation === value && styles.segmentTextActive]}>{value}°</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {tool === 'watermark' ? (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Watermark text</Text>
                <TextInput value={watermark} onChangeText={setWatermark} style={styles.input} maxLength={80} />
                <Text style={styles.helpText}>Latin text is supported in this offline watermark engine.</Text>
              </View>
            ) : null}

            {tool === 'numbers' ? (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Start numbering at</Text>
                <TextInput value={startAt} onChangeText={setStartAt} keyboardType="number-pad" style={styles.input} />
              </View>
            ) : null}

            <Pressable
              style={[styles.runButton, (!canRun || busy) && styles.disabled]}
              onPress={runTool}
              disabled={!canRun || busy}
            >
              {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.runButtonText}>{actionLabel()}</Text>}
            </Pressable>

            {result ? (
              <View style={styles.resultCard}>
                <View style={styles.resultBadge}>
                  <Text style={styles.resultBadgeText}>✓</Text>
                </View>
                <View style={styles.resultContent}>
                  <Text style={styles.resultTitle}>PDF created successfully</Text>
                  <Text style={styles.resultName}>{result.fileName}</Text>
                  <Text style={styles.resultMeta}>{result.pageCount} pages • {formatBytes(result.bytes)}</Text>
                </View>
                <View style={styles.resultActions}>
                  <Pressable style={[styles.saveButton, saving && styles.disabled]} onPress={saveResult} disabled={saving}>
                    {saving ? <ActivityIndicator color="#166534" size="small" /> : <Text style={styles.saveButtonText}>Save to folder</Text>}
                  </Pressable>
                  <Pressable style={styles.shareButton} onPress={shareResult}>
                    <Text style={styles.shareButtonText}>Share</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  container: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12 },
  headerTextWrap: { flex: 1 },
  eyebrow: { color: '#2563eb', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#0f172a', fontSize: 30, lineHeight: 36, fontWeight: '800', marginTop: 2 },
  headerButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10, backgroundColor: '#e2e8f0' },
  headerButtonText: { color: '#334155', fontWeight: '700' },
  heroCard: { backgroundColor: '#0f172a', borderRadius: 20, padding: 20, marginBottom: 18 },
  heroTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  heroText: { color: '#cbd5e1', fontSize: 14, lineHeight: 21 },
  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  toolCard: { width: '48%', minHeight: 150, backgroundColor: '#ffffff', borderRadius: 16, padding: 15, borderWidth: 1, borderColor: '#e2e8f0' },
  toolIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  toolIconText: { color: '#2563eb', fontSize: 20, fontWeight: '800' },
  toolTitle: { color: '#0f172a', fontSize: 15, fontWeight: '800', marginBottom: 5 },
  toolDescription: { color: '#64748b', fontSize: 12, lineHeight: 18 },
  footerNote: { color: '#64748b', fontSize: 12, lineHeight: 18, marginTop: 18, textAlign: 'center' },
  workspace: { backgroundColor: '#ffffff', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: '#e2e8f0' },
  workspaceHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  workspaceIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  workspaceIconText: { color: '#2563eb', fontSize: 23, fontWeight: '800' },
  workspaceHeadingText: { flex: 1 },
  workspaceTitle: { color: '#0f172a', fontSize: 22, fontWeight: '800', marginBottom: 3 },
  workspaceDescription: { color: '#64748b', fontSize: 13, lineHeight: 19 },
  selectButton: { backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', marginBottom: 12 },
  selectButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  selectionCard: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  selectionTitle: { color: '#0f172a', fontWeight: '800', marginBottom: 4 },
  selectionMeta: { color: '#64748b', fontSize: 12 },
  inlineActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  minorButton: { backgroundColor: '#e2e8f0', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  minorButtonText: { color: '#334155', fontSize: 12, fontWeight: '700' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f8fafc', borderRadius: 12, padding: 11, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  fileOrderBadge: { width: 28, height: 28, borderRadius: 9, backgroundColor: '#e0e7ff', alignItems: 'center', justifyContent: 'center' },
  fileOrderText: { color: '#3730a3', fontWeight: '800', fontSize: 12 },
  fileInfo: { flex: 1, minWidth: 0 },
  fileName: { color: '#0f172a', fontWeight: '700', fontSize: 13 },
  fileMeta: { color: '#64748b', fontSize: 11, marginTop: 2 },
  fileActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fileActionText: { color: '#334155', fontSize: 18, fontWeight: '800' },
  removeText: { color: '#dc2626', fontSize: 22, fontWeight: '700' },
  muted: { opacity: 0.25 },
  fieldBlock: { marginTop: 12 },
  fieldLabel: { color: '#334155', fontSize: 13, fontWeight: '800', marginBottom: 7 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: '#0f172a', fontSize: 14 },
  helpText: { color: '#64748b', fontSize: 11, lineHeight: 16, marginTop: 6 },
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  segment: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', backgroundColor: '#f1f5f9' },
  segmentActive: { backgroundColor: '#dbeafe', borderWidth: 1, borderColor: '#60a5fa' },
  segmentText: { color: '#475569', fontWeight: '700' },
  segmentTextActive: { color: '#1d4ed8' },
  runButton: { backgroundColor: '#0f172a', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  runButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  resultCard: { marginTop: 18, borderRadius: 15, padding: 15, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  resultBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  resultBadgeText: { color: '#ffffff', fontWeight: '900' },
  resultContent: { marginBottom: 12 },
  resultTitle: { color: '#166534', fontSize: 15, fontWeight: '800' },
  resultName: { color: '#334155', fontSize: 12, marginTop: 4 },
  resultMeta: { color: '#64748b', fontSize: 11, marginTop: 3 },
  resultActions: { flexDirection: 'row', gap: 8 },
  saveButton: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center', backgroundColor: '#dcfce7' },
  saveButtonText: { color: '#166534', fontWeight: '800', fontSize: 12 },
  shareButton: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center', backgroundColor: '#dbeafe' },
  shareButtonText: { color: '#1d4ed8', fontWeight: '800', fontSize: 12 },
});
