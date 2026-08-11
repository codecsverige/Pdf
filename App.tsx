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
  extractPages,
  getPdfPageCount,
  mergePdfs,
  PdfOutput,
  reorderPages,
  rotatePages,
  watermarkPdf,
} from './services/pdfEngine';
import { ImageInput, imagesToPdf } from './services/imageToPdf';
import { savePdfToChosenFolder } from './services/savePdf';

type ToolId = 'merge' | 'extract' | 'reorder' | 'rotate' | 'watermark' | 'numbers' | 'images';

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
  { id: 'merge', title: 'Merge PDF', description: 'Combine multiple PDFs in the chosen order', icon: '⊕' },
  { id: 'extract', title: 'Extract pages', description: 'Create a new PDF from selected pages', icon: '⇲' },
  { id: 'reorder', title: 'Reorder pages', description: 'Build a new PDF with a custom page order', icon: '↕' },
  { id: 'rotate', title: 'Rotate pages', description: 'Rotate all pages or only selected pages', icon: '↻' },
  { id: 'watermark', title: 'Watermark', description: 'Burn a visible text watermark into every page', icon: 'W' },
  { id: 'numbers', title: 'Page numbers', description: 'Add permanent page numbers to the PDF', icon: '#' },
  { id: 'images', title: 'Images to PDF', description: 'Create an A4 PDF from multiple photos', icon: '▧' },
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
        Alert.alert('Cannot open PDF', errorMessage(error));
        return;
      }
      setPdfs([selected[0]]);
    } else {
      setPdfs(selected);
    }
    setResult(null);
  }

  async function pickImages() {
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
    setImages(response.assets.map(asset => ({ uri: asset.uri, width: asset.width, height: asset.height })));
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
          if (!Number.isInteger(firstNumber)) throw new Error('Start number must be a whole number.');
          output = await addPageNumbers(pdfs[0].uri, firstNumber);
          break;
        }
        case 'images':
          output = await imagesToPdf(images, { pageMode: 'auto', jpegQuality: 0.9, margin: 28 });
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
      await savePdfToChosenFolder(result.uri, result.fileName);
      Alert.alert('Saved', 'The PDF was copied to the folder you selected.');
    } catch (error) {
      Alert.alert('Could not save PDF', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function shareResult() {
    if (!result) return;
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Sharing unavailable', `The file was created at ${result.uri}`);
      return;
    }
    await Sharing.shareAsync(result.uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share PDF',
      UTI: 'com.adobe.pdf',
    });
  }

  function actionLabel() {
    switch (tool) {
      case 'merge': return 'Merge PDFs';
      case 'extract': return 'Extract pages';
      case 'reorder': return 'Reorder pages';
      case 'rotate': return 'Rotate pages';
      case 'watermark': return 'Apply watermark';
      case 'numbers': return 'Add page numbers';
      case 'images': return 'Create PDF';
      default: return 'Run';
    }
  }

  const canRun = tool === 'images' ? images.length > 0 : tool === 'merge' ? pdfs.length >= 2 : pdfs.length === 1;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View>
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
            <Text style={styles.intro}>Only tools that actually modify the output PDF are shown here.</Text>
            <View style={styles.toolGrid}>
              {TOOLS.map(item => (
                <Pressable key={item.id} style={styles.toolCard} onPress={() => openTool(item.id)}>
                  <View style={styles.toolIcon}><Text style={styles.toolIconText}>{item.icon}</Text></View>
                  <Text style={styles.toolTitle}>{item.title}</Text>
                  <Text style={styles.toolDescription}>{item.description}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.workspace}>
            <Text style={styles.workspaceTitle}>{selectedTool?.title}</Text>
            <Text style={styles.workspaceDescription}>{selectedTool?.description}</Text>

            {tool === 'images' ? (
              <>
                <Pressable style={styles.selectButton} onPress={pickImages}>
                  <Text style={styles.selectButtonText}>{images.length ? 'Choose different images' : 'Choose images'}</Text>
                </Pressable>
                {images.length > 0 && <Text style={styles.selectionSummary}>{images.length} image(s) selected</Text>}
              </>
            ) : (
              <>
                <Pressable style={styles.selectButton} onPress={() => pickPdf(tool === 'merge')}>
                  <Text style={styles.selectButtonText}>{tool === 'merge' ? 'Choose PDF files' : 'Choose PDF'}</Text>
                </Pressable>
                {pdfs.map((pdf, index) => (
                  <View key={`${pdf.uri}-${index}`} style={styles.fileRow}>
                    <View style={styles.fileInfo}>
                      <Text style={styles.fileName} numberOfLines={1}>{pdf.name}</Text>
                      <Text style={styles.fileMeta}>
                        {[formatBytes(pdf.size), pdf.pages ? `${pdf.pages} pages` : ''].filter(Boolean).join(' • ')}
                      </Text>
                    </View>
                    {tool === 'merge' && (
                      <Pressable onPress={() => removePdf(index)} hitSlop={10}>
                        <Text style={styles.removeText}>Remove</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </>
            )}

            {(tool === 'extract' || tool === 'reorder' || tool === 'rotate') && (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>{tool === 'reorder' ? 'New page order' : 'Pages'}</Text>
                <TextInput
                  value={pageExpression}
                  onChangeText={setPageExpression}
                  placeholder={tool === 'rotate' ? 'Leave empty for all pages, or 1-3,5' : tool === 'reorder' ? 'Example: 3,1,2,4-8' : 'Example: 1-3,5,8'}
                  placeholderTextColor="#94a3b8"
                  style={styles.input}
                  autoCapitalize="none"
                />
                <Text style={styles.helpText}>Page numbers are 1-based. Ranges are supported.</Text>
              </View>
            )}

            {tool === 'rotate' && (
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
            )}

            {tool === 'watermark' && (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Watermark text</Text>
                <TextInput value={watermark} onChangeText={setWatermark} style={styles.input} maxLength={80} />
                <Text style={styles.helpText}>This first engine uses the built-in PDF Latin font. Unicode font embedding comes separately.</Text>
              </View>
            )}

            {tool === 'numbers' && (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Start numbering at</Text>
                <TextInput value={startAt} onChangeText={setStartAt} keyboardType="number-pad" style={styles.input} />
              </View>
            )}

            <Pressable
              style={[styles.runButton, (!canRun || busy) && styles.disabled]}
              onPress={runTool}
              disabled={!canRun || busy}
            >
              {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.runButtonText}>{actionLabel()}</Text>}
            </Pressable>

            {result && (
              <View style={styles.resultCard}>
                <View style={styles.resultBadge}><Text style={styles.resultBadgeText}>✓</Text></View>
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
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  container: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  eyebrow: { color: '#2563eb', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#0f172a', fontSize: 30, lineHeight: 36, fontWeight: '800', marginTop: 2 },
  headerButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10, backgroundColor: '#e2e8f0' },
  headerButtonText: { color: '#334155', fontWeight: '700' },
  intro: { color: '#64748b', fontSize: 15, lineHeight: 22, marginBottom: 18 },
  toolGrid: { gap: 12 },
  toolCard: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 18, padding: 17 },
  toolIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  toolIconText: { color: '#2563eb', fontSize: 20, fontWeight: '800' },
  toolTitle: { color: '#0f172a', fontSize: 17, fontWeight: '800' },
  toolDescription: { color: '#64748b', fontSize: 14, lineHeight: 20, marginTop: 4 },
  workspace: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 20, padding: 18 },
  workspaceTitle: { color: '#0f172a', fontSize: 24, fontWeight: '800' },
  workspaceDescription: { color: '#64748b', fontSize: 14, lineHeight: 20, marginTop: 5, marginBottom: 18 },
  selectButton: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#93c5fd', backgroundColor: '#eff6ff', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  selectButtonText: { color: '#1d4ed8', fontSize: 15, fontWeight: '800' },
  selectionSummary: { marginTop: 10, color: '#475569', fontWeight: '600' },
  fileRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, padding: 12, backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  fileInfo: { flex: 1, minWidth: 0 },
  fileName: { color: '#0f172a', fontWeight: '700' },
  fileMeta: { color: '#64748b', fontSize: 12, marginTop: 3 },
  removeText: { color: '#dc2626', fontSize: 13, fontWeight: '700', marginLeft: 12 },
  fieldBlock: { marginTop: 18 },
  fieldLabel: { color: '#334155', fontSize: 13, fontWeight: '800', marginBottom: 7 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15 },
  helpText: { color: '#64748b', fontSize: 12, lineHeight: 18, marginTop: 6 },
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  segmentActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  segmentText: { color: '#475569', fontWeight: '800' },
  segmentTextActive: { color: '#ffffff' },
  runButton: { backgroundColor: '#2563eb', borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', minHeight: 52, marginTop: 22 },
  runButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  resultCard: { marginTop: 18, padding: 14, borderRadius: 15, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  resultBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  resultBadgeText: { color: '#ffffff', fontWeight: '900' },
  resultContent: { marginBottom: 12 },
  resultTitle: { color: '#166534', fontWeight: '800', fontSize: 15 },
  resultName: { color: '#14532d', marginTop: 4, fontWeight: '600' },
  resultMeta: { color: '#15803d', fontSize: 12, marginTop: 3 },
  resultActions: { flexDirection: 'row', gap: 10 },
  saveButton: { flex: 1, borderWidth: 1, borderColor: '#16a34a', borderRadius: 11, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { color: '#166534', fontWeight: '800' },
  shareButton: { flex: 1, backgroundColor: '#166534', borderRadius: 11, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  shareButtonText: { color: '#ffffff', fontWeight: '800' },
});
