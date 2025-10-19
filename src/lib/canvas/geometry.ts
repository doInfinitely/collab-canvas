// Geometric calculations for canvas shapes

import { resolveSides } from './shapes';

// Shape type (minimal definition needed for geometry functions)
type Shape = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  sides?: number;
};

export const polygonPoints = (x: number, y: number, w: number, h: number, n: number) => {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.abs(w) / 2;
  const ry = Math.abs(h) / 2;
  const pts: string[] = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const ang = start + (i * 2 * Math.PI) / n;
    const px = cx + rx * Math.cos(ang);
    const py = cy + ry * Math.sin(ang);
    pts.push(`${px},${py}`);
  }
  return pts.join(" ");
};

export const shapeCenter = (s: Shape) => ({ cx: s.x + s.width / 2, cy: s.y + s.height / 2 });

export const worldToLocal = (s: Shape, wx: number, wy: number) => {
  const { cx, cy } = shapeCenter(s);
  const theta = s.rotation ?? 0;
  const dx = wx - cx;
  const dy = wy - cy;
  const c = Math.cos(-theta);
  const si = Math.sin(-theta);
  return { lx: dx * c - dy * si, ly: dx * si + dy * c };
};

export const pointInShape = (s: Shape, wx: number, wy: number) => {
  const sides = resolveSides(s.sides);
  const { lx, ly } = worldToLocal(s, wx, wy);
  const rx = Math.abs(s.width) / 2;
  const ry = Math.abs(s.height) / 2;

  if (sides === 4) return Math.abs(lx) <= rx && Math.abs(ly) <= ry;
  if (sides === 0) return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;

  const pts: Array<[number, number]> = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const ang = start + (i * 2 * Math.PI) / sides;
    pts.push([rx * Math.cos(ang), ry * Math.sin(ang)]);
  }
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect = yi > ly !== yj > ly && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

export const nearPerimeter = (s: Shape, wx: number, wy: number, threshWorld: number) => {
  const sides = resolveSides(s.sides);
  const { lx, ly } = worldToLocal(s, wx, wy);
  const rx = Math.abs(s.width) / 2;
  const ry = Math.abs(s.height) / 2;

  if (sides === 4) {
    const dx = Math.abs(Math.abs(lx) - rx);
    const dy = Math.abs(Math.abs(ly) - ry);
    const withinY = Math.abs(ly) <= ry + threshWorld;
    const withinX = Math.abs(lx) <= rx + threshWorld;
    const d = (withinY ? dx : Infinity) < (withinX ? dy : Infinity) ? dx : dy;
    const outside = Math.abs(lx) > rx + threshWorld || Math.abs(ly) > ry + threshWorld;
    return !outside && d <= threshWorld;
  }

  if (sides === 0) {
    const rNorm = Math.sqrt((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry));
    const minR = Math.min(rx, ry);
    const delta = Math.abs(rNorm - 1) * minR;
    return delta <= threshWorld;
  }

  const pts: Array<[number, number]> = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const ang = start + (i * 2 * Math.PI) / sides;
    pts.push([rx * Math.cos(ang), ry * Math.sin(ang)]);
  }
  const distPointSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (ab2 || 1)));
    const cx = ax + t * abx, cy = ay + t * aby;
    const dx = px - cx, dy = py - cy;
    return Math.hypot(dx, dy);
  };
  let dmin = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    dmin = Math.min(dmin, distPointSeg(lx, ly, a[0], a[1], b[0], b[1]));
  }
  return dmin <= threshWorld;
};

export const getTextBoxBounds = (s: Shape) => {
  const sides = resolveSides(s.sides);
  const { cx, cy } = shapeCenter(s);
  const theta = s.rotation ?? 0;
  const rx = Math.abs(s.width) / 2;
  const ry = Math.abs(s.height) / 2;

  // For unrotated shapes, use the simple calculation
  if (Math.abs(theta) < 0.001) {
    const factor = 0.7;
    return { boxW: rx * 2 * factor, boxH: ry * 2 * factor };
  }

  // For rotated shapes, we need to find the largest axis-aligned rectangle
  // that fits inside the rotated shape

  // Get the shape's boundary points in world coordinates
  const getBoundaryPoints = (): Array<[number, number]> => {
    const points: Array<[number, number]> = [];
    const numPoints = sides === 0 ? 64 : sides; // Use 64 points for ellipse approximation
    const startAngle = -Math.PI / 2;

    for (let i = 0; i < numPoints; i++) {
      const angle = startAngle + (i * 2 * Math.PI) / numPoints;
      // Local coordinates
      const lx = rx * Math.cos(angle);
      const ly = ry * Math.sin(angle);
      
      // Rotate to world coordinates
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const wx = cx + (lx * c - ly * s);
      const wy = cy + (lx * s + ly * c);
      
      points.push([wx, wy]);
    }
    return points;
  };

  const boundaryPoints = getBoundaryPoints();

  // Find the axis-aligned bounding box of all boundary points
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const [x, y] of boundaryPoints) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  // Check if a point is inside the shape (in world coordinates)
  const isInsideShape = (wx: number, wy: number): boolean => {
    // Transform to local coordinates
    const dx = wx - cx;
    const dy = wy - cy;
    const c = Math.cos(-theta);
    const si = Math.sin(-theta);
    const lx = dx * c - dy * si;
    const ly = dx * si + dy * c;

    if (sides === 4) {
      return Math.abs(lx) <= rx && Math.abs(ly) <= ry;
    }
    if (sides === 0) {
      return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
    }

    // Polygon: use ray casting
    const pts: Array<[number, number]> = [];
    const start = -Math.PI / 2;
    for (let i = 0; i < sides; i++) {
      const ang = start + (i * 2 * Math.PI) / sides;
      pts.push([rx * Math.cos(ang), ry * Math.sin(ang)]);
    }
    
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      const intersect = yi > ly !== yj > ly && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  // Binary search to find the largest rectangle centered at cx, cy
  // that fits inside the shape
  const findMaxRectangle = (): { boxW: number; boxH: number } => {
    const maxW = maxX - minX;
    const maxH = maxY - minY;

    // Binary search for width
    let wLow = 0, wHigh = maxW;
    for (let iter = 0; iter < 20; iter++) {
      const testW = (wLow + wHigh) / 2;
      const testH = maxH * (testW / maxW); // Maintain aspect ratio loosely
      
      // Check if rectangle with this width fits
      const corners = [
        [cx - testW / 2, cy - testH / 2],
        [cx + testW / 2, cy - testH / 2],
        [cx - testW / 2, cy + testH / 2],
        [cx + testW / 2, cy + testH / 2],
      ];
      
      const allInside = corners.every(([x, y]) => isInsideShape(x, y));
      
      if (allInside) {
        wLow = testW;
      } else {
        wHigh = testW;
      }
    }

    // Binary search for height with the found width
    const finalW = wLow * 0.95; // Use 95% of max for safety margin
    let hLow = 0, hHigh = maxH;
    for (let iter = 0; iter < 20; iter++) {
      const testH = (hLow + hHigh) / 2;
      
      const corners = [
        [cx - finalW / 2, cy - testH / 2],
        [cx + finalW / 2, cy - testH / 2],
        [cx - finalW / 2, cy + testH / 2],
        [cx + finalW / 2, cy + testH / 2],
      ];
      
      const allInside = corners.every(([x, y]) => isInsideShape(x, y));
      
      if (allInside) {
        hLow = testH;
      } else {
        hHigh = testH;
      }
    }

    const finalH = hLow * 0.95; // Use 95% of max for safety margin
    
    return { boxW: Math.max(20, finalW), boxH: Math.max(20, finalH) };
  };

  return findMaxRectangle();
};

export const pointInTextBox = (s: Shape, wx: number, wy: number) => {
  const { cx, cy } = shapeCenter(s);
  const { boxW, boxH } = getTextBoxBounds(s);
  const dx = Math.abs(wx - cx);
  const dy = Math.abs(wy - cy);
  return dx <= boxW / 2 && dy <= boxH / 2;
};

export const nearCorner = (
  s: Shape,
  wx: number,
  wy: number,
  threshWorld: number
): { type: "rect"; sx: 1 | -1; sy: 1 | -1 } | { type: "poly"; i: number } | null => {
  const sides = resolveSides(s.sides);
  const { lx, ly } = worldToLocal(s, wx, wy);
  const rx = Math.abs(s.width) / 2;
  const ry = Math.abs(s.height) / 2;

  if (sides === 4) {
    const candidates = [
      { sx:  1 as const, sy:  1 as const, cx:  rx, cy:  ry },
      { sx:  1 as const, sy: -1 as const, cx:  rx, cy: -ry },
      { sx: -1 as const, sy:  1 as const, cx: -rx, cy:  ry },
      { sx: -1 as const, sy: -1 as const, cx: -rx, cy: -ry },
    ];
    for (const c of candidates) {
      if (Math.hypot(lx - c.cx, ly - c.cy) <= threshWorld) {
        return { type: "rect", sx: c.sx, sy: c.sy };
      }
    }
    return null;
  }

  const n = sides === 0 ? 16 : sides;
  const start = -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const a = start + (i * 2 * Math.PI) / n;
    const vx = rx * Math.cos(a), vy = ry * Math.sin(a);
    if (Math.hypot(lx - vx, ly - vy) <= threshWorld) return { type: "poly", i };
  }
  return null;
};

