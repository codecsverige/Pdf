import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type Point = { x: number; y: number };
type Stroke = Point[];

type Props = {
  onChange: (svgPath: string, width: number, height: number) => void;
};

function distance(a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function buildSvgPath(strokes: Stroke[]) {
  return strokes
    .filter(stroke => stroke.length > 1)
    .map(stroke => stroke.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '))
    .join(' ');
}

export default function SignaturePad({ onChange }: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [size, setSize] = useState({ width: 320, height: 126 });
  const sizeRef = useRef(size);

  useEffect(() => {
    onChange(buildSvgPath(strokes), size.width, size.height);
  }, [strokes, size, onChange]);

  useEffect(() => { sizeRef.current = size; }, [size]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      const { locationX, locationY } = event.nativeEvent;
      setStrokes(current => [...current, [{ x: locationX, y: locationY }]]);
    },
    onPanResponderMove: event => {
      const { locationX, locationY } = event.nativeEvent;
      const point = {
        x: Math.max(0, Math.min(sizeRef.current.width, locationX)),
        y: Math.max(0, Math.min(sizeRef.current.height, locationY)),
      };
      setStrokes(current => {
        if (!current.length) return [[point]];
        const next = current.map(stroke => [...stroke]);
        const lastStroke = next[next.length - 1];
        const lastPoint = lastStroke[lastStroke.length - 1];
        if (!lastPoint || distance(lastPoint, point) >= 2.2) lastStroke.push(point);
        return next;
      });
    },
  }), []);

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize({ width, height });
  }

  const segments = strokes.flatMap((stroke, strokeIndex) => stroke.slice(1).map((point, index) => {
    const start = stroke[index];
    const length = distance(start, point);
    const angle = Math.atan2(point.y - start.y, point.x - start.x) * 180 / Math.PI;
    return {
      key: `${strokeIndex}-${index}`,
      left: (start.x + point.x) / 2 - length / 2,
      top: (start.y + point.y) / 2 - 1.35,
      width: length,
      angle,
    };
  }));

  return (
    <View>
      <View style={styles.toolbar}>
        <View style={styles.toolbarTitle}><MaterialCommunityIcons name="draw-pen" size={17} color="#7C3AED" /><Text style={styles.toolbarText}>Draw signature</Text></View>
        {strokes.length ? <Pressable style={styles.clearButton} onPress={() => setStrokes([])}><MaterialCommunityIcons name="delete-outline" size={16} color="#C62828" /><Text style={styles.clearText}>Clear</Text></Pressable> : null}
      </View>
      <View style={styles.pad} onLayout={onLayout} {...panResponder.panHandlers}>
        {!strokes.length ? <View pointerEvents="none" style={styles.emptyHint}><MaterialCommunityIcons name="gesture-swipe" size={21} color="#B8C0CC" /><Text style={styles.hint}>Sign here with your finger</Text></View> : null}
        {segments.map(segment => <View key={segment.key} pointerEvents="none" style={[styles.segment, { left: segment.left, top: segment.top, width: segment.width, transform: [{ rotate: `${segment.angle}deg` }] }]} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  toolbarTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolbarText: { color: '#344054', fontSize: 10.5, fontWeight: '900' },
  pad: { height: 126, borderRadius: 14, borderWidth: 1.5, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF', overflow: 'hidden', position: 'relative' },
  emptyHint: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 5 },
  hint: { color: '#B8C0CC', fontWeight: '700', fontSize: 10.5 },
  segment: { position: 'absolute', height: 2.7, backgroundColor: '#0F172A', borderRadius: 2 },
  clearButton: { minHeight: 34, paddingHorizontal: 9, borderRadius: 10, backgroundColor: '#FFF1F3', flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearText: { color: '#C62828', fontSize: 9.5, fontWeight: '900' },
});
