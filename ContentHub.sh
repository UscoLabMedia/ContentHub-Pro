#!/bin/bash
# ContentHub Pro - abrir (Linux)
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Instala Node.js 22 LTS (https://nodejs.org o tu gestor de paquetes) y vuelve a ejecutar."; exit 1; }
exec node scripts/start.mjs
