// Shared canvas types

export type Shape = {
  id: string;
  created_by: string;
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  stroke_width: number;
  fill: string | null;
  sides?: number;
  rotation?: number;
  z?: number;
  name?: string;
  text_md?: string;
  text_color?: string;
  updated_at?: string;
  created_at?: string;
};

export type Wordlists = {
  adjs: string[];
  nouns: string[];
};

