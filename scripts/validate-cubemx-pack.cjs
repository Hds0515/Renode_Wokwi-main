/**
 * Static validation for the F1/F4 User Firmware Validation Pack.
 *
 * This does not launch CubeMX. It proves that the examples and UI guidance can
 * derive the expected CubeMX pin contract for the three MVP paths:
 * Button -> LED, UART terminal output, and SI7021 I2C reads.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

const { getBoardSchema } = require('../src/lib/boards.ts');
const { getExampleProject } = require('../src/lib/examples.ts');
const { createCubeMxValidationPack } = require('../src/lib/cubemx-validation.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getExampleWiring(boardId, suffix) {
  const example = getExampleProject(`${boardId}-${suffix}`, boardId);
  assert(example, `Missing bundled example ${boardId}-${suffix}.`);
  return example.project.wiring;
}

function assertHint(pack, role, mcuPinId, context) {
  assert(
    pack.pinHints.some((hint) => hint.role === role && hint.mcuPinId === mcuPinId),
    `${context} should expose ${role} on ${mcuPinId}.`
  );
}

function validateButtonLed(boardId, expected) {
  const board = getBoardSchema(boardId);
  const pack = createCubeMxValidationPack(board, getExampleWiring(boardId, 'button-led'));
  const context = `${board.name} Button -> LED`;
  assert(pack.schemaVersion === 1, `${context} should use CubeMX validation schema v1.`);
  assert(pack.supported, `${context} should be supported by v1.`);
  assert(pack.cubeMxTarget === expected.target, `${context} target mismatch.`);
  assert(pack.scenarios.find((scenario) => scenario.id === 'button-led')?.ready, `${context} button-led scenario should be ready.`);
  assert(pack.scenarios.find((scenario) => scenario.id === 'uart-output')?.ready, `${context} UART scenario should be ready.`);
  assertHint(pack, 'gpio-input', expected.button, context);
  assertHint(pack, 'gpio-output', expected.led, context);
  assertHint(pack, 'uart-tx', 'PA2', context);
  assertHint(pack, 'uart-rx', 'PA3', context);
  const snippet = pack.snippets.find((item) => item.id === 'button-led')?.source ?? '';
  assert(snippet.includes('HAL_GPIO_ReadPin'), `${context} snippet should read GPIO.`);
  assert(snippet.includes('HAL_GPIO_WritePin'), `${context} snippet should write GPIO.`);
  console.log(`[cubemx] ${context}: ${expected.button} -> ${expected.led}, UART PA2/PA3`);
}

function validateSi7021(boardId, expected) {
  const board = getBoardSchema(boardId);
  const pack = createCubeMxValidationPack(board, getExampleWiring(boardId, 'si7021-sensor'));
  const context = `${board.name} SI7021`;
  assert(pack.scenarios.find((scenario) => scenario.id === 'si7021-i2c')?.ready, `${context} SI7021 scenario should be ready.`);
  assert(pack.scenarios.find((scenario) => scenario.id === 'uart-output')?.ready, `${context} UART scenario should be ready.`);
  assertHint(pack, 'i2c-scl', expected.scl, context);
  assertHint(pack, 'i2c-sda', expected.sda, context);
  assertHint(pack, 'uart-tx', 'PA2', context);
  assertHint(pack, 'uart-rx', 'PA3', context);
  const snippet = pack.snippets.find((item) => item.id === 'si7021-i2c')?.source ?? '';
  assert(snippet.includes('SI7021_ADDR'), `${context} snippet should define the SI7021 address.`);
  assert(snippet.includes('HAL_I2C_Master_Transmit'), `${context} snippet should transmit an I2C command.`);
  assert(snippet.includes('HAL_I2C_Master_Receive'), `${context} snippet should receive I2C data.`);
  console.log(`[cubemx] ${context}: ${expected.scl}/${expected.sda}, UART PA2/PA3`);
}

function validateDocs() {
  const requiredFiles = [
    'docs/cubemx-user-firmware-guide.md',
    'examples/firmware-cubemx/README.md',
    'examples/firmware-cubemx/stm32f4-discovery-button-led.md',
    'examples/firmware-cubemx/stm32f103-gpio-lab-button-led.md',
    'examples/firmware-cubemx/stm32f4-discovery-si7021.md',
    'examples/firmware-cubemx/stm32f103-gpio-lab-si7021.md',
  ];
  requiredFiles.forEach((filePath) => {
    const absolutePath = path.join(__dirname, '..', filePath);
    assert(fs.existsSync(absolutePath), `Missing CubeMX validation document: ${filePath}`);
    const content = fs.readFileSync(absolutePath, 'utf8');
    assert(content.includes('CubeMX') || content.includes('CubeIDE'), `${filePath} should mention CubeMX/CubeIDE.`);
  });
}

function main() {
  validateDocs();
  validateButtonLed('stm32f4-discovery', {
    target: 'STM32F407VGTx',
    button: 'PA1',
    led: 'PB0',
  });
  validateButtonLed('stm32f103-gpio-lab', {
    target: 'STM32F103RBTx',
    button: 'PA0',
    led: 'PB0',
  });
  validateSi7021('stm32f4-discovery', {
    scl: 'PB6',
    sda: 'PB7',
  });
  validateSi7021('stm32f103-gpio-lab', {
    scl: 'PB6',
    sda: 'PB7',
  });
  console.log('CubeMX user firmware validation pack completed successfully.');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
