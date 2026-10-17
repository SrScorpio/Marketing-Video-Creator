/**
 * Pack de prompts: es lo que permite pasar de una app desconocida a una
 * configuración grabable (pantallas → guion → pasos → mvc-config.json).
 *
 * Los tests comprueban que los prompts siguen existiendo, que cubren los dos
 * modos (wizard y autónomo) y que el prompt de ensamblado usa el esquema exacto
 * que lee la extensión: si el esquema cambia y los prompts no, el vídeo sale sin
 * narración o sin pasos.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { PROMPT_ENTRY_FILE, PROMPT_PACK } from '../src/prompts/prompt-pack';
import { CONFIG_VERSION, DEFAULT_PHASES } from '../src/config/project-schema';

function prompt(name: string): string {
  const file = PROMPT_PACK.find(item => item.path.endsWith(name));

  if (!file) {
    throw new Error(`No existe el prompt ${name}`);
  }

  return file.content;
}

describe('pack de prompts', () => {
  it('incluye el índice y los cuatro pasos del flujo', () => {
    expect(PROMPT_PACK.map(item => item.path)).toEqual([
      '.mvc/prompts/00-leeme.md',
      '.mvc/prompts/01-descubrimiento.md',
      '.mvc/prompts/02-guion.md',
      '.mvc/prompts/03-pasos-captura.md',
      '.mvc/prompts/04-ensamblar-config.md'
    ]);
    expect(PROMPT_ENTRY_FILE).toBe('.mvc/prompts/00-leeme.md');
  });

  it('todos los ficheros van a .mvc/prompts y tienen contenido real', () => {
    for (const file of PROMPT_PACK) {
      expect(file.path.startsWith('.mvc/prompts/')).toBe(true);
      expect(file.content.length).toBeGreaterThan(300);
      expect(file.content.trim().endsWith('`')).toBe(false);
    }
  });

  it('cada prompt ofrece los dos modos (wizard y autónomo)', () => {
    for (const file of PROMPT_PACK.filter(item => !item.path.endsWith('00-leeme.md'))) {
      expect(file.content).toContain('Modo wizard');
      expect(file.content).toContain('Modo autónomo');
    }
  });

  it('el prompt de captura documenta las seis acciones soportadas', () => {
    const content = prompt('03-pasos-captura.md');

    for (const action of ['goto', 'click', 'fill', 'press', 'waitForSelector', 'wait']) {
      expect(content).toContain(`"action": "${action}"`);
    }
  });

  it('el prompt de ensamblado usa el esquema real del fichero de configuración', () => {
    const content = prompt('04-ensamblar-config.md');

    expect(content).toContain(`"version": "${CONFIG_VERSION}"`);

    for (const key of ['"project"', '"name"', '"url"', '"outputDir"', '"variant"', '"phases"']) {
      expect(content).toContain(key);
    }

    for (const key of ['"id"', '"label"', '"duration"', '"script"', '"steps"']) {
      expect(content).toContain(key);
    }

    // El ejemplo del prompt debe ser JSON válido y ejecutable tal cual.
    const json = content.split('```json')[1]?.split('```')[0];
    expect(json).toBeTruthy();

    const parsed = JSON.parse(json!) as { version: string; project: { phases: Array<{ id: string; script: string; steps: unknown[] }> } };
    expect(parsed.version).toBe(CONFIG_VERSION);
    expect(parsed.project.phases[0].id).toBe(DEFAULT_PHASES[0].id);
    expect(parsed.project.phases[0].script.length).toBeGreaterThan(10);
    expect(Array.isArray(parsed.project.phases[0].steps)).toBe(true);
  });

  it('el índice explica el orden de uso y no promete automatismo inexistente', () => {
    const content = prompt('00-leeme.md');

    for (const step of ['01-descubrimiento.md', '02-guion.md', '03-pasos-captura.md', '04-ensamblar-config.md']) {
      expect(content).toContain(step);
    }

    expect(content).toContain('mvc-config.json');
    expect(content).not.toMatch(/automáticamente sin revisar/i);
  });

  it('ningún prompt incluye secretos ni credenciales de ejemplo reales', () => {
    for (const file of PROMPT_PACK) {
      expect(file.content).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
      expect(file.content).not.toMatch(/api[_-]?key\s*[:=]\s*['"][^'"]{8,}/i);
      expect(file.content).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    }
  });

  it('los prompts caben en el workspace sin depender del idioma del sistema', () => {
    // Se escriben como texto UTF-8 con acentos: comprobar que no hay caracteres
    // rotos por una codificación mal hecha.
    for (const file of PROMPT_PACK) {
      expect(file.content).not.toContain('\ufffd');
    }
  });

  it('el pack se escribe desde la extensión y está declarado en el manifiesto', () => {
    const root = path.resolve(__dirname, '..');
    const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf-8');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
      contributes: { commands: Array<{ command: string }> };
    };

    expect(extensionSource).toContain('marketing-video-creator.createPromptPack');
    expect(extensionSource).toContain('PROMPT_PACK');
    expect(manifest.contributes.commands.map(command => command.command)).toContain(
      'marketing-video-creator.createPromptPack'
    );
  });
});
