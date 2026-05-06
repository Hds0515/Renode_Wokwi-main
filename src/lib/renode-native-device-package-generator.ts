/**
 * Renode Native Device Package Generator v1.
 *
 * Catalog entries are the durable, reviewable facts about Renode native models.
 * This generator turns those facts into DevicePackageSource records so the UI,
 * Netlist compiler, Renode backend compiler, and runtime panels can all consume
 * a native peripheral without hand-writing one package file per device.
 */
import type {
  DevicePackagePin,
  DevicePackageSource,
} from './device-package-types';
import {
  getGeneratedRenodeNativePeripheralCatalogEntries,
  type RenodeNativePeripheralCatalogEntry,
} from './renode-native-peripheral-catalog';

export const RENODE_NATIVE_DEVICE_PACKAGE_GENERATOR_VERSION = 1;

function createI2cPin(
  packageKind: string,
  id: 'scl' | 'sda',
  label: 'SCL' | 'SDA',
  order: number
): DevicePackagePin {
  return {
    id,
    label,
    role: id === 'scl' ? 'i2c-scl' : 'i2c-sda',
    direction: 'bidirectional',
    requiredPadCapabilities: ['gpio', id === 'scl' ? 'i2c-scl' : 'i2c-sda'],
    netKind: 'i2c',
    protocols: ['i2c'],
    terminal: {
      side: 'top',
      order,
      handleId: `${packageKind}:${id}`,
      connectable: true,
      dragGesture: 'terminal-to-board-pad',
    },
  };
}

export function generateDevicePackageSourceFromRenodeNativeEntry(
  entry: RenodeNativePeripheralCatalogEntry
): DevicePackageSource {
  const generated = entry.devicePackage;
  const controlPanels = entry.control.channels.length > 0 ? (['sensor-control', 'sensor-inspector'] as const) : ([] as const);

  return {
    source: {
      packagePath: generated.packagePath,
      componentPackageKind: generated.componentTemplateKind,
    },
    kind: generated.kind,
    title: generated.title,
    subtitle: generated.subtitle,
    description: generated.description,
    version: '1.0.0',
    category: 'sensor',
    visual: {
      icon: generated.icon,
      accentColor: generated.accentColor,
      defaultWidth: 168,
      defaultHeight: 104,
      terminalLayout: 'explicit-endpoints',
      library: {
        visible: true,
        order: generated.libraryOrder,
        group: generated.group,
        draggable: true,
        addMode: 'legacy-template',
      },
    },
    pins: [
      createI2cPin(generated.kind, 'scl', 'SCL', 0),
      createI2cPin(generated.kind, 'sda', 'SDA', 1),
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
      primary: entry.protocol,
      buses: [entry.protocol],
      addressMode: 'seven-bit',
      defaultAddress: entry.defaultAddress,
      transactionModel: 'mcu-initiated-i2c',
    },
    renodeBackend: {
      type: 'renode-native-peripheral',
      manifest: 'runtime-bus-manifest',
      model: entry.id,
      address: entry.defaultAddress,
      nativeRenodeType: entry.renodeType,
      nativeCatalogId: entry.id,
      nativeControlTransport: entry.control.transport,
    },
    runtimePanel: {
      controls: controlPanels,
      visualizers: ['bus-transactions', 'uart-terminal', 'runtime-timeline'],
      eventParsers: generated.eventParsers,
    },
    exampleFirmware: {
      mode: generated.firmwareMode,
      generatedDriver: generated.generatedDriver,
      requiredIncludes: ['stdint.h'],
    },
    validationFixture: {
      representative: 'i2c-sensor',
      expectedManifest: 'runtime-bus-manifest',
      expectedPanels: ['sensor-control', 'bus-transactions', 'uart-terminal'],
      smokeExampleId: generated.validationSmokeExampleId,
    },
  };
}

export const GENERATED_RENODE_NATIVE_DEVICE_PACKAGE_SOURCES = getGeneratedRenodeNativePeripheralCatalogEntries()
  .filter((entry) => !entry.devicePackage.kind.startsWith('si7021') && !entry.devicePackage.kind.startsWith('bmp180'))
  .map((entry) => generateDevicePackageSourceFromRenodeNativeEntry(entry));
