from pathlib import Path
import json
import re

p = Path('DashboardApp.tsx')
s = p.read_text()

# Imports
s = s.replace("import SignaturePad from './components/SignaturePad';\n", "import SignaturePad from './components/SignaturePad';\nimport SignaturePlacementEditor from './components/SignaturePlacementEditor';\nimport type { SignaturePlacement } from './components/SignaturePlacementEditor';\n")
s = s.replace("  pdfToImagesNative,\n  protectPdfNative,", "  pdfToImagesNative,\n  renderAllPreviewPages,\n  protectPdfNative,")

# Signature state
s = s.replace(
    "  const [signaturePage, setSignaturePage] = useState('1');\n",
    "  const [signaturePage, setSignaturePage] = useState('1');\n  const [signaturePlacement, setSignaturePlacement] = useState<SignaturePlacement>({ x: 0.60, y: 0.76, width: 0.32 });\n  const [signatureEditorUri, setSignatureEditorUri] = useState<string | null>(null);\n  const [signatureEditorBusy, setSignatureEditorBusy] = useState(false);\n"
)

# Reset signature state
s = s.replace(
    "    setSignaturePage('1');\n    setPreviewPage(1);",
    "    setSignaturePage('1');\n    setSignaturePlacement({ x: 0.60, y: 0.76, width: 0.32 });\n    setSignatureEditorUri(null);\n    setSignatureEditorBusy(false);\n    setPreviewPage(1);"
)

# Render selected signature page automatically
anchor = "  const onSignature = useCallback((path: string, width: number, height: number) => {\n    setSignaturePath(path);\n    setSignatureSize({ width, height });\n  }, []);\n"
effect = anchor + "\n  useEffect(() => {\n    if (tool !== 'sign' || !selectedPdf) {\n      setSignatureEditorUri(null);\n      setSignatureEditorBusy(false);\n      return;\n    }\n    const page = Number(signaturePage);\n    if (!Number.isInteger(page) || page < 1 || (selectedPdf.pages && page > selectedPdf.pages)) {\n      setSignatureEditorUri(null);\n      setSignatureEditorBusy(false);\n      return;\n    }\n    let active = true;\n    setSignatureEditorBusy(true);\n    setSignatureEditorUri(null);\n    void renderPreviewPage(selectedPdf.uri, page - 1)\n      .then(renderedPage => { if (active) setSignatureEditorUri(renderedPage.uri); })\n      .catch(() => { if (active) setSignatureEditorUri(null); })\n      .finally(() => { if (active) setSignatureEditorBusy(false); });\n    return () => { active = false; };\n  }, [selectedPdf?.pages, selectedPdf?.uri, signaturePage, tool]);\n"
if anchor not in s:
    raise SystemExit('signature callback anchor not found')
s = s.replace(anchor, effect)

# Reset editor when choosing a PDF
s = s.replace(
    "      setSelectionPreview(null);\n      setSaveNotice(null);",
    "      setSelectionPreview(null);\n      setSignaturePlacement({ x: 0.60, y: 0.76, width: 0.32 });\n      setSignatureEditorUri(null);\n      setSaveNotice(null);",
    1
)

# Save chosen placement in actual PDF
old_sign = "          output = await signPdf(selectedPdf.uri, page, signaturePath, signatureSize.width, signatureSize.height);"
new_sign = "          output = await signPdf(selectedPdf.uri, page, signaturePath, signatureSize.width, signatureSize.height, signaturePlacement);"
if old_sign not in s:
    raise SystemExit('signPdf call not found')
s = s.replace(old_sign, new_sign)

# Sign button should not look usable until the workflow is actually valid
old_canrun = "    if (tool === 'images' || tool === 'camera') return images.length > 0;\n    if (tool === 'merge') return pdfs.length >= 2;\n    return pdfs.length === 1;"
new_canrun = "    if (tool === 'images' || tool === 'camera') return images.length > 0;\n    if (tool === 'merge') return pdfs.length >= 2;\n    if (tool === 'sign') {\n      const page = Number(signaturePage);\n      const validPage = Number.isInteger(page) && page >= 1 && (!selectedPdf?.pages || page <= selectedPdf.pages);\n      return pdfs.length === 1 && Boolean(signaturePath) && validPage && Boolean(signatureEditorUri);\n    }\n    return pdfs.length === 1;"
if old_canrun not in s:
    raise SystemExit('canRun block not found')
s = s.replace(old_canrun, new_canrun)
s = s.replace("  }, [images.length, pdfs.length, tool]);", "  }, [images.length, pdfs.length, selectedPdf?.pages, signatureEditorUri, signaturePage, signaturePath, tool]);")

# Compact selected PDF card specifically in Sign because the real placement editor below is the important page view.
s = s.replace(
    "              multiple={tool === 'merge'}\n              onMove={movePdf}",
    "              multiple={tool === 'merge'}\n              compact={tool === 'sign'}\n              onMove={movePdf}"
)

# Replace old signature UI
old_ui = '''          {tool === 'sign' ? (\n            <OptionCard title="Signature" icon="draw-pen">\n              <TextInput value={signaturePage} onChangeText={setSignaturePage} style={styles.input} placeholder="Page 1" placeholderTextColor="#98A2B3" keyboardType="number-pad" />\n              <View style={{ marginTop: 12 }}><SignaturePad onChange={onSignature} /></View>\n            </OptionCard>\n          ) : null}\n'''
new_ui = '''          {tool === 'sign' ? (\n            <>\n              <OptionCard title="Signature" icon="draw-pen">\n                <View style={styles.signPageRow}>\n                  <View style={{ flex: 1 }}><Text style={styles.signPageLabel}>Place on page</Text><Text style={styles.signPageHelp}>Choose the page first, then draw below.</Text></View>\n                  <Mini icon="minus" disabled={Number(signaturePage) <= 1} onPress={() => setSignaturePage(String(Math.max(1, (Number(signaturePage) || 1) - 1)))} />\n                  <TextInput value={signaturePage} onChangeText={setSignaturePage} style={styles.signPageInput} keyboardType="number-pad" selectTextOnFocus />\n                  <Mini icon="plus" disabled={Boolean(selectedPdf?.pages && Number(signaturePage) >= selectedPdf.pages)} onPress={() => setSignaturePage(String(selectedPdf?.pages ? Math.min(selectedPdf.pages, (Number(signaturePage) || 0) + 1) : (Number(signaturePage) || 0) + 1))} />\n                  <Text style={styles.signPageTotal}>/ {selectedPdf?.pages || '?'}</Text>\n                </View>\n                <View style={{ marginTop: 11 }}><SignaturePad onChange={onSignature} /></View>\n                <Hint text="Only the strokes are saved. Empty space around your drawing is trimmed automatically." />\n              </OptionCard>\n              {selectedPdf ? <SignaturePlacementEditor pageUri={signatureEditorUri} busy={signatureEditorBusy} signaturePath={signaturePath} sourceWidth={signatureSize.width} sourceHeight={signatureSize.height} placement={signaturePlacement} onChange={setSignaturePlacement} /> : null}\n            </>\n          ) : null}\n'''
if old_ui not in s:
    raise SystemExit('old sign UI not found')
s = s.replace(old_ui, new_ui)

# Compact option on single PDF preview
old_sig = "function PdfSelectionPreview({ pdfs, multiple, onMove, onRemove, onOpen }: { pdfs: SelectedPdf[]; multiple: boolean; onMove: (index: number, direction: -1 | 1) => void; onRemove: (index: number) => void; onOpen: (pdf: SelectedPdf) => void }) {"
new_sig = "function PdfSelectionPreview({ pdfs, multiple, compact = false, onMove, onRemove, onOpen }: { pdfs: SelectedPdf[]; multiple: boolean; compact?: boolean; onMove: (index: number, direction: -1 | 1) => void; onRemove: (index: number) => void; onOpen: (pdf: SelectedPdf) => void }) {"
if old_sig not in s:
    raise SystemExit('PdfSelectionPreview signature not found')
s = s.replace(old_sig, new_sig)
s = s.replace("<View style={styles.singlePdfPreviewWrap}><PdfPreviewCard pdf={pdfs[0]} index={0} total={1} large onMove={onMove}", "<View style={styles.singlePdfPreviewWrap}><PdfPreviewCard pdf={pdfs[0]} index={0} total={1} large={!compact} onMove={onMove}")

# Continuous scroll viewer instead of Previous/Next pages.
viewer_pattern = re.compile(r"function ViewerModal\(\{ open, output, page, uri, busy, onClose, onPage, onDownload \}: \{.*?\n\}\n\nconst styles", re.S)
viewer_replacement = '''function ViewerModal({ open, output, onClose, onDownload }: { open: boolean; output: PdfOutput | null; page: number; uri: string | null; busy: boolean; onClose: () => void; onPage: (page: number) => void; onDownload: () => void }) {\n  const [pages, setPages] = useState<RenderedImage[]>([]);\n  const [loading, setLoading] = useState(false);\n  const [viewerError, setViewerError] = useState('');\n\n  useEffect(() => {\n    if (!open || !output) { setPages([]); setViewerError(''); return; }\n    let active = true;\n    setLoading(true);\n    setPages([]);\n    setViewerError('');\n    void renderAllPreviewPages(output.uri)\n      .then(items => { if (active) setPages(items); })\n      .catch(error => { if (active) setViewerError(errorText(error)); })\n      .finally(() => { if (active) setLoading(false); });\n    return () => { active = false; };\n  }, [open, output?.uri]);\n\n  return (\n    <Modal visible={open} animationType="slide" onRequestClose={onClose}>\n      <SafeAreaView style={styles.viewerSafe}>\n        <StatusBar style="dark" />\n        <View style={styles.viewerHeader}>\n          <Pressable style={styles.backButton} onPress={onClose}><Icon name="arrow-left" color={INK} /></Pressable>\n          <View style={{ flex: 1 }}><Text style={styles.viewerTitle}>PDF preview</Text><Text style={styles.viewerSub}>{output?.pageCount || pages.length || 0} page(s) · continuous scroll</Text></View>\n          <Pressable style={styles.viewerDownload} onPress={onDownload}><Icon name="download" color="#FFFFFF" /></Pressable>\n        </View>\n        {loading ? <View style={styles.viewerLoading}><ActivityIndicator size="large" color={BRAND} /><Text style={styles.viewerLoadingText}>Preparing all pages…</Text></View> : null}\n        {!loading && viewerError ? <View style={styles.viewerLoading}><Icon name="alert-circle-outline" size={34} color="#B42318" /><Text style={styles.viewerErrorText}>{viewerError}</Text></View> : null}\n        {!loading && !viewerError ? (\n          <ScrollView style={styles.viewerScroll} contentContainerStyle={styles.viewerScrollContent} showsVerticalScrollIndicator>\n            {pages.map((item, index) => <View key={`${item.uri}-${index}`} style={styles.viewerPageCard}><View style={styles.viewerPageLabel}><Text style={styles.viewerPageLabelText}>Page {index + 1}</Text></View><Image source={{ uri: item.uri }} style={styles.viewerContinuousImage} resizeMode="contain" /></View>)}\n          </ScrollView>\n        ) : null}\n      </SafeAreaView>\n    </Modal>\n  );\n}\n\nconst styles'''
if not viewer_pattern.search(s):
    raise SystemExit('ViewerModal block not found')
s = viewer_pattern.sub(viewer_replacement, s, count=1)

# Add styles used by the revised sign editor and continuous viewer.
style_anchor = "  pageNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },\n"
style_insert = "  signPageRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },\n  signPageLabel: { color: '#344054', fontSize: 10.5, fontWeight: '900' },\n  signPageHelp: { color: '#98A2B3', fontSize: 8.8, marginTop: 2 },\n  signPageInput: { width: 48, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', color: '#111827', fontWeight: '900', textAlign: 'center', paddingHorizontal: 4 },\n  signPageTotal: { color: '#667085', minWidth: 28, fontSize: 9.5, fontWeight: '800' },\n" + style_anchor
if style_anchor not in s:
    raise SystemExit('pageNav style anchor not found')
s = s.replace(style_anchor, style_insert)

viewer_style_anchor = "  viewerSafe: { flex: 1, backgroundColor: '#F3F4F6' },\n"
viewer_styles = viewer_style_anchor + "  viewerScroll: { flex: 1, backgroundColor: '#DDE1E8' },\n  viewerScrollContent: { padding: 10, paddingBottom: 26, gap: 10 },\n  viewerPageCard: { borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD', overflow: 'hidden', shadowColor: '#101828', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },\n  viewerPageLabel: { height: 27, paddingHorizontal: 10, justifyContent: 'center', backgroundColor: '#F8F9FB', borderBottomWidth: 1, borderBottomColor: '#EAECF0' },\n  viewerPageLabelText: { color: '#667085', fontSize: 9, fontWeight: '900' },\n  viewerContinuousImage: { width: '100%', aspectRatio: 0.707, backgroundColor: '#FFFFFF' },\n  viewerLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 24 },\n  viewerLoadingText: { color: '#667085', fontSize: 11, fontWeight: '800' },\n  viewerErrorText: { color: '#B42318', fontSize: 10.5, lineHeight: 16, textAlign: 'center' },\n"
if viewer_style_anchor not in s:
    raise SystemExit('viewer style anchor not found')
s = s.replace(viewer_style_anchor, viewer_styles)

p.write_text(s)

# Bump app version.
app_path = Path('app.json')
app = json.loads(app_path.read_text())
app['expo']['version'] = '1.5.0'
app['expo']['android']['versionCode'] = 8
app_path.write_text(json.dumps(app, indent=2) + '\n')

# Smoke test follows the new release identity.
smoke_path = Path('scripts/smoke-emulator.sh')
smoke = smoke_path.read_text().replace('1.4.2', '1.5.0')
smoke = smoke.replace('test "$INSTALLED_CODE" = "7"', 'test "$INSTALLED_CODE" = "8"')
smoke_path.write_text(smoke)
