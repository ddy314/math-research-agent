$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot '../dist/src/cli.js') @args
exit $LASTEXITCODE
