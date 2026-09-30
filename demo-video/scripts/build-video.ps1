param(
  [Parameter(Mandatory = $true)][string]$ConfigFile
)

$configPath = Resolve-Path -LiteralPath $ConfigFile
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

$recordingsDir = $config.video.recordingsDir
$finalVideo = $config.video.finalVideo
$narrationWav = $config.video.narrationWav

if (-not (Test-Path -LiteralPath $recordingsDir)) {
  throw "Recordings directory not found: $recordingsDir"
}

$raw = Get-ChildItem -LiteralPath $recordingsDir -Filter *.webm | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $raw) {
  throw "No .webm recording found in $recordingsDir"
}

$finalDir = Split-Path -Parent $finalVideo
if (-not (Test-Path -LiteralPath $finalDir)) {
  throw "Final output directory does not exist: $finalDir"
}

if (Test-Path -LiteralPath $narrationWav) {
  # Use video as master duration; if audio is shorter, it will play and end (no cut of video)
  ffmpeg -y -i $raw.FullName -i $narrationWav -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest $finalVideo
} else {
  ffmpeg -y -i $raw.FullName -c:v libx264 -pix_fmt yuv420p $finalVideo
}

"Video export completed: $finalVideo"
