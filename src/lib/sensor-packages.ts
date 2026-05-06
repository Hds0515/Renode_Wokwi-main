/**
 * Sensor package schema.
 *
 * A sensor package maps one visual component to firmware-facing protocol
 * metadata, Renode-native peripheral metadata, and UI/runtime control channels.
 * SI7021/SI70xx is the first concrete package and the pattern for new sensors.
 */
import { getRenodeNativePeripheralCatalogEntry } from './renode-native-peripheral-catalog';
import type { RenodeNativePeripheralCatalogId } from './renode-native-peripheral-catalog';

export const SENSOR_PACKAGE_SCHEMA_VERSION = 1;
export const SENSOR_PACKAGE_CATALOG_VERSION = 1;
export const SENSOR_PACKAGE_SDK_SCHEMA_VERSION = 2;
export const SENSOR_PACKAGE_SDK_CATALOG_VERSION = 1;

export type SensorPackageKind = 'si7021-sensor' | 'bmp180-sensor';
export type SensorBusProtocol = 'i2c';
export type SensorChannelKind = string;
export type SensorChannelUnit = 'celsius' | 'percent-rh' | 'pascal' | 'raw';
export type SensorControlTransport = 'renode-monitor-property';
export type SensorTransactionCodec = 'si70xx-compatible' | 'bmp180-compatible' | (string & {});

export type SensorPackageChannel = {
  id: SensorChannelKind;
  label: string;
  unit: SensorChannelUnit;
  minimum: number;
  maximum: number;
  defaultValue: number;
  step: number;
  renodeProperty: string;
};

export type NativeRenodeSensorBinding = {
  type: 'renode-native-sensor';
  nativeCatalogId: RenodeNativePeripheralCatalogId;
  renodeType: string;
  modelProperty: string | null;
  modelValue: string | null;
  busProtocol: SensorBusProtocol;
  addressMode: 'seven-bit';
  defaultAddress: number;
  propertyPath: {
    root: 'sysbus';
    busPlaceholder: '${busName}';
    peripheralNamePrefix: string;
  };
  control: {
    transport: SensorControlTransport;
    channels: readonly SensorPackageChannel[];
  };
};

export type SensorPackage = {
  schemaVersion: typeof SENSOR_PACKAGE_SCHEMA_VERSION;
  kind: SensorPackageKind;
  title: string;
  subtitle: string;
  description: string;
  native: NativeRenodeSensorBinding;
  firmware: {
    address: number;
    readCommands: Record<SensorChannelKind, number>;
  };
};

export type SensorPackageSdkChannel = SensorPackageChannel & {
  schemaVersion: typeof SENSOR_PACKAGE_SDK_SCHEMA_VERSION;
  ui: {
    control: 'slider';
    visualizers: readonly ['numeric-readout', 'timeline'];
    precision: number;
  };
  dataFlow: {
    configuredBy: 'user';
    appliedThrough: SensorControlTransport;
    readByFirmware: true;
  };
};

export type SensorPackageSdk = {
  schemaVersion: typeof SENSOR_PACKAGE_SDK_SCHEMA_VERSION;
  kind: SensorPackageKind;
  title: string;
  subtitle: string;
  description: string;
  version: '1.0.0';
  compatibility: {
    sensorPackageSchemaVersion: typeof SENSOR_PACKAGE_SCHEMA_VERSION;
    sensorPackageCatalogVersion: typeof SENSOR_PACKAGE_CATALOG_VERSION;
  };
  protocol: {
    bus: SensorBusProtocol;
    addressMode: 'seven-bit';
    defaultAddress: number;
    transactionModel: 'mcu-initiated-reads';
  };
  native: NativeRenodeSensorBinding & {
    sdkControl: {
      transport: SensorControlTransport;
      target: 'renode-monitor-property';
      requiresSimulation: true;
    };
  };
  firmware: SensorPackage['firmware'] & {
    driver: 'generated-i2c-read-driver';
  };
  channels: readonly SensorPackageSdkChannel[];
  runtime: {
    controlPlane: 'native-sensor-control';
    dataPlane: 'bus-transaction-broker';
    manifest: 'runtime-bus-manifest';
  };
  busRuntime: {
    transactionCodec: SensorTransactionCodec;
    readCommands: Record<SensorChannelKind, number>;
    responseByteLength: number;
  };
  ui: {
    packageIcon: 'temperature-humidity' | 'pressure-temperature';
    controlPanel: 'sensor-control';
    resultPanels: readonly ['bus-transactions', 'uart-terminal'];
  };
};

export type SensorPackageSdkCatalog = {
  schemaVersion: typeof SENSOR_PACKAGE_SDK_SCHEMA_VERSION;
  catalogVersion: typeof SENSOR_PACKAGE_SDK_CATALOG_VERSION;
  packages: readonly SensorPackageSdk[];
};

function sanitizeRenodeIdentifier(value: string): string {
  return value.replace(/[^a-z0-9_]+/gi, '_');
}

function createNativeBindingFromCatalog(id: RenodeNativePeripheralCatalogId): NativeRenodeSensorBinding {
  const entry = getRenodeNativePeripheralCatalogEntry(id);
  return {
    type: 'renode-native-sensor',
    nativeCatalogId: entry.id,
    renodeType: entry.renodeType,
    modelProperty: entry.modelProperty,
    modelValue: entry.modelValue,
    busProtocol: entry.protocol,
    addressMode: 'seven-bit',
    defaultAddress: entry.defaultAddress,
    propertyPath: entry.propertyPath,
    control: entry.control,
  };
}

function getSensorTransactionCodec(sensorPackage: SensorPackage): SensorTransactionCodec {
  return sensorPackage.kind === 'bmp180-sensor' ? 'bmp180-compatible' : 'si70xx-compatible';
}

function getSensorResponseByteLength(sensorPackage: SensorPackage): number {
  return sensorPackage.kind === 'bmp180-sensor' ? 3 : 2;
}

export const SENSOR_PACKAGES = [
  {
    schemaVersion: SENSOR_PACKAGE_SCHEMA_VERSION,
    kind: 'si7021-sensor',
    title: 'SI7021 Temperature / Humidity Sensor',
    subtitle: 'Renode native SI70xx over I2C',
    description:
      'A reusable sensor package that maps the visual SI7021 component to Renode Sensors.SI70xx, MCU I2C firmware reads, and runtime monitor property control.',
    native: createNativeBindingFromCatalog('si70xx'),
    firmware: {
      address: 0x40,
      readCommands: {
        temperature: 0xf3,
        humidity: 0xf5,
      },
    },
  },
  {
    schemaVersion: SENSOR_PACKAGE_SCHEMA_VERSION,
    kind: 'bmp180-sensor',
    title: 'BMP180 Pressure / Temperature Sensor',
    subtitle: 'Renode native BMP180 over I2C',
    description:
      'A reusable sensor package that maps the visual BMP180 component to Renode Sensors.BMP180, MCU I2C wiring, and runtime monitor property control.',
    native: createNativeBindingFromCatalog('bmp180'),
    firmware: {
      address: 0x77,
      readCommands: {
        temperature: 0xf4,
        pressure: 0xf4,
      },
    },
  },
] as const satisfies readonly SensorPackage[];

export type SensorPackageCatalog = {
  schemaVersion: typeof SENSOR_PACKAGE_SCHEMA_VERSION;
  catalogVersion: typeof SENSOR_PACKAGE_CATALOG_VERSION;
  packages: readonly SensorPackage[];
};

export const SENSOR_PACKAGE_CATALOG: SensorPackageCatalog = {
  schemaVersion: SENSOR_PACKAGE_SCHEMA_VERSION,
  catalogVersion: SENSOR_PACKAGE_CATALOG_VERSION,
  packages: SENSOR_PACKAGES,
};

function createSensorPackageSdk(sensorPackage: SensorPackage): SensorPackageSdk {
  return {
    schemaVersion: SENSOR_PACKAGE_SDK_SCHEMA_VERSION,
    kind: sensorPackage.kind,
    title: sensorPackage.title,
    subtitle: sensorPackage.subtitle,
    description: sensorPackage.description,
    version: '1.0.0',
    compatibility: {
      sensorPackageSchemaVersion: SENSOR_PACKAGE_SCHEMA_VERSION,
      sensorPackageCatalogVersion: SENSOR_PACKAGE_CATALOG_VERSION,
    },
    protocol: {
      bus: sensorPackage.native.busProtocol,
      addressMode: sensorPackage.native.addressMode,
      defaultAddress: sensorPackage.native.defaultAddress,
      transactionModel: 'mcu-initiated-reads',
    },
    native: {
      ...sensorPackage.native,
      sdkControl: {
        transport: sensorPackage.native.control.transport,
        target: 'renode-monitor-property',
        requiresSimulation: true,
      },
    },
    firmware: {
      ...sensorPackage.firmware,
      driver: 'generated-i2c-read-driver',
    },
    channels: sensorPackage.native.control.channels.map((channel) => ({
      ...channel,
      schemaVersion: SENSOR_PACKAGE_SDK_SCHEMA_VERSION,
      ui: {
        control: 'slider',
        visualizers: ['numeric-readout', 'timeline'],
        precision: channel.step < 1 ? 1 : 0,
      },
      dataFlow: {
        configuredBy: 'user',
        appliedThrough: sensorPackage.native.control.transport,
        readByFirmware: true,
      },
    })),
    runtime: {
      controlPlane: 'native-sensor-control',
      dataPlane: 'bus-transaction-broker',
      manifest: 'runtime-bus-manifest',
    },
    busRuntime: {
      transactionCodec: getSensorTransactionCodec(sensorPackage),
      readCommands: sensorPackage.firmware.readCommands,
      responseByteLength: getSensorResponseByteLength(sensorPackage),
    },
    ui: {
      packageIcon: sensorPackage.kind === 'bmp180-sensor' ? 'pressure-temperature' : 'temperature-humidity',
      controlPanel: 'sensor-control',
      resultPanels: ['bus-transactions', 'uart-terminal'],
    },
  };
}

export const SENSOR_PACKAGE_SDK_CATALOG: SensorPackageSdkCatalog = {
  schemaVersion: SENSOR_PACKAGE_SDK_SCHEMA_VERSION,
  catalogVersion: SENSOR_PACKAGE_SDK_CATALOG_VERSION,
  packages: SENSOR_PACKAGES.map((sensorPackage) => createSensorPackageSdk(sensorPackage)),
};

export const SENSOR_PACKAGE_SDKS = SENSOR_PACKAGE_SDK_CATALOG.packages;

const SENSOR_PACKAGE_MAP = new Map<SensorPackageKind, SensorPackage>(
  SENSOR_PACKAGES.map((sensorPackage) => [sensorPackage.kind, sensorPackage])
);
const SENSOR_PACKAGE_SDK_MAP = new Map<SensorPackageKind, SensorPackageSdk>(
  SENSOR_PACKAGE_SDKS.map((sensorPackage) => [sensorPackage.kind, sensorPackage])
);

export function isSensorPackageKind(value: unknown): value is SensorPackageKind {
  return typeof value === 'string' && SENSOR_PACKAGE_MAP.has(value as SensorPackageKind);
}

export function getSensorPackage(kind: SensorPackageKind): SensorPackage {
  const sensorPackage = SENSOR_PACKAGE_MAP.get(kind);
  if (!sensorPackage) {
    throw new Error(`Unknown sensor package kind: ${kind}`);
  }
  return sensorPackage;
}

export function getSensorPackageSdk(kind: SensorPackageKind): SensorPackageSdk {
  const sensorPackage = SENSOR_PACKAGE_SDK_MAP.get(kind);
  if (!sensorPackage) {
    throw new Error(`Unknown sensor package SDK kind: ${kind}`);
  }
  return sensorPackage;
}

export function findSensorPackage(kind: unknown): SensorPackage | null {
  return isSensorPackageKind(kind) ? getSensorPackage(kind) : null;
}

export function buildRenodeSensorPeripheralName(kind: SensorPackageKind, deviceId: string): string {
  const sensorPackage = getSensorPackage(kind);
  return `${sensorPackage.native.propertyPath.peripheralNamePrefix}__${sanitizeRenodeIdentifier(deviceId)}`;
}

export function buildRenodeSensorPath(kind: SensorPackageKind, busName: string, renodeName: string): string {
  const sensorPackage = getSensorPackage(kind);
  return [sensorPackage.native.propertyPath.root, busName, renodeName].filter(Boolean).join('.');
}
