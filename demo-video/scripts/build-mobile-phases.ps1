param(
  [string]$ConfigFile = "marketing/demo-video/config/demo-prod.json"
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot | Split-Path -Parent | Split-Path -Parent | Split-Path -Parent
Set-Location $root

$config = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
$variant = $config.variants.mobile
$rawDir = $variant.recordingsDir
$outputDir = $variant.outputDir
$clipsDir = Join-Path $outputDir 'clips'
$audioDir = 'marketing/demo-video/audio'
$srtDir = 'marketing/demo-video/srt'
$pdfPagesDir = 'marketing/output/demo-video/mobile/pdf-pages'

function Resolve-PdfPageImage {
  param([string]$PageToken)

  if (-not (Test-Path -LiteralPath $pdfPagesDir)) { return $null }

  $patterns = @(
    "page-$PageToken.png",
    "page-$PageToken.jpg",
    "page-$PageToken.jpeg",
    "*page*$PageToken*.png",
    "*page*$PageToken*.jpg",
    "*page*$PageToken*.jpeg",
    "*000$PageToken*.png",
    "*000$PageToken*.jpg",
    "*000$PageToken*.jpeg"
  )

  foreach ($pattern in $patterns) {
    $match = Get-ChildItem -LiteralPath $pdfPagesDir -File -Filter $pattern -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -First 1
    if ($match) { return $match.FullName }
  }

  return $null
}

New-Item -ItemType Directory -Force -Path $clipsDir | Out-Null

$phases = @(
  '01-presentacion',
  '02-crear-ficha',
  '03-evaluacion',
  '04-descargar-informe',
  '05-historial',
  '06-cuenta',
  '07-cierre'
)

$clipFiles = @()

foreach ($phase in $phases) {
  $raw = Join-Path $rawDir "$phase.webm"
  $audio = Join-Path $audioDir "$phase.mp3"
  $srt = Join-Path $srtDir "$phase.srt"
  if (-not (Test-Path -LiteralPath $audio)) { throw "Audio missing: $audio" }

  $audioDur = [double](ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $audio)
  $videoSlice = Join-Path $clipsDir "$phase-video.mp4"
  $clipOut = Join-Path $clipsDir "$phase.mp4"

  $pdfPage1 = Resolve-PdfPageImage '1'
  $pdfPage2 = Resolve-PdfPageImage '2'
  if ($phase -eq '04-descargar-informe' -and $pdfPage1 -and $pdfPage2) {
    $halfDur = [math]::Round($audioDur / 2, 3)
    Write-Host "=== $phase pdf-pages audio=$audioDur half=$halfDur ==="
    ffmpeg -y -loop 1 -t $halfDur -i $pdfPage1 -loop 1 -t $halfDur -i $pdfPage2 -i $audio -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[v0];[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[v]" -map "[v]" -map 2:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest $clipOut
    if (Test-Path -LiteralPath $srt) {
      Copy-Item -LiteralPath $srt -Destination (Join-Path $clipsDir "$phase.srt") -Force
    }
    $clipFiles += [System.IO.Path]::GetFullPath($clipOut)
    continue
  }

  if (-not (Test-Path -LiteralPath $raw)) { throw "Raw phase missing: $raw" }
  $videoDur = [double](ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $raw)
  $pad = [math]::Max(0, [math]::Round($audioDur - $videoDur, 3))

  $vf = "scale=1080:1920"
  if ($pad -gt 0) { $vf = "$vf,tpad=stop_mode=clone:stop_duration=$pad" }

  Write-Host "=== $phase video=$videoDur audio=$audioDur pad=$pad ==="
  ffmpeg -y -i $raw -t $audioDur -vf $vf -c:v libx264 -pix_fmt yuv420p -an $videoSlice
  ffmpeg -y -i $videoSlice -i $audio -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest $clipOut

  if (Test-Path -LiteralPath $srt) {
    Copy-Item -LiteralPath $srt -Destination (Join-Path $clipsDir "$phase.srt") -Force
  }
  $clipFiles += [System.IO.Path]::GetFullPath($clipOut)
}

$concat = Join-Path $clipsDir 'concat.txt'
$clipFiles | ForEach-Object { "file '$_'" } | Set-Content -LiteralPath $concat -Encoding UTF8
$final = Join-Path $outputDir 'judgepreai-demo-mobile-final.mp4'
ffmpeg -y -f concat -safe 0 -i $concat -c copy $final

Write-Host "DONE $final"
