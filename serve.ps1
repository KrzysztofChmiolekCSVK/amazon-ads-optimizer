$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8123

$contentTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'
    '.js' = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png' = 'image/png'
    '.jpg' = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.svg' = 'image/svg+xml'
    '.ico' = 'image/x-icon'
    '.csv' = 'text/csv; charset=utf-8'
    '.txt' = 'text/plain; charset=utf-8'
    '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    '.xls' = 'application/vnd.ms-excel'
}

function Get-ResponseBytes {
    param(
        [int]$StatusCode,
        [string]$ReasonPhrase,
        [byte[]]$Body,
        [string]$ContentType = 'text/plain; charset=utf-8'
    )

    $headerText = "HTTP/1.1 $StatusCode $ReasonPhrase`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
    $responseBytes = New-Object byte[] ($headerBytes.Length + $Body.Length)
    [System.Array]::Copy($headerBytes, 0, $responseBytes, 0, $headerBytes.Length)
    [System.Array]::Copy($Body, 0, $responseBytes, $headerBytes.Length, $Body.Length)
    return $responseBytes
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
Write-Host "Serving $root at http://localhost:$port/"

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)

            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) {
                continue
            }

            while ($reader.ReadLine()) { }

            $parts = $requestLine.Split(' ')
            $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
            $requestPath = [Uri]::UnescapeDataString(($rawPath.Split('?')[0]).TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($requestPath)) {
                $requestPath = 'index.html'
            }

            $fullPath = Join-Path $root $requestPath
            $resolvedRoot = [System.IO.Path]::GetFullPath($root)
            $resolvedPath = [System.IO.Path]::GetFullPath($fullPath)

            if (-not $resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $resolvedPath -PathType Leaf)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
                $response = Get-ResponseBytes -StatusCode 404 -ReasonPhrase 'Not Found' -Body $body
            }
            else {
                $ext = [System.IO.Path]::GetExtension($resolvedPath).ToLowerInvariant()
                $body = [System.IO.File]::ReadAllBytes($resolvedPath)
                $contentType = if ($contentTypes.ContainsKey($ext)) { $contentTypes[$ext] } else { 'application/octet-stream' }
                $response = Get-ResponseBytes -StatusCode 200 -ReasonPhrase 'OK' -Body $body -ContentType $contentType
            }

            $stream.Write($response, 0, $response.Length)
            $stream.Flush()
        }
        finally {
            $client.Close()
        }
    }
}
finally {
    $listener.Stop()
}
