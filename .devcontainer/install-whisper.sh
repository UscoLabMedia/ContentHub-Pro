#!/usr/bin/env bash
# Instala whisper-cli (whisper.cpp) para transcribir audio y video en local en Linux/Codespaces.
# En Windows la app lo descarga sola; en Linux espera encontrar `whisper-cli` en el PATH.
# Se puede repetir sin problema y NUNCA hace fallar la creación del contenedor (si algo sale mal, solo avisa).
set -u
VERSION="${WHISPER_VERSION:-v1.9.5}"
DEST="${WHISPER_DEST:-/usr/local/bin}"

if command -v whisper-cli >/dev/null 2>&1; then
  echo "whisper-cli ya está instalado: $(command -v whisper-cli)"
  exit 0
fi

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

if ! command -v cmake >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
  echo "Instalando cmake y herramientas de compilación…"
  { $SUDO apt-get update -qq && $SUDO apt-get install -y -qq cmake build-essential; } || { echo "AVISO: no pude instalar cmake; instala whisper.cpp a mano y ponlo en el PATH."; exit 0; }
fi

tmp="$(mktemp -d)"
echo "Compilando whisper.cpp $VERSION (unos minutos)…"
if git -c advice.detachedHead=false clone -q --depth 1 --branch "$VERSION" https://github.com/ggml-org/whisper.cpp "$tmp/w" \
  && cmake -S "$tmp/w" -B "$tmp/w/build" -DBUILD_SHARED_LIBS=OFF >/dev/null \
  && cmake --build "$tmp/w/build" -j --config Release --target whisper-cli >/dev/null \
  && $SUDO install -m 0755 "$tmp/w/build/bin/whisper-cli" "$DEST/whisper-cli"; then
  echo "whisper-cli instalado en $DEST"
else
  echo "AVISO: no pude instalar whisper-cli. La transcripción de tus archivos no funcionará hasta instalarlo a mano (ver README)."
fi
rm -rf "$tmp"
exit 0
