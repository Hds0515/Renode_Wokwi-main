import type { DevicePackageSource } from '../../../src/lib/device-package-types';

/**
 * Independent Device Package source for BMP180.
 *
 * This package proves the native Renode sensor path is no longer SI7021-only:
 * visual pins, runtime controls, Renode backend metadata, and validation data
 * all come from the package/catalog layer.
 */
export const BMP180_DEVICE_PACKAGE_SOURCE = {
  source: {
    packagePath: 'packages/devices/bmp180',
    componentPackageKind: 'bmp180-sensor',
    sensorPackageKind: 'bmp180-sensor',
  },
  kind: 'bmp180-sensor',
  title: 'BMP180 Sensor',
  subtitle: 'I2C pressure/temperature',
  description:
    'A Renode BMP180-compatible I2C pressure and temperature sensor with adjustable native monitor properties.',
  version: '1.0.0',
  category: 'sensor',
  visual: {
    icon: 'sensor',
    accentColor: '#f97316',
    defaultWidth: 168,
    defaultHeight: 104,
    terminalLayout: 'explicit-endpoints',
    library: {
      visible: true,
      order: 210,
      group: 'Sensors',
      draggable: true,
      addMode: 'legacy-template',
    },
  },
  pins: [
    {
      id: 'scl',
      label: 'SCL',
      role: 'i2c-scl',
      direction: 'bidirectional',
      requiredPadCapabilities: ['gpio', 'i2c-scl'],
      netKind: 'i2c',
      protocols: ['i2c'],
      terminal: {
        side: 'top',
        order: 0,
        handleId: 'bmp180-sensor:scl',
        connectable: true,
        dragGesture: 'terminal-to-board-pad',
      },
    },
    {
      id: 'sda',
      label: 'SDA',
      role: 'i2c-sda',
      direction: 'bidirectional',
      requiredPadCapabilities: ['gpio', 'i2c-sda'],
      netKind: 'i2c',
      protocols: ['i2c'],
      terminal: {
        side: 'top',
        order: 1,
        handleId: 'bmp180-sensor:sda',
        connectable: true,
        dragGesture: 'terminal-to-board-pad',
      },
    },
  ],
  electricalRules: {
    requiresPower: false,
    requiresGround: false,
    voltageDomains: [],
    compatibleProtocols: ['i2c'],
    busPairing: 'i2c-scl-sda',
    outputContention: 'not-applicable',
  },
  protocol: {
    primary: 'i2c',
    buses: ['i2c'],
    addressMode: 'seven-bit',
    defaultAddress: 0x77,
    transactionModel: 'mcu-initiated-i2c',
  },
  renodeBackend: {
    type: 'renode-native-peripheral',
    manifest: 'runtime-bus-manifest',
    model: 'bmp180',
    address: 0x77,
    nativeRenodeType: 'Sensors.BMP180',
    nativeCatalogId: 'bmp180',
    nativeControlTransport: 'renode-monitor-property',
    sensorPackage: 'bmp180-sensor',
  },
  runtimePanel: {
    controls: ['sensor-control', 'sensor-inspector'],
    visualizers: ['bus-transactions', 'uart-terminal', 'runtime-timeline'],
    eventParsers: ['bus-transaction', 'i2c-bmp180-measurement', 'uart-line-buffer'],
  },
  exampleFirmware: {
    mode: 'manual-compatible',
    generatedDriver: null,
    requiredIncludes: ['stdint.h'],
  },
  validationFixture: {
    representative: 'i2c-sensor',
    expectedManifest: 'runtime-bus-manifest',
    expectedPanels: ['sensor-control', 'bus-transactions', 'uart-terminal'],
    smokeExampleId: null,
  },
} as const satisfies DevicePackageSource;

export default BMP180_DEVICE_PACKAGE_SOURCE;
