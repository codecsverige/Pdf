import React, { useMemo } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

export default function AdBanner() {
  const unitId = useMemo(() => {
    // Replace with real ad unit ids before production
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
});

