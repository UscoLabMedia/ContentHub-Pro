@echo off
rem Claude Code para ContentHub Pro - doble clic (Windows). Abre Claude Code dentro de esta carpeta.
title Claude Code - ContentHub Pro
cd /d "%~dp0"

rem Las carpetas habituales van PRIMERO en el PATH: asi se encuentran node, git y claude aunque el PATH de Windows este danado.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
if exist "%APPDATA%\npm" set "PATH=%APPDATA%\npm;%PATH%"
if exist "%USERPROFILE%\.local\bin" set "PATH=%USERPROFILE%\.local\bin;%PATH%"

claude --version >nul 2>nul
if errorlevel 1 goto :sin_claude

echo.
echo  Claude Code - carpeta: %CD%
echo.
echo   1  Abrir Claude Code (nueva conversacion)
echo   2  Seguir la ultima conversacion de esta carpeta
echo   3  Abrir con control remoto (para trabajar desde la app de Claude)
echo.
choice /c 123 /n /t 10 /d 1 /m "Elige 1, 2 o 3 (en 10 segundos se abre la opcion 1): "
if errorlevel 3 goto :remoto
if errorlevel 2 goto :seguir

claude
goto :fin

:seguir
claude --continue
goto :fin

:remoto
claude remote-control
goto :fin

:sin_claude
echo.
echo Claude Code no esta instalado (o no se puede ejecutar).
where npm >nul 2>nul
if errorlevel 1 goto :sin_node
choice /c SN /n /m "Quieres instalarlo ahora con npm? (S/N): "
if errorlevel 2 goto :fin
call npm install -g @anthropic-ai/claude-code
set "PATH=%APPDATA%\npm;%PATH%"
claude --version >nul 2>nul
if errorlevel 1 goto :fallo
claude
goto :fin

:sin_node
echo Falta Node.js. Instalalo desde https://nodejs.org (version LTS), o abre primero ContentHub.bat, que lo instala solo.
goto :fin

:fallo
echo No se pudo instalar Claude Code. Copia el mensaje de arriba y pegalo aqui para ayudarte.

:fin
echo.
pause
