/**
 * Static validation for User Firmware Validation System v2.
 *
 * This does not launch CubeMX. It proves that the renderer can derive a
 * CubeMX/CubeIDE contract from the visual wiring for GPIO, UART, and native
 * Renode I2C sensors across the supported STM32F1/F4 boards.
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
const {
  USER_FIRMWARE_VALIDATION_SCHEMA_VERSION,
  createCubeMxValidationPack,
} = require('../src/lib/cubemx-validation.ts');
const { createPeripheralTemplate } = require('../src/lib/firmware.ts');
const { getDevicePackage } = require('../src/lib/device-packages.ts');

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

function getAllBoardPads(board) {
  return board.connectors.all.flatMap((connector) => connector.pins);
}

function findPadIdByMcuPin(board, mcuPinId) {
  const pad = getAllBoardPads(board).find((candidate) => candidate.mcuPinId === mcuPinId);
  assert(pad, `${board.name} should expose ${mcuPinId} as a selectable pad.`);
  return pad.id;
}

function createNativeSensorWiring(board, devicePackageKind) {
  const i2c = board.runtime.i2c?.[0];
  assert(i2c, `${board.name} should expose an I2C bus for native sensor validation.`);
  const peripherals = createPeripheralTemplate(devicePackageKind, 1).map((peripheral) => ({
    ...peripheral,
    padId: peripheral.endpointId === 'scl'
      ? findPadIdByMcuPin(board, i2c.sclPinId)
      : findPadIdByMcuPin(board, i2c.sdaPinId),
  }));
  return { peripherals };
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
  assert(pack.schemaVersion === USER_FIRMWARE_VALIDATION_SCHEMA_VERSION, `${context} should use User Firmware Validation schema v2.`);
  assert(pack.supported, `${context} should be supported by v2.`);
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
  assert(snippet.includes('Keep GPIO polling fast'), `${context} snippet should document non-blocking peripheral work.`);
  console.log(`[firmware-v2] ${context}: ${expected.button} -> ${expected.led}, UART PA2/PA3`);
}

function validateNativeSensor(boardId, devicePackageKind, expected) {
  const board = getBoardSchema(boardId);
  const devicePackage = getDevicePackage(devicePackageKind);
  const pack = createCubeMxValidationPack(board, createNativeSensorWiring(board, devicePackageKind));
  const context = `${board.name} ${devicePackage.title}`;
  const contract = pack.nativeSensorContracts.find((candidate) => candidate.devicePackageKind === devicePackageKind);

  assert(pack.schemaVersion === USER_FIRMWARE_VALIDATION_SCHEMA_VERSION, `${context} should use User Firmware Validation schema v2.`);
  assert(pack.scenarios.find((scenario) => scenario.id === 'native-sensor-i2c')?.ready, `${context} native-sensor-i2c scenario should be ready.`);
  assert(contract, `${context} should produce a native sensor contract.`);
  assert(contract.schemaVersion === USER_FIRMWARE_VALIDATION_SCHEMA_VERSION, `${context} native contract schema mismatch.`);
  assert(contract.ready, `${context} native sensor contract should be ready.`);
  assert(contract.address === expected.address, `${context} I2C address mismatch.`);
  assert(contract.renodeBackendType === expected.backendType, `${context} Renode backend type mismatch.`);
  assert(contract.nativeRenodeType === expected.nativeRenodeType, `${context} native Renode type mismatch.`);
  assert(contract.canApplyNativeControls, `${context} should allow UI values to be applied to the native Renode sensor.`);
  assert(contract.canDecodeTransactions === expected.canDecodeTransactions, `${context} transaction decoder readiness mismatch.`);
  assert(contract.halHandle === 'hi2c1', `${context} should infer HAL I2C handle hi2c1.`);
  assertHint(pack, 'i2c-scl', 'PB6', context);
  assertHint(pack, 'i2c-sda', 'PB7', context);
  const snippet = pack.snippets.find((item) => item.id === 'native-sensor-i2c')?.source ?? '';
  assert(snippet.includes(`0x${expected.address.toString(16).toUpperCase()} << 1`), `${context} snippet should include the package I2C address.`);
  assert(snippet.includes('HAL_GetTick'), `${context} snippet should rate-limit sensor reads.`);
  assert(snippet.includes('HAL_I2C_Master_Transmit'), `${context} snippet should transmit an I2C command.`);
  assert(snippet.includes('HAL_I2C_Master_Receive'), `${context} snippet should receive I2C data.`);
  console.log(
    `[firmware-v2] ${context}: I2C1 PB6/PB7 @ 0x${expected.address.toString(16).toUpperCase()}, decoder=${contract.canDecodeTransactions}`
  );
}

function validateSi7021CompatibilityScenario(boardId) {
  const board = getBoardSchema(boardId);
  const pack = createCubeMxValidationPack(board, getExampleWiring(boardId, 'si7021-sensor'));
  const context = `${board.name} SI7021 compatibility`;
  assert(pack.scenarios.find((scenario) => scenario.id === 'si7021-i2c')?.ready, `${context} SI7021 scenario should remain ready.`);
  assert(pack.nativeSensorContracts.length === 1, `${context} should expose exactly one native sensor contract.`);
  assert(pack.nativeSensorContracts[0].devicePackageKind === 'si7021-sensor', `${context} should keep SI7021 package metadata.`);
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
  ['stm32f4-discovery', 'stm32f103-gpio-lab'].forEach((boardId) => {
    validateSi7021CompatibilityScenario(boardId);
    validateNativeSensor(boardId, 'si7021-sensor', {
      address: 0x40,
      backendType: 'renode-native-sensor',
      nativeRenodeType: 'Sensors.SI70xx',
      canDecodeTransactions: true,
    });
    validateNativeSensor(boardId, 'bmp180-sensor', {
      address: 0x77,
      backendType: 'renode-native-peripheral',
      nativeRenodeType: 'Sensors.BMP180',
      canDecodeTransactions: true,
    });
    validateNativeSensor(boardId, 'bme280-sensor', {
      address: 0x76,
      backendType: 'renode-native-peripheral',
      nativeRenodeType: 'I2C.BME280',
      canDecodeTransactions: false,
    });
  });
  console.log('User Firmware Validation System v2 completed successfully.');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
