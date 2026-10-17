const path = require('path');
const Mocha = require('mocha');

/**
 * Runner de los tests del Extension Host.
 *
 * VS Code carga este módulo (`extensionTestsPath`) y llama a `run()`: aquí se
 * configura Mocha y se añaden los ficheros de test, que declaran sus casos con
 * la interfaz TDD (`suite` / `test`).
 */
function run() {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 60000
  });

  mocha.addFile(path.resolve(__dirname, 'extension.test.js'));

  return new Promise((resolve, reject) => {
    try {
      mocha.run(failures => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) del Extension Host han fallado.`));
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { run };
