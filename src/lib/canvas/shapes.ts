// Shape utility functions

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const nowIso = () => new Date().toISOString();
export const deg = (rad: number) => (rad * 180) / Math.PI;
export const resolveSides = (n?: number) => (n === 0 || (typeof n === "number" && n >= 3)) ? n : 4;

