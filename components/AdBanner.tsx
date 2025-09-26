import React, { useMemo } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
let BannerAd: any, BannerAdSize: any, TestIds: any;
try {
  const mod = require('react-native-google-mobile-ads');
  BannerAd = mod.BannerAd;
  BannerAdSize = mod.BannerAdSize;
  TestIds = mod.TestIds;
} catch {}

export default function AdBanner() {
  // Return placeholder for web or when ads aren't available
  if (Platform.OS === 'web' || !BannerAd || !BannerAdSize || !TestIds) {
    return <View style={styles.placeholder} />;
  }
  
  const unitId = useMemo(() => {
    return Platform.select({ ios: TestIds.BANNER, android: TestIds.BANNER }) as string;
  }, []);

  return (
    <View style={styles.container}>
      <BannerAd unitId={unitId} size={BannerAdSize.BANNER} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  placeholder: { height: 0 },
});

