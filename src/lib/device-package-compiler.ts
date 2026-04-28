/**
 * Device Package Compiler v1.
 *
 * Independent packages under packages/devices own the reusable device metadata.
 * The compiler turns those source descriptors into runtime-ready catalog
 * records and still adapts legacy component packages until every device has
 * moved to its own package directory.
 */
import {
  COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
  ComponentPackageProtocol,
  ComponentPackageSdk,
} from './component-packs';
import type { DemoPeripheralTemplateKind } from './firmware';
import {
  SENSOR_PACKAGE_SDK_SCHEMA_VERSION,
  SensorPackageSdk,
  getSensorPackageSdk,
  isSensorPackageKind,
} from './sensor-packages';
import type {
  DevicePackage,
  DevicePackageCatalog,
  DevicePackagePin,
  DevicePackagePinRole,
  DevicePackageProtocol,
  DevicePackageSource,
  DeviceRuntimeEventParser,
} from './device-package-types';
import {
  DEVICE_PACKAGE_CATALOG_VERSION,
  DEVICE_PACKAGE_COMPILER_VERSION,
  DEVICE_PACKAGE_SCHEMA_VERSION,
} from './device-package-types';

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
  // During migration, legacy component packages still need to become full
  // Device Packages. This function chooses the same backend vocabulary used by
  // independent packages: native Renode model, bus broker, or GPIO signal broker.
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
  // Runtime panels are deliberately metadata, not React imports. App.tsx later
  // uses these names to compose the visible panels without checking for each
  // concrete device kind.
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

export function compileComponentDevicePackage(componentPackage: ComponentPackageSdk): DevicePackage {
  // Compatibility path: old Component Package SDK entries become Device Package
  // records so the rest of the runtime can depend on one unified schema.
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
    compiler: {
      version: DEVICE_PACKAGE_COMPILER_VERSION,
      source: 'component-adapter',
      packagePath: null,
    },
    legacy: {
      componentPackageKind: componentPackage.kind,
      componentPackageSdkSchemaVersion: componentPackage.schemaVersion,
      sensorPackageKind: sensorSdk?.kind,
      sensorPackageSdkSchemaVersion: sensorSdk?.schemaVersion,
    },
  };
}

export function compileDevicePackageSource(source: DevicePackageSource): DevicePackage {
  // Independent packages already own the complete device description. The
  // compiler only stamps schema/compiler metadata and keeps legacy links for the
  // current Netlist/Renode generators.
  return {
    schemaVersion: DEVICE_PACKAGE_SCHEMA_VERSION,
    kind: source.kind,
    title: source.title,
    subtitle: source.subtitle,
    description: source.description,
    version: source.version,
    category: source.category,
    visual: source.visual,
    pins: source.pins,
    electricalRules: source.electricalRules,
    protocol: source.protocol,
    renodeBackend: source.renodeBackend,
    runtimePanel: source.runtimePanel,
    exampleFirmware: source.exampleFirmware,
    validationFixture: source.validationFixture,
    compiler: {
      version: DEVICE_PACKAGE_COMPILER_VERSION,
      source: 'independent-package',
      packagePath: source.source.packagePath,
    },
    legacy: {
      componentPackageKind: source.source.componentPackageKind,
      componentPackageSdkSchemaVersion: source.source.componentPackageKind ? COMPONENT_PACKAGE_SDK_SCHEMA_VERSION : undefined,
      sensorPackageKind: source.source.sensorPackageKind,
      sensorPackageSdkSchemaVersion: source.source.sensorPackageKind ? SENSOR_PACKAGE_SDK_SCHEMA_VERSION : undefined,
    },
  };
}

export function compileDevicePackageCatalog(options: {
  componentPackages: readonly ComponentPackageSdk[];
  sources: readonly DevicePackageSource[];
}): DevicePackageCatalog {
  // Independent packages win over generated adapters. This lets us migrate one
  // device at a time while keeping the visible library stable for users.
  const sourceByComponentKind = new Map(
    options.sources.flatMap((source) => (source.source.componentPackageKind ? [[source.source.componentPackageKind, source] as const] : []))
  );
  const compiledByKind = new Map<DevicePackage['kind'], DevicePackage>();

  options.componentPackages.forEach((componentPackage) => {
    const source = sourceByComponentKind.get(componentPackage.kind);
    const compiled = source ? compileDevicePackageSource(source) : compileComponentDevicePackage(componentPackage);
    compiledByKind.set(compiled.kind, compiled);
  });

  options.sources
    .filter((source) => !source.source.componentPackageKind)
    .forEach((source) => {
      const compiled = compileDevicePackageSource(source);
      compiledByKind.set(compiled.kind, compiled);
    });

  return {
    schemaVersion: DEVICE_PACKAGE_SCHEMA_VERSION,
    catalogVersion: DEVICE_PACKAGE_CATALOG_VERSION,
    compilerVersion: DEVICE_PACKAGE_COMPILER_VERSION,
    packages: Array.from(compiledByKind.values()).sort((left, right) => left.visual.library.order - right.visual.library.order),
  };
}
