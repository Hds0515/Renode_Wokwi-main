/**
 * Device Package Conformance Test v1.
 *
 * This validates reusable external device packages independently from a single
 * demo project. The goal is to prove every package can drive the schema-based
 * pipeline: visual library -> Netlist/IR -> Renode manifest -> runtime panels
 * -> event/parser or protocol codec.
 */
const fs = require('fs');
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

const { COMPONENT_PACKAGE_SDKS } = require('../src/lib/component-packs.ts');
const {
  DEVICE_PACKAGE_CATALOG,
  DEVICE_PACKAGES,
  getDevicePackage,
  getSensorDevicePackage,
} = require('../src/lib/device-packages.ts');
const {
  DEVICE_PACKAGE_CONFORMANCE_SCHEMA_VERSION,
  validateDevicePackageCatalogConformance,
} = require('../src/lib/device-package-conformance.ts');
const {
  SENSOR_PROTOCOL_CODEC_REGISTRY_SCHEMA_VERSION,
  SENSOR_PROTOCOL_CODECS,
  findSensorProtocolCodec,
} = require('../src/lib/sensor-protocol-codecs.ts');
const { SENSOR_PACKAGE_SDKS } = require('../src/lib/sensor-packages.ts');
const {
  RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION,
  RENODE_NATIVE_PERIPHERAL_CATALOG,
  getRenodeNativePeripheralCatalogEntry,
  getGeneratedRenodeNativePeripheralCatalogEntries,
} = require('../src/lib/renode-native-peripheral-catalog.ts');
const {
  RENODE_NATIVE_DEVICE_PACKAGE_GENERATOR_VERSION,
  GENERATED_RENODE_NATIVE_DEVICE_PACKAGE_SOURCES,
} = require('../src/lib/renode-native-device-package-generator.ts');
const {
  DEVICE_PACKAGE_NATIVE_RUNTIME_SCHEMA_VERSION,
  countDevicePackageInstances,
  createPeripheralsFromDevicePackage,
  getDevicePackageLibraryItems,
  getDevicePackagePinForPeripheral,
  getDevicePackageRequirementSummary,
} = require('../src/lib/device-package-native-runtime.ts');
const { BOARD_SCHEMAS } = require('../src/lib/boards.ts');
const { createPeripheralTemplate } = require('../src/lib/firmware.ts');
const { createNetlistFromWiring } = require('../src/lib/netlist.ts');
const { createRuntimeBusManifest } = require('../src/lib/runtime-timeline.ts');
const { createProtocolRuntimeRegistry } = require('../src/lib/protocol-runtime-registry.ts');
const {
  BUS_SENSOR_RUNTIME_SCHEMA_VERSION,
  applyNativeSensorControlValues,
  createBusSensorReadTransactions,
  createBusSensorRuntimeState,
  getBusSensorRuntimeDevicesFromProtocolRegistry,
  summarizeNativeSensorRuntime,
} = require('../src/lib/bus-sensor-runtime.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateRepresentativeDevices() {
  const si7021 = getSensorDevicePackage('si7021-sensor');
  assert(si7021.validationFixture.representative === 'i2c-sensor', 'SI7021 must represent the I2C sensor fixture.');
  assert(si7021.renodeBackend.type === 'renode-native-sensor', 'SI7021 must use the native Renode sensor backend.');
  assert(si7021.runtimePanel.controls.includes('sensor-control'), 'SI7021 must expose generic sensor controls.');

  const bmp180 = getSensorDevicePackage('bmp180-sensor');
  assert(bmp180.validationFixture.representative === 'i2c-sensor', 'BMP180 must represent the I2C sensor fixture.');
  assert(bmp180.renodeBackend.type === 'renode-native-peripheral', 'BMP180 must use the generic native Renode peripheral backend.');
  assert(bmp180.renodeBackend.nativeCatalogId === 'bmp180', 'BMP180 must reference the native peripheral catalog.');
  assert(bmp180.runtimePanel.eventParsers.includes('i2c-bmp180-measurement'), 'BMP180 must register its reusable protocol parser.');

  const ssd1306 = getDevicePackage('ssd1306-oled');
  assert(ssd1306.validationFixture.representative === 'i2c-display', 'SSD1306 must represent the I2C display fixture.');
  assert(ssd1306.renodeBackend.type === 'bus-transaction-broker', 'SSD1306 must use the bus transaction broker backend.');
  assert(ssd1306.runtimePanel.visualizers.includes('oled-preview'), 'SSD1306 must expose an OLED preview panel.');

  const uart = getDevicePackage('uart-terminal');
  assert(uart.validationFixture.representative === 'uart-instrument', 'UART Terminal must represent the virtual instrument fixture.');
  assert(uart.renodeBackend.type === 'virtual-uart-terminal', 'UART Terminal must use the virtual UART backend.');
  assert(uart.runtimePanel.eventParsers.includes('uart-line-buffer'), 'UART Terminal must parse UART line buffers.');

  ['bme280-sensor', 'hs3001-sensor', 'sht45-sensor'].forEach((kind) => {
    const generated = getDevicePackage(kind);
    assert(generated.compiler.source === 'independent-package', `${kind} must be compiled from a generated Device Package source.`);
    assert(generated.renodeBackend.type === 'renode-native-peripheral', `${kind} must use the generic native Renode peripheral backend.`);
    assert(generated.runtimePanel.controls.includes('sensor-control'), `${kind} must expose generic sensor controls from catalog channels.`);
    assert(generated.runtimePanel.eventParsers.includes('bus-transaction'), `${kind} must enter the unified bus transaction event stream.`);
  });
}

function validateRenodeNativePeripheralCatalog() {
  assert(RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION === 2, 'Renode Native Peripheral Catalog should use schema v2.');
  assert(RENODE_NATIVE_PERIPHERAL_CATALOG.entries.length >= 5, 'Expected SI70xx, BMP180, BME280, HS3001, and SHT45 native catalog entries.');
  assert(RENODE_NATIVE_DEVICE_PACKAGE_GENERATOR_VERSION === 1, 'Renode Native Device Package Generator should use version v1.');
  assert(GENERATED_RENODE_NATIVE_DEVICE_PACKAGE_SOURCES.length >= 3, 'Expected at least three catalog-generated native Device Package sources.');
  assert(
    getGeneratedRenodeNativePeripheralCatalogEntries().length >= 5,
    'Catalog should mark native peripheral entries as eligible for Device Package generation.'
  );

  const bmp180 = getRenodeNativePeripheralCatalogEntry('bmp180');
  assert(bmp180.renodeType === 'Sensors.BMP180', 'BMP180 catalog entry should map to Renode Sensors.BMP180.');
  assert(bmp180.defaultAddress === 0x77, 'BMP180 catalog entry should use I2C address 0x77.');
  assert(
    bmp180.control.channels.some((channel) => channel.renodeProperty === 'Temperature') &&
      bmp180.control.channels.some((channel) => channel.renodeProperty === 'UncompensatedPressure'),
    'BMP180 catalog entry should expose Renode Temperature and UncompensatedPressure controls.'
  );

  const bme280 = getRenodeNativePeripheralCatalogEntry('bme280');
  assert(bme280.renodeType === 'I2C.BME280', 'BME280 catalog entry should map to Renode I2C.BME280.');
  assert(bme280.defaultAddress === 0x76, 'BME280 catalog entry should use I2C address 0x76.');
  assert(bme280.control.channels.some((channel) => channel.renodeProperty === 'Pressure'), 'BME280 should expose pressure control.');

  const hs3001 = getRenodeNativePeripheralCatalogEntry('hs3001');
  assert(hs3001.renodeType === 'Sensors.HS3001', 'HS3001 catalog entry should map to Renode Sensors.HS3001.');
  assert(hs3001.defaultAddress === 0x44, 'HS3001 catalog entry should use I2C address 0x44.');

  const sht45 = getRenodeNativePeripheralCatalogEntry('sht45');
  assert(sht45.renodeType === 'I2C.SHT45', 'SHT45 catalog entry should map to Renode I2C.SHT45.');
  assert(sht45.control.channels.some((channel) => channel.renodeProperty === 'SerialNumber'), 'SHT45 should expose serial number control.');
}

function validateSensorProtocolCodecRegistry() {
  assert(SENSOR_PROTOCOL_CODEC_REGISTRY_SCHEMA_VERSION === 1, 'Sensor Protocol Codec Registry should use schema v1.');
  assert(SENSOR_PROTOCOL_CODECS.length >= 2, 'Expected SI70xx and BMP180 reusable sensor protocol codecs.');

  SENSOR_PACKAGE_SDKS.forEach((sensorPackage) => {
    const codec = findSensorProtocolCodec(sensorPackage.busRuntime.transactionCodec);
    assert(codec, `${sensorPackage.kind} references missing sensor protocol codec ${sensorPackage.busRuntime.transactionCodec}.`);
    sensorPackage.channels.forEach((channel) => {
      assert(
        codec.supportedChannels.includes(channel.id),
        `${sensorPackage.kind}.${channel.id} is not supported by codec ${codec.id}.`
      );
    });
  });
}

function validateDevicePackageNativeRuntime() {
  assert(DEVICE_PACKAGE_NATIVE_RUNTIME_SCHEMA_VERSION === 1, 'Device Package Native Runtime should use schema v1.');
  const libraryItems = getDevicePackageLibraryItems();
  assert(libraryItems.length > 0, 'Device Package Native Runtime should expose visible library items.');

  libraryItems.forEach((item) => {
    assert(item.schemaVersion === DEVICE_PACKAGE_NATIVE_RUNTIME_SCHEMA_VERSION, `${item.packageKind} library item schema mismatch.`);
    assert(item.endpointCount > 0, `${item.packageKind} should expose at least one connectable endpoint.`);
    assert(item.requirementSummary === getDevicePackageRequirementSummary(item.packageKind), `${item.packageKind} requirement summary should be package-driven.`);
    assert(item.canInstantiate, `${item.packageKind} should be instantiable through the native runtime compatibility bridge.`);

    const peripherals = createPeripheralsFromDevicePackage(item.packageKind, 1);
    assert(peripherals.length === item.endpointCount, `${item.packageKind} should create one peripheral per connectable endpoint.`);
    peripherals.forEach((peripheral) => {
      const pin = getDevicePackagePinForPeripheral(peripheral);
      assert(pin, `${item.packageKind}.${peripheral.endpointId} should round-trip to a Device Package pin.`);
      assert(pin.terminal.connectable, `${item.packageKind}.${pin.id} should stay connectable.`);
    });

    const wiring = { peripherals };
    assert(countDevicePackageInstances(wiring, item.packageKind) === 1, `${item.packageKind} instance counting should be package-driven.`);
  });
}

function findPadIdByMcuPin(board, mcuPinId) {
  const pad = board.connectors.all.flatMap((connector) => connector.pins).find((candidate) => candidate.mcuPinId === mcuPinId);
  assert(pad, `${board.name} should expose ${mcuPinId} for Native Sensor Runtime validation.`);
  return pad.id;
}

function createI2cSensorFixture(kind) {
  const board = BOARD_SCHEMAS.find((candidate) => candidate.id === 'stm32f103-gpio-lab');
  assert(board, 'Native Sensor Runtime v2 fixture needs the STM32F103 GPIO Lab board.');
  const i2c = board.runtime.i2c?.[0];
  assert(i2c, `${board.name} should expose I2C runtime metadata.`);
  const peripherals = createPeripheralTemplate(kind, 1).map((peripheral) => ({
    ...peripheral,
    padId: peripheral.endpointId === 'scl' ? findPadIdByMcuPin(board, i2c.sclPinId) : findPadIdByMcuPin(board, i2c.sdaPinId),
  }));
  return {
    board,
    netlist: createNetlistFromWiring({ peripherals }, board),
  };
}

function validateNativeSensorRuntimeV2() {
  assert(BUS_SENSOR_RUNTIME_SCHEMA_VERSION === 2, 'Native Sensor Runtime should use Bus Sensor Runtime schema v2.');

  [
    { kind: 'si7021-sensor', expectedReadiness: 'ready', expectedDecoder: true },
    { kind: 'bmp180-sensor', expectedReadiness: 'ready', expectedDecoder: true },
    { kind: 'bme280-sensor', expectedReadiness: 'needs-codec', expectedDecoder: false },
  ].forEach((fixture) => {
    const { board, netlist } = createI2cSensorFixture(fixture.kind);
    const busManifest = createRuntimeBusManifest(board, netlist);
    const protocolRuntimeRegistry = createProtocolRuntimeRegistry({ board, busManifest });
    const devices = getBusSensorRuntimeDevicesFromProtocolRegistry(protocolRuntimeRegistry);
    const runtimeDevice = devices.find((device) => device.devicePackageKind === fixture.kind);
    assert(runtimeDevice, `${fixture.kind} should be discoverable through Protocol Runtime Registry -> Native Sensor Runtime.`);
    assert(runtimeDevice.nativeRuntime.schemaVersion === BUS_SENSOR_RUNTIME_SCHEMA_VERSION, `${fixture.kind} native runtime contract schema mismatch.`);
    assert(runtimeDevice.nativeRuntime.attachment === 'renode-native', `${fixture.kind} should attach to a native Renode peripheral path.`);
    assert(runtimeDevice.nativeRuntime.readiness === fixture.expectedReadiness, `${fixture.kind} native runtime readiness mismatch.`);
    assert(runtimeDevice.nativeRuntime.canApplyNativeControls, `${fixture.kind} should allow UI channel values to be applied to Renode native properties.`);
    assert(runtimeDevice.nativeRuntime.canReadThroughUserFirmware, `${fixture.kind} should be readable by user firmware through MCU I2C.`);
    assert(runtimeDevice.nativeRuntime.canDecodeTransactions === fixture.expectedDecoder, `${fixture.kind} decoder readiness mismatch.`);

    const initialState = createBusSensorRuntimeState(devices);
    const summary = summarizeNativeSensorRuntime(initialState, devices);
    assert(summary.schemaVersion === BUS_SENSOR_RUNTIME_SCHEMA_VERSION, `${fixture.kind} summary schema mismatch.`);
    assert(summary.nativeReadyCount >= 1, `${fixture.kind} summary should count the native firmware read path.`);

    const state = initialState.devices[runtimeDevice.id];
    const firstChannel = Object.values(state.channels)[0];
    const applied = applyNativeSensorControlValues(initialState, runtimeDevice.nativeRenodePath, {
      [firstChannel.id]: firstChannel.configuredValue,
    });
    assert(applied.devices[runtimeDevice.id].nativeApplyCount === 1, `${fixture.kind} should track native apply count.`);
    assert(
      typeof applied.devices[runtimeDevice.id].lastNativeApplyValues[firstChannel.id] === 'number',
      `${fixture.kind} should keep the last applied native channel value.`
    );

    const transactions = createBusSensorReadTransactions(runtimeDevice, state, firstChannel.id);
    assert(
      fixture.expectedDecoder ? transactions.length > 0 : transactions.length === 0,
      `${fixture.kind} transaction creation should reflect codec availability.`
    );
  });
}

function main() {
  const report = validateDevicePackageCatalogConformance({
    catalog: DEVICE_PACKAGE_CATALOG,
    componentPackages: COMPONENT_PACKAGE_SDKS,
  });

  assert(report.schemaVersion === DEVICE_PACKAGE_CONFORMANCE_SCHEMA_VERSION, 'Conformance report schema mismatch.');
  assert(report.packageCount === DEVICE_PACKAGES.length, 'Conformance package count should match the runtime catalog.');
  report.issues.forEach((issue) => {
    const prefix = issue.severity === 'error' ? '[device:error]' : '[device:warning]';
    console.log(`${prefix} ${issue.packageKind} ${issue.code}: ${issue.message}`);
  });
  assert(report.errorCount === 0, `Device Package conformance failed with ${report.errorCount} error(s).`);

  validateRepresentativeDevices();
  validateRenodeNativePeripheralCatalog();
  validateSensorProtocolCodecRegistry();
  validateDevicePackageNativeRuntime();
  validateNativeSensorRuntimeV2();
  console.log(
    `Device Package conformance completed: ${report.packageCount} package(s), ${SENSOR_PROTOCOL_CODECS.length} sensor protocol codec(s), ${report.warningCount} warning(s).`
  );
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
