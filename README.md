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

## Estilo visual (paso 7)

Cada escena tiene movimiento de cámara propio (zoom adentro, zoom afuera, paneos, empuje con leve giro), tres capas con profundidad (fondo, plano medio, partículas al frente), transiciones en el eje Z, **subtítulos karaoke** (hasta 3 palabras, la palabra dicha resalta sobre un marcador) y **números gigantes** que cuentan hasta la cifra de la escena.

- **4 estilos** para elegir, cada uno con «Ver ejemplo» (un fotograma de tu primera escena): Papel recortado, Limpio y moderno, Noticiero y Pastel suave.
- **Referencias:** sube una imagen o un video y la app saca su **paleta de colores** en tu PC (no se guarda ni se envía), la aplica sobre el estilo que elijas y crea «Mi estilo». Copia colores, no movimientos ni composición.
- Los tiempos por palabra son **estimados** (proporcionales al largo de cada palabra); con una voz real pueden desviarse una fracción de segundo.

## Verificación de fuentes (modo documental)

En el paso de producción, cada escena con datos necesita **fuentes comprobadas**:

1. **«Buscar fuentes gratis»** (primero): separa cada escena en afirmaciones y consulta [Wikipedia en español](https://es.wikipedia.org/), [OpenAlex](https://openalex.org/) (artículos científicos) y [datos.gov.co](https://www.datos.gov.co/) (datos abiertos de Colombia), sin claves y **sin gastar tu plan**. Solo se queda con una fuente si su propio texto contiene la cifra o las palabras de la afirmación.
   **«Buscar con IA (solo lo pendiente)»:** para lo que siga pendiente, Claude Code busca en toda la web (necesita el motor «Mi cuenta de Claude Code»; consume consultas de tu plan).
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

## Estilo desde un video de referencia

En el paso 7, sube un video de referencia: la app mide **en tu PC, sin gastar IA** el ritmo de cortes, los movimientos de cámara, la posición de subtítulos y la paleta, y los aplica como estilo propio. El botón opcional **«Afinar con IA»** envía una sola hoja de fotogramas (1 consulta pequeña, con caché) para detectar el tipo de fondo, trazos a mano y palabras resaltadas. Limitación: la medición local detecta zoom y paneos marcados; los sutiles pueden quedar como «still».

## Subtítulos

En el paso 7, sección **Subtítulos**: elige tipografía (10 fuentes libres incluidas o tu propio archivo .ttf/.otf/.woff2, cifrado en tu bóveda), colores, resaltado de la palabra dicha, posición, tamaño y **animación de entrada**. Marca varias animaciones para **alternarlas escena por escena**. También puedes **copiarlos de un video de referencia**: la app mide en tu PC la posición, el tamaño, los colores, la caja del resaltado y las palabras a la vez; «Afinar con IA» (1 consulta pequeña) describe el tipo de letra y la animación. Se usa la fuente libre más parecida, no la exacta.

## Música de fondo

En el paso 7, sección **Música**: elige un ánimo (o «Sugerir con IA», una consulta mínima), busca 3 pistas libres de Openverse (CC0, dominio público o CC BY), escúchalas y elige una. También puedes subir tu propio archivo (por ejemplo, una pista de YouTube Audio Library: escribe su atribución si la pide). La música baja sola mientras habla la voz, se ajusta a la duración del video (se corta con fundido o se repite) y entra y sale con fundido. Las pistas CC BY y las atribuciones que escribas salen en la pantalla final y en la descripción.

## Efectos de sonido

En el paso 7, sección **Efectos de sonido** (apagados por defecto): se generan en tu PC, sin descargas ni licencias. Hay una **biblioteca** de 12 sonidos y 5 ambientes (toca ▶ para escucharlos). Tú eliges qué suena en cada momento: cambio de escena (con opción de alternar varios), número gigante, ilustración, y los subtítulos con **un sonido distinto por cada animación** (al entrar cada grupo de palabras o en cada palabra resaltada). El ambiente de fondo es muy suave y baja cuando habla la voz. «Escuchar los efectos de mi video» reproduce solo los efectos sobre la línea de tiempo de tu proyecto, sin renderizar.

## Video de stock (B-roll)

En el paso 7, sección **Video de stock**: por escena, busca 3 videos libres y elige uno como **fondo** (con el color de tu estilo encima para que los subtítulos se lean; se recorta a 30 s, va sin audio y se repite si es más corto que la escena). Fuentes sin clave: Wikimedia Commons, Internet Archive (dominio público, CC0, CC BY) y NASA. Con una **clave gratuita** (pégala una vez; se guarda cifrada y nunca se muestra) se suman Pexels y Pixabay, que dan mejor calidad de stock. Los CC BY y NASA salen en la pantalla final y en la descripción. Los términos de búsqueda salen de la misma consulta de IA que las ilustraciones (sin gasto extra).

## Voces en línea

En el paso 6 hay voces neuronales en español **en línea**, además de las locales:

- **Edge** (gratis, sin clave): sirve para probar o para videos personales. Usa un acceso *no oficial* de Microsoft que puede dejar de funcionar, y sus términos para uso comercial no son claros. Entrega **tiempos por palabra**, así que el karaoke de los subtítulos queda sincronizado con la voz.
- **Azure AI Speech** (oficial, permite uso comercial): crea un recurso «Speech» gratis (capa F0, unos 500 000 caracteres al mes), pega la clave y la región; se guardan cifradas en tu bóveda y nunca se muestran de nuevo. Permite **estilos o emociones** (alegre, triste, susurro…).

Ajustes para cualquier voz: **velocidad**, **tono** (±6 semitonos; en las voces locales se aplica con filtros de audio) y, en Azure, **estilo**. En el guion puedes escribir `[pausa]` o `[pausa 1.5s]` para un silencio y `*palabra*` para darle énfasis; las marcas no salen en pantalla ni en los subtítulos.

## Voces locales gratis: Kokoro

En el paso 6, filtro **Locales**: **Dora**, **Alex** y **Santa** (Kokoro, 82 millones de parámetros, pesos Apache 2.0; motor `kokoro-onnx`, MIT). Funcionan **sin internet y sin clave**, corren en CPU (unas 3 veces más rápido que el tiempo real en las pruebas) y aceptan velocidad, tono y las marcas `[pausa]` y `*énfasis*`.

La primera vez que pides una muestra se instalan solas (unos 220 MB, una sola vez) en tu carpeta de datos: un Python privado (si no tienes Python 3.10–3.13, se descarga uno con `uv`, sin permisos de administrador), el paquete `kokoro-onnx`, el modelo y las voces (con comprobación de integridad SHA-256). Un proceso pequeño mantiene el modelo cargado y se apaga solo tras 5 minutos sin uso. Nada de tu texto sale de tu PC.

Licencias: el motor `espeak-ng` que usa Kokoro para pronunciar es GPL-3.0; se instala en tu PC como dependencia y no se redistribuye con este proyecto. Revisa la ficha oficial del modelo antes de uso comercial.

## Clonar una voz

En el paso 6, **Clonar una voz**: subes (o grabas con el micrófono) una muestra de **6 a 30 segundos** y la app le pone ese timbre a cualquier voz base (Kokoro, Azure, Edge o Piper). Funciona de voz a voz: la voz base dice el texto y luego un convertidor (**OpenVoice v2**, MIT, en formato ONNX mediante `voiceclonnx`) le cambia el timbre. Por eso la **velocidad, el tono, el estilo y las pausas** se ajustan en la voz base como siempre, y los tiempos por palabra del karaoke se conservan. Motores alternativos: FACodec y kNN-VC.

**Consentimiento obligatorio:** debes indicar si es tu propia voz o la de otra persona que te dio permiso por escrito (con su nombre), para qué la usarás, y marcar la casilla de confirmación. Sin eso no se lee ni se guarda nada. La muestra queda **cifrada** en tu bóveda (solo se descifra un instante, en un archivo temporal, mientras se convierte un clip) y al borrar la voz se eliminan la muestra y las narraciones hechas con ella. Los videos narrados con una voz clonada llevan en la descripción una línea que indica que la voz es sintética. No clones voces de personas públicas ni la uses para engañar o suplantar a nadie.

La primera vez se instala un Python privado y `voiceclonnx` y se descargan los modelos (unos 160 MB, desde Hugging Face). Corre solo en CPU (no usa la tarjeta de video).
