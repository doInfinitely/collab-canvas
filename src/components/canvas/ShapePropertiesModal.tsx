// Shape properties and annotations modal

import React from 'react';
import { deg, resolveSides } from '@/lib/canvas/shapes';
import { HEX_RE, HEX6 } from '@/lib/canvas/colors';

type Shape = {
  id: string;
  created_by: string;
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  stroke_width: number;
  fill: string | null;
  updated_at?: string;
  sides?: number;
  rotation?: number;
  z?: number;
  name?: string;
  text_md?: string;
  text_color?: string;
};

type Annotation = {
  id: string;
  shape_id: string;
  user_id: string;
  text: string;
  created_at: string;
};

type ShapePropertiesModalProps = {
  shape: Shape;
  userEmail: string;
  ownerEmail: string;
  annotations: Annotation[];
  profiles: Map<string, string>;
  userId: string;
  selectedIds: Set<string>;
  
  // Input states
  sidesInput: string;
  zIndexInput: string;
  strokeWidthInput: string;
  strokeColorInput: string;
  fillColorInput: string;
  textColorInput: string;
  noFill: boolean;
  annotationInput: string;
  lastColorTarget: 'stroke' | 'fill' | 'text';
  recentColors: string[];
  
  // Setters
  setSidesInput: (v: string) => void;
  setZIndexInput: (v: string) => void;
  setStrokeWidthInput: (v: string) => void;
  setStrokeColorInput: (v: string) => void;
  setFillColorInput: (v: string) => void;
  setTextColorInput: (v: string) => void;
  setNoFill: (v: boolean) => void;
  setAnnotationInput: (v: string) => void;
  setLastColorTarget: (v: 'stroke' | 'fill' | 'text') => void;
  
  // Actions
  onClose: () => void;
  onSaveSides: () => void;
  onSaveZIndex: () => void;
  onSaveStyle: () => void;
  onSendToFront: () => void;
  onSendToBack: () => void;
  onAddAnnotation: () => void;
  onDeleteAnnotation: (annotationId: string, shapeId: string) => void;
  onOpenColorPicker: (target: 'stroke' | 'fill' | 'text', x: number, y: number, initial: string) => void;
};

export const ShapePropertiesModal: React.FC<ShapePropertiesModalProps> = ({
  shape: s,
  userEmail,
  ownerEmail,
  annotations: anns,
  profiles,
  userId,
  selectedIds,
  
  sidesInput,
  zIndexInput,
  strokeWidthInput,
  strokeColorInput,
  fillColorInput,
  textColorInput,
  noFill,
  annotationInput,
  lastColorTarget,
  recentColors,
  
  setSidesInput,
  setZIndexInput,
  setStrokeWidthInput,
  setStrokeColorInput,
  setFillColorInput,
  setTextColorInput,
  setNoFill,
  setAnnotationInput,
  setLastColorTarget,
  
  onClose,
  onSaveSides,
  onSaveZIndex,
  onSaveStyle,
  onSendToFront,
  onSendToBack,
  onAddAnnotation,
  onDeleteAnnotation,
  onOpenColorPicker,
}) => {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" aria-modal role="dialog">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-[660px] max-w-[92vw] rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Shape Properties{s.name ? ` — ${s.name}` : ""}
            </h2>
            {!s.name && (
              <div className="text-xs text-gray-500">(unnamed)</div>
            )}
          </div>
          <button
            className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            onClick={onClose}
            aria-label="Close properties"
          >
            ✕
          </button>
        </div>

        {/* Basic */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">ID:</span> {s.id}</div>
          <div><span className="text-gray-500">Owner:</span> {ownerEmail}</div>
          <div><span className="text-gray-500">X:</span> {s.x}</div>
          <div><span className="text-gray-500">Y:</span> {s.y}</div>
          <div><span className="text-gray-500">Width:</span> {s.width}</div>
          <div><span className="text-gray-500">Height:</span> {s.height}</div>
          <div><span className="text-gray-500">Rotation:</span> {Math.round(deg(s.rotation ?? 0))}°</div>
          <div><span className="text-gray-500">Updated:</span> {s.updated_at ? new Date(s.updated_at).toLocaleString() : "—"}</div>
        </div>

        {/* Layering */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium">Layering</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-2">
              <button
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                onClick={onSendToFront}
              >
                Send to front
              </button>
              <button
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                onClick={onSendToBack}
              >
                Send to back
              </button>
            </div>

            {/* exact z-index setter */}
            <div className="ml-auto flex items-end gap-2">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Z-index (integer)</label>
                <input
                  type="number"
                  step={1}
                  className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                  value={zIndexInput}
                  onChange={(e) => setZIndexInput(e.target.value)}
                  onBlur={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n)) setZIndexInput(String(n));
                  }}
                />
              </div>
              <button
                className="h-9 shrink-0 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={onSaveZIndex}
                disabled={!Number.isFinite(Number(zIndexInput))}
                title={
                  selectedIds.size > 0 && selectedIds.has(s.id)
                    ? `Apply to ${selectedIds.size} selected`
                    : "Apply to this shape"
                }
              >
                Set Z
              </button>
            </div>
          </div>

          {selectedIds.size > 0 && selectedIds.has(s.id) && (
            <div className="mt-1 text-xs text-gray-500">
              Applies to {selectedIds.size} selected shape{selectedIds.size > 1 ? "s" : ""}.
            </div>
          )}
        </div>

        {/* Geometry */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium">Geometry</h3>
          <div className="flex items-end gap-3">
            <div className="grow">
              <label className="mb-1 block text-xs text-gray-600">Number of sides (0 = ellipse, 3+ = polygon)</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                value={sidesInput}
                onChange={(e) => setSidesInput(e.target.value)}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!(v === 0 || v >= 3)) {
                    setSidesInput(String(resolveSides(s.sides)));
                  }
                }}
              />
            </div>
            <button
              className="h-9 shrink-0 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={onSaveSides}
              disabled={(() => { const v = Number(sidesInput); return !(v === 0 || v >= 3); })()}
            >Save sides</button>
          </div>
          {selectedIds.size > 0 && selectedIds.has(s.id) && (
            <div className="mt-1 text-xs text-gray-500">
              Applies to {selectedIds.size} selected shape{selectedIds.size > 1 ? "s" : ""}.
            </div>
          )}
        </div>

        {/* Style */}
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-medium">Style</h3>

          {/* Stroke width */}
          <div className="mb-3 flex items-end gap-3">
            <div className="w-44">
              <label className="mb-1 block text-xs text-gray-600">Stroke width (px)</label>
              <input
                type="number"
                step="0.5"
                min={0.5}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                value={strokeWidthInput}
                onChange={(e) => setStrokeWidthInput(e.target.value)}
                onFocus={() => setLastColorTarget("stroke")}
              />
            </div>
          </div>

          {/* Stroke color */}
          <div className="mb-3 grid grid-cols-[1fr_auto] items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Stroke color (hex)</label>
              <div className="flex items-center gap-3">
                <input
                  className={`w-full rounded-md border px-2 py-1.5 text-sm outline-none ${HEX_RE.test(strokeColorInput) ? "border-gray-300 focus:border-blue-500" : "border-red-400 focus:border-red-500"}`}
                  placeholder="#000000"
                  value={strokeColorInput}
                  onChange={(e) => setStrokeColorInput(e.target.value)}
                  onFocus={() => setLastColorTarget("stroke")}
                />
                <button
                  type="button"
                  className="aspect-square w-12 rounded border border-gray-300"
                  style={{
                    background: HEX_RE.test(strokeColorInput)
                      ? strokeColorInput
                      : "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/10px 10px"
                  }}
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    setLastColorTarget("stroke");
                    const safeInitial = HEX6.test(strokeColorInput) ? strokeColorInput : "#000000";
                    onOpenColorPicker("stroke", rect.left + window.scrollX, rect.bottom + 6 + window.scrollY, safeInitial);
                  }}
                  title="Pick stroke color"
                />
              </div>
              {!HEX_RE.test(strokeColorInput) && (
                <div className="mt-1 text-xs text-red-600">Enter a valid hex like #ffcc00 or #fc0</div>
              )}
            </div>
            <div className="self-center text-xs text-gray-500">Preview</div>
          </div>

          {/* Fill color */}
          <div className="mb-3 grid grid-cols-[1fr_auto] items-end gap-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs text-gray-600">Fill color (hex)</label>
                <label className="flex select-none items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={noFill}
                    onChange={(e) => { setNoFill(e.target.checked); setLastColorTarget("fill"); }}
                  />
                  No fill (transparent)
                </label>
              </div>
              <div className="flex items-center gap-3">
                <input
                  className={`w-full rounded-md border px-2 py-1.5 text-sm outline-none ${noFill || HEX_RE.test(fillColorInput) ? "border-gray-300 focus:border-blue-500" : "border-red-400 focus:border-red-500"}`}
                  placeholder="#ffffff"
                  value={fillColorInput}
                  onChange={(e) => setFillColorInput(e.target.value)}
                  onFocus={() => setLastColorTarget("fill")}
                  disabled={noFill}
                />
                <button
                  type="button"
                  className="aspect-square w-12 rounded border border-gray-300"
                  style={{
                    background: noFill
                      ? "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/10px 10px"
                      : (HEX_RE.test(fillColorInput) ? fillColorInput : "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/10px 10px")
                  }}
                  onClick={(e) => {
                    if (noFill) setNoFill(false);
                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    setLastColorTarget("fill");
                    const safeInitial = noFill
                      ? "#ffffff"
                      : (HEX6.test(fillColorInput) ? fillColorInput : "#ffffff");
                    onOpenColorPicker("fill", rect.left + window.scrollX, rect.bottom + 6 + window.scrollY, safeInitial);
                  }}
                  title="Pick fill color"
                />
              </div>
              {!noFill && !HEX_RE.test(fillColorInput) && (
                <div className="mt-1 text-xs text-red-600">Enter a valid hex like #66ccff or #6cf</div>
              )}
            </div>
            <div className="self-center text-xs text-gray-500">Preview</div>
          </div>

          {/* Text color */}
          <div className="mb-3 grid grid-cols-[1fr_auto] items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Text color (hex)</label>
              <div className="flex items-center gap-3">
                <input
                  className={`w-full rounded-md border px-2 py-1.5 text-sm outline-none ${HEX_RE.test(textColorInput) ? "border-gray-300 focus:border-blue-500" : "border-red-400 focus:border-red-500"}`}
                  placeholder="#000000"
                  value={textColorInput}
                  onChange={(e) => setTextColorInput(e.target.value)}
                  onFocus={() => setLastColorTarget("text")}
                />
                <button
                  type="button"
                  className="aspect-square w-12 rounded border border-gray-300"
                  style={{
                    background: HEX_RE.test(textColorInput)
                      ? textColorInput
                      : "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/10px 10px"
                  }}
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    setLastColorTarget("text");
                    const safeInitial = HEX6.test(textColorInput) ? textColorInput : "#000000";
                    onOpenColorPicker("text", rect.left + window.scrollX, rect.bottom + 6 + window.scrollY, safeInitial);
                  }}
                  title="Pick text color"
                />
              </div>
              {!HEX_RE.test(textColorInput) && (
                <div className="mt-1 text-xs text-red-600">Enter a valid hex like #000000 or #000</div>
              )}
            </div>
            <div className="self-center text-xs text-gray-500">Preview</div>
          </div>

          {/* Recent colors + target toggle */}
          {recentColors.length > 0 && (
            <div className="mb-1 flex items-center gap-2 text-xs text-gray-600">
              <span>Recent colors</span>
              <div className="ml-auto flex gap-1">
                <button
                  className={`rounded px-2 py-0.5 ${lastColorTarget === "stroke" ? "bg-gray-200" : "hover:bg-gray-100"}`}
                  onClick={() => setLastColorTarget("stroke")}
                  title="Apply to stroke"
                >
                  Stroke
                </button>
                <button
                  className={`rounded px-2 py-0.5 ${lastColorTarget === "fill" ? "bg-gray-200" : "hover:bg-gray-100"}`}
                  onClick={() => setLastColorTarget("fill")}
                  title="Apply to fill"
                >
                  Fill
                </button>
                <button
                  className={`rounded px-2 py-0.5 ${lastColorTarget === "text" ? "bg-gray-200" : "hover:bg-gray-100"}`}
                  onClick={() => setLastColorTarget("text")}
                  title="Apply to text"
                >
                  Text
                </button>
              </div>
            </div>
          )}
          {recentColors.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {recentColors.map((c) => (
                <button
                  key={c}
                  className="aspect-square w-8 rounded border border-gray-300"
                  style={{ background: c }}
                  title={`${c} → ${lastColorTarget}`}
                  onClick={() => {
                    if (lastColorTarget === "stroke") setStrokeColorInput(c);
                    else if (lastColorTarget === "fill") setFillColorInput(c);
                    else setTextColorInput(c);
                  }}
                />
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={onClose}>Close</button>
            <button
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={onSaveStyle}
              disabled={
                !Number.isFinite(Number(strokeWidthInput)) ||
                Number(strokeWidthInput) <= 0 ||
                !HEX_RE.test(strokeColorInput) ||
                (!noFill && !HEX_RE.test(fillColorInput)) ||
                !HEX_RE.test(textColorInput)
              }
            >
              Save style
            </button>
          </div>

          {selectedIds.size > 0 && selectedIds.has(s.id) && (
            <div className="mt-1 text-xs text-gray-500">
              Applies to {selectedIds.size} selected shape{selectedIds.size > 1 ? "s" : ""}.
            </div>
          )}
        </div>

        {/* Annotations */}
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Annotations</h3>
          <div className="max-h-48 overflow-auto rounded border border-gray-200">
            {anns.length === 0 ? (
              <div className="p-3 text-sm text-gray-500">No annotations yet.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {anns
                  .filter(a => a.text && a.text.trim().length > 0)
                  .map(a => {
                    const author = profiles.get(a.user_id) ?? a.user_id;
                    const isMine = a.user_id === userId;
                    return (
                      <li key={a.id} className="p-3 text-sm">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <div className="font-medium">{author}</div>
                          {isMine && (
                            <button
                              className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded px-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                              aria-label="Delete annotation"
                              title="Delete annotation"
                              onClick={() => onDeleteAnnotation(a.id, a.shape_id)}
                            >✕</button>
                          )}
                        </div>
                        <div className="whitespace-pre-wrap">{a.text}</div>
                        <div className="mt-1 text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs text-gray-600">
              Add annotation (as {userEmail})
            </label>
            {selectedIds.size > 0 && selectedIds.has(s.id) && (
              <div className="mb-1 text-xs text-gray-500">
                This note will be added to {selectedIds.size} selected shape{selectedIds.size > 1 ? "s" : ""}.
              </div>
            )}
            <textarea
              className="h-20 w-full rounded-md border border-gray-300 p-2 text-sm outline-none focus:border-blue-500"
              placeholder="Type a note…"
              value={annotationInput}
              onChange={(e) => setAnnotationInput(e.target.value)}
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={onClose}>Close</button>
              <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" onClick={onAddAnnotation} disabled={!annotationInput.trim()}>Save annotation</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

