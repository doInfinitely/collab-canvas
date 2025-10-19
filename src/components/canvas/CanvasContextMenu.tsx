// Canvas right-click context menu with Export and Versions tabs

import React from 'react';
import Portal from '@/components/Portal';

type CanvasVersion = {
  id: string;
  created_at: string;
  created_by: string;
};

type CanvasContextMenuProps = {
  show: boolean;
  position: { x: number; y: number } | null;
  menuRef: React.RefObject<HTMLDivElement | null>;
  activeTab: 'export' | 'versions';
  versions: CanvasVersion[];
  onTabChange: (tab: 'export' | 'versions') => void;
  onClose: () => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  onExportJSON: () => void;
  onSaveVersion: () => void;
  onRestoreVersion: (versionId: string) => void;
};

export const CanvasContextMenu = React.memo(({
  show,
  position,
  menuRef,
  activeTab,
  versions,
  onTabChange,
  onClose,
  onExportPNG,
  onExportSVG,
  onExportJSON,
  onSaveVersion,
  onRestoreVersion,
}: CanvasContextMenuProps) => {
  if (!show || !position) return null;

  return (
    <Portal>
      <div
        ref={menuRef}
        role="menu"
        className="fixed z-[9999] rounded-xl shadow-2xl bg-white border border-gray-200"
        style={{ left: position.x, top: position.y, minWidth: 280 }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <div className="flex text-sm">
          <button
            className={`px-3 py-2 ${activeTab==='export' ? 'font-semibold border-b-2 border-blue-500' : 'text-gray-500'}`}
            onClick={() => onTabChange('export')}
          >
            Export
          </button>
          <button
            className={`px-3 py-2 ${activeTab==='versions' ? 'font-semibold border-b-2 border-blue-500' : 'text-gray-500'}`}
            onClick={() => onTabChange('versions')}
          >
            Versions
          </button>
          <div className="ml-auto px-2 py-2">
            <button className="text-gray-400 hover:text-gray-700" onClick={onClose}>✕</button>
          </div>
        </div>

        {activeTab === 'export' && (
          <div className="p-3 space-y-2">
            <button className="w-full rounded-md border px-3 py-2 hover:bg-gray-50" onClick={onExportPNG}>Download PNG</button>
            <button className="w-full rounded-md border px-3 py-2 hover:bg-gray-50" onClick={onExportSVG}>Download SVG</button>
            <button className="w-full rounded-md border px-3 py-2 hover:bg-gray-50" onClick={onExportJSON}>Download JSON (state)</button>
          </div>
        )}

        {activeTab === 'versions' && (
          <div className="p-3 space-y-3">
            <div className="flex gap-2">
              <button className="flex-1 rounded-md border px-3 py-2 hover:bg-gray-50" onClick={onSaveVersion}>
                Save current version
              </button>
            </div>
            <div className="max-h-64 overflow-auto divide-y">
              {versions.length === 0 ? (
                <div className="text-sm text-gray-500 py-6 text-center">No versions yet.</div>
              ) : versions.map(v => (
                <div key={v.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="text-xs">
                    <div className="font-medium">{new Date(v.created_at).toLocaleString()}</div>
                    <div className="text-gray-500">by {v.created_by}</div>
                  </div>
                  <button
                    className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                    onClick={() => onRestoreVersion(v.id)}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Portal>
  );
});

CanvasContextMenu.displayName = 'CanvasContextMenu';

