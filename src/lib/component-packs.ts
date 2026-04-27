import {
  DEMO_PERIPHERAL_TEMPLATES,
  DemoPeripheralBehavior,
  DemoPeripheralPowerBinding,
  DemoEndpointDirection,
  DemoPadCapability,
  DemoPeripheralKind,
  DemoPeripheralTemplateDefinition,
  DemoPeripheralTemplateKind,
} from './firmware';
import { getSensorPackage } from './sensor-packages';
import type { SensorPackageKind } from './sensor-packages';

export const COMPONENT_PACKAGE_SCHEMA_VERSION = 1;
export const COMPONENT_PACKAGE_CATALOG_VERSION = 3;
export const COMPONENT_PACKAGE_SDK_SCHEMA_VERSION = 2;
export const COMPONENT_PACKAGE_SDK_CATALOG_VERSION = 1;

export type ComponentPackagePinRole = 'gpio-signal' | 'i2c-scl' | 'i2c-sda';
export type ComponentPackagePowerPinRole = 'power-vcc' | 'power-gnd';
export type ComponentPackageProtocol = 'gpio' | 'i2c' | 'power';
export type ComponentPackageEndpointNetKind = 'gpio' | 'i2c' | 'power' | 'ground';
export type ComponentPackageEndpointTerminalSide = 'top' | 'right' | 'bottom' | 'left';
export type ComponentPackageResultPanel =
  | 'gpio-control'
  | 'gpio-output-state'
  | 'i2c-framebuffer'
  | 'sensor-control'
  | 'bus-transactions'
  | 'logic-analyzer';

export type ComponentPackagePin = {
  id: string;
  label: string;
  role: ComponentPackagePinRole;
  direction: DemoEndpointDirection;
  requiredPadCapabilities: readonly DemoPadCapability[];
  defaultSignalLabel: string;
  accentColor: string;
  legacyPeripheralKind: DemoPeripheralKind;
};

export type ComponentPackageRuntimeBinding = {
  type: 'renode-gpio';
  replPeripheral: 'Miscellaneous.Button' | 'Miscellaneous.LED';
} | {
  type: 'renode-i2c-broker';
  address: number;
  model: 'ssd1306' | 'si7021';
  sensorPackage?: SensorPackageKind;
};

export type ComponentPackagePowerPin = {
  id: 'vcc' | 'gnd';
  label: 'VCC' | 'GND';
  role: ComponentPackagePowerPinRole;
  required: boolean;
  requiredPadCapabilities: readonly DemoPadCapability[];
};

export type ComponentPackage = {
  schemaVersion: typeof COMPONENT_PACKAGE_SCHEMA_VERSION;
  kind: DemoPeripheralTemplateKind;
  title: string;
  subtitle: string;
  description: string;
  category: DemoPeripheralTemplateDefinition['category'];
  behavior: DemoPeripheralBehavior;
  defaultPower: DemoPeripheralPowerBinding;
  pins: readonly ComponentPackagePin[];
  powerPins: readonly ComponentPackagePowerPin[];
  visual: {
    accentColor: string;
    defaultWidth: number;
    defaultHeight: number;
  };
  runtime: ComponentPackageRuntimeBinding;
};

export type ComponentPackageCatalog = {
  schemaVersion: typeof COMPONENT_PACKAGE_SCHEMA_VERSION;
  catalogVersion: typeof COMPONENT_PACKAGE_CATALOG_VERSION;
  packages: readonly ComponentPackage[];
};

export type ComponentPackageSdkEndpointTerminal = {
  schemaVersion: typeof COMPONENT_PACKAGE_SDK_SCHEMA_VERSION;
  side: ComponentPackageEndpointTerminalSide;
  order: number;
  handleId: string;
  connectable: boolean;
  dragGesture: 'terminal-to-board-pad';
};

export type ComponentPackageSdkPin = ComponentPackagePin & {
  schemaVersion: typeof COMPONENT_PACKAGE_SDK_SCHEMA_VERSION;
  netKind: ComponentPackageEndpointNetKind;
  protocols: readonly ComponentPackageProtocol[];
  terminal: ComponentPackageSdkEndpointTerminal;
  ui: {
    dragLabel: string;
    inspectorLabel: string;
  };
};

export type ComponentPackageSdkPowerPin = ComponentPackagePowerPin & {
  schemaVersion: typeof COMPONENT_PACKAGE_SDK_SCHEMA_VERSION;
  netKind: 'power' | 'ground';
  protocols: readonly ['power'];
  terminal: ComponentPackageSdkEndpointTerminal;
};

export type ComponentPackageSdkRuntimeBinding = ComponentPackageRuntimeBinding & {
  schemaVersion: typeof COMPONENT_PACKAGE_SDK_SCHEMA_VERSION;
  broker: 'signal-broker' | 'bus-transaction-broker';
  manifest: 'runtime-signal-manifest' | 'runtime-bus-manifest';
  firmware: 'generated-gpio-demo' | 'generated-i2c-demo' | 'manual-compatible';
};

export type ComponentPackageSdk = {
  schemaVersion: typeof COMPONENT_PACKAGE_SDK_SCHEMA_VERSION;
  kind: DemoPeripheralTemplateKind;
  title: string;
  subtitle: string;
  description: string;
  version: '1.0.0';
  category: DemoPeripheralTemplateDefinition['category'];
  compatibility: {
    componentPackageSchemaVersion: typeof COMPONENT_PACKAGE_SCHEMA_VERSION;
    componentPackageCatalogVersion: typeof COMPONENT_PACKAGE_CATALOG_VERSION;
  };
  behavior: DemoPeripheralBehavior;
  defaultPower: DemoPeripheralPowerBinding;
  pins: readonly ComponentPackageSdkPin[];
  powerPins: readonly ComponentPackageSdkPowerPin[];
  visual: ComponentPackage['visual'] & {
    terminalLayout: 'explicit-endpoints';
  };
  runtime: ComponentPackageSdkRuntimeBinding;
  capabilities: {
    endpointCount: number;
    multiEndpoint: boolean;
    requiresPower: boolean;
    protocols: readonly ComponentPackageProtocol[];
    observable: boolean;
    controllable: boolean;
    resultPanels: readonly ComponentPackageResultPanel[];
  };
};

export type ComponentPackageSdkCatalog = {
  schemaVersion: typeof COMPONENT_PACKAGE_SDK_SCHEMA_VERSION;
  catalogVersion: typeof COMPONENT_PACKAGE_SDK_CATALOG_VERSION;
  packages: readonly ComponentPackageSdk[];
};

function createRuntimeBinding(template: DemoPeripheralTemplateDefinition): ComponentPackageRuntimeBinding {
  if (template.kind === 'ssd1306-oled') {
    return {
      type: 'renode-i2c-broker',
      address: 0x3c,
      model: 'ssd1306',
    };
  }

  if (template.kind === 'si7021-sensor') {
    const sensorPackage = getSensorPackage('si7021-sensor');
    return {
      type: 'renode-i2c-broker',
      address: sensorPackage.native.defaultAddress,
      model: 'si7021',
      sensorPackage: sensorPackage.kind,
    };
  }

  return {
    type: 'renode-gpio',
    replPeripheral: template.category === 'input' ? 'Miscellaneous.Button' : 'Miscellaneous.LED',
  };
}

function createComponentPackage(template: DemoPeripheralTemplateDefinition): ComponentPackage {
  const powerRequired = template.behavior.powerRequired;
  return {
    schemaVersion: COMPONENT_PACKAGE_SCHEMA_VERSION,
    kind: template.kind,
    title: template.title,
    subtitle: template.subtitle,
    description: template.description,
    category: template.category,
    behavior: {
      schemaVersion: 2,
      role: template.behavior.role,
      controller: template.behavior.defaultController,
      powerRequired,
    },
    defaultPower: {
      schemaVersion: 1,
      vccPadId: null,
      gndPadId: null,
      voltage: null,
    },
    pins: template.endpoints.map((endpoint) => ({
      id: endpoint.id,
      label: endpoint.label,
      role: endpoint.kind === 'i2c' ? (endpoint.id === 'scl' ? 'i2c-scl' : 'i2c-sda') : 'gpio-signal',
      direction: endpoint.direction,
      requiredPadCapabilities: endpoint.requiredCapabilities,
      defaultSignalLabel: endpoint.defaultSignalLabel,
      accentColor: endpoint.accentColor,
      legacyPeripheralKind: endpoint.kind,
    })),
    powerPins: [
      {
        id: 'vcc',
        label: 'VCC',
        role: 'power-vcc',
        required: powerRequired,
        requiredPadCapabilities: ['power-vcc'],
      },
      {
        id: 'gnd',
        label: 'GND',
        role: 'power-gnd',
        required: powerRequired,
        requiredPadCapabilities: ['ground'],
      },
    ],
    visual: {
      accentColor: template.accentColor,
      defaultWidth: template.kind === 'rgb-led' || template.kind === 'ssd1306-oled' || template.kind === 'si7021-sensor' ? 168 : 138,
      defaultHeight: template.kind === 'rgb-led' || template.kind === 'ssd1306-oled' || template.kind === 'si7021-sensor' ? 104 : 86,
    },
    runtime: createRuntimeBinding(template),
  };
}

function getPinProtocols(pin: ComponentPackagePin): readonly ComponentPackageProtocol[] {
  if (pin.role === 'i2c-scl' || pin.role === 'i2c-sda') {
    return ['i2c'];
  }

  return ['gpio'];
}

function getPinNetKind(pin: ComponentPackagePin): ComponentPackageEndpointNetKind {
  return pin.role === 'i2c-scl' || pin.role === 'i2c-sda' ? 'i2c' : 'gpio';
}

function getResultPanels(componentPackage: ComponentPackage): readonly ComponentPackageResultPanel[] {
  if (componentPackage.kind === 'ssd1306-oled') {
    return ['i2c-framebuffer', 'bus-transactions'];
  }

  if (componentPackage.kind === 'si7021-sensor') {
    return ['sensor-control', 'bus-transactions'];
  }

  if (componentPackage.category === 'input') {
    return ['gpio-control', 'logic-analyzer'];
  }

  return ['gpio-output-state', 'logic-analyzer'];
}

function getRuntimeBinding(componentPackage: ComponentPackage): ComponentPackageSdkRuntimeBinding {
  if (componentPackage.runtime.type === 'renode-i2c-broker') {
    return {
      ...componentPackage.runtime,
      schemaVersion: COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
      broker: 'bus-transaction-broker',
      manifest: 'runtime-bus-manifest',
      firmware: 'generated-i2c-demo',
    };
  }

  return {
    ...componentPackage.runtime,
    schemaVersion: COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
    broker: 'signal-broker',
    manifest: 'runtime-signal-manifest',
    firmware: componentPackage.category === 'input' ? 'manual-compatible' : 'generated-gpio-demo',
  };
}

function createTerminal(
  componentKind: DemoPeripheralTemplateKind,
  pinId: string,
  order: number,
  side: ComponentPackageEndpointTerminalSide,
  connectable: boolean
): ComponentPackageSdkEndpointTerminal {
  return {
    schemaVersion: COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
    side,
    order,
    handleId: `${componentKind}:${pinId}`,
    connectable,
    dragGesture: 'terminal-to-board-pad',
  };
}

function createComponentPackageSdk(componentPackage: ComponentPackage): ComponentPackageSdk {
  const protocols = Array.from(
    new Set(componentPackage.pins.flatMap((pin) => getPinProtocols(pin)))
  ) as ComponentPackageProtocol[];
  const resultPanels = getResultPanels(componentPackage);

  return {
    schemaVersion: COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
    kind: componentPackage.kind,
    title: componentPackage.title,
    subtitle: componentPackage.subtitle,
    description: componentPackage.description,
    version: '1.0.0',
    category: componentPackage.category,
    compatibility: {
      componentPackageSchemaVersion: COMPONENT_PACKAGE_SCHEMA_VERSION,
      componentPackageCatalogVersion: COMPONENT_PACKAGE_CATALOG_VERSION,
    },
    behavior: componentPackage.behavior,
    defaultPower: componentPackage.defaultPower,
    pins: componentPackage.pins.map((pin, index) => ({
      ...pin,
      schemaVersion: COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
      netKind: getPinNetKind(pin),
      protocols: getPinProtocols(pin),
      terminal: createTerminal(componentPackage.kind, pin.id, index, 'top', true),
      ui: {
        dragLabel: `${componentPackage.title} ${pin.label}`,
        inspectorLabel: `${pin.label} endpoint`,
      },
    })),
    powerPins: componentPackage.powerPins.map((pin, index) => ({
      ...pin,
      schemaVersion: COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
      netKind: pin.id === 'vcc' ? 'power' : 'ground',
      protocols: ['power'],
      terminal: createTerminal(componentPackage.kind, pin.id, index, 'bottom', pin.required),
    })),
    visual: {
      ...componentPackage.visual,
      terminalLayout: 'explicit-endpoints',
    },
    runtime: getRuntimeBinding(componentPackage),
    capabilities: {
      endpointCount: componentPackage.pins.length,
      multiEndpoint: componentPackage.pins.length > 1,
      requiresPower: componentPackage.behavior.powerRequired,
      protocols,
      observable: resultPanels.some((panel) => panel !== 'gpio-control'),
      controllable: componentPackage.category === 'input' || componentPackage.kind === 'si7021-sensor',
      resultPanels,
    },
  };
}

export const COMPONENT_PACKAGE_CATALOG: ComponentPackageCatalog = {
  schemaVersion: COMPONENT_PACKAGE_SCHEMA_VERSION,
  catalogVersion: COMPONENT_PACKAGE_CATALOG_VERSION,
  packages: DEMO_PERIPHERAL_TEMPLATES.map((template) => createComponentPackage(template)),
};

export const COMPONENT_PACKAGES = COMPONENT_PACKAGE_CATALOG.packages;
export const COMPONENT_PACKAGE_SDK_CATALOG: ComponentPackageSdkCatalog = {
  schemaVersion: COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
  catalogVersion: COMPONENT_PACKAGE_SDK_CATALOG_VERSION,
  packages: COMPONENT_PACKAGES.map((componentPackage) => createComponentPackageSdk(componentPackage)),
};

export const COMPONENT_PACKAGE_SDKS = COMPONENT_PACKAGE_SDK_CATALOG.packages;

const COMPONENT_PACKAGE_MAP = new Map<DemoPeripheralTemplateKind, ComponentPackage>(
  COMPONENT_PACKAGES.map((componentPackage) => [componentPackage.kind, componentPackage])
);
const COMPONENT_PACKAGE_SDK_MAP = new Map<DemoPeripheralTemplateKind, ComponentPackageSdk>(
  COMPONENT_PACKAGE_SDKS.map((componentPackage) => [componentPackage.kind, componentPackage])
);

export function getComponentPackage(kind: DemoPeripheralTemplateKind): ComponentPackage {
  const componentPackage = COMPONENT_PACKAGE_MAP.get(kind);
  if (!componentPackage) {
    throw new Error(`Unknown component package kind: ${kind}`);
  }
  return componentPackage;
}

export function getComponentPackageSdk(kind: DemoPeripheralTemplateKind): ComponentPackageSdk {
  const componentPackage = COMPONENT_PACKAGE_SDK_MAP.get(kind);
  if (!componentPackage) {
    throw new Error(`Unknown component package SDK kind: ${kind}`);
  }
  return componentPackage;
}

export function getComponentPackagePin(
  kind: DemoPeripheralTemplateKind,
  pinId: string
): ComponentPackagePin | null {
  return getComponentPackage(kind).pins.find((pin) => pin.id === pinId) ?? null;
}

export function getComponentPackageSdkPin(
  kind: DemoPeripheralTemplateKind,
  pinId: string
): ComponentPackageSdkPin | null {
  return getComponentPackageSdk(kind).pins.find((pin) => pin.id === pinId) ?? null;
}

export function describeComponentPackagePins(kind: DemoPeripheralTemplateKind): string {
  return getComponentPackage(kind)
    .pins.map((pin) => `${pin.label}: ${pin.requiredPadCapabilities.join('+')}`)
    .join(' / ');
}
