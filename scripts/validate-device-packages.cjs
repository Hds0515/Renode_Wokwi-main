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

  const ssd1306 = getDevicePackage('ssd1306-oled');
  assert(ssd1306.validationFixture.representative === 'i2c-display', 'SSD1306 must represent the I2C display fixture.');
  assert(ssd1306.renodeBackend.type === 'bus-transaction-broker', 'SSD1306 must use the bus transaction broker backend.');
  assert(ssd1306.runtimePanel.visualizers.includes('oled-preview'), 'SSD1306 must expose an OLED preview panel.');

  const uart = getDevicePackage('uart-terminal');
  assert(uart.validationFixture.representative === 'uart-instrument', 'UART Terminal must represent the virtual instrument fixture.');
  assert(uart.renodeBackend.type === 'virtual-uart-terminal', 'UART Terminal must use the virtual UART backend.');
  assert(uart.runtimePanel.eventParsers.includes('uart-line-buffer'), 'UART Terminal must parse UART line buffers.');
}

function validateSensorProtocolCodecRegistry() {
  assert(SENSOR_PROTOCOL_CODEC_REGISTRY_SCHEMA_VERSION === 1, 'Sensor Protocol Codec Registry should use schema v1.');
  assert(SENSOR_PROTOCOL_CODECS.length >= 1, 'Expected at least one reusable sensor protocol codec.');

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
  validateSensorProtocolCodecRegistry();
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
