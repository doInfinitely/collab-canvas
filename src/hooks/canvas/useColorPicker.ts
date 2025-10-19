// Color picker state management with localStorage persistence

import { useState, useEffect } from 'react';
import { HEX_RE, normalizeHex } from '@/lib/canvas/colors';

type ColorTarget = 'stroke' | 'fill' | 'text';

type PickerState = {
  for: ColorTarget;
  x: number;
  y: number;
  initial?: string;
} | null;

export function useColorPicker() {
  const [picker, setPicker] = useState<PickerState>(null);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [lastColorTarget, setLastColorTarget] = useState<ColorTarget>("stroke");

  // Load recent colors from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("recentColors");
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) {
          setRecentColors(arr.filter(c => HEX_RE.test(c)));
        }
      }
    } catch {}
  }, []);

  // Save recent colors to localStorage when changed
  useEffect(() => {
    try {
      localStorage.setItem("recentColors", JSON.stringify(recentColors.slice(0, 16)));
    } catch {}
  }, [recentColors]);

  const addRecentColor = (hex: string) => {
    const n = normalizeHex(hex);
    if (!n) return;
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c.toLowerCase() !== n);
      return [n, ...filtered].slice(0, 16);
    });
  };

  return {
    picker,
    setPicker,
    recentColors,
    lastColorTarget,
    setLastColorTarget,
    addRecentColor,
  };
}

