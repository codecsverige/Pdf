import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type SignaturePlacement = { x: number; y: number; width: number };

type Point = { command: 'M' | 'L'; x: number; y: number };
type Segment = { x: number; y: number; width: number; angle: number };

type Props = {
  pageUri: string | null;
  busy?: boolean;
  signaturePath: string;
  sourceWidth: number;
  sourceHeight: number;
  placement: SignaturePlacement;
  onChange: (placement: SignaturePlacement) => void;
};

function parsePath(path: string) {
  const points: Point[] = [];
  const regex = /([ML])\s*(-?\d+(?:\.\d+)?)\s*(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path))) points.push({ command: match[1] as 'M' | 'L', x: Number(match[2]), y: Number(match[3]) });
  if (!points.length) return null;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const segments: Segment[] = [];
  let previous: Point | null = null;
  for (const point of points) {
    if (point.command === 'M') {
      previous = point;
      continue;
    }
    if (!previous) {
      previous = point;
      continue;
    }
    const x1 = previous.x - minX;
    const y1 = previous.y - minY;
    const x2 = point.x - minX;
    const y2 = point.y - minY;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    segments.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, width: length, angle: Math.atan2(dy, dx) * 180 / Math.PI });
    previous = point;
  }
  return { width, height, segments };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function SignaturePlacementEditor({ pageUri, busy, signaturePath, sourceWidth, sourceHeight, placement, onChange }: Props) {
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const [pageRatio, setPageRatio] = useState(0.707);
  const placementRef = useRef(placement);
  const dragStart = useRef({ x: placement.x, y: placement.y });
  const parsed = useMemo(() => parsePath(signaturePath), [signaturePath]);
  const signatureRatio = parsed ? parsed.height / parsed.width : sourceHeight / Math.max(1, sourceWidth);

  useEffect(() => { placementRef.current = placement; }, [placement]);

  function heightFraction(width = placementRef.current.width) {
    return width * signatureRatio * pageRatio;
  }

  function normalized(next: SignaturePlacement) {
    const width = clamp(next.width, 0.14, 0.72);
    const h = heightFraction(width);
    return {
      width,
      x: clamp(next.x, 0, Math.max(0, 1 - width)),
      y: clamp(next.y, 0, Math.max(0, 1 - h)),
    };
  }

  useEffect(() => {
    if (!signaturePath) return;
    const current = placementRef.current;
    const next = normalized(current);
    if (Math.abs(next.x - current.x) > 0.001 || Math.abs(next.y - current.y) > 0.001 || Math.abs(next.width - current.width) > 0.001) {
      placementRef.current = next;
      onChange(next);
    }
  }, [onChange, pageRatio, signaturePath, signatureRatio]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => Boolean(signaturePath),
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
    onPanResponderGrant: () => {
      dragStart.current = { x: placementRef.current.x, y: placementRef.current.y };
    },
    onPanResponderMove: (_, gesture) => {
      if (!canvas.width || !canvas.height) return;
      const next = normalized({
        ...placementRef.current,
        x: dragStart.current.x + gesture.dx / canvas.width,
        y: dragStart.current.y + gesture.dy / canvas.height,
      });
      placementRef.current = next;
      onChange(next);
    },
  }), [canvas.height, canvas.width, onChange, pageRatio, signaturePath, signatureRatio]);

  function onCanvasLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    if (width && height) setCanvas({ width, height });
  }

  function resize(delta: number) {
    const current = placementRef.current;
    const nextWidth = clamp(current.width + delta, 0.14, 0.72);
    const centerX = current.x + current.width / 2;
    const centerY = current.y + heightFraction(current.width) / 2;
    const next = normalized({ x: centerX - nextWidth / 2, y: centerY - heightFraction(nextWidth) / 2, width: nextWidth });
    placementRef.current = next;
    onChange(next);
  }

  function reset() {
    const next = normalized({ x: 0.60, y: 0.76, width: 0.32 });
    placementRef.current = next;
    onChange(next);
  }

  const overlayWidth = canvas.width * placement.width;
  const overlayHeight = overlayWidth * signatureRatio;
  const scale = parsed ? overlayWidth / parsed.width : 1;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerIcon}><MaterialCommunityIcons name="gesture-tap-hold" size={19} color="#7C3AED" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Place your signature</Text>
          <Text style={styles.subtitle}>Drag it anywhere on the page, then adjust its size.</Text>
        </View>
      </View>

      <View style={[styles.pageStage, { aspectRatio: pageRatio }]} onLayout={onCanvasLayout}>
        {busy || !pageUri ? (
          <View style={styles.loading}><ActivityIndicator color="#7C3AED" /><Text style={styles.loadingText}>{busy ? 'Loading page…' : 'Choose a valid page'}</Text></View>
        ) : (
          <Image
            source={{ uri: pageUri }}
            style={styles.pageImage}
            resizeMode="contain"
            onLoad={event => {
              const source = event.nativeEvent.source;
              if (source?.width && source?.height) setPageRatio(source.width / source.height);
            }}
          />
        )}

        {signaturePath && parsed && canvas.width > 0 ? (
          <View
            {...panResponder.panHandlers}
            style={[
              styles.signatureBox,
              {
                left: placement.x * canvas.width,
                top: placement.y * canvas.height,
                width: overlayWidth,
                height: overlayHeight,
              },
            ]}
          >
            {parsed.segments.map((segment, index) => (
              <View
                key={index}
                pointerEvents="none"
                style={[
                  styles.signatureSegment,
                  {
                    left: segment.x * scale - segment.width * scale / 2,
                    top: segment.y * scale - 1.25,
                    width: Math.max(1.5, segment.width * scale),
                    transform: [{ rotate: `${segment.angle}deg` }],
                  },
                ]}
              />
            ))}
            <View pointerEvents="none" style={styles.dragBadge}><MaterialCommunityIcons name="drag" size={13} color="#FFFFFF" /></View>
          </View>
        ) : null}
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.controlButton} onPress={() => resize(-0.05)} disabled={!signaturePath}>
          <MaterialCommunityIcons name="minus" size={19} color="#344054" /><Text style={styles.controlText}>Smaller</Text>
        </Pressable>
        <Pressable style={styles.controlButton} onPress={reset} disabled={!signaturePath}>
          <MaterialCommunityIcons name="backup-restore" size={18} color="#344054" /><Text style={styles.controlText}>Reset</Text>
        </Pressable>
        <Pressable style={styles.controlButton} onPress={() => resize(0.05)} disabled={!signaturePath}>
          <MaterialCommunityIcons name="plus" size={19} color="#344054" /><Text style={styles.controlText}>Larger</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: '#E4E7EC', backgroundColor: '#FFFFFF', padding: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 },
  headerIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#F3EEFF', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#111827', fontSize: 13, fontWeight: '900' },
  subtitle: { color: '#7D8798', fontSize: 9.5, lineHeight: 14, marginTop: 2 },
  pageStage: { width: '100%', borderRadius: 12, backgroundColor: '#E9ECF2', overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: '#D0D5DD' },
  pageImage: { width: '100%', height: '100%', backgroundColor: '#FFFFFF' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { color: '#667085', fontSize: 10, fontWeight: '700' },
  signatureBox: { position: 'absolute', borderWidth: 1.5, borderColor: '#7C3AED', borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.72)', overflow: 'visible' },
  signatureSegment: { position: 'absolute', height: 2.5, borderRadius: 2, backgroundColor: '#0F172A' },
  dragBadge: { position: 'absolute', right: -9, top: -9, width: 24, height: 24, borderRadius: 12, backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', gap: 7, marginTop: 10 },
  controlButton: { flex: 1, minHeight: 42, borderRadius: 12, backgroundColor: '#F7F8FA', borderWidth: 1, borderColor: '#E4E7EC', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  controlText: { color: '#344054', fontSize: 9.5, fontWeight: '900' },
});
