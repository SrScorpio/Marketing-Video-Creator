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

/* ------------------------------------------------------------------------- *
 * Descubrimiento automático (SSS-282)
 *
 * Estos tipos son el espejo de `src/discovery/panel-model.ts`: el webview no
 * puede importar módulos de Node (fs/path), así que el host le manda el payload
 * ya resumido con el mismo contrato.
 * ------------------------------------------------------------------------- */

interface DiscoveryProgressShape {
  status: 'idle' | 'running' | 'cancelled' | 'error';
  pagesFound: number;
  currentPage?: string;
  message?: string;
}

interface DiscoveredAction {
  kind: string;
  text: string;
  selector: string;
  selectorStrategy: string;
}

interface DiscoveredPage {
  path: string;
  url: string;
  title: string;
  heading: string;
  actionCount: number;
  formCount: number;
  statusCount: number;
  actions: DiscoveredAction[];
  forms: Array<{ label: string; fieldCount: number }>;
}

interface DiscoveryView {
  generatedAt: string;
  baseUrl: string;
  pageCount: number;
  actionCount: number;
  formCount: number;
  depthReached: number;
  pages: DiscoveredPage[];
  warnings: string[];
  skipped: Array<{ url: string; reason: string }>;
}

interface ProposalPhase {
  id: string;
  label: string;
  duration: number;
  script: string;
  url: string | null;
  steps: Array<{ action: string; selector: string | null; detail: string | null }>;
  /** Pasos originales: se reenvían a `savePhases` sin reinterpretarlos. */
  rawSteps: Array<Record<string, unknown>>;
}

interface DiscoveryPayloadShape {
  discovery: DiscoveryView | null;
  proposal: { phases: ProposalPhase[]; warnings: string[]; filePath: string } | null;
  configExists: boolean;
  configPhaseCount: number;
  errors: string[];
}

const emptyDiscoveryPayload: DiscoveryPayloadShape = {
  discovery: null,
  proposal: null,
  configExists: false,
  configPhaseCount: 0,
  errors: []
};

const idleDiscoveryProgress: DiscoveryProgressShape = { status: 'idle', pagesFound: 0 };

/** Estilo del selector en sólo lectura de la propuesta. */
const selectorStyle = {
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  fontSize: '12px',
  wordBreak: 'break-all'
} as const;

const panelBackground = 'var(--vscode-input-background)';
const panelBorder = '1px solid var(--vscode-panel-border)';

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
  const [discoveryPayload, setDiscoveryPayload] = useState<DiscoveryPayloadShape>(emptyDiscoveryPayload);
  const [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgressShape>(idleDiscoveryProgress);
  const [proposalPhases, setProposalPhases] = useState<ProposalPhase[]>([]);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

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

        case 'discovery': {
          const payload = (message.data ?? emptyDiscoveryPayload) as DiscoveryPayloadShape;
          setDiscoveryPayload(payload);
          setProposalPhases(payload.proposal?.phases ?? []);
          setConfirmOverwrite(false);
          break;
        }

        case 'discoveryProgress':
          setDiscoveryProgress((message.data ?? idleDiscoveryProgress) as DiscoveryProgressShape);
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

  /* ---------------------- asistente de descubrimiento ---------------------- */

  const discoveryRunning = discoveryProgress.status === 'running';

  const handleDiscoverApp = () => {
    setDiscoveryProgress({ status: 'running', pagesFound: 0 });
    send('discoverApp');
    appendLog('Descubrimiento lanzado: recorriendo la app en modo lectura…');
  };

  const handleCancelDiscovery = () => {
    send('cancelDiscovery');
    appendLog('Cancelación del descubrimiento solicitada…');
  };

  const handleChangeProposalPhase = (id: string, field: 'label' | 'duration' | 'script', value: string | number) => {
    setProposalPhases(previous => previous.map(phase => (phase.id === id ? { ...phase, [field]: value } : phase)));
  };

  /** Payload para `savePhases`: los pasos del descubrimiento viajan intactos. */
  const proposalSavePayload = () =>
    proposalPhases.map(phase => ({
      id: phase.id,
      label: phase.label,
      duration: phase.duration,
      url: phase.url ?? undefined,
      script: phase.script,
      steps: phase.rawSteps
    }));

  const handleSaveProposal = () => {
    if (!discoveryPayload.proposal || proposalPhases.length === 0) {
      appendLog('No hay propuesta de fases que guardar: ejecuta "Descubrir app" primero.');
      return;
    }

    // Nunca se sobrescribe mvc-config.json sin confirmación explícita.
    if (discoveryPayload.configExists) {
      setConfirmOverwrite(true);
      return;
    }

    send('savePhases', proposalSavePayload());
    appendLog(`${proposalPhases.length} fase(s) de la propuesta enviadas para guardar.`);
  };

  const handleConfirmOverwrite = () => {
    setConfirmOverwrite(false);
    send('savePhases', proposalSavePayload());
    appendLog(`Confirmado: ${proposalPhases.length} fase(s) propuestas sustituyen a las de mvc-config.json.`);
  };

  return (
    <div style={{ padding: '16px', fontFamily: 'var(--vscode-font-family)' }}>
      <h2>Marketing Video Creator</h2>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['Configuración', 'Fases', 'Progreso', 'Descubrir'].map((tab, index) => (
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

      {activeTab === 3 && (
        <div>
          <style>
            {'@keyframes mvc-spin{to{transform:rotate(360deg)}}' +
              '.mvc-spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--vscode-panel-border);' +
              'border-top-color:var(--vscode-progressBar-background);border-radius:50%;' +
              'animation:mvc-spin .9s linear infinite;vertical-align:middle;margin-right:6px}'}
          </style>

          <strong>Descubrimiento automático</strong>
          <p style={{ marginTop: '4px' }}>
            Recorre la URL configurada en modo <strong>sólo lectura</strong> (mismo origen, sin enviar formularios ni
            pulsar acciones destructivas) y propone las fases con los selectores reales observados. El inventario queda
            en <code>.mvc/discovery.json</code> y la propuesta en <code>.mvc/mvc-config.borrador.json</code>.
          </p>

          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              alignItems: 'center',
              marginTop: '12px',
              marginBottom: '12px'
            }}
          >
            <Button appearance="primary" onClick={handleDiscoverApp} disabled={discoveryRunning}>
              Descubrir app
            </Button>
            <Button appearance="secondary" onClick={handleCancelDiscovery} disabled={!discoveryRunning}>
              Cancelar descubrimiento
            </Button>
            {discoveryRunning && (
              <span>
                <span className="mvc-spinner" aria-hidden="true" />
                {`Descubriendo… ${discoveryProgress.pagesFound} página(s) encontrada(s)`}
                {discoveryProgress.currentPage ? ` · ${discoveryProgress.currentPage}` : ''}
              </span>
            )}
            {!discoveryRunning && discoveryProgress.status === 'cancelled' && (
              <span>
                {discoveryProgress.message ?? 'Descubrimiento cancelado.'} ({discoveryProgress.pagesFound} página(s)
                antes de parar)
              </span>
            )}
            {!discoveryRunning && discoveryProgress.status === 'error' && (
              <span>⚠️ {discoveryProgress.message ?? 'El descubrimiento ha fallado.'}</span>
            )}
          </div>

          {discoveryPayload.errors.length > 0 && (
            <ul style={{ marginTop: 0, paddingLeft: '18px' }}>
              {discoveryPayload.errors.map(error => (
                <li key={error}>⚠️ {error}</li>
              ))}
            </ul>
          )}

          {discoveryPayload.discovery && (
            <div
              style={{
                border: panelBorder,
                borderRadius: '4px',
                padding: '8px',
                marginBottom: '16px',
                background: panelBackground
              }}
            >
              <strong>Resumen de lo encontrado</strong>
              <p style={{ margin: '4px 0' }}>
                {`${discoveryPayload.discovery.pageCount} páginas · ${discoveryPayload.discovery.actionCount} acciones · ${discoveryPayload.discovery.formCount} formularios`}
              </p>
              <p style={{ margin: '0 0 8px 0', opacity: 0.8 }}>
                {`${discoveryPayload.discovery.baseUrl} · profundidad ${discoveryPayload.discovery.depthReached} · ${discoveryPayload.discovery.generatedAt}`}
              </p>

              <strong>Páginas encontradas ({discoveryPayload.discovery.pageCount})</strong>
              <ul style={{ marginTop: '4px', marginBottom: '8px', paddingLeft: '18px' }}>
                {discoveryPayload.discovery.pages.map(page => (
                  <li key={page.path} style={{ marginBottom: '4px' }}>
                    <details>
                      <summary>
                        <strong>{page.path}</strong> — {page.title || '(sin título)'}{' '}
                        <span style={{ opacity: 0.8 }}>
                          ({page.actionCount} acciones · {page.formCount} formularios)
                        </span>
                      </summary>
                      <ul style={{ marginTop: '4px', paddingLeft: '18px' }}>
                        {page.actions.map(action => (
                          <li key={`${page.path}-${action.selector}`} style={selectorStyle}>
                            <code>{action.selector}</code> · {action.kind}
                            {action.text ? `: ${action.text}` : ''} <em>({action.selectorStrategy})</em>
                          </li>
                        ))}
                        {page.forms.map(form => (
                          <li key={`${page.path}-form-${form.label}`} style={selectorStyle}>
                            formulario <strong>{form.label}</strong> · {form.fieldCount} campo(s)
                          </li>
                        ))}
                        {page.actions.length === 0 && page.forms.length === 0 && <li>Sin controles inventariados.</li>}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>

              {discoveryPayload.discovery.warnings.length > 0 && (
                <div
                  style={{
                    border: '1px solid var(--vscode-inputValidation-warningBorder, #b89500)',
                    borderRadius: '4px',
                    padding: '8px',
                    marginBottom: '8px'
                  }}
                >
                  <strong>Avisos del descubrimiento ({discoveryPayload.discovery.warnings.length})</strong>
                  <ul style={{ marginTop: '4px', marginBottom: 0, paddingLeft: '18px' }}>
                    {discoveryPayload.discovery.warnings.map(warning => (
                      <li key={warning}>⚠️ {warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {discoveryPayload.discovery.skipped.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <strong>{`${discoveryPayload.discovery.skipped.length} enlace(s) saltado(s)`}</strong>
                  <ul style={{ marginTop: '4px', marginBottom: 0, paddingLeft: '18px' }}>
                    {discoveryPayload.discovery.skipped.map(skip => (
                      <li key={`${skip.url}-${skip.reason}`} style={selectorStyle}>
                        {skip.url} — <em>{skip.reason}</em>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <strong>Propuesta de fases</strong>
          {!discoveryPayload.proposal || proposalPhases.length === 0 ? (
            <p style={{ marginTop: '4px' }}>
              Sin propuesta todavía: pulsa <strong>Descubrir app</strong> para generarla (o revisa los avisos de
              arriba).
            </p>
          ) : (
            <>
              <p style={{ marginTop: '4px' }}>
                Guion y duración se editan; los pasos y sus selectores se muestran en sólo lectura porque son los
                observados en la app (<code>{discoveryPayload.proposal.filePath}</code>).
              </p>
              {discoveryPayload.proposal.warnings.length > 0 && (
                <ul style={{ marginTop: 0, paddingLeft: '18px' }}>
                  {discoveryPayload.proposal.warnings.map(warning => (
                    <li key={warning}>⚠️ {warning}</li>
                  ))}
                </ul>
              )}
              {proposalPhases.map(phase => (
                <div
                  key={phase.id}
                  style={{
                    marginBottom: '8px',
                    padding: '8px',
                    border: panelBorder,
                    borderRadius: '4px'
                  }}
                >
                  <div style={{ marginBottom: '4px' }}>
                    <strong>{phase.id}</strong> — {phase.steps.length} paso(s)
                  </div>
                  <TextField
                    label={`Nombre de la fase ${phase.id}`}
                    value={phase.label}
                    onChange={(event: any) => handleChangeProposalPhase(phase.id, 'label', event.target.value)}
                    style={{ width: '100%', display: 'block' }}
                  />
                  <TextField
                    label={`Duración de la fase ${phase.id}`}
                    value={String(phase.duration)}
                    onChange={(event: any) =>
                      handleChangeProposalPhase(phase.id, 'duration', Number(event.target.value) || 0)
                    }
                    style={{ width: '100%', display: 'block' }}
                  />
                  <label style={{ display: 'block', marginTop: '8px', marginBottom: '4px' }}>
                    Guion de la narración (borrador: revísalo antes de guardar)
                  </label>
                  <textarea
                    aria-label={`Guion de la fase ${phase.id}`}
                    value={phase.script}
                    onChange={(event: any) => handleChangeProposalPhase(phase.id, 'script', event.target.value)}
                    rows={3}
                    style={textareaStyle}
                  />
                  <label style={{ display: 'block', marginTop: '8px', marginBottom: '4px' }}>
                    Pasos observados (selectores en sólo lectura)
                  </label>
                  <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                    {phase.steps.map((step, index) => (
                      <li key={`${phase.id}-step-${index}`} style={selectorStyle}>
                        <code>{step.action}</code>
                        {step.selector ? (
                          <>
                            {' → '}
                            <code>{step.selector}</code>
                          </>
                        ) : null}
                        {step.detail ? ` · ${step.detail}` : ''}
                      </li>
                    ))}
                    {phase.steps.length === 0 && <li>Sin pasos: la fase sólo navega a su URL.</li>}
                  </ul>
                </div>
              ))}
            </>
          )}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            <Button appearance="primary" onClick={handleSaveProposal} disabled={proposalPhases.length === 0}>
              Guardar fases
            </Button>
          </div>

          {confirmOverwrite && (
            <div
              style={{
                marginTop: '12px',
                padding: '8px',
                border: '1px solid var(--vscode-inputValidation-warningBorder, #b89500)',
                borderRadius: '4px'
              }}
            >
              <p style={{ marginTop: 0 }}>
                Ya existe mvc-config.json: al guardar se sustituirán las {discoveryPayload.configPhaseCount} fase(s)
                actuales por la propuesta. ¿Continuar?
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button appearance="primary" onClick={handleConfirmOverwrite}>
                  Sobrescribir fases
                </Button>
                <Button appearance="secondary" onClick={() => setConfirmOverwrite(false)}>
                  Cancelar guardado
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
