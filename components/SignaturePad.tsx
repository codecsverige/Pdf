import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

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

function buildSvgPath(strokes: Stroke[], height: number) {
  return strokes
    .filter(stroke => stroke.length > 1)
    .map(stroke => stroke.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${(height - point.y).toFixed(1)}`).join(' '))
    .join(' ');
}

export default function SignaturePad({ onChange }: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [size, setSize] = useState({ width: 320, height: 170 });
  const strokesRef = useRef<Stroke[]>([]);
  const sizeRef = useRef(size);

  useEffect(() => {
    strokesRef.current = strokes;
    onChange(buildSvgPath(strokes, size.height), size.width, size.height);
  }, [strokes, size, onChange]);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event => {
        const { locationX, locationY } = event.nativeEvent;
        const point = { x: locationX, y: locationY };
        setStrokes(current => [...current, [point]]);
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
    }),
    [],
  );

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize({ width, height });
  }

  const segments = strokes.flatMap((stroke, strokeIndex) =>
    stroke.slice(1).map((point, index) => {
      const start = stroke[index];
      const length = distance(start, point);
      const angle = Math.atan2(point.y - start.y, point.x - start.x) * 180 / Math.PI;
      return {
        key: `${strokeIndex}-${index}`,
        left: start.x,
        top: start.y - 1.4,
        width: length,
        angle,
      };
    }),
  );

  return (
    <View>
      <View style={styles.pad} onLayout={onLayout} {...panResponder.panHandlers}>
        <Text style={styles.hint}>Sign here</Text>
        {segments.map(segment => (
          <View
            key={segment.key}
            pointerEvents="none"
            style={[
              styles.segment,
              {
                left: segment.left,
                top: segment.top,
                width: segment.width,
                transform: [{ rotate: `${segment.angle}deg` }],
              },
            ]}
          />
        ))}
      </View>
      <Pressable style={styles.clearButton} onPress={() => setStrokes([])}>
        <Text style={styles.clearText}>Clear signature</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    height: 170,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    position: 'relative',
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    top: 72,
    color: '#cbd5e1',
    fontWeight: '700',
  },
  segment: {
    position: 'absolute',
    height: 2.8,
    backgroundColor: '#0f172a',
    borderRadius: 2,
    transformOrigin: 'left center',
  },
  clearButton: {
    alignSelf: 'flex-end',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  clearText: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '800',
  },
});
