import {
  DEMO_PERIPHERAL_TEMPLATES,
  DemoEndpointDirection,
  DemoPadCapability,
  DemoPeripheralKind,
  DemoPeripheralTemplateDefinition,
  DemoPeripheralTemplateKind,
} from './firmware';

export const COMPONENT_PACKAGE_SCHEMA_VERSION = 1;
export const COMPONENT_PACKAGE_CATALOG_VERSION = 1;

export type ComponentPackagePinRole = 'gpio-signal' | 'i2c-scl' | 'i2c-sda';

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
  model: 'ssd1306';
};

export type ComponentPackage = {
  schemaVersion: typeof COMPONENT_PACKAGE_SCHEMA_VERSION;
  kind: DemoPeripheralTemplateKind;
  title: string;
  subtitle: string;
  description: string;
  category: DemoPeripheralTemplateDefinition['category'];
  pins: readonly ComponentPackagePin[];
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

function createRuntimeBinding(template: DemoPeripheralTemplateDefinition): ComponentPackageRuntimeBinding {
  if (template.kind === 'ssd1306-oled') {
    return {
      type: 'renode-i2c-broker',
      address: 0x3c,
      model: 'ssd1306',
    };
  }

  return {
    type: 'renode-gpio',
    replPeripheral: template.category === 'input' ? 'Miscellaneous.Button' : 'Miscellaneous.LED',
  };
}

function createComponentPackage(template: DemoPeripheralTemplateDefinition): ComponentPackage {
  return {
    schemaVersion: COMPONENT_PACKAGE_SCHEMA_VERSION,
    kind: template.kind,
    title: template.title,
    subtitle: template.subtitle,
    description: template.description,
    category: template.category,
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
    visual: {
      accentColor: template.accentColor,
      defaultWidth: template.kind === 'rgb-led' || template.kind === 'ssd1306-oled' ? 168 : 138,
      defaultHeight: template.kind === 'rgb-led' || template.kind === 'ssd1306-oled' ? 104 : 86,
    },
    runtime: createRuntimeBinding(template),
  };
}

export const COMPONENT_PACKAGE_CATALOG: ComponentPackageCatalog = {
  schemaVersion: COMPONENT_PACKAGE_SCHEMA_VERSION,
  catalogVersion: COMPONENT_PACKAGE_CATALOG_VERSION,
  packages: DEMO_PERIPHERAL_TEMPLATES.map((template) => createComponentPackage(template)),
};

export const COMPONENT_PACKAGES = COMPONENT_PACKAGE_CATALOG.packages;

const COMPONENT_PACKAGE_MAP = new Map<DemoPeripheralTemplateKind, ComponentPackage>(
  COMPONENT_PACKAGES.map((componentPackage) => [componentPackage.kind, componentPackage])
);

export function getComponentPackage(kind: DemoPeripheralTemplateKind): ComponentPackage {
  const componentPackage = COMPONENT_PACKAGE_MAP.get(kind);
  if (!componentPackage) {
    throw new Error(`Unknown component package kind: ${kind}`);
  }
  return componentPackage;
}

export function getComponentPackagePin(
  kind: DemoPeripheralTemplateKind,
  pinId: string
): ComponentPackagePin | null {
  return getComponentPackage(kind).pins.find((pin) => pin.id === pinId) ?? null;
}

export function describeComponentPackagePins(kind: DemoPeripheralTemplateKind): string {
  return getComponentPackage(kind)
    .pins.map((pin) => `${pin.label}: ${pin.requiredPadCapabilities.join('+')}`)
    .join(' / ');
}
