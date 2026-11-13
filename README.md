# ContentHub Pro

Estudio personal para creadores de contenido: **tendencias → tratamiento → audiencia → formatos → guion → producción → borrador → render → publicación → análisis de resultados**.
Plataformas: TikTok, Instagram, Facebook, YouTube (largo y Shorts) y Spotify.

## Abrir la app (un clic, Windows)

**PC nuevo:** copia el archivo `Instalar-ContentHub.bat` (es uno solo) y haz doble clic. Instala Git y Node.js si faltan, descarga el proyecto, crea un acceso directo «ContentHub Pro» en el Escritorio y abre la app. Si GitHub pide iniciar sesión, hazlo en la ventana que se abre.

**Día a día:** doble clic en el acceso directo (o en `ContentHub.bat`). Se actualiza solo desde la rama `main` de GitHub (siempre lo último) si no tienes cambios locales, instala lo que falte (incluido Claude Code), prepara la interfaz y abre el navegador.

macOS: `ContentHub.command` · Linux: `./ContentHub.sh`. También funciona en Codespaces (`.devcontainer`).

**Para hacer ajustes con recarga en caliente:** `npm run dev:all` · pruebas y reglas: `npm run verify`.

## IA con tu cuenta de Claude Code

Por defecto la app usa **tu sesión de Claude Code** (sin clave de API): en Ajustes → «Conectar con Claude Code» se abre el inicio de sesión de Anthropic en el navegador (la app nunca ve tus credenciales). Las consultas cuentan contra los límites de tu plan. Es para uso personal. También puedes elegir una clave de API (se factura aparte).

No hay barra de presupuesto: no existe una API para leer tu saldo o límites, así que no lo simulamos. Para controlar consumo la app aplica caché cifrada, el modelo más barato que sirva por tarea y entradas comprimidas.

## Editar la app con Claude Code

Botón **«Editar con Claude Code»** (arriba a la derecha): abre claude.ai/code en tu cuenta (elige el repositorio `UscoLabMedia/ContentHub-Pro`) o abre una terminal con Claude Code en la carpeta del proyecto. Los cambios llegan por GitHub y la app se actualiza sola al abrirla.

## Crear contenido desde tus archivos

Paso 1 → pestaña **«Desde mis archivos»**: sube un podcast, audio, video, texto, subtítulos (.srt/.vtt) o PDF. El audio y el video se transcriben **en tu PC** (whisper.cpp; en Windows se descarga solo la primera vez, ~60–180 MB según la calidad). La IA recibe solo la transcripción y propone 6–8 piezas (plataforma, formato, gancho, tramo del original). Las fuentes muy largas se condensan primero con el modelo barato. Al elegir una idea, el guion (paso 5) se escribe con el pasaje real del original.

## Contraseña y recuperación

- Al crear la bóveda se muestra **una sola vez** una *clave de recuperación*. Guárdala fuera del equipo.
- Si olvidas la contraseña: «Olvidé mi contraseña» → clave de recuperación → nueva contraseña. Tus datos se conservan.
- Si pierdes **ambas**, los datos no se pueden recuperar: no hay puerta trasera ni servidor que lo restablezca. Es lo que hace real el cifrado.
- Desde Ajustes puedes cambiar la contraseña o generar una clave de recuperación nueva (la anterior deja de funcionar).

## Flujo completo (11 pasos)

1. **Punto de partida:** tendencias con datos reales o tus propios archivos. 2. **Tratamiento.** 3. **Audiencia.** 4. **Formatos y plataformas.** 5. **Guion.**
6. **Voz:** escucha muestras de voces gratuitas, elige una (o video sin voz). 7. **Producción:** el guion se convierte en escenas animadas editables, en tu PC y sin IA. 8. **Borrador** (mitad de tamaño, con la voz) que debes aprobar. 9. **Entregables:** marcas lo que quieres producir y se genera todo en tu PC a calidad final (máx. 1080p).
10. **Publicación:** textos listos por plataforma; tú publicas y registras el enlace. 11. **Análisis:** sube CSV, PDF o captura de tus métricas; se leen en local y la IA interpreta un resumen corto.

Si cambias escenas, estilo o voz, el video queda marcado como desactualizado y hay que generarlo de nuevo. Pendiente: carruseles de imágenes, música de fondo y publicación automática (cada plataforma exige tu propia sesión y credenciales de desarrollador).

## Verificación de fuentes (modo documental)

En el paso de producción, cada escena con datos necesita **fuentes comprobadas**:

1. **«Buscar fuentes con IA»:** Claude Code busca en la web fuentes para las afirmaciones de cada escena (necesita el motor «Mi cuenta de Claude Code»; consume consultas de tu plan).
2. **Comprobación local:** la app abre **cada enlace** y busca la cifra o la frase en la página (sin gastar IA). Si no aparece o la página no abre, la escena queda **pendiente**. Nada de lo que diga la IA se da por bueno sin esto.
3. **Tú decides:** puedes añadir tus propias fuentes (con cita), confirmar una fuente que revisaste tú, o marcar una escena como «opinión / sin datos».
4. **Puerta:** mientras haya escenas pendientes no se puede pasar al borrador ni generar entregables.
5. Las fuentes verificadas salen en la **descripción** y en una **tarjeta «Fuentes»** de 6 s al final de cada video; tus cálculos propios se anotan.

Los enlaces solo se abren si son públicos: se bloquean direcciones locales y privadas.

## Entregables que se marcan (paso 9)

| Entregable | Qué sale |
|---|---|
| Video largo 16:9 | MP4 1920×1080 con la voz |
| Shorts verticales | Un MP4 1080×1920 por cada Short; tú eliges qué escenas lleva cada uno (se proponen solos, máx. 60 s) |
| Miniatura | PNG 1280×720 con tu título |
| Descripción | Texto con resumen, capítulos con tiempos (si el video los permite), fuentes de los datos y hashtags |
| Voz sola | WAV de la narración alineado con el video, para mejorarlo en otra app (debe volver con la misma duración) |
| Subtítulos | Archivo `.srt` sincronizado con el video largo |

Cada archivo tiene su enlace de descarga con un nombre claro. Si cambias escenas, estilo o voz, los archivos quedan marcados como desactualizados.

## Revisión de la transcripción (audio y video)

Después de transcribir un podcast, entrevista o video, **tú eliges los tramos** que quieres usar (a mano, o con sugerencias de la IA) y la app te pide confirmar cada uno:

- ves el texto y **escuchas ese fragmento** del audio;
- respondes «está bien», «hay un error» (lo corriges) o «no lo entiendo bien» (escribes qué dice; si lo dejas vacío, ese tramo no se usa);
- se avisan con ⚠ las partes que conviene escuchar: cifras, nombres propios y baja confianza del reconocimiento;
- el contenido (ideas y guion) se crea **solo con los tramos confirmados**, con tu texto corregido.

Para poder escucharlos se guarda una **copia temporal del audio, cifrada con tu bóveda** (en `~/.contenthub-pro/review`). Se borra al confirmar la revisión o al quitar el archivo; la app nunca la deja en claro en disco.

## Fuentes de los datos (búsqueda de temas)

Los temas salen de datos públicos reales y cada uno muestra de dónde vienen (con enlace):

| Fuente | Qué aporta |
|---|---|
| [Google Trends](https://trends.google.com/trending?geo=CO) (feed RSS de búsquedas en tendencia, Colombia) | Qué se busca hoy, con volumen aproximado y los medios que lo cubren |
| [Google News](https://news.google.com/) (titulares de Colombia y noticias de tu región) | Qué cubren los medios (cada titular nombra su medio) |
| [Wikipedia en español](https://es.wikipedia.org/) vía la [API de Wikimedia](https://wikimedia.org/api/rest_v1) | Qué artículos se leyeron más ayer |

La IA solo ordena esos datos y cita los que respaldan cada tema; el «potencial» es una estimación suya y se rotula así. El perfil de audiencia y las recomendaciones de formato son estimaciones de la IA, y también se rotulan. Si una fuente no responde, la pantalla lo dice (✔/✘ por fuente) y no se inventa su dato.

## Voces gratuitas

Hay dos motores locales y gratuitos, sin enviar tu texto a ningún servicio:

- **[Piper](https://github.com/rhasspy/piper)** (MIT): voces neuronales en español (Davefx, Ald, Claude y dos básicas alojadas en GitHub) de [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices). El motor y cada voz se descargan solos la primera vez que las escuchas (60–110 MB). Cada voz tiene su licencia: revísala antes de un uso comercial.
- **Voces de Windows** (System.Speech): sin descarga; aparecen solas si tienes voces en español instaladas.

Alternativas revisadas y no incluidas: [Kokoro](https://github.com/hexgrad/kokoro) (Apache-2.0, muy buena calidad pero exige Python o un runtime pesado), [Coqui XTTS](https://github.com/coqui-ai/TTS) (clonación de voz, necesita GPU y tiene licencia restrictiva) y [eSpeak NG](https://github.com/espeak-ng/espeak-ng) (muy ligera pero robótica).

## Probar que todo funciona

Botón **«Probar todo»** (arriba) o `npm run selftest`. La **prueba rápida** revisa sin descargar nada ni usar IA; la **completa** usa cada pieza de verdad (voz, transcripción, una consulta mínima a la IA, un render de 1 segundo) y descarga lo que falte. Cada punto sale como ✔ funciona, ! aviso, ✘ falla u omitido, con la causa. Hay un botón para copiar el informe.

## Principios

- **Cifrado:** bóveda AES-256-GCM (clave derivada con PBKDF2) en `~/.contenthub-pro/vault.enc`, fuera del repo. El servidor solo escucha en `127.0.0.1`.
- **Ahorro de tokens obligatorio** (ver `CLAUDE.md`): único gateway de IA, JSON validado, modelo por tarea, caché cifrada, ingesta local de métricas, video local con Remotion, máximo 1080p.
- **Métricas sin tokens:** sube CSV, PDF o capturas; se leen en local y solo un resumen mínimo llega a la IA.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | lo mismo que el lanzador de un clic |
| `npm run dev:all` | servidor + interfaz con recarga en caliente |
| `npm run verify` | reglas + tipos + tests |
| `npm run video:studio` | vista previa de plantillas Remotion |
| `npm run render -w video -- spec.json draft` | render por línea de comandos (la app lo hace sola desde el paso 7) |

## Estado

- `feat/scaffold`: estructura, cifrado, gateway con presupuesto, ingesta local y plantilla de video.
- `feat/steps-1-5`: recuperación de contraseña, presupuesto ligado a la cuenta, inicio de un clic y pasos 1–5 con la IA real.
- `feat/sources-and-engine`: sin presupuesto, IA con tu cuenta de Claude Code, instalador de Windows, botón de edición con Claude Code y contenido desde archivos.
- `main` contiene todo lo anterior y es lo que recibe cada PC.
- `feat/production-publish-analysis`: producción y render (6–8), publicación (9) y análisis de resultados (10).
- `feat/voice-radar-selftest`: voces gratuitas (muestras y narración), fuentes de datos con enlaces, prueba del sistema.
- Pendiente: carruseles, música de fondo, cortes de clips del podcast.
