// Initial data loading: wordlists and shapes

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { Shape, Wordlists } from '@/types/canvas';

type UseDataLoadingProps = {
  setShapes: (value: Map<string, Shape> | ((prev: Map<string, Shape>) => Map<string, Shape>)) => void;
};

export function useDataLoading({
  setShapes,
}: UseDataLoadingProps) {
  const [wordlists, setWordlists] = useState<Wordlists | null>(null);

  // Load wordlists (adjectives and nouns) on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      const [aRes, nRes] = await Promise.all([
        fetch("/names/adjectives.txt"),
        fetch("/names/nouns.txt"),
      ]);
      const [aText, nText] = await Promise.all([aRes.text(), nRes.text()]);
      if (!alive) return;
      const adjs = aText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const nouns = nText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      setWordlists({ adjs, nouns });
    })();
    return () => { alive = false; };
  }, []);

  // Load initial shapes from database
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("shapes")
        .select("*")
        .order("updated_at", { ascending: true });
      if (!active || !data) return;
      const rows = data as unknown as Shape[];
      setShapes(new Map(rows.map((s) => [s.id, s])));
    })();
    return () => { active = false; };
  }, [setShapes]);

  return {
    wordlists,
  };
}

