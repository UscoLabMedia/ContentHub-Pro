# ContentHub Pro

Estudio personal para creadores de contenido: **tendencias → tratamiento → audiencia → formatos → guion → producción → borrador → render → publicación → análisis de resultados**.
Plataformas: TikTok, Instagram, Facebook, YouTube (largo y Shorts) y Spotify.

## Arranque en cualquier PC

```bash
git clone https://github.com/UscoLabMedia/ContentHub-Pro.git
cd ContentHub-Pro
npm run setup
```

```bash
npm run dev:server
```

```bash
npm run dev:app
```

Abre http://localhost:5173, crea la contraseña de tu bóveda y pega tu clave de API (queda cifrada; nunca se muestra de nuevo).
También funciona en Codespaces / Dev Containers (`.devcontainer`).

## Principios

- **Cifrado:** bóveda AES-256-GCM (clave derivada con PBKDF2) en `~/.contenthub-pro/vault.enc`, fuera del repo. El servidor solo escucha en `127.0.0.1`.
- **Presupuesto de IA con barra visual** (diario y semanal). Al agotarse, las tareas esperan y se reanudan solas cuando la ventana se renueva. El gasto se mide con el uso real que devuelve cada llamada.
- **Ahorro de tokens obligatorio** (ver `CLAUDE.md`): único gateway de IA, JSON validado, modelo por tarea, caché cifrada, ingesta local de métricas, video local con Remotion, máximo 1080p.
- **Métricas sin tokens:** sube CSV, PDF o capturas; se leen en local y solo un resumen mínimo llega a la IA.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run verify` | reglas + tipos + tests |
| `npm run video:studio` | vista previa de plantillas Remotion |
| `npm run render -w video -- spec.json draft` | render local (draft = 540p, final = 1080p) |

## Estado

Esta rama (`feat/scaffold`) contiene la estructura, el cifrado, el gateway con presupuesto, la ingesta local y la plantilla de video. Los pasos 1–5 del prototipo, la publicación (9) y el análisis (10) se migran en las siguientes ramas.
