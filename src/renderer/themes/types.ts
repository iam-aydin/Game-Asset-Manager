export interface Theme {
  id: string;
  label: string;
  colorScheme: 'light' | 'dark';
  colors: Record<string, string>;
  cssVars: Record<string, string>;
}