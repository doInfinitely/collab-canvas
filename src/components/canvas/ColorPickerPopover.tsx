// Full HSV color picker with recent colors

import React, { useState, useEffect, useRef } from 'react';
import { HEX6, hexToRgb, rgbToHsv, hsvToHex } from '@/lib/canvas/colors';

type ColorPickerPopoverProps = {
  x: number;
  y: number;
  initial: string;                 // may be invalid; we'll coerce
  recent: string[];
  onClose: () => void;
  onPick: (hex: string) => void;
  onPickRecent: (hex: string) => void;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const ColorPickerPopover: React.FC<ColorPickerPopoverProps> = ({
  x, y, initial, recent, onClose, onPick, onPickRecent,
}) => {
  // Coerce initial to a valid hex & HSV
  const initHex = HEX6.test(initial) ? initial : "#000000";
  const initRgb = hexToRgb(initHex)!;
  const initHsv = rgbToHsv(initRgb.r, initRgb.g, initRgb.b);

  const [h, setH] = useState(initHsv.h);     // 0..360
  const [s, setS] = useState(initHsv.s);     // 0..1
  const [v, setV] = useState(initHsv.v);     // 0..1
  const [hex, setHex] = useState(initHex);

  const svRef = useRef<HTMLDivElement | null>(null);
  const hRef  = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const next = hsvToHex(h, s, v);
    setHex(next);
    onPick(next); // live updates
  }, [h, s, v, onPick]);

  const startDragSV = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = svRef.current!.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const nx = clamp01((ev.clientX - rect.left) / rect.width);       // S
      const ny = clamp01(1 - (ev.clientY - rect.top) / rect.height);   // V
      setS(nx); setV(ny);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    move(e.nativeEvent as unknown as MouseEvent);
  };

  const startDragH = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = hRef.current!.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const ny = clamp01((ev.clientY - rect.top) / rect.height);
      setH(ny * 360);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    move(e.nativeEvent as unknown as MouseEvent);
  };

  const setFromHex = (hexStr: string) => {
    const rgb = hexToRgb(hexStr);
    if (!rgb) return;
    const nhsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    setH(nhsv.h);
    setS(nhsv.s);
    setV(nhsv.v);
    setHex(hexStr);
    onPick(hexStr);           // notify parent with the new color
  };

  const baseColor = hsvToHex(h, 1, 1);

  const svMarkerStyle: React.CSSProperties = {
    position: "absolute",
    left: `${s * 100}%`,
    bottom: `${v * 100}%`,
    transform: "translate(-50%, 50%)",
    width: 12, height: 12,
    borderRadius: 9999,
    border: "2px solid white",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
    pointerEvents: "none",
  };
  const hMarkerStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: `calc(${(h / 360) * 100}% - 6px)`,
    width: "100%",
    height: 12,
    border: "2px solid white",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
    borderRadius: 6,
    pointerEvents: "none",
  };

  return (
    <div
      data-test-id="color-picker-root"
      className="fixed"
      style={{
        left: x,
        top: y,
        zIndex: 2147483647,
        pointerEvents: "auto",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-xl bg-white p-3 shadow-2xl ring-1 ring-black/10"
        style={{ width: 320 }}
      >
        {/* Preview + hex */}
        <div className="mb-3 flex items-center gap-3">
          <div className="aspect-square w-10 rounded border border-gray-300" style={{ background: hex }} title={hex} />
          <input
            className="h-9 grow rounded border border-gray-300 px-2 text-sm outline-none focus:border-blue-500 font-mono"
            value={hex}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (HEX6.test(v)) {
                const rgb = hexToRgb(v)!;
                const nhsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                setH(nhsv.h); setS(nhsv.s); setV(nhsv.v);
                setHex(v);
                onPick(v);
              } else {
                setHex(v);
              }
            }}
            onBlur={() => {
              if (!HEX6.test(hex)) setHex(hsvToHex(h, s, v));
            }}
            placeholder="#RRGGBB"
          />
          <button className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100" onClick={onClose}>Close</button>
        </div>

        {/* SV + Hue */}
        <div className="flex gap-3">
          <div
            ref={svRef}
            onMouseDown={startDragSV}
            className="relative cursor-crosshair rounded-md"
            style={{
              width: 192,   // 48 * 4
              height: 192,  // 48 * 4
              background: `
                linear-gradient(to top, #000, rgba(0,0,0,0)),
                linear-gradient(to right, #fff, ${baseColor})
              `,
            }}
          >
            <div style={svMarkerStyle} />
          </div>

          <div
            ref={hRef}
            onMouseDown={startDragH}
            className="relative cursor-pointer rounded-md"
            style={{
              width: 24,    // ~w-6
              height: 192,  // match SV height
              background: "linear-gradient(to bottom,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
            }}
          >
            <div style={hMarkerStyle} />
          </div>
        </div>

        {/* Recent */}
        {recent.length > 0 && (
          <>
            <div className="mt-3 text-xs text-gray-500">Recent colors</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {recent.map((c) => (
                <button
                  key={c}
                  className="aspect-square w-8 rounded border border-gray-300"
                  style={{ background: c }}
                  title={c}
                  onClick={() => {
                    setFromHex(c);
                    onPickRecent(c);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

