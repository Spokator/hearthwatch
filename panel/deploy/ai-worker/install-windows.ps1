# Installe le renfort d'IA sur un PC Windows : il démarre avec la session et appelle le panel (rien à ouvrir sur la box).
#
#   powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Panel https://mon-serveur.fr -Key <clé> -Model qwen2.5:7b
#
# Pour l'enlever : supprimer le raccourci « Hearthwatch renfort IA » dans shell:startup, puis le dossier
# %LOCALAPPDATA%\Hearthwatch.
param(
  [Parameter(Mandatory = $true)][string]$Panel,
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$Model = 'qwen2.5:7b',
  [string]$Ollama = 'http://127.0.0.1:11434',
  [string]$Name = $env:COMPUTERNAME,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js est nécessaire : https://nodejs.org" }

$dir = Join-Path $env:LOCALAPPDATA 'Hearthwatch'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'worker.mjs') (Join-Path $dir 'worker.mjs') -Force

# Lanceur : relance le renfort s'il s'arrête, et garde son journal à côté.
$launcher = Join-Path $dir 'renfort.cmd'
Set-Content -Path $launcher -Encoding ascii -Value @(
  '@echo off',
  'cd /d "%~dp0"',
  ':boucle',
  ('"{0}" "%~dp0worker.mjs" --panel {1} --key {2} --model {3} --ollama {4} --name {5} --log "%~dp0renfort.log"' -f $node, $Panel, $Key, $Model, $Ollama, $Name),
  'timeout /t 10 /nobreak > nul',
  'goto boucle'
)

# Démarrage avec la session, sans fenêtre noire à l'écran.
$hidden = Join-Path $dir 'renfort-silencieux.vbs'
Set-Content -Path $hidden -Encoding ascii -Value @(
  'Set shell = CreateObject("WScript.Shell")',
  ('shell.Run """{0}""", 0, False' -f $launcher)
)
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup 'Hearthwatch renfort IA.lnk'))
$shortcut.TargetPath = 'wscript.exe'
$shortcut.Arguments = '"{0}"' -f $hidden
$shortcut.WorkingDirectory = $dir
$shortcut.Description = 'Fait parler les habitants de Spokaheim avec la carte graphique de ce PC.'
$shortcut.Save()

if (-not $NoStart) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*worker.mjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process wscript.exe -ArgumentList ('"{0}"' -f $hidden) -WindowStyle Hidden
  Start-Sleep -Seconds 4
}

Write-Host "Renfort installé. Journal : $(Join-Path $dir 'renfort.log')"
Write-Host "Il repartira tout seul à l'ouverture de ta session Windows."
Write-Host "Le panel doit afficher « $Name » connecté dans Monde vivant > Réglages."
