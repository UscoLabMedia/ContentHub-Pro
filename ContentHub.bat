@echo off
rem ContentHub Pro - doble clic para abrir (Windows)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Intentando instalarlo con winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo.
  echo Si la instalacion termino, cierra esta ventana y vuelve a abrir ContentHub.bat.
  pause
  exit /b
)
node scripts\start.mjs
if errorlevel 1 pause
