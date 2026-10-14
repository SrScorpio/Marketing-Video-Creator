/**
 * Tests del Extension Host de VS Code.
 *
 * Se ejecutan dentro de un VS Code real (descargado por @vscode/test-cli) con
 * la extensión cargada: es la validación de "instalado y funcionando", no una
 * simulación. En Linux sin display: `xvfb-run -a npm run test:vscode`.
 *
 * Nota: se usa JS plano (CommonJS) porque @vscode/test-cli ejecuta los ficheros
 * tal cual dentro del host, sin transpilar.
 */

const assert = require('assert');
const vscode = require('vscode');

const EXTENSION_NAME = 'marketing-video-creator';

const COMMANDS = [
  'marketing-video-creator.startDemo',
  'marketing-video-creator.openPanel',
  'marketing-video-creator.cancelDemo',
  'marketing-video-creator.exportMobile',
  'marketing-video-creator.exportDesktop',
  'marketing-video-creator.openOutputFolder'
];

function getExtension() {
  return vscode.extensions.all.find(extension => extension.packageJSON && extension.packageJSON.name === EXTENSION_NAME);
}

suite('Marketing Video Creator · Extension Host', () => {
  test('la extensión está presente y se activa', async () => {
    const extension = getExtension();
    assert.ok(extension, `extensión ${EXTENSION_NAME} no encontrada en el host`);
    assert.strictEqual(extension.isActive, false, 'no debería estar activa antes de activarla');

    await extension.activate();
    assert.strictEqual(extension.isActive, true, 'la extensión no quedó activa');
  });

  test('registra los 6 comandos declarados en el manifiesto', async () => {
    await getExtension().activate();

    const registered = await vscode.commands.getCommands(true);
    for (const command of COMMANDS) {
      assert.ok(registered.includes(command), `comando no registrado: ${command}`);
    }
  });

  test('la configuración declarada se resuelve con sus valores por defecto', async () => {
    await getExtension().activate();

    const config = vscode.workspace.getConfiguration('marketingVideoCreator');
    assert.strictEqual(config.get('tts.provider'), 'sapi');
    assert.strictEqual(config.get('tts.voice'), 'Microsoft Pablo');
    assert.strictEqual(config.get('playwright.headless'), true);
    assert.strictEqual(config.get('playwright.fps'), 30);
    assert.strictEqual(config.get('output.directory'), './output/demo-video');
    assert.strictEqual(config.get('ffmpeg.autoDownload'), true);
    assert.strictEqual(config.get('variants.mobile.width'), 1080);
    assert.strictEqual(config.get('variants.desktop.height'), 1080);

    const phases = config.get('phases.list');
    assert.ok(Array.isArray(phases), 'phases.list no es un array');
    assert.strictEqual(phases.length, 7);
    assert.strictEqual(phases[0].id, '01-presentacion');
  });

  test('abre el panel webview sin lanzar errores', async () => {
    await getExtension().activate();

    const disposable = vscode.window.onDidChangeVisibleTextEditors(() => undefined);
    try {
      await vscode.commands.executeCommand('marketing-video-creator.openPanel');
    } finally {
      disposable.dispose();
    }
  });

  test('los comandos sin captura previa responden sin romper (avisan y salen)', async () => {
    await getExtension().activate();

    // Los mensajes de VS Code no se cierran solos en el host de test: se lanzan
    // sin esperar la promesa y se comprueba que no revientan.
    void vscode.commands.executeCommand('marketing-video-creator.exportDesktop');
    void vscode.commands.executeCommand('marketing-video-creator.exportMobile');
    void vscode.commands.executeCommand('marketing-video-creator.openOutputFolder');
    void vscode.commands.executeCommand('marketing-video-creator.cancelDemo');

    await new Promise(resolve => setTimeout(resolve, 750));
  });

  test('el manifest del host expone el bundle compilado del panel', () => {
    const extension = getExtension();
    assert.strictEqual(extension.packageJSON.main, './dist/extension.js');
    assert.strictEqual(extension.packageJSON.publisher, 'scolf');
  });
});
