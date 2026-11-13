@echo off
rem ============================================================================
rem  ContentHub Pro - instalador para un PC nuevo con Windows.
rem  Es UN solo archivo: copialo al otro PC y haz doble clic.
rem  Instala Git y Node.js si faltan, descarga el proyecto, crea un acceso
rem  directo en el Escritorio y abre la app.
rem ============================================================================
title Instalar ContentHub Pro
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText('%~f0'); iex $s.Substring($s.IndexOf('#PS1#'))"
echo.
pause
exit /b
#PS1#
$ErrorActionPreference = 'Stop'
$repo   = 'https://github.com/UscoLabMedia/ContentHub-Pro.git'
$branch = 'main'
$dir    = Join-Path $env:USERPROFILE 'ContentHub-Pro'

function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Install-Tool($id, $cmd, $nombre) {
  if (Have $cmd) { return }
  Write-Host "Instalando $nombre (solo la primera vez)..." -ForegroundColor Cyan
  if (-not (Have 'winget')) { throw "No encuentro 'winget'. Actualiza 'Instalador de aplicacion' desde Microsoft Store y vuelve a intentar." }
  winget install -e --id $id --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Have $cmd)) { throw "No pude instalar $nombre automaticamente. Instalalo a mano y vuelve a ejecutar este archivo." }
}

try {
  Install-Tool 'Git.Git' 'git' 'Git'
  Install-Tool 'OpenJS.NodeJS.LTS' 'node' 'Node.js'

  if (Test-Path (Join-Path $dir '.git')) {
    Write-Host 'Actualizando el proyecto...' -ForegroundColor Cyan
    git -C $dir fetch origin $branch
    git -C $dir checkout $branch
    git -C $dir pull --ff-only origin $branch
  } else {
    Write-Host 'Descargando el proyecto (si pide iniciar sesion en GitHub, hazlo en la ventana que se abre)...' -ForegroundColor Cyan
    git clone --branch $branch $repo $dir
  }
  if ($LASTEXITCODE -ne 0) { throw 'No pude descargar el proyecto desde GitHub.' }

  $desktop = [Environment]::GetFolderPath('Desktop')
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path $desktop 'ContentHub Pro.lnk'))
  $lnk.TargetPath = Join-Path $dir 'ContentHub.bat'
  $lnk.WorkingDirectory = $dir
  $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
  $lnk.Save()

  Write-Host 'Listo. Se creo el acceso directo "ContentHub Pro" en el Escritorio. Abriendo la app...' -ForegroundColor Green
  & (Join-Path $dir 'ContentHub.bat')
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
