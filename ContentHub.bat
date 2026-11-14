@echo off
rem ContentHub Pro - doble clic para abrir (Windows). Instala lo que falte automaticamente.
title ContentHub Pro
cd /d "%~dp0"

rem Node y Git en sus carpetas habituales van PRIMERO en el PATH: asi funcionan aunque el PATH de
rem Windows este danado (por ejemplo, con una comilla suelta) o aun no se haya actualizado.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"

rem Se comprueba ejecutandolo de verdad: "where node" puede encontrarlo aunque CMD no pueda ejecutarlo.
node -v >nul 2>nul
if errorlevel 1 call :install_node
node -v >nul 2>nul
if errorlevel 1 goto :no_node

node scripts\start.mjs
if errorlevel 1 pause
exit /b

:install_node
echo Instalando Node.js (solo la primera vez)...
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
exit /b

:no_node
echo.
echo No pude instalar Node.js automaticamente.
echo Instalalo desde https://nodejs.org (version LTS) y vuelve a abrir este archivo.
pause
exit /b 1
