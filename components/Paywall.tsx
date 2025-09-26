import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
let Purchases: any;
try { Purchases = require('react-native-purchases').default; } catch {}

type Props = {
  visible: boolean;
  onClose: () => void;
  onPurchased: () => void;
};

export default function Paywall({ visible, onClose, onPurchased }: Props) {
  const [loading, setLoading] = useState(false);
  const [packageId, setPackageId] = useState<string | null>(null);

  useEffect(() => {
    async function loadOfferings() {
      try {
        const offerings = await Purchases.getOfferings();
        const current = offerings.current;
        const first = current?.availablePackages?.[0];
        setPackageId(first?.identifier ?? null);
      } catch (e) {
        // ignore
      }
    }
    if (visible) loadOfferings();
  }, [visible]);

  async function purchase() {
    if (!packageId) {
      Alert.alert('غير متاح', 'العرض غير متاح حاليًا.');
      return;
    }
    setLoading(true);
    try {
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.availablePackages?.find(p => p.identifier === packageId);
      if (!pkg) throw new Error('Package not found');
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const active = customerInfo?.entitlements?.active ?? {};
      if (active['pro'] || active['premium']) onPurchased();
    } catch (e: any) {
      // cancelled or failed
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>ترقية إلى الإصدار المحترف</Text>
          <Text style={styles.desc}>إزالة الإعلانات، صفحات غير محدودة، وضغط أفضل للصور.</Text>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.outline]} onPress={onClose} disabled={loading}>
              <Text style={styles.btnText}>لاحقًا</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={purchase} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>ترقية الآن</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  desc: { color: '#444', marginBottom: 16 },
  row: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
  btn: { backgroundColor: '#2563eb', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8 },
  outline: { backgroundColor: '#0000', borderWidth: 1, borderColor: '#2563eb' },
  btnText: { color: '#fff', fontWeight: '700' },
});

