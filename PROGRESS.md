# PROGRESS

Estado del proyecto. Rama vigente de la pila: **`feat/reference-analysis`** (PR #8). Actualizar en cada PR.

## Pila de PRs (fusionar en este orden; cada uno apunta al anterior)

| PR | Rama | Contenido | Estado |
|----|------|-----------|--------|
| #1 | `feat/production-publish-analysis` → `main` | Pasos 6-10: producción, render, publicación, análisis | abierto |
| #2 | `feat/voice-radar-selftest` | Voces gratuitas, radar de datos con fuentes, «Probar todo» | abierto |
| #3 | `feat/transcript-review` | Revisión de transcripción con audio (cifrado, temporal) | abierto |
| #4 | `feat/deliverables` | Entregables elegibles: largo, Shorts, miniatura, descripción, voz, subtítulos | abierto |
| #5 | `feat/source-verification` | Modo documental: búsqueda, comprobación local, puerta, créditos | abierto |
| #6 | `feat/free-source-search` | Búsqueda gratuita (Wikipedia, OpenAlex, datos abiertos) antes de IA | abierto |
| #7 | `feat/visual-engine` | Motor visual parte 1: cámara, capas, karaoke, números gigantes, estilos | abierto |
| #8 | `feat/reference-analysis` | Estilo desde video de referencia: análisis local + «Afinar con IA» | abierto |

## Decisiones tomadas (no volver a preguntar)

- Voz: local gratis + opción en línea después. Audio de revisión: cifrado y temporal.
- Revisión de transcripción: solo los tramos elegidos. Entregables: todas las opciones, seleccionables.
- Verificación: búsqueda gratis primero, IA solo para lo pendiente; sin buscador con clave; el render se bloquea con escenas pendientes.
- Motor visual: ambos (catálogo de ilustraciones + a medida con Claude Code). Música: catálogo curado + archivos propios.
- Resolución máxima 1080p. Sin módulo de presupuesto. IA vía cuenta de Claude Code.
- El usuario aprueba cada fase con preguntas antes de cambiar nada y revisa por PR. Suele estar en el celular: enviar fotogramas o video corto.

## Pendiente

- Motor visual parte 2: catálogo de ilustraciones animadas (la IA elige por escena) + a medida. Preguntar diseño antes.
- Música y efectos: pistas libres/CC-BY con créditos en pantalla y descripción, ducking, SFX. Preguntar antes.
- Voz en línea (JorgeNeural) con tiempos por palabra para mejor karaoke; revisar la librería con el usuario.
- Menores: carruseles de Instagram, cortes de podcast, publicación automática.

## Límites conocidos / sin verificar

- Sin Windows ni red en la sesión: no probados Piper real, SAPI, confianza de whisper.cpp real, descarga de OCR, búsquedas reales (Google/Wikipedia/OpenAlex/datos.gov.co) ni verificación de páginas reales.
- Análisis de referencia: los movimientos de cámara suaves se leen como «still».

## Tareas del usuario

- Revisar y fusionar PRs #1–#8 en orden.
- Borrar ramas viejas: `git push origin --delete feat/scaffold feat/steps-1-5 feat/sources-and-engine`.
- Probar «Probar todo» en Windows. El instalador clona `main`.
