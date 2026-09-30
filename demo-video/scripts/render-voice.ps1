param(
  [Parameter(Mandatory = $true)][string]$ScriptFile,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [string]$VoiceName = 'Microsoft Pablo',
  [int]$Rate = -1,
  [int]$Volume = 100
)

Add-Type -AssemblyName System.Speech

$scriptPath = Resolve-Path -LiteralPath $ScriptFile
$outputDir = Split-Path -Parent $OutputFile
if (-not (Test-Path -LiteralPath $outputDir)) {
  throw "Output directory does not exist: $outputDir"
}

$text = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8).Trim()
if (-not $text) {
  throw 'Narration script is empty.'
}

$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$synth.SelectVoice($VoiceName)
$synth.Rate = $Rate
$synth.Volume = $Volume
$synth.SetOutputToWaveFile($OutputFile)
$synth.Speak($text)
$synth.Dispose()

"Voice render completed: $OutputFile"
