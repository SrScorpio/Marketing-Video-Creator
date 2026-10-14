/**
 * Tests de contrato del manifiesto.
 *
 * No prueban el host de VS Code, pero cazan de forma automática la clase de
 * bug que ya apareció una vez: un id de comando declarado en `package.json` que
 * no coincide con el registrado en el código (el panel no abría), o una clave
 * de configuración leída por la extensión que no está declarada en el
 * manifiesto (aparece como `undefined` sin avisar).
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
  main: string;
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string; title: string }>;
    configuration: { properties: Record<string, unknown> };
  };
};

const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf-8');
const settingsSource = fs.readFileSync(path.join(root, 'src', 'config', 'extension-settings.ts'), 'utf-8');
const projectConfigSource = fs.readFileSync(path.join(root, 'src', 'config', 'project-config.ts'), 'utf-8');
const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf-8')) as {
  compilerOptions: { outDir: string; rootDir: string };
};

function extractAll(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map(match => match[1]);
}

describe('package.json ↔ código', () => {
  it('cada comando declarado está registrado en extension.ts', () => {
    const declared = manifest.contributes.commands.map(command => command.command);
    const registered = extractAll(extensionSource, /registerCommand\(\s*'([^']+)'/g);

    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(declared)).toEqual(new Set(registered));
  });

  it('cada comando activa la extensión (activationEvents)', () => {
    const declared = manifest.contributes.commands.map(command => command.command);
    const activation = manifest.activationEvents
      .filter(event => event.startsWith('onCommand:'))
      .map(event => event.replace('onCommand:', ''));

    expect(new Set(activation)).toEqual(new Set(declared));
  });

  it('cada comando declarado tiene título', () => {
    for (const command of manifest.contributes.commands) {
      expect(command.title.trim().length, `título vacío en ${command.command}`).toBeGreaterThan(0);
    }
  });

  it('las claves de configuración del manifiesto son exactamente las que lee la extensión', () => {
    const prefix = 'marketingVideoCreator.';
    const declared = Object.keys(manifest.contributes.configuration.properties)
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length))
      .sort();

    const read = extractAll(settingsSource, /config\.get\('([^']+)'/g).sort();

    expect(declared.length).toBeGreaterThan(20);
    expect(read).toEqual(declared);
  });

  it('las claves que el panel persiste están declaradas en el manifiesto', () => {
    const prefix = 'marketingVideoCreator.';
    const declared = Object.keys(manifest.contributes.configuration.properties).map(key => key.replace(prefix, ''));
    const persisted = extractAll(extensionSource, /key:\s*'([^']+)'\s*,\s*value:/g);

    expect(persisted.length).toBeGreaterThan(0);
    for (const key of persisted) {
      expect(declared, `${key} no está en contributes.configuration`).toContain(key);
    }
  });

  it('las fases por defecto del manifiesto coinciden con DEFAULT_PHASES', () => {
    const manifestPhases = (
      manifest.contributes.configuration.properties['marketingVideoCreator.phases.list'] as {
        default: Array<{ id: string; label: string; duration: number }>;
      }
    ).default;

    const codePhases = extractAll(projectConfigSource, /\{\s*id:\s*'([^']+)',\s*label:\s*'[^']+',\s*duration:\s*\d+\s*\}/g);

    expect(codePhases).toEqual(manifestPhases.map(phase => phase.id));
  });

  it('el punto de entrada y el bundle del panel apuntan a rutas que el build genera', () => {
    expect(manifest.main).toBe('./dist/extension.js');
    expect(tsconfig.compilerOptions.outDir).toBe('dist');
    expect(tsconfig.compilerOptions.rootDir).toBe('src');

    const panelReference = /joinPath\(uri,\s*'dist',\s*'panel',\s*'index\.js'\)/;
    expect(panelReference.test(extensionSource)).toBe(true);

    const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf-8');
    // Salida estable (sin hash) porque el HTML del webview referencia el nombre fijo.
    expect(viteConfig).toContain("index.js");
    expect(viteConfig).not.toContain('[hash]');
  });

  it('el webview declara Content-Security-Policy y nonce', () => {
    expect(extensionSource).toContain('Content-Security-Policy');
    expect(extensionSource).toContain('nonce-');
    expect(extensionSource).toContain('enableScripts: true');
  });
});
