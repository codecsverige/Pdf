import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import React, { useState } from 'react';
import { StyleSheet, Text, View, Pressable, FlatList, Image, Alert } from 'react-native';

export default function App() {
  const [images, setImages] = useState<string[]>([]);
  const [isBuilding, setIsBuilding] = useState<boolean>(false);

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

  async function buildPdf() {
    if (images.length === 0) {
      Alert.alert('لا صور', 'اختر صورًا أولاً.');
      return;
    }
    setIsBuilding(true);
    try {
      const pdfDoc = await PDFDocument.create();
      for (const uri of images) {
        const file = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const imgBytes = Uint8Array.from(atob(file), c => c.charCodeAt(0));
        let embedded;
        if (uri.toLowerCase().endsWith('.png')) embedded = await pdfDoc.embedPng(imgBytes);
        else embedded = await pdfDoc.embedJpg(imgBytes);
        const { width, height } = embedded.size();
        const page = pdfDoc.addPage([width, height]);
        page.drawImage(embedded, { x: 0, y: 0, width, height });
      }
      const pdfBytes = await pdfDoc.save();
      const fileUri = FileSystem.cacheDirectory + `scan_${Date.now()}.pdf`;
      await FileSystem.writeAsStringAsync(fileUri, Buffer.from(pdfBytes).toString('base64'), { encoding: FileSystem.EncodingType.Base64 });

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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SwiftPDF Scanner</Text>
      <View style={styles.buttonsRow}>
        <Pressable style={styles.btn} onPress={pickImages}>
          <Text style={styles.btnText}>اختر صور</Text>
        </Pressable>
        <Pressable style={[styles.btn, isBuilding && styles.btnDisabled]} onPress={buildPdf} disabled={isBuilding}>
          <Text style={styles.btnText}>{isBuilding ? 'جارٍ...' : 'إنشاء PDF'}</Text>
        </Pressable>
        <Pressable style={styles.btnOutline} onPress={clearImages}>
          <Text style={styles.btnText}>مسح</Text>
        </Pressable>
      </View>
      <FlatList
        data={images}
        keyExtractor={(u, i) => u + i}
        renderItem={({ item }) => <Image source={{ uri: item }} style={styles.thumb} />}
        horizontal
        contentContainerStyle={{ paddingVertical: 12 }}
        showsHorizontalScrollIndicator={false}
      />
      <StatusBar style="auto" />
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
  thumb: {
    width: 100,
    height: 140,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: '#eee',
  },
});
