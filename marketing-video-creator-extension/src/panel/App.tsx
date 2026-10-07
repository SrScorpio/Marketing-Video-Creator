/**
 * Componente principal del panel webview.
 */

import React, { useState, useEffect } from 'react';
import {
  VSCodeButton,
  VSCodeTextField,
  VSCodeDropdown,
  VSCodeOption
} from '@vscode/webview-ui-toolkit/react';

interface AppConfig {
  apiKey: string;
  url: string;
  ttsProvider: string;
  ttsLanguage: string;
  recordingMode: string;
  resolution: string;
  phases: Array<{ id: string; label: string; duration: number }>;
}

interface ProgressState {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  logs: string[];
  videoPath?: string;
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>({
    apiKey: '',
    url: '',
    ttsProvider: 'sapi',
    ttsLanguage: 'espanol',
    recordingMode: 'headful',
    resolution: 'mobile',
    phases: []
  });
  const [activeTab, setActiveTab] = useState(0);
  const [progress, setProgress] = useState<ProgressState>({
    status: 'idle',
    progress: 0,
    logs: [],
    videoPath: undefined
  });

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'config') {
        setConfig(prev => ({ ...prev, ...msg.data }));
      }
      if (msg.type === 'progress') {
        setProgress(prev => ({ ...prev, ...msg.data }));
      }
      if (msg.type === 'videoReady') {
        setProgress(prev => ({ ...prev, status: 'done', videoPath: msg.data.path }));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const vscodePostMessage = (data: any) => { window.postMessage(data); };

  const handleSaveConfig = () => {
    vscodePostMessage({ type: 'saveConfig', data: config });
    vscode.window.showInformationMessage('Configuración guardada');
  };

  const handleStartCapture = () => {
    setProgress({ status: 'running', progress: 0, logs: ['Iniciando captura...'] });
    vscodePostMessage({ type: 'startCapture' });
  };

  const handleBuildVideo = () => {
    setProgress({ status: 'running', progress: 0, logs: ['Montando vídeo...'] });
    vscodePostMessage({ type: 'buildVideo' });
  };

  const handleAddPhase = () => {
    const nextId = 'PHASE-' + (config.phases.length + 1);
    setConfig(prev => ({ ...prev, phases: [...prev.phases, { id: nextId, label: 'Fase demo ' + nextId, duration: 30 }] }));
  };

  const handleSavePhases = () => {
    vscodePostMessage({ type: 'savePhases', data: config.phases });
    vscode.window.showInformationMessage('Fases guardadas');
  };

  const handleDeletePhase = (id: string) => {
    setConfig(prev => ({ ...prev, phases: prev.phases.filter(p => p.id !== id) }));
  };

  const handleChangePhase = (id: string, field: string, value: string | number) => {
    setConfig(prev => ({
      ...prev,
      phases: prev.phases.map(p => (p.id === id ? { ...p, [field]: value } : p))
    }));
  };

  return (
    <div style={{ padding: '16px', fontFamily: 'var(--vscode-font-family)' }}>
      <h2 style={{ color: 'var(--vscode-foreground)' }}>Marketing Video Creator</h2>

      {/* Tabs manuales */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['Configuración', 'Fases', 'Progreso'].map((tab, index) => (
          <button
            key={tab}
            style={{
              padding: '8px 16px',
              background: index === activeTab ? 'var(--vscode-button-background)' : 'var(--vscode-background)',
              color: index === activeTab ? 'var(--vscode-button-foreground)' : 'var(--vscode-text-foreground)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: index === activeTab ? 'bold' : 'normal'
            }}
            onClick={() => setActiveTab(index)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '16px' }}>
        {/* Tab 1: Configuración */}
        {activeTab === 0 && (
          <div>
            <VSCodeTextField label="URL de la app" placeholder="https://ejemplo.com"
              value={config.url}
              onChange={(e: any) => setConfig(prev => ({ ...prev, url: e.target.value }))}
              style={{ width: '100%', display: 'block', marginBottom: '12px' }} />
            <VSCodeTextField label="API Key (Nan.Builders)" placeholder="tu API Key"
              value={config.apiKey}
              onChange={(e: any) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
              style={{ width: '100%', display: 'block', marginBottom: '12px' }} />
            <VSCodeDropdown label="Motor TTS" value={config.ttsProvider}
              onChange={(e: any) => setConfig(prev => ({ ...prev, ttsProvider: e.target.value }))}
              style={{ width: '100%', display: 'block', marginBottom: '12px' }}>
              <VSCodeOption value="sapi">SAPI (local) - Microsoft Pablo</VSCodeOption>
              <VSCodeOption value="nan-builders">Nan.Builders Kokoro</VSCodeOption>
            </VSCodeDropdown>
            <VSCodeDropdown label="Resolución" value={config.resolution}
              onChange={(e: any) => setConfig(prev => ({ ...prev, resolution: e.target.value }))}
              style={{ width: '100%', display: 'block', marginBottom: '12px' }}>
              <VSCodeOption value="mobile">Mobile (1080x1920)</VSCodeOption>
              <VSCodeOption value="desktop">Desktop (1920x1080)</VSCodeOption>
            </VSCodeDropdown>
            <VSCodeButton onClick={handleSaveConfig} style={{ marginTop: '12px' }}>Guardar configuración</VSCodeButton>
          </div>
        )}

        {/* Tab 2: Fases */}
        {activeTab === 1 && (
          <div>
            <strong>Fases del vídeo</strong>
            <VSCodeButton onClick={handleAddPhase} style={{ marginTop: '12px', marginBottom: '12px' }}>Añadir fase</VSCodeButton>
            {config.phases.length === 0 && (
              <p style={{ color: 'var(--vscode-warningForeground)' }}>No hay fases configuradas.</p>
            )}
            {config.phases.map(phase => (
              <div key={phase.id} style={{ marginBottom: '8px', padding: '8px', background: 'var(--vscode-backgroundSecondary)', borderRadius: '4px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <strong>{phase.label}</strong>
                  <span style={{ color: 'var(--vscode-descriptionForeground)' }}>({phase.duration}s)</span>
                  <VSCodeButton onClick={() => handleDeletePhase(phase.id)} style={{ marginLeft: 'auto' }}>Eliminar</VSCodeButton>
                </div>
                <VSCodeTextField label="Nombre de fase" value={phase.label}
                  onChange={(e: any) => handleChangePhase(phase.id, 'label', e.target.value)}
                  style={{ width: '100%', display: 'block' }} />
                <VSCodeTextField label="Duración (segundos)" type="number" value={phase.duration}
                  onChange={(e: any) => handleChangePhase(phase.id, 'duration', Number(e.target.value))}
                  style={{ width: '100%', display: 'block' }} />
              </div>
            ))}
            <VSCodeButton onClick={handleSavePhases} style={{ marginTop: '12px', marginBottom: '12px' }}>Guardar fases</VSCodeButton>
          </div>
        )}

        {/* Tab 3: Progreso */}
        {activeTab === 2 && (
          <div>
            {/* Barra de progreso */}
            <div style={{ background: 'var(--vscode-backgroundSecondary)', height: '20px', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--vscode-borderRegion)', marginBottom: '16px' }}>
              <div style={{
                width: progress.progress + '%',
                background: 'var(--vscode-text-foreground)',
                height: '100%',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <p style={{ textAlign: 'center', marginBottom: '16px' }}>
              {progress.status === 'done' ? '¡Completada!' : progress.status === 'running' ? 'En progreso...' : 'En espera'}
              <span style={{ fontWeight: 'bold' }} />
            </p>
            {progress.status === 'done' && progress.videoPath && (
              <p style={{ color: 'var(--vscode-text-foreground)' }}>
                Vídeo generado: <code>{progress.videoPath}</code>
              </p>
            )}
            {/* Botones de captura */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <VSCodeButton onClick={handleStartCapture} disabled={progress.status === 'running'}>
                {progress.status === 'running' ? 'Capturando...' : 'Iniciar captura'}
              </VSCodeButton>
              <VSCodeButton onClick={handleBuildVideo} disabled={progress.status !== 'done'}>
                Montar vídeo
              </VSCodeButton>
            </div>
            {/* Log de eventos */}
            <div style={{ marginTop: '16px', maxHeight: '200px', overflow: 'auto', background: 'var(--vscode-backgroundSecondary)', padding: '12px', borderRadius: '4px', fontFamily: 'var(--vscode-font-family-mono)', fontSize: '12px' }}>
              {progress.logs.map((log, index) => (
                <div key={index} style={{ marginBottom: '4px', color: 'var(--vscode-text-foreground)' }}>
                  {['[' + (index + 1) + '] ' + ' ' + log]}
                </div>
              ))}
              {progress.logs.length === 0 && <span style={{ color: 'var(--vscode-descriptionForeground)' }}>Sin eventos.</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
