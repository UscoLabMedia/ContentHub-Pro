// The full creator workflow, from idea to results. Steps 1-5 are migrated next; 9-10 are new.
export const STEPS = [
  { id: 1, title: 'Punto de partida', status: 'next' },
  { id: 2, title: 'Tratamiento viral', status: 'next' },
  { id: 3, title: 'Audiencia y anclaje', status: 'next' },
  { id: 4, title: 'Formatos y canales', status: 'next' },
  { id: 5, title: 'Guiones y copys', status: 'next' },
  { id: 6, title: 'Producción (Remotion / HTML)', status: 'planned' },
  { id: 7, title: 'Borrador (540p)', status: 'planned' },
  { id: 8, title: 'Render final 1080p', status: 'planned' },
  { id: 9, title: 'Publicación', status: 'planned' },
  { id: 10, title: 'Análisis de resultados', status: 'planned' },
] as const;
