/**
 * Protocol Runtime Registry v1.
 *
 * Device packages describe reusable parts; bus/signal manifests describe what
 * is wired in the current project. This registry joins both views by protocol
 * so GPIO, UART, I2C, and SPI devices can share discovery, codecs, panels, and
 * broker routing instead of each runtime feature scanning manifests on its own.
 */
import type { BoardSchema } from './boards';
import {
  DevicePackage,
  DevicePackageKind,
  DeviceRuntimeEventParser,
  DeviceRuntimePanelKind,
  findDevicePackage,
  getDevicePackage,
} from './device-packages';
import type {
  RuntimeBusDeviceManifestEntry,
  RuntimeBusManifestEntry,
  RuntimeBusManifestStatus,
  RuntimeProtocol,
} from './runtime-timeline';
import type { SensorPackageKind } from './sensor-packages';
import { isSensorPackageKind } from './sensor-packages';
import type { SignalDefinition } from './signal-broker';

export const PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION = 1;

/**
 * Role describes what a runtime device means to the UI, not which Renode class
 * implements it. For example, an I2C display and an I2C sensor both use the I2C
 * protocol runtime but need different panels and codecs.
 */
export type ProtocolRuntimeDeviceRole = 'gpio-endpoint' | 'sensor' | 'display' | 'instrument' | 'bus-device';
export type ProtocolRuntimeSource = 'runtime-signal-manifest' | 'runtime-bus-manifest' | 'board-runtime';
export type ProtocolRuntimeBackend =
  | DevicePackage['renodeBackend']['type']
  | 'socket-terminal'
  | 'transaction-broker-planned'
  | 'signal-broker';

export type ProtocolRuntimeDevice = {
  schemaVersion: typeof PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION;
  id: string;
  protocol: RuntimeProtocol;
  role: ProtocolRuntimeDeviceRole;
  source: ProtocolRuntimeSource;
  label: string;
  componentId: string | null;
  componentKind: string | null;
  devicePackageKind: DevicePackageKind | string | null;
  devicePackageSchemaVersion: number | null;
  backendType: ProtocolRuntimeBackend;
  busId: string | null;
  busLabel: string | null;
  busStatus: RuntimeBusManifestStatus | null;
  renodePeripheralName: string | null;
  address: number | null;
  model: string;
  runtimePanels: readonly DeviceRuntimePanelKind[];
  eventParsers: readonly DeviceRuntimeEventParser[];
  sensorPackage?: SensorPackageKind;
  sensorPackageTitle?: string;
  sensorPackageSdkSchemaVersion?: number;
  nativeControlTransport?: string | null;
  controlChannels?: RuntimeBusDeviceManifestEntry['controlChannels'];
  nativeRenodeName?: string | null;
  nativeRenodePath?: string | null;
  manifestDevice?: RuntimeBusDeviceManifestEntry;
  signal?: SignalDefinition;
};

export type ProtocolRuntimeBus = {
  schemaVersion: typeof PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION;
  id: string;
  protocol: Exclude<RuntimeProtocol, 'gpio'>;
  label: string;
  renodePeripheralName: string | null;
  status: RuntimeBusManifestStatus;
  deviceIds: readonly string[];
  endpointCount: number;
};

export type ProtocolRuntimeEntry = {
  schemaVersion: typeof PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION;
  protocol: RuntimeProtocol;
  label: string;
  buses: readonly ProtocolRuntimeBus[];
  devices: readonly ProtocolRuntimeDevice[];
  runtimePanels: readonly DeviceRuntimePanelKind[];
  eventParsers: readonly DeviceRuntimeEventParser[];
};

export type ProtocolRuntimeRegistrySummary = {
  protocolCount: number;
  busCount: number;
  deviceCount: number;
  gpioSignalCount: number;
  sensorCount: number;
  displayCount: number;
  instrumentCount: number;
};

export type ProtocolRuntimeRegistry = {
  schemaVersion: typeof PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION;
  generatedFor: {
    boardId: string | null;
    boardName: string | null;
  };
  protocols: readonly ProtocolRuntimeEntry[];
  buses: readonly ProtocolRuntimeBus[];
  devices: readonly ProtocolRuntimeDevice[];
  summary: ProtocolRuntimeRegistrySummary;
};

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

/**
 * Prefer Device Package metadata whenever it exists. Fallbacks keep old or
 * planned manifest entries visible while their independent package is still
 * being migrated.
 */
function getRuntimePanels(devicePackage: DevicePackage | null, fallback: readonly DeviceRuntimePanelKind[]): readonly DeviceRuntimePanelKind[] {
  return devicePackage ? [...devicePackage.runtimePanel.controls, ...devicePackage.runtimePanel.visualizers] : fallback;
}

/**
 * The fallback parser list is intentionally protocol-oriented. It lets a new
 * SPI/I2C device appear in the timeline immediately, even before a specialized
 * model-specific decoder has been added.
 */
function getBusDeviceFallbackParsers(
  protocol: RuntimeProtocol,
  device: RuntimeBusDeviceManifestEntry | null
): readonly DeviceRuntimeEventParser[] {
  if (protocol === 'gpio') {
    return ['gpio-level'];
  }
  if (protocol === 'uart') {
    return ['uart-line-buffer'];
  }
  if (device?.model === 'ssd1306') {
    return ['bus-transaction', 'i2c-ssd1306-framebuffer'];
  }
  if (isSensorPackageKind(device?.sensorPackage)) {
    return ['bus-transaction', 'i2c-si70xx-measurement', 'uart-line-buffer'];
  }
  return ['bus-transaction'];
}

function getBusDeviceFallbackPanels(
  protocol: RuntimeProtocol,
  role: ProtocolRuntimeDeviceRole,
  device: RuntimeBusDeviceManifestEntry | null
): readonly DeviceRuntimePanelKind[] {
  if (protocol === 'gpio') {
    return ['gpio-monitor', 'logic-analyzer', 'runtime-timeline'];
  }
  if (protocol === 'uart') {
    return ['uart-terminal', 'runtime-timeline'];
  }
  if (role === 'display' || device?.model === 'ssd1306') {
    return ['oled-preview', 'bus-transactions', 'runtime-timeline'];
  }
  if (role === 'sensor') {
    return ['sensor-control', 'sensor-inspector', 'bus-transactions', 'uart-terminal', 'runtime-timeline'];
  }
  return ['bus-transactions', 'runtime-timeline'];
}

function classifyBusDevice(device: RuntimeBusDeviceManifestEntry): ProtocolRuntimeDeviceRole {
  if (isSensorPackageKind(device.sensorPackage)) {
    return 'sensor';
  }
  if (device.model === 'ssd1306') {
    return 'display';
  }
  return 'bus-device';
}

/**
 * Converts one concrete bus manifest device into the registry's protocol-level
 * shape. This is where Renode/backend details, Device Package panels, and codec
 * hints are joined into one object consumed by the UI/runtime panels.
 */
function createBusDevice(entry: RuntimeBusManifestEntry, device: RuntimeBusDeviceManifestEntry): ProtocolRuntimeDevice {
  const devicePackage = findDevicePackage(device.devicePackageKind);
  const role = classifyBusDevice(device);

  return {
    schemaVersion: PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION,
    id: device.id,
    protocol: entry.protocol,
    role,
    source: 'runtime-bus-manifest',
    label: device.label,
    componentId: device.componentId,
    componentKind: device.componentKind,
    devicePackageKind: devicePackage?.kind ?? device.devicePackageKind ?? null,
    devicePackageSchemaVersion: device.devicePackageSchemaVersion ?? null,
    backendType: devicePackage?.renodeBackend.type ?? (device.nativeControlTransport ? 'renode-native-sensor' : entry.adapter),
    busId: entry.id,
    busLabel: entry.label,
    busStatus: entry.status,
    renodePeripheralName: entry.renodePeripheralName,
    address: device.address,
    model: device.model,
    runtimePanels: getRuntimePanels(devicePackage, getBusDeviceFallbackPanels(entry.protocol, role, device)),
    eventParsers: devicePackage?.runtimePanel.eventParsers ?? getBusDeviceFallbackParsers(entry.protocol, device),
    ...(isSensorPackageKind(device.sensorPackage) ? { sensorPackage: device.sensorPackage } : {}),
    sensorPackageTitle: device.sensorPackageTitle,
    sensorPackageSdkSchemaVersion: device.sensorPackageSdkSchemaVersion,
    nativeControlTransport: device.nativeControlTransport,
    controlChannels: device.controlChannels,
    nativeRenodeName: device.nativeRenodeName,
    nativeRenodePath: device.nativeRenodePath,
    manifestDevice: device,
  };
}

/**
 * The board UART is not dragged in by the user, but it behaves like a virtual
 * instrument. Treating it as a registry device keeps UART panels schema-driven.
 */
function createUartInstrumentDevice(entry: RuntimeBusManifestEntry): ProtocolRuntimeDevice | null {
  if (entry.protocol !== 'uart') {
    return null;
  }

  const devicePackage = getDevicePackage('uart-terminal');
  return {
    schemaVersion: PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION,
    id: `${entry.id}:uart-terminal`,
    protocol: 'uart',
    role: 'instrument',
    source: 'board-runtime',
    label: devicePackage.title,
    componentId: null,
    componentKind: null,
    devicePackageKind: devicePackage.kind,
    devicePackageSchemaVersion: devicePackage.schemaVersion,
    backendType: devicePackage.renodeBackend.type,
    busId: entry.id,
    busLabel: entry.label,
    busStatus: entry.status,
    renodePeripheralName: entry.renodePeripheralName,
    address: null,
    model: devicePackage.renodeBackend.model,
    runtimePanels: getRuntimePanels(devicePackage, ['uart-terminal', 'runtime-timeline']),
    eventParsers: devicePackage.runtimePanel.eventParsers,
  };
}

/**
 * GPIO devices come from signal definitions rather than the bus manifest. They
 * still join the same protocol registry so monitors and logic analyzers can be
 * selected through the same runtime-panel mechanism as I2C/SPI/UART devices.
 */
function createGpioSignalDevice(signal: SignalDefinition): ProtocolRuntimeDevice {
  return {
    schemaVersion: PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION,
    id: signal.id,
    protocol: 'gpio',
    role: 'gpio-endpoint',
    source: 'runtime-signal-manifest',
    label: signal.label,
    componentId: signal.componentId,
    componentKind: null,
    devicePackageKind: null,
    devicePackageSchemaVersion: null,
    backendType: 'signal-broker',
    busId: signal.netId,
    busLabel: signal.netId,
    busStatus: 'active',
    renodePeripheralName: null,
    address: null,
    model: signal.direction,
    runtimePanels: ['gpio-monitor', 'logic-analyzer', 'runtime-timeline'],
    eventParsers: ['gpio-level'],
    signal,
  };
}

function createProtocolBuses(busManifest: readonly RuntimeBusManifestEntry[], devices: readonly ProtocolRuntimeDevice[]): ProtocolRuntimeBus[] {
  return busManifest.map((entry) => ({
    schemaVersion: PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION,
    id: entry.id,
    protocol: entry.protocol,
    label: entry.label,
    renodePeripheralName: entry.renodePeripheralName,
    status: entry.status,
    deviceIds: devices.filter((device) => device.busId === entry.id).map((device) => device.id),
    endpointCount: entry.endpoints.length,
  }));
}

function createProtocolEntries(
  buses: readonly ProtocolRuntimeBus[],
  devices: readonly ProtocolRuntimeDevice[]
): ProtocolRuntimeEntry[] {
  const protocolLabels: Record<RuntimeProtocol, string> = {
    gpio: 'GPIO Signals',
    uart: 'UART Instruments',
    i2c: 'I2C Devices',
    spi: 'SPI Devices',
  };

  return (['gpio', 'uart', 'i2c', 'spi'] as const).map((protocol) => {
    const protocolDevices = devices.filter((device) => device.protocol === protocol);
    const protocolBuses = protocol === 'gpio' ? [] : buses.filter((bus) => bus.protocol === protocol);
    return {
      schemaVersion: PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION,
      protocol,
      label: protocolLabels[protocol],
      buses: protocolBuses,
      devices: protocolDevices,
      runtimePanels: unique(protocolDevices.flatMap((device) => device.runtimePanels)),
      eventParsers: unique(protocolDevices.flatMap((device) => device.eventParsers)),
    };
  });
}

function summarizeProtocolRuntimeRegistry(
  buses: readonly ProtocolRuntimeBus[],
  devices: readonly ProtocolRuntimeDevice[]
): ProtocolRuntimeRegistrySummary {
  return {
    protocolCount: new Set(devices.map((device) => device.protocol)).size,
    busCount: buses.length,
    deviceCount: devices.length,
    gpioSignalCount: devices.filter((device) => device.role === 'gpio-endpoint').length,
    sensorCount: devices.filter((device) => device.role === 'sensor').length,
    displayCount: devices.filter((device) => device.role === 'display').length,
    instrumentCount: devices.filter((device) => device.role === 'instrument').length,
  };
}

/**
 * Public entry point used by App.tsx. Inputs are intentionally simple:
 * busManifest for UART/I2C/SPI and signalDefinitions for GPIO. The return value
 * is a protocol-indexed runtime view that later code can query by protocol,
 * model, role, or sensor capability.
 */
export function createProtocolRuntimeRegistry(options: {
  board?: BoardSchema | null;
  busManifest: readonly RuntimeBusManifestEntry[];
  signalDefinitions?: readonly SignalDefinition[];
}): ProtocolRuntimeRegistry {
  const busDevices = options.busManifest.flatMap((entry) => [
    ...(entry.devices ?? []).map((device) => createBusDevice(entry, device)),
    ...[createUartInstrumentDevice(entry)].filter((device): device is ProtocolRuntimeDevice => Boolean(device)),
  ]);
  const gpioDevices = (options.signalDefinitions ?? []).map((signal) => createGpioSignalDevice(signal));
  const devices = [...gpioDevices, ...busDevices];
  const buses = createProtocolBuses(options.busManifest, devices);

  return {
    schemaVersion: PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION,
    generatedFor: {
      boardId: options.board?.id ?? null,
      boardName: options.board?.name ?? null,
    },
    protocols: createProtocolEntries(buses, devices),
    buses,
    devices,
    summary: summarizeProtocolRuntimeRegistry(buses, devices),
  };
}

export function getProtocolRuntimeDevicesByModel(
  registry: ProtocolRuntimeRegistry,
  model: string,
  protocol?: RuntimeProtocol
): ProtocolRuntimeDevice[] {
  return registry.devices.filter((device) => device.model === model && (!protocol || device.protocol === protocol));
}

export function getProtocolRuntimeSensorDevices(registry: ProtocolRuntimeRegistry): ProtocolRuntimeDevice[] {
  return registry.devices.filter((device) => device.role === 'sensor' && isSensorPackageKind(device.sensorPackage));
}

export function getProtocolRuntimeDevicesByProtocol(
  registry: ProtocolRuntimeRegistry,
  protocol: RuntimeProtocol
): ProtocolRuntimeDevice[] {
  return registry.devices.filter((device) => device.protocol === protocol);
}
