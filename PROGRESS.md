# PROGRESS

Estado del proyecto. Estado vigente: **`main`** (PRs #1–#33 fusionados). Cada fase nueva va en su propia rama y PR. Actualizar en cada PR.

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

| #20 | `feat/carousel` | Carrusel de Instagram 4:5 (1080×1350): láminas desde las escenas, editor, PNG numerados + .zip + pie sugerido | fusionado |

| #22 | `feat/projects` | Gestor de proyectos: crear, abrir, renombrar, duplicar, plantilla, archivar, exportar/importar y eliminar (con sus archivos huérfanos) | fusionado |

| #30 | `feat/original-audio` | Tus propias voces como narración: fragmentos de tus audios (paso 5), selector voz original / generada / sin voz (paso 6) | fusionado |

## Decisiones tomadas (no volver a preguntar)

- Mejoras visuales tomadas de las guías Enclave y GPS (elegidas por el usuario, que prefiere su aspecto al de la app), por fases, cada una en su rama y PR: **A ritmo** (número gigante sincronizado con la palabra, beats con palabras que propone la IA, cambio visual cada 3-6 s) → HECHA; **B aspecto** (recortes de papel rasgado con sombra y grano, entrada con rebote y temblor stop-motion; palabras clave destacadas en los subtítulos); **C** (gancho en etiquetas de papel arriba y pantalla final con botón animado, textos del usuario, sin logos); **D sonido** (normalizar el render final a -15 LUFS con pico máx. -2 dB usando `loudnorm` del ffmpeg de Remotion en dos pasadas, el borrador no se toca; música generada por código, sin licencias); **E** (hoja de contactos del borrador para el celular y revisión final automática: duración, resolución, volumen, gancho). Descartado por ahora: marca (logo/portada) en las esquinas. Notas técnicas: el ffmpeg de Remotion tiene `loudnorm`, `volume` y `amix`, pero NO `ebur128`, `alimiter`, `volumedetect`, `afade` ni FLAC.
- Voz del video (elegido por el usuario): usar sus propios audios originales (solo cortes y ediciones, sin generar ni imitar voces; tiene autorización de esas voces) o una voz generada, **por video** (no se mezclan). Audio original guardado cifrado **hasta que el usuario borre la fuente**. Ediciones: recortar inicio/fin, ordenar/quitar/repetir, acortar pausas largas y fundidos de milisegundos. Al unir fragmentos el video se alarga y el tope lo pone el formato (Reel corto, video largo).
- Gestor de proyectos (elegido por el usuario): pantalla de inicio con tarjetas + selector en la cabecera; nuevo proyecto en blanco pidiendo solo un nombre (o desde plantilla); eliminar borra todo lo suyo con confirmación escribiendo el nombre; extras: duplicar, plantilla desde un proyecto, archivar, exportar/importar un solo proyecto.
- Descartado por el usuario: cortes de clips del podcast y publicación automática. No proponerlos.
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
- CARRUSEL DE INSTAGRAM: HECHO y fusionado (PR #20, `feat/carousel`). Láminas locales desde las escenas (portada = gancho, cierre = llamada a la acción, textos largos divididos a ≤160 caracteres, máx. 20; lámina final de «Fuentes» si hay créditos), editables/reordenables/quitables en el paso 9 con vista previa por lámina; estilo del usuario + ilustración o cuadro del B-roll de la escena; numeración 1/N y flecha; sin número gigante. Entrega: PNG numerados + .zip (sin compresión, `core/src/zip.ts`) + `-pie.md` con créditos. Código: `core/src/carousel.ts`, composición `video/src/Carousel.tsx` (un fotograma por lámina, `--sequence`), modo `carousel`/`cslide` en `video/render.mjs`, `server/src/render.ts` (`renderCarousel`), entregable `carousel`, check `carousel` en «Probar todo». La verificación documental se aplica por lámina (`carouselGate`: un texto editado o dividido con cifras sin verificar queda pendiente). El paso 9 ya no exige borrador aprobado si solo se marcan carrusel, miniatura o descripción.
  - Sin probar: lámina con cuadro de B-roll real (solo ilustración con SVG de prueba), el check «Probar todo» completo en el PC del usuario y la interfaz del editor en navegador (typecheck y tests sí pasan).
  - Opcional más adelante (no elegido): 1:1, 9:16 y PDF.

- GESTOR DE PROYECTOS: HECHO y fusionado (PR #22, `feat/projects`). En la bóveda: `projects` (índice + proyecto actual) y `project:<id>` por proyecto; el proyecto único de versiones anteriores se migra solo a «primer proyecto». Lógica pura y probada en `core/src/projects.ts`; endpoints `/api/projects*` en `server/src/main.ts` (el servidor lee verificación, ilustraciones, B-roll, música y SFX del proyecto *actual*; abrir un proyecto se lo avisa); pantalla `app/src/components/Projects.tsx` y selector en `App.tsx`. Al eliminar solo se borran los archivos que ningún otro proyecto usa (ilustraciones, B-roll, música, borradores y entregables); duplicar comparte archivos y olvida borradores/entregables; exportar/importar lleva guion, escenas, estilo y verificaciones, no los archivos del PC. Las fuentes subidas (paso 1) siguen siendo una biblioteca común a todos los proyectos y no se borran con ellos; un proyecto importado no conserva su fuente. Sin probar: borrado real de archivos en disco con B-roll/música reales (solo probado en la lógica pura) y exportar/importar entre dos PCs.

- TUS AUDIOS COMO VOZ: HECHO y fusionado (PR #30, `feat/original-audio`). Al subir un audio/video (paso 1) se guarda su pista de audio **sin recodificar**, cifrada (`server/src/original.ts`, `originals/<id>.enc`; máx. 800 MB). Paso 5, pestaña «Usar mis audios»: línea(s) de la transcripción, tramos confirmados o por tiempo → fragmentos editables (`app/src/components/Fragments.tsx`); el texto de los fragmentos es el guion. Paso 6: botón «Usar mis audios originales». Cada fragmento se divide en varias escenas (ver más abajo: «Fragmentos en escenas»); una escena de audio original dura lo que dura su corte (sin el límite de 30 s; manda el total del formato); el servidor corta con ffmpeg a WAV estéreo 44,1 kHz, con fundido hecho sobre las muestras (el ffmpeg de Remotion no trae `afade`, `volumedetect` ni FLAC) y pausas largas acortadas con `silencedetect`; los subtítulos siguen la sincronía de la transcripción. Lógica pura en `core/src/fragments.ts`. El paso 2 tiene «Saltar: usaré mis propios audios» (no hace falta IA para llegar al 5). Regla 11 de `CLAUDE.md` actualizada. Probado con navegador real y render real: el mp4 lleva el audio del archivo (tonos de 330/440/550 Hz medidos), «Voz sola» sale estéreo y los subtítulos cuadran. Sin probar: transcripción real de un podcast (el modelo de whisper no se descarga desde la sesión), archivos de cientos de MB, y que el original no viaja al exportar la bóveda o un proyecto (hay que subir el archivo en otro PC). Las fuentes subidas antes de esta función no tienen audio original: hay que subirlas de nuevo.

- REVISIÓN DE TRANSCRIPCIÓN, línea de tiempo del audio: HECHO y fusionado (PR #33, junto con el recorte). Barra fija arriba del diálogo (`app/src/components/TranscriptReview.tsx`) con pausa/reproducir, deslizador, ±5 s y tiempo actual/total, en la elección de tramos y en la confirmación del texto; mover el deslizador cancela la parada automática al final del tramo, y la línea que suena se resalta. Probado en navegador real; no probado con un audio de varios minutos.

- REVISIÓN DE TRANSCRIPCIÓN, recorte por palabras y criterio de la IA: HECHO y fusionado (PR #33, `feat/review-trim`). En «Confirmar la transcripción» las palabras del tramo se tocan para «Empezar desde esta palabra» / «Terminar en esta palabra» (se tachan las quitadas y el texto del tramo las deja fuera), y se afina por oído con «El tramo empieza/termina aquí» usando la línea de tiempo; «Quitar recortes» deshace. Los tiempos por palabra son ESTIMADOS (reparto por longitud dentro de cada línea, `wordSpans` en `core/src/sources/review.ts`): la transcripción solo tiene tiempos por segmento; tiempos reales por palabra quedó descartado por ahora (no se puede probar el motor de voz desde la sesión). Sugerencias de IA: el criterio pasó a «lo más interesante, viral, curioso, relevante y significativo» (prompts `contentIdeas` y `sourceHighlights`), con `score` 1-10 opcional, ordenadas de mejor a peor, y el motivo (`why`) ya se muestra. Sin probar: la calidad real de las sugerencias con la IA (no hay IA en la sesión) ni el recorte en un audio largo de varios minutos.

- FRAGMENTOS EN ESCENAS: HECHO en `feat/fragment-scenes` (pendiente de PR). Corrige un malentendido: el usuario quiere que su captura de audio sea la base del guion **y se reparta en escenas**, no que cada fragmento sea una sola escena (un fragmento de 54,9 s salía como una escena). Ahora `fragmentsToScenes` (`core/src/fragments.ts`) parte cada fragmento en los límites entre segmentos de la transcripción (`splitIntoScenes`, ≈8 s por escena; más largas si el audio es larguísimo, máx. 50 escenas): las partes son contiguas, así que juntas son exactamente el audio del fragmento. Cada escena muestra lo que se dice en ella; si el usuario corrigió el texto, se reparte por palabras (`distributeText`). En las uniones entre escenas del mismo fragmento no hay fundido ni se quita la pausa (`joinStart`/`joinEnd`); el fundido y la pausa de los extremos solo valen en los bordes del fragmento. `GET /api/sources/:id/text` ahora devuelve también los segmentos del rango (`segs`); los fragmentos guardados antes los obtienen al pulsar «Rehacer desde mis fragmentos» o al abrir el paso 5. Probado: 2 escenas en el paso 7, el audio del borrador sigue continuo (330 / pausa acortada / 440 / 550 Hz). Sin probar: un audio real de varios minutos y Windows.

- FASE A, RITMO: HECHA en `feat/rhythm` (pendiente de PR). `core/src/rhythm.ts`: `sceneWordTimes` (los mismos tiempos de los subtítulos), `heroStartSec` (el número gigante aparece cuando se dice la cifra, ya no a un instante fijo; su sonido también), `beatTimes`/`matchBeatWords` (palabras clave → segundos; solo palabras que de verdad están en el texto) y `segmentCount` (escenas de más de 6,5 s se dividen en segmentos de ~5 s: cámara y capas nuevas más un golpe suave). Beats: nueva tarea de IA `beatWords` (Haiku, effort low, una consulta por guion, cacheada) → `project.beats` por texto de escena, editable con chips en el paso 7 (`Beats.tsx`); el servidor los convierte en segundos tras la narración (`render.ts`) y los usan Remotion (golpe de zoom ~5 %) y los efectos (`SfxConfig.beat`, por defecto «Tic»; el test viejo del número ya no fija 0,13 s). Probado: fotogramas reales (sin número antes de decirlo, número al decirlo, golpe de zoom en el beat y cambio de capas a los 6 s), panel de beats y un borrador con beats en la app. Sin probar: la propuesta real de la IA (no hay IA en la sesión), el sonido de los beats a oído y un video largo completo.

## Límites conocidos / sin verificar

- Sin Windows ni red en la sesión: no probados Piper real, SAPI, confianza de whisper.cpp real, descarga de OCR, búsquedas reales (Google/Wikipedia/OpenAlex/datos.gov.co) ni verificación de páginas reales.
- Análisis de referencia: los movimientos de cámara suaves se leen como «still». Subtítulos: la medición local funciona mejor con texto blanco, amarillo u oscuro sobre otro fondo; la tipografía se aproxima con la fuente libre más parecida. Las fuentes propias no viajan con la bóveda exportada: hay que subirlas en cada PC.

## Instalación y arranque (correcciones #24–#28, tras la primera prueba real en Windows y Codespaces)

- Codespaces: `whisper-cli` (whisper.cpp v1.9.5) se compila solo al crear el Codespace (`.devcontainer/install-whisper.sh`, #24). El servidor solo escucha en `127.0.0.1`: el puerto 8787 debe quedar «Private».
- `Instalar-ContentHub.bat` usa la última marca `#PS1#` (#25): antes PowerShell ejecutaba también las líneas de CMD (errores rojos inofensivos y una pausa extra).
- `ContentHub.bat` pone las carpetas habituales de Node y Git al principio del PATH y comprueba con `node -v` (#27): en un PC con una comilla suelta en el PATH del sistema, `where node` lo encontraba pero CMD no podía ejecutarlo.
- whisper.cpp en Windows: la descarga prueba la última release, las 10 anteriores y el enlace directo sin API (#26); se usa `whisper-cli.exe` y nunca `main.exe`, que en los paquetes recientes es solo un aviso de «obsoleto» que termina con error (#28).
- Ninguna de estas correcciones se probó en Windows desde la sesión (no hay Windows): se dedujeron de las capturas del usuario. El instalador necesita `winget`; sin él hay que instalar Git y Node a mano.

- Paso 7 (Producción): la fila de cada escena salía rota (cuadro de texto diminuto y duración a todo el ancho) porque la clase `field` trae `w-full` y `w-16` no la vencía; corregido con `!w-20` (`fix/scene-row-layout`). Era un defecto antiguo que nadie había visto en pantalla real; la lección: los cambios de interfaz se revisan mirando la imagen, no solo los valores.

## Tareas del usuario

- Probar «Probar todo» en Windows (el instalador clona `main`, que ya tiene todo).
