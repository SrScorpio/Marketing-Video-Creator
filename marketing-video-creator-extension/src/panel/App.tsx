/**
 * Panel de control del webview.
 *
 * Se comunica con el extension host mediante `acquireVsCodeApi()`
 * (window.postMessage NO llega al host).
 *
 * Nota: @vscode/webview-ui-toolkit está deprecado y sus tipos React son
 * incompletos; se usan alias `any` para los componentes para no romper el
 * type-check del proyecto.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  VSCodeButton,
  VSCodeCheckbox,
  VSCodeDropdown,
  VSCodeOption,
  VSCodeTextField
} from '@vscode/webview-ui-toolkit/react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TextField: any = VSCodeTextField;
const Dropdown: any = VSCodeDropdown;
const Option: any = VSCodeOption;
const Button: any = VSCodeButton;
const Checkbox: any = VSCodeCheckbox;

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface PhaseProgressShape {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  phases: Array<{
    id: string;
    label: string;
    status: string;
    progress: number;
    clipPath?: string;
    error?: string;
  }>;
}

interface PhaseDraft {
  id: string;
  label: string;
  duration: number;
  url?: string;
  script?: string;
  /** Pasos de captura en texto JSON mientras se editan. */
  stepsText?: string;
}

const textareaStyle = {
  width: '100%',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  fontSize: '12px',
  color: 'var(--vscode-input-foreground)',
  background: 'var(--vscode-input-background)',
  border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
  borderRadius: '2px',
  padding: '4px'
} as const;

const vscode: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: () => undefined, getState: () => undefined, setState: () => undefined };

export interface RequirementShape {
  id: string;
  label: string;
  severity: 'obligatorio' | 'opcional';
  status: 'ok' | 'missing' | 'degraded';
  detail: string;
  fix?: string;
  command?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [ttsProvider, setTtsProvider] = useState('sapi');
  const [ttsVoice, setTtsVoice] = useState('Microsoft Pablo');
  const [headless, setHeadless] = useState(true);
  const [variant, setVariant] = useState<'desktop' | 'mobile'>('desktop');
  const [phases, setPhases] = useState<PhaseDraft[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<PhaseProgressShape>({ status: 'idle', progress: 0, phases: [] });
  const [videoPath, setVideoPath] = useState<string>('');
  const [requirements, setRequirements] = useState<RequirementShape[] | null>(null);

  const appendLog = useCallback((message: string) => {
    setLogs(previous => [...previous.slice(-199), message]);
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as { type: string; data: any };

      switch (message.type) {
        case 'requirements':
          setRequirements(Array.isArray(message.data) ? (message.data as RequirementShape[]) : null);
          break;

        case 'settings':
          setApiKey(message.data.settings?.apiKey ?? '');
          setTtsProvider(message.data.settings?.ttsProvider ?? 'sapi');
          setTtsVoice(message.data.settings?.ttsVoice ?? 'Microsoft Pablo');
          setHeadless(message.data.settings?.playwrightHeadless ?? true);
          if (message.data.project) {
            setUrl(message.data.project.url ?? '');
            setPhases(
              (message.data.project.phases ?? []).map((phase: PhaseDraft & { steps?: unknown[] }) => ({
                ...phase,
                stepsText: phase.steps && phase.steps.length > 0 ? JSON.stringify(phase.steps, null, 2) : ''
              }))
            );
            setVariant(message.data.project.variant === 'mobile' ? 'mobile' : 'desktop');
          }
          setProgress(message.data.progress ?? { status: 'idle', progress: 0, phases: [] });
          break;

        case 'state':
          setProgress(message.data);
          if (message.data.status === 'running') {
            setActiveTab(2);
          }
          break;

        case 'log':
          appendLog(String(message.data));
          break;

        case 'videoReady':
          setVideoPath(message.data.path);
          appendLog(`Vídeo generado (${message.data.variant}): ${message.data.path}`);
          break;

        default:
          break;
      }
    };

    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, [appendLog]);

  const send = (type: string, data?: unknown) => vscode.postMessage({ type, data });

  const running = progress.status === 'running';

  const handleSaveConfig = () => {
    send('saveConfig', { url, apiKey, ttsProvider, ttsVoice, headless });
    appendLog('Configuración enviada para guardar.');
  };

  const handleAddPhase = () => {
    setPhases(previous => [
      ...previous,
      { id: `fase-${previous.length + 1}`, label: `Fase ${previous.length + 1}`, duration: 10 }
    ]);
  };

  const handleChangePhase = (id: string, field: keyof PhaseDraft, value: string | number) => {
    setPhases(previous => previous.map(phase => (phase.id === id ? { ...phase, [field]: value } : phase)));
  };

  const handleSavePhases = () => {
    const prepared: Array<Record<string, unknown>> = [];
    const parseErrors: string[] = [];

    for (const phase of phases) {
      const stepsText = (phase.stepsText ?? '').trim();
      let steps: unknown;

      if (stepsText) {
        try {
          steps = JSON.parse(stepsText);
        } catch {
          parseErrors.push(`${phase.label}: los pasos no son JSON válido.`);
          continue;
        }
      }

      prepared.push({
        id: phase.id,
        label: phase.label,
        duration: phase.duration,
        url: phase.url?.trim() || undefined,
        script: phase.script?.trim() || undefined,
        steps
      });
    }

    if (parseErrors.length > 0) {
      for (const error of parseErrors) {
        appendLog(error);
      }
      appendLog('No se han guardado las fases: corrige los pasos marcados.');
      return;
    }

    send('savePhases', prepared);
    appendLog(`${prepared.length} fase(s) enviadas para guardar.`);
  };

  return (
    <div style={{ padding: '16px', fontFamily: 'var(--vscode-font-family)' }}>
      <h2>Marketing Video Creator</h2>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['Configuración', 'Fases', 'Progreso'].map((tab, index) => (
          <Button
            key={tab}
            appearance={index === activeTab ? 'primary' : 'secondary'}
            onClick={() => setActiveTab(index)}
          >
            {tab}
          </Button>
        ))}
      </div>

      {activeTab === 0 && (
        <div>
          <div
            style={{
              border: '1px solid var(--vscode-panel-border)',
              borderRadius: '4px',
              padding: '8px',
              marginBottom: '16px'
            }}
          >
            <strong>Requisitos del sistema</strong>
            <p style={{ marginTop: '4px', marginBottom: '8px' }}>
              FFmpeg/FFprobe y el navegador de Playwright no viajan dentro de la extensión: se comprueban antes de
              grabar. La narración necesita Windows (SAPI del sistema).
            </p>
            <Button appearance="secondary" onClick={() => send('checkRequirements')}>
              Comprobar requisitos
            </Button>
            {requirements && (
              <ul style={{ marginTop: '8px', marginBottom: 0, paddingLeft: '18px' }}>
                {requirements.map(check => (
                  <li key={check.id} style={{ marginBottom: '4px' }}>
                    {check.status === 'ok' ? '✅' : check.status === 'degraded' ? '⚠️' : '❌'}{' '}
                    <strong>{check.label}</strong>: {check.detail}
                    {check.command ? (
                      <>
                        {' · '}
                        <code>{check.command}</code>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <TextField
            label="URL de la app a demostrar"
            value={url}
            onChange={(event: any) => setUrl(event.target.value)}
            style={{ width: '100%', display: 'block', marginBottom: '12px' }}
          />
          <TextField
            label="API Key (Nan.Builders) — se guarda en los ajustes de usuario"
            type="password"
            value={apiKey}
            onChange={(event: any) => setApiKey(event.target.value)}
            style={{ width: '100%', display: 'block', marginBottom: '12px' }}
          />
          <Dropdown
            label="Motor TTS"
            value={ttsProvider}
            onChange={(event: any) => setTtsProvider(event.target.value)}
            style={{ width: '100%', display: 'block', marginBottom: '12px' }}
          >
            <Option value="sapi">SAPI local (Windows)</Option>
            <Option value="edge-tts">edge-tts (pendiente)</Option>
            <Option value="external">Externo (pendiente)</Option>
          </Dropdown>
          <TextField
            label="Voz TTS"
            value={ttsVoice}
            onChange={(event: any) => setTtsVoice(event.target.value)}
            style={{ width: '100%', display: 'block', marginBottom: '12px' }}
          />
          <Dropdown
            label="Variante de grabación"
            value={variant}
            onChange={(event: any) => setVariant(event.target.value)}
            style={{ width: '100%', display: 'block', marginBottom: '12px' }}
          >
            <Option value="desktop">Desktop (1920x1080)</Option>
            <Option value="mobile">Mobile (1080x1920)</Option>
          </Dropdown>
          <Checkbox checked={headless} onChange={(event: any) => setHeadless(event.target.checked)}>
            Capturar en modo headless
          </Checkbox>
          <div style={{ marginTop: '12px' }}>
            <Button appearance="primary" onClick={handleSaveConfig}>
              Guardar configuración
            </Button>
          </div>
        </div>
      )}

      {activeTab === 1 && (
        <div>
          <strong>Fases del vídeo</strong>
          <p style={{ marginTop: '4px' }}>
            Cada fase tiene su guion (lo que se narra) y sus pasos de captura. Acciones válidas:{' '}
            <code>goto</code> {'{url}'}, <code>click</code> {'{selector}'}, <code>fill</code> {'{selector, text}'},{' '}
            <code>press</code> {'{selector, key}'}, <code>waitForSelector</code> {'{selector, timeoutMs}'}, <code>wait</code> {'{ms}'}.
          </p>
          <div style={{ marginTop: '12px', marginBottom: '12px' }}>
            <Button onClick={handleAddPhase}>Añadir fase</Button>{' '}
            <Button onClick={handleSavePhases}>Guardar fases</Button>
          </div>
          {phases.length === 0 && <p>No hay fases configuradas.</p>}
          {phases.map(phase => (
            <div
              key={phase.id}
              style={{
                marginBottom: '8px',
                padding: '8px',
                border: '1px solid var(--vscode-panel-border)',
                borderRadius: '4px'
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                <strong>{phase.label}</strong>
                <span>({phase.duration}s)</span>
                <Button
                  appearance="secondary"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setPhases(previous => previous.filter(item => item.id !== phase.id))}
                >
                  Eliminar
                </Button>
              </div>
              <TextField
                label="Nombre de fase"
                value={phase.label}
                onChange={(event: any) => handleChangePhase(phase.id, 'label', event.target.value)}
                style={{ width: '100%', display: 'block' }}
              />
              <TextField
                label="Duración (segundos)"
                value={String(phase.duration)}
                onChange={(event: any) => handleChangePhase(phase.id, 'duration', Number(event.target.value) || 0)}
                style={{ width: '100%', display: 'block' }}
              />
              <TextField
                label="URL de la fase (opcional; si no, la del proyecto)"
                value={phase.url ?? ''}
                onChange={(event: any) => handleChangePhase(phase.id, 'url', event.target.value)}
                style={{ width: '100%', display: 'block' }}
              />
              <label style={{ display: 'block', marginTop: '8px', marginBottom: '4px' }}>
                Guion de la narración (vacío = fase sin voz)
              </label>
              <textarea
                aria-label="Guion de la narración"
                value={phase.script ?? ''}
                onChange={(event: any) => handleChangePhase(phase.id, 'script', event.target.value)}
                rows={3}
                placeholder="Ej.: En esta pantalla se crea la ficha del caballo con sus datos básicos."
                style={textareaStyle}
              />
              <label style={{ display: 'block', marginTop: '8px', marginBottom: '4px' }}>
                Pasos de captura (JSON, opcional)
              </label>
              <textarea
                aria-label="Pasos de captura"
                value={phase.stepsText ?? ''}
                onChange={(event: any) => handleChangePhase(phase.id, 'stepsText', event.target.value)}
                rows={4}
                placeholder='[{"action":"click","selector":"#nueva-ficha"},{"action":"fill","selector":"#nombre","text":"Rocinante"}]'
                style={textareaStyle}
              />
            </div>
          ))}
        </div>
      )}

      {activeTab === 2 && (
        <div>
          <div
            style={{
              height: '20px',
              borderRadius: '10px',
              overflow: 'hidden',
              border: '1px solid var(--vscode-panel-border)',
              marginBottom: '16px'
            }}
          >
            <div
              style={{
                width: `${progress.progress}%`,
                background: 'var(--vscode-progressBar-background)',
                height: '100%',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
          <p>
            Estado: <strong>{progress.status}</strong> ({progress.progress}%)
          </p>

          <ul style={{ listStyle: 'none', padding: 0 }}>
            {progress.phases.map(phase => (
              <li key={phase.id} style={{ marginBottom: '4px' }}>
                {phase.status === 'done'
                  ? '✅'
                  : phase.status === 'error'
                    ? '❌'
                    : phase.status === 'cancelled'
                      ? '⏹️'
                      : '⏳'}{' '}
                <strong>{phase.label}</strong> — {phase.status} ({phase.progress}%)
                {phase.error ? <em> — {phase.error}</em> : null}
              </li>
            ))}
            {progress.phases.length === 0 && <li>Sin fases: inicia la captura para ver el progreso.</li>}
          </ul>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' }}>
            <Button appearance="primary" onClick={() => send('startCapture')} disabled={running}>
              {running ? 'Capturando…' : 'Iniciar captura'}
            </Button>
            <Button appearance="secondary" onClick={() => send('cancel')} disabled={!running}>
              Cancelar
            </Button>
            <Button appearance="secondary" onClick={() => send('buildVideo')} disabled={running}>
              Montar vídeo
            </Button>
            <Button appearance="secondary" onClick={() => send('exportMobile')} disabled={running}>
              Exportar mobile
            </Button>
            <Button appearance="secondary" onClick={() => send('exportDesktop')} disabled={running}>
              Exportar desktop
            </Button>
            <Button appearance="secondary" onClick={() => send('openOutputFolder')}>
              Abrir carpeta
            </Button>
          </div>

          {videoPath && (
            <p>
              Último vídeo: <code>{videoPath}</code>
            </p>
          )}

          <div
            style={{
              marginTop: '16px',
              maxHeight: '220px',
              overflow: 'auto',
              padding: '12px',
              border: '1px solid var(--vscode-panel-border)',
              borderRadius: '4px',
              fontFamily: 'var(--vscode-editor-font-family)',
              fontSize: '12px'
            }}
          >
            {logs.map((log, index) => (
              <div key={index}>{log}</div>
            ))}
            {logs.length === 0 && <span>Sin eventos.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
