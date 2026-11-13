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
| `npm run render -w video -- spec.json draft` | render local (draft = 540p, final = 1080p) |

## Estado

- `feat/scaffold`: estructura, cifrado, gateway con presupuesto, ingesta local y plantilla de video.
- `feat/steps-1-5`: recuperación de contraseña, presupuesto ligado a la cuenta, inicio de un clic y pasos 1–5 con la IA real.
- `feat/sources-and-engine`: sin presupuesto, IA con tu cuenta de Claude Code, instalador de Windows, botón de edición con Claude Code y contenido desde archivos.
- `main` contiene todo lo anterior y es lo que recibe cada PC.
- Siguiente: producción y render (6–8), publicación (9) y análisis de resultados (10).
