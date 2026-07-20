export type CssQuasi = {
  start: number;
  end: number;
  cooked: string;
};

export type CssTemplate = {
  global: boolean;
  quasis: CssQuasi[];
};

export type ParsedModule = {
  source: string;
  templates: CssTemplate[];
};
