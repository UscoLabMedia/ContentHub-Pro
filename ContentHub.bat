@echo off
rem ContentHub Pro - doble clic para abrir (Windows). Instala lo que falte automaticamente.
title ContentHub Pro
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 call :install_node
where node >nul 2>nul
if errorlevel 1 goto :no_node

node scripts\start.mjs
if errorlevel 1 pause
exit /b

:install_node
echo Instalando Node.js (solo la primera vez)...
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs"
exit /b

:no_node
echo.
echo No pude instalar Node.js automaticamente.
echo Instalalo desde https://nodejs.org (version LTS) y vuelve a abrir este archivo.
pause
exit /b 1
