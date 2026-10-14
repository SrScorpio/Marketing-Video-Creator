/**
 * Runner de los tests del Extension Host.
 *
 * Se usa @vscode/test-electron directamente (en lugar de @vscode/test-cli) para
 * poder fijar un `--user-data-dir` corto: la ruta por defecto
 * (`<proyecto>/.vscode-test/user-data`) supera los 107 caracteres del límite de
 * sockets UNIX y VS Code aborta con `listen EINVAL`.
 *
 * Ejecutar en Linux sin display: `xvfb-run -a npm run test:vscode`
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runTests } from '@vscode/test-electron';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const cacheDir = '/tmp/mvc-vscode-test';
const userDataDir = path.join(cacheDir, 'user-data');
const extensionsDir = path.join(cacheDir, 'extensions');

fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });

/** Reutiliza el VS Code ya descargado (evita 344 MB por ejecución). */
function findDownloadedVSCode() {
  const installRoot = path.join(projectRoot, '.vscode-test');

  if (!fs.existsSync(installRoot)) {
    return undefined;
  }

  const candidates = fs
    .readdirSync(installRoot)
    .filter(name => name.startsWith('vscode-'))
    .sort()
    .reverse();

  for (const candidate of candidates) {
    const executable = path.join(
      installRoot,
      candidate,
      process.platform === 'win32' ? 'Code.exe' : process.platform === 'darwin' ? 'Contents/MacOS/Electron' : 'code'
    );

    if (fs.existsSync(executable)) {
      return executable;
    }
  }

  return undefined;
}

const vscodeExecutablePath = findDownloadedVSCode();

await runTests({
  vscodeExecutablePath,
  extensionDevelopmentPath: projectRoot,
  extensionTestsPath: path.join(projectRoot, 'test', 'vscode', 'suite'),
  launchArgs: [
    path.join(projectRoot, 'test', 'vscode', 'fixture-workspace'),
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--disable-gpu',
    '--no-sandbox',
    '--skip-welcome',
    '--skip-release-notes'
  ]
});
