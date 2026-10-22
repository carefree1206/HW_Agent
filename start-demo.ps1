param([ValidateRange(1024, 65535)][int]$Port = 8000)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$drillPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $drillPython)) { throw 'Please create .venv and install requirements first. See README.md.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\index.html'))) { throw 'Please run npm ci and npm run build first.' }
$env:UNDELIVERED_INTERNAL_URL = "http://127.0.0.1:$Port"
Write-Host "Undelivered demo: http://127.0.0.1:$Port (Ctrl+C to stop)" -ForegroundColor Green
& $drillPython -m uvicorn backend.main:app --host 127.0.0.1 --port $Port --no-access-log
