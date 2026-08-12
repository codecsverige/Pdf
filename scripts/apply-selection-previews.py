from pathlib import Path
import json

p = Path('DashboardApp.tsx')
s = p.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global s
    if old not in s:
        raise SystemExit(f'{label} not found')
    s = s.replace(old, new, 1)

replace_once(
    "type SelectedPdf = { uri: string; name: string; size?: number; pages?: number };",
    "type SelectedPdf = { uri: string; name: string; size?: number; pages?: number; previewUri?: string; previewPending?: boolean };",
    'SelectedPdf type',
)
replace_once(
    "  const [images, setImages] = useState<ImageInput[]>([]);\n",
    "  const [images, setImages] = useState<ImageInput[]>([]);\n  const [selectionPreview, setSelectionPreview] = useState<{ uri: string; title: string } | null>(null);\n",
    'selection preview state',
)
replace_once(
    "  const lastBack = useRef(0);\n",
    "  const lastBack = useRef(0);\n  const selectionGeneration = useRef(0);\n",
    'selection generation ref',
)
replace_once(
    "  const resetWorkspace = useCallback((nextTool: ToolId | null = null) => {\n    setTool(nextTool);",
    "  const resetWorkspace = useCallback((nextTool: ToolId | null = null) => {\n    selectionGeneration.current += 1;\n    setSelectionPreview(null);\n    setTool(nextTool);",
    'workspace reset',
)
replace_once(
    "    const sub = BackHandler.addEventListener('hardwareBackPress', () => {\n      if (viewerOpen) {",
    "    const sub = BackHandler.addEventListener('hardwareBackPress', () => {\n      if (selectionPreview) {\n        setSelectionPreview(null);\n        return true;\n      }\n      if (viewerOpen) {",
    'back handler preview',
)
replace_once(
    "  }, [quickOpen, resetWorkspace, screen, tool, viewerOpen]);",
    "  }, [quickOpen, resetWorkspace, screen, selectionPreview, tool, viewerOpen]);",
    'back handler dependencies',
)

old_pick_pdf = """  async function pickPdf(multiple: boolean) {
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
"""
new_pick_pdf = """  async function pickPdf(multiple: boolean) {
    try {
      const response = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple, copyToCacheDirectory: true });
      if (response.canceled || !response.assets?.length) return;
      const generation = ++selectionGeneration.current;
      const next: SelectedPdf[] = response.assets.map((asset, index) => ({
        uri: asset.uri,
        name: asset.name || 'document.pdf',
        size: asset.size,
        previewPending: index < 12,
      }));
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
      setSelectionPreview(null);
      setSaveNotice(null);

      next.forEach((item, index) => {
        void (async () => {
          let pageCount = item.pages;
          let firstPagePreview: string | undefined;
          if (!pageCount) {
            try { pageCount = await getPdfPageCount(item.uri); } catch { /* protected PDF fallback */ }
          }
          if (index < 12) {
            try { firstPagePreview = (await renderPreviewPage(item.uri, 0)).uri; } catch { /* keep visual fallback */ }
          }
          if (selectionGeneration.current !== generation) return;
          setPdfs(current => current.map(existing => existing.uri === item.uri
            ? { ...existing, pages: pageCount || existing.pages, previewUri: firstPagePreview, previewPending: false }
            : existing));
        })();
      });
    } catch (error) {
      Alert.alert('Cannot open PDF', errorText(error));
    }
  }
"""
replace_once(old_pick_pdf, new_pick_pdf, 'pickPdf')

old_move = """  function movePdf(index: number, direction: -1 | 1) {
    setPdfs(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
"""
new_move = """  function movePdf(index: number, direction: -1 | 1) {
    setPdfs(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removePdf(index: number) {
    setPdfs(current => current.filter((_, i) => i !== index));
    setResult(null);
    setPreviewUri(null);
    setSelectionPreview(null);
  }

  function moveImage(index: number, direction: -1 | 1) {
    setImages(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeImage(index: number) {
    setImages(current => current.filter((_, i) => i !== index));
    setResult(null);
    setSelectionPreview(null);
  }
"""
replace_once(old_move, new_move, 'move helpers')

old_selection_ui = """          {tool === 'images' ? <SelectButton icon=\"image-plus\" label={images.length ? `${images.length} images selected` : 'Choose images'} onPress={pickImages} /> : null}
          {tool === 'camera' ? <SelectButton icon=\"camera-plus-outline\" label={images.length ? `Capture another page · ${images.length} ready` : 'Capture first page'} onPress={capturePage} /> : null}
          {tool !== 'images' && tool !== 'camera' ? <SelectButton icon=\"file-plus-outline\" label={tool === 'merge' ? 'Choose PDF files' : 'Choose PDF'} onPress={() => pickPdf(tool === 'merge')} /> : null}

          {tool === 'camera' && images.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbScroll}>
              {images.slice(0, 8).map((item, index) => <Image key={`${item.uri}-${index}`} source={{ uri: item.uri }} style={styles.thumb} />)}
              <Pressable style={styles.undoCard} onPress={() => setImages(current => current.slice(0, -1))}><Icon name=\"undo\" color=\"#B42318\" /><Text style={styles.undoText}>Undo</Text></Pressable>
            </ScrollView>
          ) : null}

          {pdfs.map((pdf, index) => (
            <View key={`${pdf.uri}-${index}`} style={styles.fileRow}>
              <View style={styles.pdfBadge}><Icon name=\"file-pdf-box\" size={27} color={BRAND} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.fileName} numberOfLines={1}>{pdf.name}</Text>
                <Text style={styles.fileMeta}>{[fmt(pdf.size), pdf.pages ? `${pdf.pages} pages` : ''].filter(Boolean).join(' · ') || 'PDF file'}</Text>
              </View>
              {tool === 'merge' ? (
                <View style={styles.rowActions}>
                  <Mini icon=\"arrow-up\" onPress={() => movePdf(index, -1)} disabled={index === 0} />
                  <Mini icon=\"arrow-down\" onPress={() => movePdf(index, 1)} disabled={index === pdfs.length - 1} />
                  <Mini icon=\"close\" danger onPress={() => setPdfs(current => current.filter((_, i) => i !== index))} />
                </View>
              ) : null}
            </View>
          ))}
"""
new_selection_ui = """          {tool === 'images' ? <SelectButton icon=\"image-plus\" label={images.length ? `${images.length} images selected · choose again` : 'Choose images'} onPress={pickImages} /> : null}
          {tool === 'camera' ? <SelectButton icon=\"camera-plus-outline\" label={images.length ? `Capture another page · ${images.length} ready` : 'Capture first page'} onPress={capturePage} /> : null}
          {tool !== 'images' && tool !== 'camera' ? <SelectButton icon=\"file-plus-outline\" label={pdfs.length ? (tool === 'merge' ? `${pdfs.length} PDFs selected · choose again` : 'Change selected PDF') : (tool === 'merge' ? 'Choose PDF files' : 'Choose PDF')} onPress={() => pickPdf(tool === 'merge')} /> : null}

          {images.length ? (
            <ImageSelectionPreview
              images={images}
              onMove={moveImage}
              onRemove={removeImage}
              onOpen={(item, index) => setSelectionPreview({ uri: item.uri, title: `Page ${index + 1}` })}
            />
          ) : null}

          {pdfs.length ? (
            <PdfSelectionPreview
              pdfs={pdfs}
              multiple={tool === 'merge'}
              onMove={movePdf}
              onRemove={removePdf}
              onOpen={pdf => pdf.previewUri && setSelectionPreview({ uri: pdf.previewUri, title: pdf.name })}
            />
          ) : null}
"""
replace_once(old_selection_ui, new_selection_ui, 'selection UI')

old_modal = "        <ViewerModal open={viewerOpen} output={viewerSource} page={viewerPage} uri={viewerUri} busy={viewerBusy} onClose={() => setViewerOpen(false)} onPage={p => viewerSource && renderViewerPage(viewerSource, p)} onDownload={() => viewerSource && downloadOutput(viewerSource, false)} />\n      </SafeAreaView>"
new_modal = "        <SelectionPreviewModal preview={selectionPreview} onClose={() => setSelectionPreview(null)} />\n        <ViewerModal open={viewerOpen} output={viewerSource} page={viewerPage} uri={viewerUri} busy={viewerBusy} onClose={() => setViewerOpen(false)} onPage={p => viewerSource && renderViewerPage(viewerSource, p)} onDownload={() => viewerSource && downloadOutput(viewerSource, false)} />\n      </SafeAreaView>"
replace_once(old_modal, new_modal, 'selection modal mount')

components = r'''function PdfSelectionPreview({ pdfs, multiple, onMove, onRemove, onOpen }: { pdfs: SelectedPdf[]; multiple: boolean; onMove: (index: number, direction: -1 | 1) => void; onRemove: (index: number) => void; onOpen: (pdf: SelectedPdf) => void }) {
  return (
    <View style={styles.selectionPanel}>
      <View style={styles.selectionHeader}>
        <View style={styles.selectionHeaderIcon}><Icon name="file-eye-outline" size={18} color={BRAND} /></View>
        <View style={{ flex: 1 }}><Text style={styles.selectionTitle}>{multiple ? 'Selected documents' : 'Selected document'}</Text><Text style={styles.selectionSub}>{multiple ? 'Preview the first page and confirm the order' : 'Tap the page to view it larger'}</Text></View>
        <View style={styles.selectionCount}><Text style={styles.selectionCountText}>{pdfs.length}</Text></View>
      </View>
      {multiple ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pdfPreviewStrip}>
          {pdfs.map((pdf, index) => <PdfPreviewCard key={`${pdf.uri}-${index}`} pdf={pdf} index={index} total={pdfs.length} onMove={onMove} onRemove={onRemove} onOpen={onOpen} />)}
        </ScrollView>
      ) : (
        <View style={styles.singlePdfPreviewWrap}><PdfPreviewCard pdf={pdfs[0]} index={0} total={1} large onMove={onMove} onRemove={onRemove} onOpen={onOpen} /></View>
      )}
    </View>
  );
}

function PdfPreviewCard({ pdf, index, total, large, onMove, onRemove, onOpen }: { pdf: SelectedPdf; index: number; total: number; large?: boolean; onMove: (index: number, direction: -1 | 1) => void; onRemove: (index: number) => void; onOpen: (pdf: SelectedPdf) => void }) {
  const canOpen = Boolean(pdf.previewUri);
  return (
    <View style={[styles.pdfPreviewCard, large && styles.pdfPreviewCardLarge]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${pdf.name}`} disabled={!canOpen} onPress={() => onOpen(pdf)} style={[styles.pdfPreviewPaper, large && styles.pdfPreviewPaperLarge]}>
        {pdf.previewUri ? <Image source={{ uri: pdf.previewUri }} style={styles.pdfPreviewImage} resizeMode="contain" /> : pdf.previewPending ? <ActivityIndicator color={BRAND} /> : <View style={styles.pdfPreviewFallback}><Icon name="file-pdf-box" size={large ? 46 : 36} color={BRAND} /><Text style={styles.pdfPreviewFallbackText}>PDF</Text></View>}
        <View style={styles.previewNumber}><Text style={styles.previewNumberText}>{index + 1}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${pdf.name}`} hitSlop={8} style={styles.previewRemove} onPress={() => onRemove(index)}><Icon name="close" size={15} color="#344054" /></Pressable>
        {canOpen ? <View style={styles.tapPreviewBadge}><Icon name="arrow-expand" size={11} color="#FFFFFF" /><Text style={styles.tapPreviewText}>Preview</Text></View> : null}
      </Pressable>
      <Text style={[styles.previewFileName, large && styles.previewFileNameLarge]} numberOfLines={1}>{pdf.name}</Text>
      <Text style={styles.previewFileMeta}>{[fmt(pdf.size), pdf.pages ? `${pdf.pages} pages` : null].filter(Boolean).join(' · ') || 'PDF document'}</Text>
      {total > 1 ? <View style={styles.previewControls}><Mini icon="arrow-left" onPress={() => onMove(index, -1)} disabled={index === 0} /><Mini icon="arrow-right" onPress={() => onMove(index, 1)} disabled={index === total - 1} /></View> : null}
    </View>
  );
}

function ImageSelectionPreview({ images, onMove, onRemove, onOpen }: { images: ImageInput[]; onMove: (index: number, direction: -1 | 1) => void; onRemove: (index: number) => void; onOpen: (image: ImageInput, index: number) => void }) {
  return (
    <View style={styles.selectionPanel}>
      <View style={styles.selectionHeader}>
        <View style={[styles.selectionHeaderIcon, { backgroundColor: '#EEF6FF' }]}><Icon name="image-multiple-outline" size={18} color="#2563EB" /></View>
        <View style={{ flex: 1 }}><Text style={styles.selectionTitle}>Selected pages</Text><Text style={styles.selectionSub}>Check the images and arrange them before creating the PDF</Text></View>
        <View style={[styles.selectionCount, { backgroundColor: '#E8F1FF' }]}><Text style={[styles.selectionCountText, { color: '#2563EB' }]}>{images.length}</Text></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imagePreviewStrip}>
        {images.map((item, index) => (
          <View key={`${item.uri}-${index}`} style={styles.imagePreviewCard}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Preview page ${index + 1}`} onPress={() => onOpen(item, index)} style={styles.imagePreviewFrame}>
              <Image source={{ uri: item.uri }} style={styles.imagePreviewImage} resizeMode="contain" />
              <View style={[styles.previewNumber, { backgroundColor: '#2563EB' }]}><Text style={styles.previewNumberText}>{index + 1}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove page ${index + 1}`} hitSlop={8} style={styles.previewRemove} onPress={() => onRemove(index)}><Icon name="close" size={15} color="#344054" /></Pressable>
              <View style={styles.tapPreviewBadge}><Icon name="arrow-expand" size={11} color="#FFFFFF" /><Text style={styles.tapPreviewText}>Preview</Text></View>
            </Pressable>
            <View style={styles.previewControls}><Mini icon="arrow-left" onPress={() => onMove(index, -1)} disabled={index === 0} /><Mini icon="arrow-right" onPress={() => onMove(index, 1)} disabled={index === images.length - 1} /></View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function SelectionPreviewModal({ preview, onClose }: { preview: { uri: string; title: string } | null; onClose: () => void }) {
  return (
    <Modal visible={Boolean(preview)} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.selectionModalSafe}>
        <StatusBar style="dark" />
        <View style={styles.selectionModalHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close preview" style={styles.backButton} onPress={onClose}><Icon name="arrow-left" color={INK} /></Pressable>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.selectionModalTitle} numberOfLines={1}>{preview?.title || 'Preview'}</Text><Text style={styles.selectionModalSub}>Selected file preview</Text></View>
          <View style={styles.selectionModalBadge}><Icon name="eye-outline" size={16} color="#2563EB" /><Text style={styles.selectionModalBadgeText}>Preview</Text></View>
        </View>
        <View style={styles.selectionModalCanvas}>{preview?.uri ? <Image source={{ uri: preview.uri }} style={styles.selectionModalImage} resizeMode="contain" /> : null}</View>
      </SafeAreaView>
    </Modal>
  );
}

'''
replace_once(
    "function ToolHeader({ tool, onBack }: { tool: Tool; onBack: () => void }) {",
    components + "function ToolHeader({ tool, onBack }: { tool: Tool; onBack: () => void }) {",
    'preview components marker',
)

preview_styles = r'''  selectionPanel: { marginTop: 11, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', padding: 12, shadowColor: '#101828', shadowOpacity: 0.035, shadowRadius: 12, elevation: 1 },
  selectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 11 },
  selectionHeaderIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#FFF0F1', alignItems: 'center', justifyContent: 'center' },
  selectionTitle: { color: INK, fontSize: 12.5, fontWeight: '900' },
  selectionSub: { color: '#98A2B3', fontSize: 9.2, marginTop: 2 },
  selectionCount: { minWidth: 30, height: 30, borderRadius: 10, backgroundColor: '#FFF0F1', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  selectionCountText: { color: BRAND, fontSize: 10.5, fontWeight: '900' },
  pdfPreviewStrip: { gap: 11, paddingRight: 3, paddingBottom: 2 },
  singlePdfPreviewWrap: { alignItems: 'center', paddingTop: 2, paddingBottom: 1 },
  pdfPreviewCard: { width: 132 },
  pdfPreviewCardLarge: { width: 196 },
  pdfPreviewPaper: { width: 132, aspectRatio: 0.707, borderRadius: 14, borderWidth: 1, borderColor: '#DDE1E8', backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: '#101828', shadowOpacity: 0.08, shadowRadius: 7, elevation: 2 },
  pdfPreviewPaperLarge: { width: 196, borderRadius: 17 },
  pdfPreviewImage: { width: '100%', height: '100%', backgroundColor: '#FFFFFF' },
  pdfPreviewFallback: { alignItems: 'center', justifyContent: 'center', gap: 5 },
  pdfPreviewFallbackText: { color: '#98A2B3', fontSize: 9.5, fontWeight: '900' },
  previewNumber: { position: 'absolute', left: 7, top: 7, minWidth: 24, height: 24, borderRadius: 8, paddingHorizontal: 6, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 4, elevation: 2 },
  previewNumberText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  previewRemove: { position: 'absolute', right: 7, top: 7, width: 27, height: 27, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#EAECF0', elevation: 2 },
  tapPreviewBadge: { position: 'absolute', right: 7, bottom: 7, minHeight: 25, borderRadius: 9, backgroundColor: 'rgba(17,24,39,0.82)', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7 },
  tapPreviewText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' },
  previewFileName: { color: INK, fontSize: 10.6, fontWeight: '900', marginTop: 7 },
  previewFileNameLarge: { fontSize: 11.5, textAlign: 'center' },
  previewFileMeta: { color: '#98A2B3', fontSize: 8.8, marginTop: 2, textAlign: 'center' },
  previewControls: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 7 },
  imagePreviewStrip: { gap: 10, paddingRight: 3, paddingBottom: 2 },
  imagePreviewCard: { width: 106 },
  imagePreviewFrame: { width: 106, height: 142, borderRadius: 14, borderWidth: 1, borderColor: '#DDE1E8', backgroundColor: '#F2F4F7', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: '#101828', shadowOpacity: 0.07, shadowRadius: 7, elevation: 2 },
  imagePreviewImage: { width: '100%', height: '100%', backgroundColor: '#FFFFFF' },
  selectionModalSafe: { flex: 1, backgroundColor: '#F4F6FA' },
  selectionModalHeader: { minHeight: 66, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: LINE, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13 },
  selectionModalTitle: { color: INK, fontSize: 14.5, fontWeight: '900' },
  selectionModalSub: { color: '#98A2B3', fontSize: 8.8, marginTop: 1 },
  selectionModalBadge: { height: 34, borderRadius: 11, backgroundColor: '#EEF6FF', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9 },
  selectionModalBadgeText: { color: '#2563EB', fontSize: 8.8, fontWeight: '900' },
  selectionModalCanvas: { flex: 1, margin: 12, borderRadius: 20, backgroundColor: '#DDE1E8', borderWidth: 1, borderColor: '#D0D5DD', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  selectionModalImage: { width: '100%', height: '100%' },
'''
replace_once(
    "  thumbScroll: { marginTop: 10 },",
    preview_styles + "  thumbScroll: { marginTop: 10 },",
    'preview style marker',
)

p.write_text(s)

app_path = Path('app.json')
app = json.loads(app_path.read_text())
app['expo']['version'] = '1.4.2'
app['expo']['android']['versionCode'] = 7
app_path.write_text(json.dumps(app, indent=2) + '\n')

build_path = Path('.github/workflows/android-build.yml')
build = build_path.read_text().replace('1.4.1', '1.4.2')
build = build.replace("versionCode='6'", "versionCode='7'").replace('versionCode=6', 'versionCode=7')
build_path.write_text(build)

smoke_path = Path('scripts/smoke-emulator.sh')
smoke = smoke_path.read_text().replace('1.4.1', '1.4.2')
smoke = smoke.replace('test "$INSTALLED_CODE" = "6"', 'test "$INSTALLED_CODE" = "7"')
smoke_path.write_text(smoke)
