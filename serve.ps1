# Tiny local web server for testing without Node or Python.
# ES modules do not load from file://, so the pages need http://localhost.
#
#   powershell -ExecutionPolicy Bypass -File serve.ps1
#   then open http://localhost:8080/ (stop with Ctrl+C)
param([int]$Port = 8080)

$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$Port/ (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(200)) { }
    $ctx = $task.Result
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }
      # Same as GitHub Pages: nothing outside the repo, and never private/.
      $inside = $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
      $private = $rel -match '^(private|\.git)(/|$)'
      if ($inside -and -not $private -and (Test-Path $path -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($path)
        $type = $types[[IO.Path]::GetExtension($path).ToLower()]
        if (-not $type) { $type = 'application/octet-stream' }
        $res.ContentType = $type
        $res.Headers['Cache-Control'] = 'no-store'
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
