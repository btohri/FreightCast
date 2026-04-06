param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $projectRoot ".env"
$hostName = "127.0.0.1"
$port = "8000"

if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            return
        }

        $parts = $line.Split("=", 2)
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")

        if ($key -eq "FREIGHTCAST_HOST" -and $value) {
            $hostName = $value
        }

        if ($key -eq "FREIGHTCAST_PORT" -and $value) {
            $port = $value
        }
    }
}

$baseUrl = "http://${hostName}:${port}"
$healthUrl = "${baseUrl}/api/health"

function Test-FreightCastHealth {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Test-FreightCastHealth -Url $healthUrl)) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "title FreightCast Backend && cd /d `"$projectRoot`" && python backend\server.py"

    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-FreightCastHealth -Url $healthUrl) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        throw "FreightCast backend failed to start at $healthUrl"
    }
}

if (-not $NoBrowser) {
    Start-Process $baseUrl
}
