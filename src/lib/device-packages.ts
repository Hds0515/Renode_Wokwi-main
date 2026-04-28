/**
 * Unified Device Package schema.
 *
 * This layer is the next abstraction above component-packs and sensor-packages:
 * a "device" describes how a visual part looks, which pins it exposes, which
 * electrical rules apply, how it maps to Renode, which runtime panels it needs,
 * and which validation fixture proves the package is reusable.
 */
import {
  COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
  COMPONENT_PACKAGE_SDKS,
  ComponentPackageEndpointNetKind,
  ComponentPackageProtocol,
  ComponentPackageResultPanel,
  ComponentPackageSdk,
  getComponentPackageSdk,
} from './component-packs';
import type { DemoEndpointDirection, DemoPadCapability, DemoPeripheralTemplateKind } from './firmware';
import {
  SENSOR_PACKAGE_SDK_SCHEMA_VERSION,
  SensorPackageKind,
  SensorPackageSdk,
  getSensorPackageSdk,
  isSensorPackageKind,
} from './sensor-packages';

export const DEVICE_PACKAGE_SCHEMA_VERSION = 3;
export const DEVICE_PACKAGE_CATALOG_VERSION = 1;

export type DevicePackageKind = DemoPeripheralTemplateKind | 'uart-terminal';
export type DevicePackageCategory = 'input' | 'output' | 'grouped-output' | 'display' | 'sensor' | 'instrument';
export type DevicePackageProtocol = ComponentPackageProtocol | 'ground' | 'uart' | 'spi' | 'virtual';
export type DevicePackagePinRole =
  | 'gpio-signal'
  | 'i2c-scl'
  | 'i2c-sda'
  | 'uart-tx'
  | 'uart-rx'
  | 'spi-sck'
  | 'spi-miso'
  | 'spi-mosi'
  | 'spi-cs'
  | 'power-vcc'
  | 'power-gnd'
  | 'virtual-terminal';
export type DevicePackageNetKind = ComponentPackageEndpointNetKind | 'uart' | 'spi' | 'virtual';
export type DeviceRuntimePanelKind =
  | ComponentPackageResultPanel
  | 'uart-terminal'
  | 'gpio-monitor'
  | 'oled-preview'
  | 'sensor-inspector'
  | 'runtime-timeline';
export type DeviceRuntimeEventParser =
  | 'gpio-level'
  | 'i2c-ssd1306-framebuffer'
  | 'i2c-si70xx-measurement'
  | 'uart-line-buffer'
  | 'bus-transaction';

export type DevicePackagePin = {
  id: string;
  label: string;
  role: DevicePackagePinRole;
  direction: DemoEndpointDirection;
  requiredPadCapabilities: readonly DemoPadCapability[];
  netKind: DevicePackageNetKind;
  protocols: readonly DevicePackageProtocol[];
  terminal: {
    side: 'top' | 'right' | 'bottom' | 'left';
    order: number;
    handleId: string;
    connectable: boolean;
    dragGesture: 'terminal-to-board-pad' | 'virtual-board-instrument';
  };
};

export type DevicePackage = {
  schemaVersion: typeof DEVICE_PACKAGE_SCHEMA_VERSION;
  kind: DevicePackageKind;
  title: string;
  subtitle: string;
  description: string;
  version: '1.0.0';
  category: DevicePackageCategory;
  visual: {
    icon: 'button' | 'led' | 'buzzer' | 'rgb-led' | 'oled' | 'sensor' | 'terminal';
    accentColor: string;
    defaultWidth: number;
    defaultHeight: number;
    terminalLayout: 'explicit-endpoints' | 'virtual-instrument';
    library: {
      visible: boolean;
      order: number;
      group: 'GPIO' | 'Bus Displays' | 'Sensors' | 'Virtual Instruments';
      draggable: boolean;
      addMode: 'legacy-template' | 'board-instrument';
    };
  };
  pins: readonly DevicePackagePin[];
  electricalRules: {
    requiresPower: boolean;
    requiresGround: boolean;
    voltageDomains: readonly ('3v3' | '5v' | 'vin' | 'external')[];
    compatibleProtocols: readonly DevicePackageProtocol[];
    busPairing: 'none' | 'i2c-scl-sda' | 'uart-tx-rx' | 'spi-sck-miso-mosi-cs';
    outputContention: 'forbid' | 'not-applicable';
  };
  protocol: {
    primary: DevicePackageProtocol;
    buses: readonly DevicePackageProtocol[];
    addressMode?: 'seven-bit';
    defaultAddress?: number;
    transactionModel:
      | 'gpio-level'
      | 'mcu-initiated-i2c'
      | 'framebuffer-i2c'
      | 'uart-stream'
      | 'virtual-instrument';
  };
  renodeBackend: {
    type: 'signal-broker' | 'bus-transaction-broker' | 'renode-native-sensor' | 'virtual-uart-terminal';
    manifest: 'runtime-signal-manifest' | 'runtime-bus-manifest' | 'board-runtime';
    model: string;
    address?: number;
    replPeripheral?: string;
    nativeRenodeType?: string;
    nativeControlTransport?: 'renode-monitor-property';
    sensorPackage?: SensorPackageKind;
  };
  runtimePanel: {
    controls: readonly DeviceRuntimePanelKind[];
    visualizers: readonly DeviceRuntimePanelKind[];
    eventParsers: readonly DeviceRuntimeEventParser[];
  };
  exampleFirmware: {
    mode: 'generated-gpio-demo' | 'generated-i2c-demo' | 'board-uart-terminal' | 'manual-compatible';
    generatedDriver: string | null;
    requiredIncludes: readonly string[];
  };
  validationFixture: {
    representative: 'gpio-basic' | 'i2c-display' | 'i2c-sensor' | 'uart-instrument';
    expectedManifest: 'runtime-signal-manifest' | 'runtime-bus-manifest' | 'board-runtime';
    expectedPanels: readonly DeviceRuntimePanelKind[];
    smokeExampleId: string | null;
  };
  legacy: {
    componentPackageKind?: DemoPeripheralTemplateKind;
    componentPackageSdkSchemaVersion?: typeof COMPONENT_PACKAGE_SDK_SCHEMA_VERSION;
    sensorPackageKind?: SensorPackageKind;
    sensorPackageSdkSchemaVersion?: typeof SENSOR_PACKAGE_SDK_SCHEMA_VERSION;
  };
};

export type DevicePackageCatalog = {
  schemaVersion: typeof DEVICE_PACKAGE_SCHEMA_VERSION;
  catalogVersion: typeof DEVICE_PACKAGE_CATALOG_VERSION;
  packages: readonly DevicePackage[];
};

const DEVICE_LIBRARY_ORDER: Record<DemoPeripheralTemplateKind, number> = {
  button: 10,
  led: 20,
  buzzer: 30,
  'rgb-led': 40,
  'ssd1306-oled': 100,
  'si7021-sensor': 200,
};

function iconForComponent(kind: DemoPeripheralTemplateKind): DevicePackage['visual']['icon'] {
  if (kind === 'ssd1306-oled') {
    return 'oled';
  }
  if (kind === 'si7021-sensor') {
    return 'sensor';
  }
  return kind;
}

function groupForComponent(kind: DemoPeripheralTemplateKind): DevicePackage['visual']['library']['group'] {
  if (kind === 'ssd1306-oled') {
    return 'Bus Displays';
  }
  if (kind === 'si7021-sensor') {
    return 'Sensors';
  }
  return 'GPIO';
}

function roleForPin(role: string): DevicePackagePinRole {
  if (role === 'power-vcc' || role === 'power-gnd' || role === 'i2c-scl' || role === 'i2c-sda') {
    return role;
  }
  return 'gpio-signal';
}

function normalizeProtocols(protocols: readonly ComponentPackageProtocol[]): readonly DevicePackageProtocol[] {
  return protocols;
}

function getComponentBackend(componentPackage: ComponentPackageSdk, sensorSdk: SensorPackageSdk | null): DevicePackage['renodeBackend'] {
  if (sensorSdk) {
    return {
      type: 'renode-native-sensor',
      manifest: 'runtime-bus-manifest',
      model: componentPackage.runtime.type === 'renode-i2c-broker' ? componentPackage.runtime.model : sensorSdk.kind,
      address: sensorSdk.protocol.defaultAddress,
      nativeRenodeType: sensorSdk.native.renodeType,
      nativeControlTransport: sensorSdk.native.sdkControl.transport,
      sensorPackage: sensorSdk.kind,
    };
  }

  if (componentPackage.runtime.type === 'renode-i2c-broker') {
    return {
      type: 'bus-transaction-broker',
      manifest: 'runtime-bus-manifest',
      model: componentPackage.runtime.model,
      address: componentPackage.runtime.address,
    };
  }

  return {
    type: 'signal-broker',
    manifest: 'runtime-signal-manifest',
    model: componentPackage.runtime.replPeripheral,
    replPeripheral: componentPackage.runtime.replPeripheral,
  };
}

function getComponentEventParsers(componentPackage: ComponentPackageSdk, sensorSdk: SensorPackageSdk | null): readonly DeviceRuntimeEventParser[] {
  if (sensorSdk) {
    return ['bus-transaction', 'i2c-si70xx-measurement', 'uart-line-buffer'];
  }
  if (componentPackage.kind === 'ssd1306-oled') {
    return ['bus-transaction', 'i2c-ssd1306-framebuffer'];
  }
  return ['gpio-level'];
}

function getComponentPanels(componentPackage: ComponentPackageSdk, sensorSdk: SensorPackageSdk | null): DevicePackage['runtimePanel'] {
  if (sensorSdk) {
    return {
      controls: ['sensor-control', 'sensor-inspector'],
      visualizers: ['bus-transactions', 'uart-terminal', 'runtime-timeline'],
      eventParsers: getComponentEventParsers(componentPackage, sensorSdk),
    };
  }
  if (componentPackage.kind === 'ssd1306-oled') {
    return {
      controls: [],
      visualizers: ['oled-preview', 'bus-transactions', 'runtime-timeline'],
      eventParsers: getComponentEventParsers(componentPackage, null),
    };
  }
  if (componentPackage.capabilities.controllable) {
    return {
      controls: ['gpio-control'],
      visualizers: ['logic-analyzer', 'gpio-monitor', 'runtime-timeline'],
      eventParsers: ['gpio-level'],
    };
  }
  return {
    controls: [],
    visualizers: ['gpio-output-state', 'logic-analyzer', 'gpio-monitor', 'runtime-timeline'],
    eventParsers: ['gpio-level'],
  };
}

function getComponentFirmware(componentPackage: ComponentPackageSdk, sensorSdk: SensorPackageSdk | null): DevicePackage['exampleFirmware'] {
  if (sensorSdk) {
    return {
      mode: 'generated-i2c-demo',
      generatedDriver: sensorSdk.firmware.driver,
      requiredIncludes: ['stdint.h'],
    };
  }
  return {
    mode: componentPackage.runtime.firmware,
    generatedDriver: componentPackage.runtime.firmware === 'generated-i2c-demo' ? 'generated-i2c-demo-driver' : null,
    requiredIncludes: ['stdint.h'],
  };
}

function getComponentValidation(componentPackage: ComponentPackageSdk, sensorSdk: SensorPackageSdk | null): DevicePackage['validationFixture'] {
  if (sensorSdk) {
    return {
      representative: 'i2c-sensor',
      expectedManifest: 'runtime-bus-manifest',
      expectedPanels: ['sensor-control', 'bus-transactions', 'uart-terminal'],
      smokeExampleId: 'nucleo-h753zi-si7021-sensor',
    };
  }
  if (componentPackage.kind === 'ssd1306-oled') {
    return {
      representative: 'i2c-display',
      expectedManifest: 'runtime-bus-manifest',
      expectedPanels: ['oled-preview', 'bus-transactions'],
      smokeExampleId: 'nucleo-h753zi-ssd1306-oled',
    };
  }
  return {
    representative: 'gpio-basic',
    expectedManifest: 'runtime-signal-manifest',
    expectedPanels: componentPackage.capabilities.resultPanels,
    smokeExampleId: componentPackage.kind === 'button' || componentPackage.kind === 'led' ? 'nucleo-h753zi-button-led' : null,
  };
}

function createDevicePackageFromComponent(componentPackage: ComponentPackageSdk): DevicePackage {
  const sensorSdk =
    componentPackage.runtime.type === 'renode-i2c-broker' && isSensorPackageKind(componentPackage.runtime.sensorPackage)
      ? getSensorPackageSdk(componentPackage.runtime.sensorPackage)
      : null;
  const protocolBuses = Array.from(new Set(componentPackage.capabilities.protocols.flatMap((protocol) => normalizeProtocols([protocol]))));
  const pins = [
    ...componentPackage.pins.map((pin): DevicePackagePin => ({
      id: pin.id,
      label: pin.label,
      role: roleForPin(pin.role),
      direction: pin.direction,
      requiredPadCapabilities: pin.requiredPadCapabilities,
      netKind: pin.netKind,
      protocols: normalizeProtocols(pin.protocols),
      terminal: pin.terminal,
    })),
    ...componentPackage.powerPins.map((pin): DevicePackagePin => ({
      id: pin.id,
      label: pin.label,
      role: pin.id === 'vcc' ? 'power-vcc' : 'power-gnd',
      direction: 'bidirectional',
      requiredPadCapabilities: pin.requiredPadCapabilities,
      netKind: pin.netKind,
      protocols: pin.id === 'vcc' ? ['power'] : ['ground'],
      terminal: pin.terminal,
    })),
  ];

  return {
    schemaVersion: DEVICE_PACKAGE_SCHEMA_VERSION,
    kind: componentPackage.kind,
    title: componentPackage.title,
    subtitle: componentPackage.subtitle,
    description: componentPackage.description,
    version: componentPackage.version,
    category: componentPackage.category,
    visual: {
      icon: iconForComponent(componentPackage.kind),
      accentColor: componentPackage.visual.accentColor,
      defaultWidth: componentPackage.visual.defaultWidth,
      defaultHeight: componentPackage.visual.defaultHeight,
      terminalLayout: componentPackage.visual.terminalLayout,
      library: {
        visible: true,
        order: DEVICE_LIBRARY_ORDER[componentPackage.kind],
        group: groupForComponent(componentPackage.kind),
        draggable: true,
        addMode: 'legacy-template',
      },
    },
    pins,
    electricalRules: {
      requiresPower: componentPackage.capabilities.requiresPower,
      requiresGround: componentPackage.capabilities.requiresPower,
      voltageDomains: componentPackage.capabilities.requiresPower ? ['3v3', '5v'] : [],
      compatibleProtocols: protocolBuses,
      busPairing: componentPackage.capabilities.protocols.includes('i2c') ? 'i2c-scl-sda' : 'none',
      outputContention: componentPackage.category === 'input' ? 'not-applicable' : 'forbid',
    },
    protocol: {
      primary: componentPackage.capabilities.protocols[0] ?? 'gpio',
      buses: protocolBuses,
      addressMode: componentPackage.runtime.type === 'renode-i2c-broker' ? 'seven-bit' : undefined,
      defaultAddress: componentPackage.runtime.type === 'renode-i2c-broker' ? componentPackage.runtime.address : undefined,
      transactionModel: sensorSdk
        ? 'mcu-initiated-i2c'
        : componentPackage.kind === 'ssd1306-oled'
          ? 'framebuffer-i2c'
          : 'gpio-level',
    },
    renodeBackend: getComponentBackend(componentPackage, sensorSdk),
    runtimePanel: getComponentPanels(componentPackage, sensorSdk),
    exampleFirmware: getComponentFirmware(componentPackage, sensorSdk),
    validationFixture: getComponentValidation(componentPackage, sensorSdk),
    legacy: {
      componentPackageKind: componentPackage.kind,
      componentPackageSdkSchemaVersion: componentPackage.schemaVersion,
      sensorPackageKind: sensorSdk?.kind,
      sensorPackageSdkSchemaVersion: sensorSdk?.schemaVersion,
    },
  };
}

const UART_TERMINAL_DEVICE_PACKAGE: DevicePackage = {
  schemaVersion: DEVICE_PACKAGE_SCHEMA_VERSION,
  kind: 'uart-terminal',
  title: 'UART Terminal',
  subtitle: 'Virtual serial instrument',
  description:
    'A board-level virtual instrument package that binds the selected board UART to the Electron terminal and unified runtime event stream.',
  version: '1.0.0',
  category: 'instrument',
  visual: {
    icon: 'terminal',
    accentColor: '#a78bfa',
    defaultWidth: 180,
    defaultHeight: 104,
    terminalLayout: 'virtual-instrument',
    library: {
      visible: false,
      order: 300,
      group: 'Virtual Instruments',
      draggable: false,
      addMode: 'board-instrument',
    },
  },
  pins: [
    {
      id: 'tx',
      label: 'TX',
      role: 'uart-tx',
      direction: 'output',
      requiredPadCapabilities: ['uart-tx'],
      netKind: 'uart',
      protocols: ['uart'],
      terminal: {
        side: 'left',
        order: 0,
        handleId: 'uart-terminal:tx',
        connectable: false,
        dragGesture: 'virtual-board-instrument',
      },
    },
    {
      id: 'rx',
      label: 'RX',
      role: 'uart-rx',
      direction: 'input',
      requiredPadCapabilities: ['uart-rx'],
      netKind: 'uart',
      protocols: ['uart'],
      terminal: {
        side: 'right',
        order: 1,
        handleId: 'uart-terminal:rx',
        connectable: false,
        dragGesture: 'virtual-board-instrument',
      },
    },
  ],
  electricalRules: {
    requiresPower: false,
    requiresGround: false,
    voltageDomains: [],
    compatibleProtocols: ['uart'],
    busPairing: 'uart-tx-rx',
    outputContention: 'not-applicable',
  },
  protocol: {
    primary: 'uart',
    buses: ['uart'],
    transactionModel: 'uart-stream',
  },
  renodeBackend: {
    type: 'virtual-uart-terminal',
    manifest: 'board-runtime',
    model: 'socket-terminal',
  },
  runtimePanel: {
    controls: ['uart-terminal'],
    visualizers: ['uart-terminal', 'runtime-timeline'],
    eventParsers: ['uart-line-buffer'],
  },
  exampleFirmware: {
    mode: 'board-uart-terminal',
    generatedDriver: 'generated-board-uart-printf',
    requiredIncludes: ['stdint.h'],
  },
  validationFixture: {
    representative: 'uart-instrument',
    expectedManifest: 'board-runtime',
    expectedPanels: ['uart-terminal', 'runtime-timeline'],
    smokeExampleId: null,
  },
  legacy: {},
};

export const DEVICE_PACKAGE_CATALOG: DevicePackageCatalog = {
  schemaVersion: DEVICE_PACKAGE_SCHEMA_VERSION,
  catalogVersion: DEVICE_PACKAGE_CATALOG_VERSION,
  packages: [...COMPONENT_PACKAGE_SDKS.map((componentPackage) => createDevicePackageFromComponent(componentPackage)), UART_TERMINAL_DEVICE_PACKAGE],
};

export const DEVICE_PACKAGES = DEVICE_PACKAGE_CATALOG.packages;
export const DEVICE_PACKAGE_LIBRARY_ITEMS = DEVICE_PACKAGES.filter(
  (devicePackage) => devicePackage.visual.library.visible && devicePackage.legacy.componentPackageKind
).sort((left, right) => left.visual.library.order - right.visual.library.order);

const DEVICE_PACKAGE_MAP = new Map<DevicePackageKind, DevicePackage>(
  DEVICE_PACKAGES.map((devicePackage) => [devicePackage.kind, devicePackage])
);
const DEVICE_PACKAGE_BY_TEMPLATE = new Map<DemoPeripheralTemplateKind, DevicePackage>(
  DEVICE_PACKAGES.flatMap((devicePackage) =>
    devicePackage.legacy.componentPackageKind ? [[devicePackage.legacy.componentPackageKind, devicePackage] as const] : []
  )
);

export function getDevicePackage(kind: DevicePackageKind): DevicePackage {
  const devicePackage = DEVICE_PACKAGE_MAP.get(kind);
  if (!devicePackage) {
    throw new Error(`Unknown device package kind: ${kind}`);
  }
  return devicePackage;
}

export function getDevicePackageForTemplate(kind: DemoPeripheralTemplateKind): DevicePackage {
  const devicePackage = DEVICE_PACKAGE_BY_TEMPLATE.get(kind);
  if (!devicePackage) {
    return getDevicePackage(getComponentPackageSdk(kind).kind);
  }
  return devicePackage;
}

export function findDevicePackage(kind: unknown): DevicePackage | null {
  return typeof kind === 'string' && DEVICE_PACKAGE_MAP.has(kind as DevicePackageKind)
    ? getDevicePackage(kind as DevicePackageKind)
    : null;
}

export function getSensorDevicePackage(kind: SensorPackageKind): DevicePackage {
  const match = DEVICE_PACKAGES.find((devicePackage) => devicePackage.legacy.sensorPackageKind === kind);
  if (!match) {
    throw new Error(`No device package registered for sensor package: ${kind}`);
  }
  return match;
}
