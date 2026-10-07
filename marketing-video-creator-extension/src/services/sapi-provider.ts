/**
 * Proveedor TTS local basado en SAPI (System.Speech.Synthesis) vía PowerShell.
 * Sin API key y sin conexión a internet: solo Windows.
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('sapi-provider');

export interface SapiSynthesisOptions {
  texto: string;
  outputPath: string;
  voz?: string;
  /** Multiplicador de velocidad (0.5 a 2.0). */
  rate?: number;
  /** Multiplicador de volumen (0 a 1). */
  volume?: number;
}

const POWERSHELL_TIMEOUT_MS = 60000;

/**
 * Script SAPI. Se escribe a un fichero temporal con BOM UTF-8 para que
 * Windows PowerShell 5.1 lo interprete siempre como UTF-8.
 * Los argumentos llegan por -File, así que ningún texto del usuario
 * se interpola en el comando.
 */
const POWERSHELL_SCRIPT = `param(
  [Parameter(Mandatory = $true)][string]$TextPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$Voice = "",
  [int]$Rate = 0,
  [int]$Volume = 100
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8)
if ([string]::IsNullOrWhiteSpace($text)) {
  throw "Texto vacio para TTS"
}

$outDir = Split-Path -Parent $OutputPath
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $selected = $synth.Voice.Name
  if ($Voice -ne "") {
    $target = $Voice.ToLower()
    $match = $synth.GetInstalledVoices() |
      Where-Object { $_.Enabled -and $_.VoiceInfo.Name.ToLower().Contains($target) } |
      Select-Object -First 1
    if ($match) {
      $synth.SelectVoice($match.VoiceInfo.Name)
      $selected = $match.VoiceInfo.Name
    } else {
      $selected = $synth.Voice.Name + " (voz por defecto, no instalada: " + $Voice + ")"
    }
  }
  $synth.Rate = $Rate
  $synth.Volume = $Volume
  $synth.SetOutputToWaveFile($OutputPath)
  $synth.Speak($text)
  $synth.SetOutputToNull()
} finally {
  $synth.Dispose()
}

$item = Get-Item -LiteralPath $OutputPath
if ($item.Length -eq 0) {
  throw "SAPI no genero audio"
}
Write-Output ("VOICE=" + $selected)
Write-Output ("BYTES=" + $item.Length)
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* la limpieza del temporal no debe romper el flujo */
  }
}

/**
 * Sintetiza `texto` a un WAV en `outputPath` usando SAPI.
 * Resuelve con la ruta generada; rechaza si PowerShell/SAPI falla
 * o si el resultado está vacío.
 */
export function sintetizarSapi(options: SapiSynthesisOptions): Promise<string> {
  const { texto, outputPath } = options;

  if (process.platform !== 'win32') {
    return Promise.reject(new Error('El provider SAPI solo funciona en Windows (System.Speech.Synthesis).'));
  }

  if (!texto || !texto.trim()) {
    return Promise.reject(new Error('El texto para TTS está vacío.'));
  }

  const voz = (options.voz ?? '').trim();
  const sapiRate = clamp(Math.round(((options.rate ?? 1) - 1) * 10), -10, 10);
  const sapiVolume = clamp(Math.round((options.volume ?? 1) * 100), 0, 100);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvc-tts-'));
  const textPath = path.join(tmpDir, 'texto.txt');
  const scriptPath = path.join(tmpDir, 'sapi-tts.ps1');

  try {
    fs.writeFileSync(textPath, texto, 'utf8');
    fs.writeFileSync(scriptPath, '\uFEFF' + POWERSHELL_SCRIPT, 'utf8');
  } catch (error) {
    removeDir(tmpDir);
    return Promise.reject(error);
  }

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-TextPath', textPath,
    '-OutputPath', outputPath,
    '-Rate', String(sapiRate),
    '-Volume', String(sapiVolume)
  ];
  if (voz) {
    args.push('-Voice', voz);
  }

  logger.debug(`Ejecutando SAPI: rate=${sapiRate}, volume=${sapiVolume}, voz=${voz || '(por defecto)'}`);

  return new Promise<string>((resolve, reject) => {
    child_process.execFile(
      'powershell.exe',
      args,
      { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        removeDir(tmpDir);

        if (error) {
          const detail = (stderr || stdout || error.message).trim();
          reject(new Error(`SAPI TTS falló: ${detail}`));
          return;
        }

        try {
          const stats = fs.statSync(outputPath);
          if (stats.size === 0) {
            throw new Error('audio vacío');
          }
        } catch {
          reject(new Error(`SAPI TTS no generó audio en ${outputPath}`));
          return;
        }

        logger.debug(stdout.trim());
        resolve(outputPath);
      }
    );
  });
}
