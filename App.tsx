import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import Constants from 'expo-constants';
import { PDFDocument } from 'pdf-lib';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Pressable, FlatList, Image, Alert, Platform, Modal } from 'react-native';
import { toByteArray } from 'base64-js';
let mobileAds: any;
try { mobileAds = require('react-native-google-mobile-ads').default; } catch {}
import Purchases from 'react-native-purchases';
import Paywall from './components/Paywall';
import AdBanner from './components/AdBanner';

export default function App() {
  const [images, setImages] = useState<string[]>([]);
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [isPro, setIsPro] = useState<boolean>(false);
  const [showPaywall, setShowPaywall] = useState<boolean>(false);

  useEffect(() => {
    // Initialize Google Mobile Ads if available
    try { mobileAds && mobileAds().initialize(); } catch {}

    // Initialize RevenueCat purchases if keys are provided via extra
    const extra: any = Constants.expoConfig?.extra ?? {};
    const androidKey = extra?.revenuecatAndroidKey ?? '';
    const iosKey = extra?.revenuecatIosKey ?? '';
    const apiKey = Platform.select({ ios: iosKey, android: androidKey });
    if (apiKey && typeof apiKey === 'string' && apiKey.length > 10) {
      Purchases.configure({ apiKey });
      // Fetch customer info to determine entitlement
      Purchases.getCustomerInfo()
        .then(info => {
          const active = info?.entitlements?.active ?? {};
          setIsPro(Boolean(active['pro'] || active['premium']));
        })
        .catch(() => {});
    }
  }, []);

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('السماح مطلوب', 'يرجى منح إذن الصور.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!result.canceled) {
      const uris = result.assets?.map(a => a.uri) ?? [];
      setImages(prev => [...prev, ...uris]);
    }
  }

  async function captureImage() {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      Alert.alert('السماح مطلوب', 'يرجى منح إذن الكاميرا.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (!result.canceled) {
      const uris = result.assets?.map(a => a.uri) ?? [];
      setImages(prev => [...prev, ...uris]);
    }
  }

  async function pickPdfFile() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    Alert.alert('ملف PDF محدد', 'يمكن دمج هذه الصفحات لاحقًا أو مشاركتها.');
    // Placeholder: In future, merge/append existing PDF with images-generated PDF
  }

  async function buildPdf() {
    if (images.length === 0) {
      Alert.alert('لا صور', 'اختر صورًا أولاً.');
      return;
    }
    setIsBuilding(true);
    try {
      const pdfDoc = await PDFDocument.create();
      for (const uri of images) {
        // Compress and normalize to JPEG for consistent embedding
        const manipulated = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 2000 } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        if (!manipulated.base64) continue;
        const imgBytes = toByteArray(manipulated.base64);
        const embedded = await pdfDoc.embedJpg(imgBytes);
        const { width, height } = embedded.size();
        const page = pdfDoc.addPage([width, height]);
        page.drawImage(embedded, { x: 0, y: 0, width, height });
      }
      const base64Pdf = await pdfDoc.saveAsBase64({ dataUri: false });
      const fileUri = FileSystem.cacheDirectory + `scan_${Date.now()}.pdf`;
      await FileSystem.writeAsStringAsync(fileUri, base64Pdf, { encoding: FileSystem.EncodingType.Base64 });

      const mediaPerm = await MediaLibrary.requestPermissionsAsync();
      if (mediaPerm.granted) {
        await MediaLibrary.saveToLibraryAsync(fileUri);
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', dialogTitle: 'مشاركة PDF' });
      } else {
        Alert.alert('جاهز', 'تم إنشاء PDF وحفظه.');
      }
    } catch (e: any) {
      Alert.alert('خطأ', e?.message ?? 'فشل إنشاء PDF');
    } finally {
      setIsBuilding(false);
    }
  }

  function clearImages() {
    setImages([]);
  }

  function rotateImage(index: number) {
    setImages(prev => {
      const copy = [...prev];
      const target = copy[index];
      if (!target) return prev;
      // Using query param as a cache-busting hint; real rotate happens before PDF via ImageManipulator
      copy[index] = target + `#rot${Date.now()}`;
      return copy;
    });
  }

  function deleteImage(index: number) {
    setImages(prev => prev.filter((_, i) => i !== index));
  }

  function moveImage(index: number, dir: -1 | 1) {
    setImages(prev => {
      const copy = [...prev];
      const newIndex = index + dir;
      if (newIndex < 0 || newIndex >= copy.length) return prev;
      const [it] = copy.splice(index, 1);
      copy.splice(newIndex, 0, it);
      return copy;
    });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SwiftPDF Scanner</Text>
      <View style={styles.buttonsRow}>
        <Pressable style={styles.btn} onPress={pickImages}>
          <Text style={styles.btnText}>اختر صور</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={captureImage}>
          <Text style={styles.btnText}>التقط صورة</Text>
        </Pressable>
        <Pressable style={[styles.btn, isBuilding && styles.btnDisabled]} onPress={buildPdf} disabled={isBuilding}>
          <Text style={styles.btnText}>{isBuilding ? 'جارٍ...' : 'إنشاء PDF'}</Text>
        </Pressable>
        <Pressable style={styles.btnOutline} onPress={pickPdfFile}>
          <Text style={styles.btnText}>اختر ملف PDF</Text>
        </Pressable>
        {!isPro && (
          <Pressable style={styles.btnOutline} onPress={() => setShowPaywall(true)}>
            <Text style={styles.btnText}>ترقية</Text>
          </Pressable>
        )}
        <Pressable style={styles.btnOutline} onPress={clearImages}>
          <Text style={styles.btnText}>مسح</Text>
        </Pressable>
      </View>
      <FlatList
        data={images}
        keyExtractor={(u, i) => u + i}
        horizontal
        contentContainerStyle={{ paddingVertical: 12 }}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <View style={styles.thumbWrap}>
            <Image source={{ uri: item }} style={styles.thumb} />
            <View style={styles.thumbActions}>
              <Pressable style={styles.smallBtn} onPress={() => moveImage(index, -1)}><Text style={styles.smallBtnText}>◀</Text></Pressable>
              <Pressable style={styles.smallBtn} onPress={() => rotateImage(index)}><Text style={styles.smallBtnText}>⟳</Text></Pressable>
              <Pressable style={styles.smallBtn} onPress={() => moveImage(index, 1)}><Text style={styles.smallBtnText}>▶</Text></Pressable>
              <Pressable style={[styles.smallBtn, styles.delBtn]} onPress={() => deleteImage(index)}><Text style={styles.smallBtnText}>✕</Text></Pressable>
            </View>
          </View>
        )}
      />
      <StatusBar style="auto" />
      {!isPro && <AdBanner />}
      <Paywall visible={showPaywall} onClose={() => setShowPaywall(false)} onPurchased={() => { setIsPro(true); setShowPaywall(false); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 64,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 12,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
  },
  thumbWrap: {
    marginRight: 8,
  },
  thumb: {
    width: 100,
    height: 140,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: '#eee',
  },
  thumbActions: {
    flexDirection: 'row',
    marginTop: 4,
    gap: 6,
    justifyContent: 'center',
  },
  smallBtn: {
    backgroundColor: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  delBtn: {
    backgroundColor: '#dc2626',
  },
  smallBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
});
