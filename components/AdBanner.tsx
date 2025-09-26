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
  if (!BannerAd || !BannerAdSize || !TestIds) {
    return <View style={styles.placeholder} />;
  }
  const unitId = useMemo(() => {
    return Platform.select({ ios: TestIds.BANNER, android: TestIds.BANNER }) as string;
  }, []);

  return (
    <View style={styles.container}>
      <BannerAd unitId={unitId} size={BannerAdSize.ADOBE_BANNER} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  placeholder: { height: 0 },
});

