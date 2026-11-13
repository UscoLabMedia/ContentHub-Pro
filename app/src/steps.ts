// The full creator workflow, from idea to results.
export const STEPS = [
  { id: 1, title: 'Punto de partida' },
  { id: 2, title: 'Tratamiento viral' },
  { id: 3, title: 'Audiencia y anclaje' },
  { id: 4, title: 'Formatos y canales' },
  { id: 5, title: 'Guiones y copys' },
  { id: 6, title: 'Voz' },
  { id: 7, title: 'Producción' },
  { id: 8, title: 'Borrador (540p)' },
  { id: 9, title: 'Render final 1080p' },
  { id: 10, title: 'Publicación' },
  { id: 11, title: 'Análisis de resultados' },
] as const;
export const TOTAL = STEPS.length;
