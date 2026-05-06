/**
 * Renode Native Peripheral Catalog v1.
 *
 * Device Packages should not hard-code scattered `.repl` snippets for every
 * built-in Renode model. This catalog is the small source of truth that maps a
 * reusable visual device to the real Renode C# peripheral type, protocol,
 * address, monitor-control properties, and source references used for review.
 */
export const RENODE_NATIVE_PERIPHERAL_CATALOG_SCHEMA_VERSION = 1;

export type RenodeNativePeripheralCatalogId = 'si70xx' | 'bmp180';
export type RenodeNativePeripheralCategory = 'sensor';
export type RenodeNativePeripheralProtocol = 'i2c';
export type RenodeNativePeripheralAttachKind = 'i2c-addressed-peripheral';
export type RenodeNativePeripheralControlTransport = 'renode-monitor-property';

export type RenodeNativePeripheralControlChannel = {
  id: string;
  label: string;
  unit: 'celsius' | 'percent-rh' | 'pascal' | 'raw';
  minimum: number;
  maximum: number;
  defaultValue: number;
  step: number;
  renodeProperty: string;
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
  ],
};

const RENODE_NATIVE_PERIPHERAL_ENTRY_MAP = new Map<RenodeNativePeripheralCatalogId, RenodeNativePeripheralCatalogEntry>(
  RENODE_NATIVE_PERIPHERAL_CATALOG.entries.map((entry) => [entry.id, entry])
);

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
