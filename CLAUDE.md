# ContentHub Pro — reglas obligatorias

Herramienta personal para creadores: tendencias → guion → video → publicación → análisis.
Estas reglas son **obligatorias**. Varias están además forzadas por código o por `npm run check` (CI falla si se rompen).

## Ahorro de tokens (aplica a la app y a Claude Code)

1. **Toda llamada a la IA pasa por `core/src/ai/gateway.ts`.** Solo `core/src/ai/client.ts` puede importar `@anthropic-ai/sdk` o ejecutar la CLI de Claude Code (lo verifica `scripts/check-rules.mjs`). El gateway ya aplica: salida JSON validada con zod, modelo + `effort` + `max_tokens` por tarea (`core/src/models.ts`), caché cifrada (repetir una petición no cuesta nada) y reintento ante límites de uso.
2. **Dos motores intercambiables:** la cuenta de Claude Code del usuario (por defecto, sin clave de API) o una clave de API. El motor de Claude Code corre con directorio vacío y sin herramientas para no cargar contexto del repo. No hay módulo de presupuesto: no existe API para leer el saldo de la cuenta, así que no se simula.
3. **Modelo mínimo suficiente.** Haiku por defecto; Sonnet para guiones y análisis; Opus nunca se elige automáticamente. Cambiar una ruta en `ROUTES` exige justificarlo en el commit.
4. **Salidas estructuradas y cortas.** Todo paso nuevo define un esquema zod en `core/src/schemas.ts`; prohibido pedir texto libre largo.
5. **El prefijo del prompt debe ser estable** (`core/src/ai/prompts.ts`): sin fechas, ids ni datos variables antes de la parte variable. Lo variable va solo en el mensaje de usuario.
6. **Audio, video, PDFs, CSV y capturas se leen en local** (transcripción con whisper.cpp + ffmpeg de Remotion, `core/src/sources` y `core/src/ingest`; cero tokens). Fuentes largas: se condensan con el modelo barato (`sourceHighlights`) antes de pedir ideas. Las métricas con `core/src/ingest` (cero tokens). A la IA solo llega `digestToPrompt(...)` o el texto de la transcripción (resumen de unos cientos de tokens). Prohibido pegar el contenido crudo de un archivo en un prompt.
7. **Video y gráficos se generan en local** (Remotion / HTML) a partir de un JSON (`VideoSpec`). La IA escribe texto, nunca código de animación por pieza.
11. **Nada se crea a partir de audio sin confirmar:** los tramos elegidos se revisan con el creador (texto + fragmento de audio) y solo los confirmados o corregidos alimentan a la IA. La copia de audio para revisar es temporal y siempre cifrada (`Vault.sealBytes`). El **audio original** (tal como se subió, sin recodificar) se conserva cifrado (`Vault.sealBytes`, `server/src/original.ts`) hasta que el creador borre la fuente: solo sirve para los fragmentos que él elige como voz de su video (únicamente cortes y fundidos de milisegundos, cambiando entre «audios originales» y «voz generada» por video). Nunca va a la IA, nunca se clona ni se mezcla con voz sintetizada.
12. **Modo documental:** una escena con datos solo se renderiza con fuentes comprobadas por la app (`core/src/verification.ts`, `server/src/verify.ts`); lo que cite la IA nunca se acepta sin abrir la página. Los enlaces se abren solo si son públicos (guarda SSRF); `CHP_VERIFY_ALLOW_LOCAL` es solo para pruebas.
9. **Todo dato mostrado indica su fuente** (nombre y enlace). Lo que sea estimación de la IA se rotula como tal (p. ej. «potencial», perfil de audiencia). La búsqueda de temas parte de datos reales (`core/src/radar`); la IA solo ordena y cita ids, nunca inventa cifras.
10. **Cada capacidad nueva suma un check en `server/src/selftest.ts`** (`npm run selftest`, o «Probar todo» en la app) para saber qué funciona y qué no en cada PC.
8. **Resolución máxima 1080p** (consumo en celular). No agregar presets 4K. Borrador = mitad de tamaño (540p).
13. **Mantener `PROGRESS.md` al día:** léelo al empezar una sesión y actualízalo en cada PR (estado, decisiones, pendientes). Es corto a propósito; el estado vigente está en la rama más reciente de la pila de PRs (la que indica el propio archivo), que llega a `main` al fusionar en orden. Sin secretos ni datos personales.

## Cómo trabajar en este repo (Claude Code)

- Lee solo lo necesario: usa Grep/Glob y `offset/limit`; no leas `node_modules`, `dist`, `out`, `package-lock.json` ni `*.enc` (el hook `.claude/hooks/guard.mjs` lo bloquea).
- Reutiliza antes de escribir: stdlib/APIs nativas y utilidades existentes en `core/` primero. No añadas dependencias sin una razón escrita en el commit.
- Cambios pequeños y verificables. Antes de dar algo por hecho: `npm run verify` (reglas + tipos + tests).
- No repitas contexto largo en respuestas; resume y señala `archivo:línea`.
- Skills del proyecto: **Ponytail** (se habilita desde `.claude/settings.json`) y **Remotion** (`npx skills add remotion-dev/skills`, ver README).

## Seguridad

- La bóveda usa cifrado de sobre: la clave de datos se envuelve con la contraseña y con una clave de recuperación que se muestra una sola vez. No añadir ningún mecanismo que permita abrirla sin una de las dos.
- Los intentos de desbloqueo están limitados (backoff) en el servidor; no quitarlo.
- Nada de claves en el código, `.env` versionados ni logs. Las claves viven en la bóveda cifrada (AES-GCM, PBKDF2) y el servidor solo escucha en `127.0.0.1`.
- `*.enc` y `.contenthub-data/` nunca se versionan. Los datos del usuario no van en este repo.
- La clave de API es de solo escritura desde la UI: ningún endpoint la devuelve.

## Mapa

- `core/` cifrado, gateway de IA (dos motores), esquemas, presets, ingesta local, fuentes, transcripción, voces (`voice/`) y radar de datos (`radar/`)
- `server/` servidor local (bóveda, motor de IA, fuentes, ingesta)
- `app/` interfaz React + Vite + Tailwind
- `video/` plantillas Remotion y `render.mjs`
- `scripts/` `setup.mjs`, `check-rules.mjs`
