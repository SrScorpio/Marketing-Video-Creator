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

const vscode: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: () => undefined, getState: () => undefined, setState: () => undefined };

export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [ttsProvider, setTtsProvider] = useState('sapi');
  const [ttsVoice, setTtsVoice] = useState('Microsoft Pablo');
  const [headless, setHeadless] = useState(true);
  const [variant, setVariant] = useState<'desktop' | 'mobile'>('desktop');
  const [phases, setPhases] = useState<Array<{ id: string; label: string; duration: number }>>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<PhaseProgressShape>({ status: 'idle', progress: 0, phases: [] });
  const [videoPath, setVideoPath] = useState<string>('');

  const appendLog = useCallback((message: string) => {
    setLogs(previous => [...previous.slice(-199), message]);
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as { type: string; data: any };

      switch (message.type) {
        case 'settings':
          setApiKey(message.data.settings?.apiKey ?? '');
          setTtsProvider(message.data.settings?.ttsProvider ?? 'sapi');
          setTtsVoice(message.data.settings?.ttsVoice ?? 'Microsoft Pablo');
          setHeadless(message.data.settings?.playwrightHeadless ?? true);
          if (message.data.project) {
            setUrl(message.data.project.url ?? '');
            setPhases(message.data.project.phases ?? []);
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

  const handleChangePhase = (id: string, field: 'label' | 'duration', value: string | number) => {
    setPhases(previous => previous.map(phase => (phase.id === id ? { ...phase, [field]: value } : phase)));
  };

  const handleSavePhases = () => {
    send('savePhases', phases);
    appendLog(`${phases.length} fase(s) enviadas para guardar.`);
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
