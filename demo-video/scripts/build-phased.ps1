param(
  [string]$MasterWebm,
  [string]$ConfigFile = "marketing/demo-video/config/demo-prod.json",
  [ValidateSet('mobile', 'desktop')][string]$Variant = 'mobile'
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot | Split-Path -Parent | Split-Path -Parent | Split-Path -Parent
Set-Location $root

$configPath = Resolve-Path -LiteralPath $ConfigFile
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

if (-not $MasterWebm) {
  $rawDir = "marketing/output/demo-video/raw"
  $MasterWebm = Get-ChildItem -LiteralPath $rawDir -Filter *.webm | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object FullName
}
if (-not (Test-Path -LiteralPath $MasterWebm)) {
  throw "Master webm not found: $MasterWebm"
}

$variantConfig = $config.variants.PSObject.Properties | Where-Object { $_.Name -eq $Variant } | Select-Object -First 1 -ExpandProperty Value
if (-not $variantConfig) {
  throw "Variant not found in config: $Variant"
}

$clipsDir = Join-Path $variantConfig.outputDir "clips"
$finalDir = $variantConfig.outputDir
New-Item -ItemType Directory -Force -Path $clipsDir | Out-Null
New-Item -ItemType Directory -Force -Path $finalDir | Out-Null

# Exact durations from the provided external audios (ffprobe)
$phases = @(
  @{ num='01'; name='presentacion';           dur=28.839125 },
  @{ num='02'; name='crear-ficha';            dur=28.865250 },
  @{ num='03'; name='evaluacion';             dur=45.165688 },
  @{ num='04'; name='descargar-informe';      dur=18.155063 },
  @{ num='05'; name='historial';              dur=20.924063 },
  @{ num='06'; name='cuenta';                 dur=20.088125 },
  @{ num='07'; name='cierre';                 dur=41.795875 }
)

$audioDir = "marketing/demo-video/audio"
$srtDir   = "marketing/demo-video/srt"
$phaseCuts = @{}

foreach ($cut in @($variantConfig.phaseCuts)) {
  if ($cut.name) {
    $phaseCuts[$cut.name] = $cut
  }
}

$cum = 0.0
$clipFiles = @()

foreach ($p in $phases) {
  $start = $cum
  $end   = [math]::Round($cum + $p.dur, 3)
  $cum   = $end

  $base = "$($p.num)-$($p.name)"
  $cut = $phaseCuts[$base]
  $phaseSource = if ($cut -and $cut.sourceFile) { [string]$cut.sourceFile } else { $MasterWebm }
  $sourceStart = if ($cut -and $null -ne $cut.sourceStart) { [double]$cut.sourceStart } else { $start }
  $sourceEnd = if ($cut -and $null -ne $cut.sourceEnd) { [double]$cut.sourceEnd } else { $end }
  $videoPad = [math]::Max(0, [math]::Round($p.dur - ($sourceEnd - $sourceStart), 3))
  $videoSlice = Join-Path $clipsDir "$base-video.mp4"
  $clipOut    = Join-Path $clipsDir "$base.mp4"

  Write-Host "=== Variant $Variant / Phase $($p.num) : source $sourceStart -> $sourceEnd / audio $($p.dur)s ==="

  # Cut silent video slice (re-encode for clean boundaries)
  $vf = @()
  if ($variantConfig.videoFilter) {
    $vf += [string]$variantConfig.videoFilter
  }
  if ($videoPad -gt 0) {
    $vf += "tpad=stop_mode=clone:stop_duration=$videoPad"
  }
  $vfArg = if ($vf.Count) { '-vf "' + ($vf -join ',') + '"' } else { '' }
  $cutCommand = "ffmpeg -y -ss $sourceStart -to $sourceEnd -i `"$phaseSource`" $vfArg -c:v libx264 -pix_fmt yuv420p -an `"$videoSlice`""
  Invoke-Expression $cutCommand

  # Mux matching audio (narration for this phase)
  $audio = Join-Path $audioDir "$base.mp3"
  if (-not (Test-Path $audio)) { $audio = Join-Path $audioDir "$base.mp3.mp3" }
  if (-not (Test-Path $audio)) { throw "Audio not found for $base" }

  ffmpeg -y -i $videoSlice -i $audio -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest $clipOut

  # Keep the separated clip
  $clipFiles += $clipOut

  # Copy SRT alongside for separate delivery / editing
  $srtSrc = Join-Path $srtDir "$base.srt"
  if (Test-Path $srtSrc) {
    Copy-Item $srtSrc (Join-Path $clipsDir "$base.srt") -Force
  }
}

# Build concat list for final joined video
$concatList = Join-Path $clipsDir "concat.txt"
$concatContent = $clipFiles | ForEach-Object {
  $full = [System.IO.Path]::GetFullPath($_)
  "file '$full'"
}
Set-Content -LiteralPath $concatList -Value $concatContent -Encoding UTF8

$joined = Join-Path $finalDir "judgepreai-demo-beta-$Variant.mp4"
ffmpeg -y -f concat -safe 0 -i $concatList -c copy $joined

Write-Host ""
Write-Host "=== DONE ==="
Write-Host "Separated clips:"
$clipFiles | ForEach-Object { Write-Host "  $_" }
Write-Host "Joined full video: $joined"
Write-Host "SRTs copied next to clips in $clipsDir"
