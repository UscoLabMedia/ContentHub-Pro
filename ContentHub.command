#!/bin/bash
# ContentHub Pro - doble clic para abrir (macOS)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then brew install node; else
    echo "Instala Node.js 22 LTS desde https://nodejs.org y vuelve a abrir este archivo."; read -r -p "Enter para salir"; exit 1
  fi
fi
node scripts/start.mjs || read -r -p "Enter para salir"
