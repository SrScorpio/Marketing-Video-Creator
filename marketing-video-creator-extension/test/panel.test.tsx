// @vitest-environment jsdom
/**
 * Smoke test del panel webview en un DOM real (jsdom).
 *
 * Los componentes de `@vscode/webview-ui-toolkit` se sustituyen por elementos
 * HTML equivalentes (el paquete está deprecado y registra web components que
 * jsdom no implementa); el resto del panel se ejecuta tal cual: protocolo de
 * mensajes, estado, edición de fases y comandos que se envían al host.
 */

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vscode/webview-ui-toolkit/react', async () => {
  const react = await import('react');

  // `input` es un elemento vacío: los componentes que lo mapean descartan los
  // children (labels/etiquetas del toolkit) para no romper el render.
  const passthrough = (tag: string, dropChildren = false) => (props: Record<string, unknown>) =>
    react.createElement(
      tag,
      {
        onClick: props.onClick,
        onChange: props.onChange,
        disabled: props.disabled,
        value: props.value,
        type: props.type
      },
      dropChildren ? undefined : (props.children as React.ReactNode)
    );

  return {
    VSCodeButton: passthrough('button'),
    VSCodeTextField: passthrough('input', true),
    VSCodeDropdown: passthrough('select'),
    VSCodeOption: passthrough('option'),
    VSCodeCheckbox: passthrough('input', true)
  };
});

const postMessage = vi.fn();

type RootComponent = React.ComponentType;

let container: HTMLDivElement;
let root: Root;
let App: RootComponent;
let messageHandler: ((event: MessageEvent) => void) | null = null;

function findByText(text: string): HTMLElement | null {
  // Primero botones (evita devolver un contenedor cuyo textContent coincide y
  // cuyo click no dispara nada), después el resto del árbol.
  const buttons = [...container.querySelectorAll('button')] as HTMLElement[];
  const match = buttons.find(button => button.textContent?.trim() === text);
  if (match) {
    return match;
  }

  const nodes = [...container.querySelectorAll('strong, li, p, span, div')] as HTMLElement[];
  return nodes.find(node => node.textContent?.trim() === text) ?? null;
}

function clickByText(text: string): void {
  const button = findByText(text);
  if (!button) {
    throw new Error(`No se encontró el botón "${text}"`);
  }
  button.click();
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

/** Escribe en un campo controlado por React (necesita el setter nativo). */
async function typeInto(element: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Entrega un mensaje del host al panel por el listener registrado en `window`. */
async function sendMessage(data: unknown): Promise<void> {
  if (!messageHandler) {
    throw new Error('El panel no registró ningún listener de mensajes en window.');
  }

  await act(async () => {
    messageHandler!({ data } as MessageEvent);
  });
}

beforeEach(async () => {
  postMessage.mockClear();
  messageHandler = null;

  (globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage,
    getState: () => undefined,
    setState: () => undefined
  });

  // Se captura el listener real del panel (el host le envía mensajes por ahí).
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: (event: MessageEvent) => void) => {
    if (type === 'message') {
      messageHandler = listener;
    }
  }) as typeof window.addEventListener);

  container = document.createElement('div');
  document.body.appendChild(container);

  const module = await import('../src/panel/App');
  App = module.default as RootComponent;

  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(App));
  });
  await flush();
});

afterEach(() => {
  vi.restoreAllMocks();
  root.unmount();
  container.remove();
});

describe('panel webview', () => {
  it('anuncia al host que está listo y pinta las tres pestañas', () => {
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
    expect(findByText('Configuración')).toBeTruthy();
    expect(findByText('Fases')).toBeTruthy();
    expect(findByText('Progreso')).toBeTruthy();
  });

  it('aplica la configuración recibida del host', async () => {
    await sendMessage({
      type: 'settings',
      data: {
        settings: { apiKey: 'x', ttsProvider: 'sapi', ttsVoice: 'Microsoft Pablo', playwrightHeadless: true },
        project: { url: 'https://ejemplo.test', phases: [{ id: 'f1', label: 'Fase uno', duration: 9 }], variant: 'desktop' },
        progress: { status: 'idle', progress: 0, phases: [] }
      }
    });

    const url = container.querySelector('input') as HTMLInputElement;
    expect(url.value).toBe('https://ejemplo.test');
  });

  it('muestra el progreso por fase y salta a la pestaña de progreso al arrancar', async () => {
    await sendMessage({
      type: 'state',
      data: {
        status: 'running',
        progress: 50,
        phases: [
          { id: 'f1', label: 'Presentación', status: 'done', progress: 100 },
          { id: 'f2', label: 'Evaluación', status: 'error', progress: 100, error: 'selector no encontrado' }
        ]
      }
    });

    expect(container.textContent).toContain('Presentación');
    expect(container.textContent).toContain('Evaluación');
    expect(container.textContent).toContain('selector no encontrado');
    expect(container.textContent).toContain('Estado:');
  });

  it('envía al host los comandos de captura, montaje y exportación', async () => {
    // En curso: el botón de captura está deshabilitado y "Cancelar" activo.
    await sendMessage({ type: 'state', data: { status: 'running', progress: 10, phases: [] } });
    clickByText('Cancelar');

    // Parado: se habilitan captura, montaje y exportaciones.
    await sendMessage({ type: 'state', data: { status: 'idle', progress: 0, phases: [] } });
    clickByText('Iniciar captura');
    clickByText('Montar vídeo');
    clickByText('Exportar mobile');
    clickByText('Exportar desktop');
    clickByText('Abrir carpeta');

    const sent = postMessage.mock.calls.map(call => (call[0] as { type: string }).type);
    expect(sent).toContain('startCapture');
    expect(sent).toContain('buildVideo');
    expect(sent).toContain('exportMobile');
    expect(sent).toContain('exportDesktop');
    expect(sent).toContain('openOutputFolder');
    expect(sent).toContain('cancel');
  });

  it('registra los eventos y el vídeo generado en el log', async () => {
    await sendMessage({ type: 'state', data: { status: 'running', progress: 10, phases: [] } });
    await sendMessage({ type: 'log', data: 'Capturando fase 01' });
    await sendMessage({ type: 'videoReady', data: { path: '/tmp/demo.mp4', variant: 'mobile' } });

    expect(container.textContent).toContain('Capturando fase 01');
    expect(container.textContent).toContain('/tmp/demo.mp4');
  });

  it('envía la configuración editada al host sin tocar el DOM ajeno', async () => {
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();

    const saveButton = findByText('Guardar configuración');
    expect(saveButton).toBeTruthy();
    saveButton!.click();

    const saved = postMessage.mock.calls.find(call => (call[0] as { type: string }).type === 'saveConfig');
    expect(saved).toBeTruthy();
    expect(saved![0]).toMatchObject({ type: 'saveConfig' });
  });

  it('guarda el guion y los pasos de cada fase', async () => {
    await sendMessage({
      type: 'settings',
      data: {
        settings: { apiKey: '', ttsProvider: 'sapi', ttsVoice: 'Microsoft Pablo', playwrightHeadless: true },
        project: {
          url: 'https://app.test',
          variant: 'desktop',
          phases: [
            {
              id: '01-presentacion',
              label: 'Presentación',
              duration: 5,
              script: 'Bienvenido a la demo.',
              steps: [{ action: 'click', selector: '#empezar' }]
            }
          ]
        },
        progress: { status: 'idle', progress: 0, phases: [] }
      }
    });

    clickByText('Fases');
    await flush();
    clickByText('Guardar fases');

    const saved = postMessage.mock.calls.map(call => call[0] as { type: string; data: any }).find(message => message.type === 'savePhases');

    expect(saved).toBeTruthy();
    expect(saved!.data).toHaveLength(1);
    expect(saved!.data[0]).toMatchObject({
      id: '01-presentacion',
      label: 'Presentación',
      duration: 5,
      script: 'Bienvenido a la demo.',
      steps: [{ action: 'click', selector: '#empezar' }]
    });
  });

  it('no envía las fases si los pasos no son JSON válido', async () => {
    await sendMessage({
      type: 'settings',
      data: {
        settings: { apiKey: '', ttsProvider: 'sapi', ttsVoice: 'Microsoft Pablo', playwrightHeadless: true },
        project: {
          url: 'https://app.test',
          variant: 'desktop',
          phases: [{ id: '01-presentacion', label: 'Presentación', duration: 5 }]
        },
        progress: { status: 'idle', progress: 0, phases: [] }
      }
    });

    clickByText('Fases');
    await flush();

    const textareas = [...container.querySelectorAll('textarea')] as HTMLTextAreaElement[];
    expect(textareas).toHaveLength(2); // guion y pasos
    await typeInto(textareas[1], '{no es json');

    clickByText('Guardar fases');
    await flush();

    // El aviso va al log, que se pinta en la pestaña de progreso.
    clickByText('Progreso');
    await flush();

    expect(postMessage.mock.calls.some(call => (call[0] as { type: string }).type === 'savePhases')).toBe(false);
    expect(container.textContent).toContain('no son JSON válido');
  });

  it('gestiona los requisitos externos desde la pestaña de configuración', async () => {
    await sendMessage({
      type: 'requirements',
      data: [
        { id: 'ffmpeg', label: 'FFmpeg', severity: 'obligatorio', status: 'ok', detail: 'en el PATH: /usr/bin/ffmpeg' },
        {
          id: 'chromium',
          label: 'Navegador (Playwright)',
          severity: 'obligatorio',
          status: 'missing',
          detail: 'Chromium de Playwright no instalado',
          command: 'npx playwright install chromium'
        }
      ]
    });

    expect(container.textContent).toContain('Navegador (Playwright)');
    expect(container.textContent).toContain('npx playwright install chromium');

    postMessage.mockClear();
    clickByText('Comprobar requisitos');

    expect(postMessage.mock.calls.some(call => (call[0] as { type: string }).type === 'checkRequirements')).toBe(true);
  });
});
