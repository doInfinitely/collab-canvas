// src/components/Portal.tsx
// "use client";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

export default function Portal({ children }: { children: React.ReactNode }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => setRoot(document.body), []);
  if (!root) return null;
  return createPortal(children, root);
}
