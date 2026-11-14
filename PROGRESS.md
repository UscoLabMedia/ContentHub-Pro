# PROGRESS

Estado del proyecto. Estado vigente: **`main`** (PRs #1–#10 fusionados). Cada fase nueva va en su propia rama y PR. Actualizar en cada PR.

## PRs fusionados

| PR | Rama | Contenido | Estado |
|----|------|-----------|--------|
| #1 | `feat/production-publish-analysis` → `main` | Pasos 6-10: producción, render, publicación, análisis | fusionado |
| #2 | `feat/voice-radar-selftest` | Voces gratuitas, radar de datos con fuentes, «Probar todo» | fusionado |
| #3 | `feat/transcript-review` | Revisión de transcripción con audio (cifrado, temporal) | fusionado |
| #4 | `feat/deliverables` | Entregables elegibles: largo, Shorts, miniatura, descripción, voz, subtítulos | fusionado |
| #5 | `feat/source-verification` | Modo documental: búsqueda, comprobación local, puerta, créditos | fusionado |
| #6 | `feat/free-source-search` | Búsqueda gratuita (Wikipedia, OpenAlex, datos abiertos) antes de IA | fusionado |
| #7 | `feat/visual-engine` | Motor visual parte 1: cámara, capas, karaoke, números gigantes, estilos | fusionado |
| #8 | `feat/reference-analysis` | Estilo desde video de referencia: análisis local + «Afinar con IA» | fusionado |
| #9 | `feat/illustrations` | Ilustraciones por escena: búsqueda libre (PD/CC0/CC BY) → SVG de Claude; créditos | fusionado |
| #10 | `feat/subtitle-style` | Subtítulos: 10 fuentes libres + fuente propia cifrada, 8 animaciones que rotan por escena, copiar de un video de referencia (local + «Afinar con IA») | fusionado |

| #12 | `feat/music` | Música de fondo: búsqueda libre (Openverse), archivos propios, ducking, fundidos, créditos | fusionado |

| #13 | `feat/sfx` | Efectos de sonido sintetizados en local: biblioteca, sonido por evento y por animación de subtítulos, ambientes | fusionado |

| #14 | `feat/broll` | Video de stock (B-roll) como fondo de escena: Commons, Internet Archive, NASA, Pexels y Pixabay (claves gratuitas), créditos | fusionado |

| #16 | `feat/online-voices` | Voces en línea (Edge y Azure), tono/estilo, pausas y énfasis, tiempos por palabra en el karaoke | fusionado |

| #17 | `feat/local-voices` | Voces locales gratis con Kokoro (Dora, Alex, Santa): instalación automática, motor persistente, descarga con reintentos | fusionado |

| #18 | `feat/voice-cloning` | Clonar una voz (OpenVoice v2 ONNX vía voiceclonnx), consentimiento obligatorio, muestra cifrada, aviso de voz sintética | fusionado |

## Decisiones tomadas (no volver a preguntar)

- Voz: local gratis + opción en línea después. Audio de revisión: cifrado y temporal.
- Revisión de transcripción: solo los tramos elegidos. Entregables: todas las opciones, seleccionables.
- Verificación: búsqueda gratis primero, IA solo para lo pendiente; sin buscador con clave; el render se bloquea con escenas pendientes.
- Motor visual: ambos (catálogo de ilustraciones + a medida con Claude Code). Música: catálogo curado + archivos propios.
- Ilustraciones (motor visual parte 2): sin catálogo fijo; surgen del estilo y del tema de cada escena. Primero búsqueda web gratuita de imágenes libres (Openverse, Wikimedia Commons, Openclipart; solo dominio público, CC0 y CC-BY, con crédito en pantalla final y descripción); si no hay resultado, Claude dibuja un SVG animado con la paleta del estilo. Criterio: lo que gaste menos tokens (búsqueda local primero; la IA solo para dibujar). La IA elige por etiquetas, una consulta por guion.
- Resolución máxima 1080p. Sin módulo de presupuesto. IA vía cuenta de Claude Code.
- El usuario aprueba cada fase con preguntas antes de cambiar nada y revisa por PR. Suele estar en el celular: enviar fotogramas o video corto.

## Pendiente

- Voces (etapas 1, 2 y 3: en línea, Kokoro local y clonación): HECHAS y fusionadas (PRs #15–#18). Pendiente solo probarlas en el PC del usuario.
- Revisar la licencia de cada voz de Piper antes de monetizar (el motor actual es GPL-3.0 y cada modelo tiene su ficha).
- B-roll: Unsplash solo tiene fotos (no se usó; podría ser otra fuente de ilustraciones). Probado solo con fixtures locales: faltan pruebas reales con Pexels/Pixabay (claves), Commons, Internet Archive y NASA.
- Ilustraciones: probar búsqueda real en Openverse/Commons (sin red en la sesión; solo probado con fixture local).
- Música y efectos: pistas libres/CC-BY con créditos en pantalla y descripción, ducking, SFX. Preguntar antes.
- Voces en línea: probado solo con proveedores simulados y un servidor de prueba de Azure; faltan pruebas reales con Edge y con una clave de Azure. Azure REST no da tiempos por palabra (se usa la estimación).
- Clonación de voz: solo probada con un convertidor simulado y la instalación real (venv + voiceclonnx 0.0.3a3, alfa de un autor pequeño); los modelos viven en Hugging Face, inaccesible desde la sesión, así que la conversión real y su calidad están sin probar. voiceclonnx fuerza CPU (no usa GPU). Chatterbox descartado (retirado por su autor en ago 2026).
- CARRUSEL DE INSTAGRAM (SIGUIENTE; rama `feat/carousel` creada desde `main`, aún sin código; diseño decidido):
  - Láminas desde las escenas del guion (local, sin IA): la primera es portada con el gancho, la última cierre con llamada a la acción; se pueden editar, reordenar y quitar. Si hay fuentes o créditos CC BY, se añade una lámina final de «Fuentes».
  - Cada lámina lleva: el estilo del usuario (colores, fondo, tipografía de subtítulos), la ilustración o un cuadro del B-roll de esa escena si existe, y numeración 1/N con flecha para deslizar. NO lleva número gigante (no lo eligió).
  - Entrega: solo Instagram 4:5 (1080×1350) en PNG numerados, descargables uno a uno o en un .zip (zip sin compresión escrito a mano con zlib.crc32). Opcional más adelante: 1:1, 9:16 y PDF (no elegidos).
  - Plan técnico: composición Remotion `Carousel` con calculateMetadata (un fotograma por lámina) renderizada como secuencia de PNG en una sola pasada (`--sequence`), modo `carousel` en `video/render.mjs`; exportar el hook de fuentes de `Piece.tsx`; entregable `carousel` en `core/src/deliverables.ts` y `server/src/deliverables.ts`; módulo `core/src/carousel.ts` (slidesFromScenes, reparto de textos largos ≤160 caracteres, máx. 20 láminas); la verificación documental (gate) se aplica al texto de cada lámina (un texto editado sin verificar con cifras queda pendiente); en `Deliverables.tsx` no exigir borrador aprobado si solo se marcan entregables sin video (carrusel, miniatura, descripción); texto con créditos y pie sugerido en un .md; vista previa de una lámina.
- Otros pendientes menores: cortes de clips del podcast (paso 1: archivos propios), publicación automática (cada plataforma exige credenciales propias).

## Límites conocidos / sin verificar

- Sin Windows ni red en la sesión: no probados Piper real, SAPI, confianza de whisper.cpp real, descarga de OCR, búsquedas reales (Google/Wikipedia/OpenAlex/datos.gov.co) ni verificación de páginas reales.
- Análisis de referencia: los movimientos de cámara suaves se leen como «still». Subtítulos: la medición local funciona mejor con texto blanco, amarillo u oscuro sobre otro fondo; la tipografía se aproxima con la fuente libre más parecida. Las fuentes propias no viajan con la bóveda exportada: hay que subirlas en cada PC.

## Tareas del usuario

- Probar «Probar todo» en Windows (el instalador clona `main`, que ya tiene todo).
