import type { DevicePackageSource } from '../../../src/lib/device-package-types';

/**
 * Independent Device Package source for SSD1306.
 *
 * It declares only reusable metadata: visual terminals, I2C protocol details,
 * Renode bus-broker backend, runtime panels, and validation fixtures. The UI
 * should not need SSD1306-specific library code to make this draggable.
 */
export const SSD1306_DEVICE_PACKAGE_SOURCE = {
  source: {
    packagePath: 'packages/devices/ssd1306',
    componentPackageKind: 'ssd1306-oled',
  },
  kind: 'ssd1306-oled',
  title: 'SSD1306 OLED',
  subtitle: '128x64 I2C display',
  description:
    'A two-wire I2C display endpoint prepared for the Renode Transaction Broker and front-end framebuffer preview.',
  version: '1.0.0',
  category: 'display',
  visual: {
    icon: 'oled',
    accentColor: '#38bdf8',
    defaultWidth: 168,
    defaultHeight: 104,
    terminalLayout: 'explicit-endpoints',
    library: {
      visible: true,
      order: 100,
      group: 'Bus Displays',
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
        handleId: 'ssd1306-oled:scl',
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
        handleId: 'ssd1306-oled:sda',
        connectable: true,
        dragGesture: 'terminal-to-board-pad',
      },
    },
    {
      id: 'vcc',
      label: 'VCC',
      role: 'power-vcc',
      direction: 'bidirectional',
      requiredPadCapabilities: ['power-vcc'],
      netKind: 'power',
      protocols: ['power'],
      terminal: {
        side: 'bottom',
        order: 0,
        handleId: 'ssd1306-oled:vcc',
        connectable: true,
        dragGesture: 'terminal-to-board-pad',
      },
    },
    {
      id: 'gnd',
      label: 'GND',
      role: 'power-gnd',
      direction: 'bidirectional',
      requiredPadCapabilities: ['ground'],
      netKind: 'ground',
      protocols: ['ground'],
      terminal: {
        side: 'bottom',
        order: 1,
        handleId: 'ssd1306-oled:gnd',
        connectable: true,
        dragGesture: 'terminal-to-board-pad',
      },
    },
  ],
  electricalRules: {
    requiresPower: true,
    requiresGround: true,
    voltageDomains: ['3v3', '5v'],
    compatibleProtocols: ['i2c', 'power', 'ground'],
    busPairing: 'i2c-scl-sda',
    outputContention: 'not-applicable',
  },
  protocol: {
    primary: 'i2c',
    buses: ['i2c'],
    addressMode: 'seven-bit',
    defaultAddress: 0x3c,
    transactionModel: 'framebuffer-i2c',
  },
  renodeBackend: {
    type: 'bus-transaction-broker',
    manifest: 'runtime-bus-manifest',
    model: 'ssd1306',
    address: 0x3c,
  },
  runtimePanel: {
    controls: [],
    visualizers: ['oled-preview', 'bus-transactions', 'runtime-timeline'],
    eventParsers: ['bus-transaction', 'i2c-ssd1306-framebuffer'],
  },
  exampleFirmware: {
    mode: 'generated-i2c-demo',
    generatedDriver: 'generated-i2c-demo-driver',
    requiredIncludes: ['stdint.h'],
  },
  validationFixture: {
    representative: 'i2c-display',
    expectedManifest: 'runtime-bus-manifest',
    expectedPanels: ['oled-preview', 'bus-transactions'],
    smokeExampleId: 'nucleo-h753zi-ssd1306-oled',
  },
} as const satisfies DevicePackageSource;

export default SSD1306_DEVICE_PACKAGE_SOURCE;
