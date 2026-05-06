/**
 * Renode Native Peripheral Catalog v2.
 *
 * This catalog is the source of truth for Renode-built-in models that the
 * visual workbench can expose as reusable devices. v2 adds enough metadata to
 * generate Device Package sources automatically: visual identity, endpoint
 * protocol, runtime panels, validation fixtures, and Renode monitor controls.
 */
export const RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION = 2;

export type RenodeNativePeripheralCatalogId = 'si70xx' | 'bmp180' | 'bme280' | 'hs3001' | 'sht45';
export type RenodeNativePeripheralCategory = 'sensor';
export type RenodeNativePeripheralProtocol = 'i2c';
export type RenodeNativePeripheralAttachKind = 'i2c-addressed-peripheral';
export type RenodeNativePeripheralControlTransport = 'renode-monitor-property';
export type RenodeNativePeripheralControlUnit = 'celsius' | 'percent-rh' | 'pascal' | 'raw' | 'hex';
export type RenodeNativePeripheralGeneratedPackageKind =
  | 'si7021-sensor'
  | 'bmp180-sensor'
  | 'bme280-sensor'
  | 'hs3001-sensor'
  | 'sht45-sensor';

export type RenodeNativePeripheralControlChannel = {
  id: string;
  label: string;
  unit: RenodeNativePeripheralControlUnit;
  minimum: number;
  maximum: number;
  defaultValue: number;
  step: number;
  renodeProperty: string;
};

export type RenodeNativePeripheralGeneratedPackage = {
  enabled: boolean;
  kind: RenodeNativePeripheralGeneratedPackageKind;
  componentTemplateKind: RenodeNativePeripheralGeneratedPackageKind;
  packagePath: string;
  title: string;
  subtitle: string;
  description: string;
  accentColor: string;
  libraryOrder: number;
  icon: 'sensor';
  group: 'Sensors';
  firmwareMode: 'generated-i2c-demo' | 'manual-compatible';
  generatedDriver: 'generated-i2c-read-driver' | null;
  validationSmokeExampleId: string | null;
  eventParsers: readonly ('bus-transaction' | 'i2c-si70xx-measurement' | 'i2c-bmp180-measurement' | 'uart-line-buffer')[];
};

export type RenodeNativePeripheralValidationFixture = {
  sourceFixture: string;
  expectedReplSnippet: string;
  sampleBoardId: 'nucleo-h753zi';
  samplePads: {
    scl: string;
    sda: string;
  };
  expectedRuntimeRole: 'sensor';
};

export type RenodeNativePeripheralCatalogEntry = {
  schemaVersion: typeof RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION;
  id: RenodeNativePeripheralCatalogId;
  title: string;
  category: RenodeNativePeripheralCategory;
  renodeType: string;
  protocol: RenodeNativePeripheralProtocol;
  defaultAddress: number;
  attach: {
    kind: RenodeNativePeripheralAttachKind;
    busPlaceholder: '${busName}';
  };
  modelProperty: string | null;
  modelValue: string | null;
  propertyPath: {
    root: 'sysbus';
    busPlaceholder: '${busName}';
    peripheralNamePrefix: string;
  };
  control: {
    transport: RenodeNativePeripheralControlTransport;
    channels: readonly RenodeNativePeripheralControlChannel[];
  };
  devicePackage: RenodeNativePeripheralGeneratedPackage;
  validation: RenodeNativePeripheralValidationFixture;
  sourceReferences: readonly {
    label: string;
    path: string;
  }[];
  verifiedBy: readonly string[];
};

export type RenodeNativePeripheralCatalog = {
  schemaVersion: typeof RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION;
  entries: readonly RenodeNativePeripheralCatalogEntry[];
};

function sensorPackage(options: Omit<RenodeNativePeripheralGeneratedPackage, 'enabled' | 'icon' | 'group' | 'packagePath'>): RenodeNativePeripheralGeneratedPackage {
  return {
    enabled: true,
    icon: 'sensor',
    group: 'Sensors',
    packagePath: `packages/devices/generated-native/${options.kind}`,
    ...options,
  };
}

export const RENODE_NATIVE_PERIPHERAL_CATALOG: RenodeNativePeripheralCatalog = {
  schemaVersion: RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION,
  entries: [
    {
      schemaVersion: RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION,
      id: 'si70xx',
      title: 'SI70xx / SI7021',
      category: 'sensor',
      renodeType: 'Sensors.SI70xx',
      protocol: 'i2c',
      defaultAddress: 0x40,
      attach: {
        kind: 'i2c-addressed-peripheral',
        busPlaceholder: '${busName}',
      },
      modelProperty: 'model',
      modelValue: 'Model.SI7021',
      propertyPath: {
        root: 'sysbus',
        busPlaceholder: '${busName}',
        peripheralNamePrefix: 'si7021Sensor',
      },
      control: {
        transport: 'renode-monitor-property',
        channels: [
          {
            id: 'temperature',
            label: 'Temperature',
            unit: 'celsius',
            minimum: -40,
            maximum: 85,
            defaultValue: 24,
            step: 0.5,
            renodeProperty: 'Temperature',
          },
          {
            id: 'humidity',
            label: 'Humidity',
            unit: 'percent-rh',
            minimum: 0,
            maximum: 100,
            defaultValue: 45,
            step: 0.5,
            renodeProperty: 'Humidity',
          },
        ],
      },
      devicePackage: sensorPackage({
        kind: 'si7021-sensor',
        componentTemplateKind: 'si7021-sensor',
        title: 'SI7021 Sensor',
        subtitle: 'I2C temperature/humidity',
        description: 'A Renode SI70xx-compatible I2C sensor endpoint with adjustable temperature and humidity readings.',
        accentColor: '#34d399',
        libraryOrder: 200,
        firmwareMode: 'generated-i2c-demo',
        generatedDriver: 'generated-i2c-read-driver',
        validationSmokeExampleId: 'nucleo-h753zi-si7021-sensor',
        eventParsers: ['bus-transaction', 'i2c-si70xx-measurement', 'uart-line-buffer'],
      }),
      validation: {
        sourceFixture: 'existing SI7021 smoke/project fixture',
        expectedReplSnippet: 'Sensors.SI70xx',
        sampleBoardId: 'nucleo-h753zi',
        samplePads: { scl: 'CN9-6', sda: 'CN9-5' },
        expectedRuntimeRole: 'sensor',
      },
      sourceReferences: [
        {
          label: 'Renode sensors source tree',
          path: 'renode-infrastructure/src/Emulator/Peripherals/Peripherals/Sensors',
        },
      ],
      verifiedBy: ['Existing SI7021 smoke test and generated board.repl emission.'],
    },
    {
      schemaVersion: RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION,
      id: 'bmp180',
      title: 'BMP180 Pressure / Temperature Sensor',
      category: 'sensor',
      renodeType: 'Sensors.BMP180',
      protocol: 'i2c',
      defaultAddress: 0x77,
      attach: {
        kind: 'i2c-addressed-peripheral',
        busPlaceholder: '${busName}',
      },
      modelProperty: null,
      modelValue: null,
      propertyPath: {
        root: 'sysbus',
        busPlaceholder: '${busName}',
        peripheralNamePrefix: 'bmp180Sensor',
      },
      control: {
        transport: 'renode-monitor-property',
        channels: [
          {
            id: 'temperature',
            label: 'Temperature',
            unit: 'celsius',
            minimum: -40,
            maximum: 85,
            defaultValue: 24,
            step: 0.5,
            renodeProperty: 'Temperature',
          },
          {
            id: 'pressure',
            label: 'Uncompensated Pressure',
            unit: 'raw',
            minimum: 300,
            maximum: 1100,
            defaultValue: 700,
            step: 1,
            renodeProperty: 'UncompensatedPressure',
          },
        ],
      },
      devicePackage: sensorPackage({
        kind: 'bmp180-sensor',
        componentTemplateKind: 'bmp180-sensor',
        title: 'BMP180 Sensor',
        subtitle: 'I2C pressure/temperature',
        description: 'A Renode BMP180-compatible I2C pressure and temperature sensor with adjustable native monitor properties.',
        accentColor: '#f97316',
        libraryOrder: 210,
        firmwareMode: 'manual-compatible',
        generatedDriver: null,
        validationSmokeExampleId: null,
        eventParsers: ['bus-transaction', 'i2c-bmp180-measurement', 'uart-line-buffer'],
      }),
      validation: {
        sourceFixture: 'renode-master/tests/peripherals/BMP180.robot',
        expectedReplSnippet: 'Sensors.BMP180',
        sampleBoardId: 'nucleo-h753zi',
        samplePads: { scl: 'CN9-6', sda: 'CN9-5' },
        expectedRuntimeRole: 'sensor',
      },
      sourceReferences: [
        {
          label: 'Renode BMP180 Robot test',
          path: 'renode-master/tests/peripherals/BMP180.robot',
        },
        {
          label: 'Renode BMP180 C# peripheral',
          path: 'renode-infrastructure/src/Emulator/Peripherals/Peripherals/Sensors/BMP180.cs',
        },
      ],
      verifiedBy: [
        'renode-master/tests/peripherals/BMP180.robot attaches `bmp180: Sensors.BMP180 @ twi0 0x77`.',
        'The same Robot fixture controls `Temperature` and `UncompensatedPressure` monitor properties.',
      ],
    },
    {
      schemaVersion: RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION,
      id: 'bme280',
      title: 'BME280 Environmental Sensor',
      category: 'sensor',
      renodeType: 'I2C.BME280',
      protocol: 'i2c',
      defaultAddress: 0x76,
      attach: {
        kind: 'i2c-addressed-peripheral',
        busPlaceholder: '${busName}',
      },
      modelProperty: null,
      modelValue: null,
      propertyPath: {
        root: 'sysbus',
        busPlaceholder: '${busName}',
        peripheralNamePrefix: 'bme280Sensor',
      },
      control: {
        transport: 'renode-monitor-property',
        channels: [
          {
            id: 'temperature',
            label: 'Temperature',
            unit: 'celsius',
            minimum: -40,
            maximum: 85,
            defaultValue: 25,
            step: 0.5,
            renodeProperty: 'Temperature',
          },
          {
            id: 'humidity',
            label: 'Humidity',
            unit: 'percent-rh',
            minimum: 0,
            maximum: 100,
            defaultValue: 60,
            step: 0.5,
            renodeProperty: 'Humidity',
          },
          {
            id: 'pressure',
            label: 'Pressure',
            unit: 'pascal',
            minimum: 300,
            maximum: 1100,
            defaultValue: 1000,
            step: 1,
            renodeProperty: 'Pressure',
          },
        ],
      },
      devicePackage: sensorPackage({
        kind: 'bme280-sensor',
        componentTemplateKind: 'bme280-sensor',
        title: 'BME280 Sensor',
        subtitle: 'I2C temperature/humidity/pressure',
        description: 'A catalog-generated Renode native BME280 environmental sensor package.',
        accentColor: '#a855f7',
        libraryOrder: 220,
        firmwareMode: 'manual-compatible',
        generatedDriver: null,
        validationSmokeExampleId: null,
        eventParsers: ['bus-transaction', 'uart-line-buffer'],
      }),
      validation: {
        sourceFixture: 'renode-master/tests/peripherals/BME280.robot',
        expectedReplSnippet: 'I2C.BME280',
        sampleBoardId: 'nucleo-h753zi',
        samplePads: { scl: 'CN9-6', sda: 'CN9-5' },
        expectedRuntimeRole: 'sensor',
      },
      sourceReferences: [
        {
          label: 'Renode BME280 Robot test',
          path: 'renode-master/tests/peripherals/BME280.robot',
        },
      ],
      verifiedBy: [
        'renode-master/tests/peripherals/BME280.robot attaches `bme280: I2C.BME280 @ i2c1 0x76`.',
        'The Robot fixture controls `Temperature`, `Humidity`, and `Pressure` monitor properties.',
      ],
    },
    {
      schemaVersion: RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION,
      id: 'hs3001',
      title: 'HS3001 Temperature / Humidity Sensor',
      category: 'sensor',
      renodeType: 'Sensors.HS3001',
      protocol: 'i2c',
      defaultAddress: 0x44,
      attach: {
        kind: 'i2c-addressed-peripheral',
        busPlaceholder: '${busName}',
      },
      modelProperty: null,
      modelValue: null,
      propertyPath: {
        root: 'sysbus',
        busPlaceholder: '${busName}',
        peripheralNamePrefix: 'hs3001Sensor',
      },
      control: {
        transport: 'renode-monitor-property',
        channels: [
          {
            id: 'temperature',
            label: 'Temperature',
            unit: 'celsius',
            minimum: -40,
            maximum: 100,
            defaultValue: 25,
            step: 0.5,
            renodeProperty: 'Temperature',
          },
          {
            id: 'humidity',
            label: 'Humidity',
            unit: 'percent-rh',
            minimum: 0,
            maximum: 100,
            defaultValue: 50,
            step: 0.5,
            renodeProperty: 'Humidity',
          },
        ],
      },
      devicePackage: sensorPackage({
        kind: 'hs3001-sensor',
        componentTemplateKind: 'hs3001-sensor',
        title: 'HS3001 Sensor',
        subtitle: 'I2C temperature/humidity',
        description: 'A catalog-generated Renode native HS3001 temperature and humidity sensor package.',
        accentColor: '#22c55e',
        libraryOrder: 230,
        firmwareMode: 'manual-compatible',
        generatedDriver: null,
        validationSmokeExampleId: null,
        eventParsers: ['bus-transaction', 'uart-line-buffer'],
      }),
      validation: {
        sourceFixture: 'renode-master/tests/peripherals/HS3001.robot',
        expectedReplSnippet: 'Sensors.HS3001',
        sampleBoardId: 'nucleo-h753zi',
        samplePads: { scl: 'CN9-6', sda: 'CN9-5' },
        expectedRuntimeRole: 'sensor',
      },
      sourceReferences: [
        {
          label: 'Renode HS3001 Robot test',
          path: 'renode-master/tests/peripherals/HS3001.robot',
        },
      ],
      verifiedBy: [
        'renode-master/tests/peripherals/HS3001.robot attaches `hs3001: Sensors.HS3001 @ i2c1 0x44`.',
        'The Robot fixture controls `Temperature` and `Humidity` monitor properties.',
      ],
    },
    {
      schemaVersion: RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION,
      id: 'sht45',
      title: 'SHT45 Temperature / Humidity Sensor',
      category: 'sensor',
      renodeType: 'I2C.SHT45',
      protocol: 'i2c',
      defaultAddress: 0x44,
      attach: {
        kind: 'i2c-addressed-peripheral',
        busPlaceholder: '${busName}',
      },
      modelProperty: null,
      modelValue: null,
      propertyPath: {
        root: 'sysbus',
        busPlaceholder: '${busName}',
        peripheralNamePrefix: 'sht45Sensor',
      },
      control: {
        transport: 'renode-monitor-property',
        channels: [
          {
            id: 'temperature',
            label: 'Temperature',
            unit: 'celsius',
            minimum: -40,
            maximum: 125,
            defaultValue: 25,
            step: 0.5,
            renodeProperty: 'Temperature',
          },
          {
            id: 'humidity',
            label: 'Humidity',
            unit: 'percent-rh',
            minimum: 0,
            maximum: 100,
            defaultValue: 60,
            step: 0.5,
            renodeProperty: 'Humidity',
          },
          {
            id: 'serialNumber',
            label: 'Serial Number',
            unit: 'hex',
            minimum: 0,
            maximum: 0xffffffff,
            defaultValue: 0xf0e0d0c0,
            step: 1,
            renodeProperty: 'SerialNumber',
          },
        ],
      },
      devicePackage: sensorPackage({
        kind: 'sht45-sensor',
        componentTemplateKind: 'sht45-sensor',
        title: 'SHT45 Sensor',
        subtitle: 'I2C temperature/humidity',
        description: 'A catalog-generated Renode native SHT45 temperature and humidity sensor package.',
        accentColor: '#14b8a6',
        libraryOrder: 240,
        firmwareMode: 'manual-compatible',
        generatedDriver: null,
        validationSmokeExampleId: null,
        eventParsers: ['bus-transaction', 'uart-line-buffer'],
      }),
      validation: {
        sourceFixture: 'renode-master/tests/peripherals/SHT45.robot',
        expectedReplSnippet: 'I2C.SHT45',
        sampleBoardId: 'nucleo-h753zi',
        samplePads: { scl: 'CN9-6', sda: 'CN9-5' },
        expectedRuntimeRole: 'sensor',
      },
      sourceReferences: [
        {
          label: 'Renode SHT45 Robot test',
          path: 'renode-master/tests/peripherals/SHT45.robot',
        },
      ],
      verifiedBy: [
        'renode-master/tests/peripherals/SHT45.robot attaches `sht45: I2C.SHT45 @ i2c1 0x44`.',
        'The Robot fixture controls `Temperature`, `Humidity`, and `SerialNumber` monitor properties.',
      ],
    },
  ],
};

const RENODE_NATIVE_PERIPHERAL_ENTRY_MAP = new Map<RenodeNativePeripheralCatalogId, RenodeNativePeripheralCatalogEntry>(
  RENODE_NATIVE_PERIPHERAL_CATALOG.entries.map((entry) => [entry.id, entry])
);

function sanitizeRenodeIdentifier(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

export function isRenodeNativePeripheralCatalogId(value: unknown): value is RenodeNativePeripheralCatalogId {
  return typeof value === 'string' && RENODE_NATIVE_PERIPHERAL_ENTRY_MAP.has(value as RenodeNativePeripheralCatalogId);
}

export function getRenodeNativePeripheralCatalogEntry(
  id: RenodeNativePeripheralCatalogId
): RenodeNativePeripheralCatalogEntry {
  const entry = RENODE_NATIVE_PERIPHERAL_ENTRY_MAP.get(id);
  if (!entry) {
    throw new Error(`Unknown Renode native peripheral catalog entry: ${id}`);
  }
  return entry;
}

export function findRenodeNativePeripheralCatalogEntry(value: unknown): RenodeNativePeripheralCatalogEntry | null {
  return isRenodeNativePeripheralCatalogId(value) ? getRenodeNativePeripheralCatalogEntry(value) : null;
}

export function buildRenodeNativePeripheralName(entry: RenodeNativePeripheralCatalogEntry, componentId: string): string {
  return `${entry.propertyPath.peripheralNamePrefix}__${sanitizeRenodeIdentifier(componentId)}`;
}

export function buildRenodeNativePeripheralPath(entry: RenodeNativePeripheralCatalogEntry, busName: string, renodeName: string): string {
  return [entry.propertyPath.root, busName, renodeName].filter(Boolean).join('.');
}

export function getGeneratedRenodeNativePeripheralCatalogEntries(): readonly RenodeNativePeripheralCatalogEntry[] {
  return RENODE_NATIVE_PERIPHERAL_CATALOG.entries.filter((entry) => entry.devicePackage.enabled);
}
