# ContentHub Pro

Estudio personal para creadores de contenido: **tendencias → tratamiento → audiencia → formatos → guion → producción → borrador → render → publicación → análisis de resultados**.
Plataformas: TikTok, Instagram, Facebook, YouTube (largo y Shorts) y Spotify.

## Abrir la app (un clic)

| Sistema | Qué hacer |
|---|---|
| Windows | doble clic en `ContentHub.bat` |
| macOS | doble clic en `ContentHub.command` |
| Linux | `./ContentHub.sh` |

El lanzador instala lo necesario la primera vez, se actualiza desde GitHub si no tienes cambios locales, prepara la interfaz y abre el navegador. Si falta Node.js, intenta instalarlo (winget/Homebrew) o te indica cómo.

**En un PC nuevo** (una sola vez): instala [Git](https://git-scm.com) y ejecuta

```bash
git clone https://github.com/UscoLabMedia/ContentHub-Pro.git
```

y luego haz doble clic en el lanzador de tu sistema, dentro de la carpeta `ContentHub-Pro`.

**Para hacer ajustes** (recarga en caliente): `npm run dev:all`. Pruebas y reglas: `npm run verify`.
También funciona en Codespaces / Dev Containers (`.devcontainer`).

## Contraseña y recuperación

- Al crear la bóveda se muestra **una sola vez** una *clave de recuperación*. Guárdala fuera del equipo.
- Si olvidas la contraseña: «Olvidé mi contraseña» → clave de recuperación → nueva contraseña. Tus datos se conservan.
- Si pierdes **ambas**, los datos no se pueden recuperar: no hay puerta trasera ni servidor que lo restablezca. Es lo que hace real el cifrado.
- Desde Ajustes puedes cambiar la contraseña o generar una clave de recuperación nueva (la anterior deja de funcionar).

## Presupuesto ligado a tu cuenta

La barra muestra el gasto diario y semanal frente a tus topes (Ajustes). Hay dos niveles:

1. **Gasto medido por la app** (siempre): usa el consumo real de cada llamada.
2. **Gasto de toda tu cuenta** (opcional): pega una clave de administrador (`sk-ant-admin…`) de tu organización en la Consola de Claude y la barra toma el mayor entre ambos. Requiere una organización de Consola; las cuentas individuales y el plan Team de claude.ai no tienen esa API. No existe una API pública para leer el saldo prepagado ni el límite de tu suscripción de claude.ai.

## Principios

- **Cifrado:** bóveda AES-256-GCM (clave derivada con PBKDF2) en `~/.contenthub-pro/vault.enc`, fuera del repo. El servidor solo escucha en `127.0.0.1`.
- **Presupuesto de IA con barra visual** (diario y semanal). Al agotarse, las tareas esperan y se reanudan solas cuando la ventana se renueva. El gasto se mide con el uso real que devuelve cada llamada.
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
- Siguiente: producción y render (6–8), publicación (9) y análisis de resultados (10).
