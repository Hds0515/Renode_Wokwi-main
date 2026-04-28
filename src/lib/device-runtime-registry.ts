/**
 * Device Runtime Registry.
 *
 * Device packages describe capabilities; this registry turns those capabilities
 * into runtime-facing descriptors that manifests, panels, and event decoders can
 * use without hard-coding every new external part in App.tsx.
 */
import type { BoardSchema } from './boards';
import {
  DEVICE_PACKAGE_SCHEMA_VERSION,
  DevicePackage,
  DevicePackageKind,
  DeviceRuntimeEventParser,
  DeviceRuntimePanelKind,
  getDevicePackage,
  getDevicePackageForTemplate,
} from './device-packages';
import type { CircuitNetlist } from './netlist';
import type { RuntimeBusManifestEntry, RuntimeBusDeviceManifestEntry } from './runtime-timeline';

export const DEVICE_RUNTIME_REGISTRY_SCHEMA_VERSION = 1;

export type DeviceRuntimeRegistryEntry = {
  schemaVersion: typeof DEVICE_RUNTIME_REGISTRY_SCHEMA_VERSION;
  devicePackageSchemaVersion: typeof DEVICE_PACKAGE_SCHEMA_VERSION;
  id: string;
  packageKind: DevicePackageKind;
  title: string;
  category: DevicePackage['category'];
  protocol: DevicePackage['protocol']['primary'];
  backendType: DevicePackage['renodeBackend']['type'];
  manifest: DevicePackage['renodeBackend']['manifest'];
  componentId: string | null;
  boardId: string | null;
  busId: string | null;
  address: number | null;
  runtimePanels: readonly DeviceRuntimePanelKind[];
  eventParsers: readonly DeviceRuntimeEventParser[];
  validationRepresentative: DevicePackage['validationFixture']['representative'];
};

export type DeviceRuntimeRegistryManifest = {
  schemaVersion: typeof DEVICE_RUNTIME_REGISTRY_SCHEMA_VERSION;
  generatedFor: {
    boardId: string;
    boardName: string;
  };
  entries: readonly DeviceRuntimeRegistryEntry[];
};

function createEntry(options: {
  devicePackage: DevicePackage;
  id: string;
  boardId: string | null;
  componentId: string | null;
  busId: string | null;
  address: number | null;
}): DeviceRuntimeRegistryEntry {
  return {
    schemaVersion: DEVICE_RUNTIME_REGISTRY_SCHEMA_VERSION,
    devicePackageSchemaVersion: DEVICE_PACKAGE_SCHEMA_VERSION,
    id: options.id,
    packageKind: options.devicePackage.kind,
    title: options.devicePackage.title,
    category: options.devicePackage.category,
    protocol: options.devicePackage.protocol.primary,
    backendType: options.devicePackage.renodeBackend.type,
    manifest: options.devicePackage.renodeBackend.manifest,
    componentId: options.componentId,
    boardId: options.boardId,
    busId: options.busId,
    address: options.address,
    runtimePanels: [
      ...options.devicePackage.runtimePanel.controls,
      ...options.devicePackage.runtimePanel.visualizers,
    ],
    eventParsers: options.devicePackage.runtimePanel.eventParsers,
    validationRepresentative: options.devicePackage.validationFixture.representative,
  };
}

function findBusDevice(
  busManifest: readonly RuntimeBusManifestEntry[],
  componentId: string
): { entry: RuntimeBusManifestEntry; device: RuntimeBusDeviceManifestEntry } | null {
  for (const entry of busManifest) {
    for (const device of entry.devices ?? []) {
      if (device.componentId === componentId) {
        return { entry, device };
      }
    }
  }
  return null;
}

export function buildDeviceRuntimeRegistryManifest(options: {
  board: BoardSchema;
  netlist: CircuitNetlist;
  busManifest: readonly RuntimeBusManifestEntry[];
}): DeviceRuntimeRegistryManifest {
  const entries = options.netlist.components.flatMap((component): DeviceRuntimeRegistryEntry[] => {
    if (component.kind === 'board') {
      return [];
    }

    const devicePackage = getDevicePackageForTemplate(component.kind);
    const busDevice = findBusDevice(options.busManifest, component.id);
    return [
      createEntry({
        devicePackage,
        id: `${component.id}:${devicePackage.kind}`,
        boardId: options.board.id,
        componentId: component.id,
        busId: busDevice?.entry.id ?? null,
        address: busDevice?.device.address ?? devicePackage.renodeBackend.address ?? null,
      }),
    ];
  });

  if (options.board.runtime.uart) {
    const uartPackage = getDevicePackage('uart-terminal');
    entries.push(
      createEntry({
        devicePackage: uartPackage,
        id: `${options.board.id}:uart-terminal`,
        boardId: options.board.id,
        componentId: null,
        busId: options.board.runtime.uart.peripheralName,
        address: null,
      })
    );
  }

  return {
    schemaVersion: DEVICE_RUNTIME_REGISTRY_SCHEMA_VERSION,
    generatedFor: {
      boardId: options.board.id,
      boardName: options.board.name,
    },
    entries,
  };
}

export function getRuntimePanelsForPackage(kind: DevicePackageKind): readonly DeviceRuntimePanelKind[] {
  const devicePackage = getDevicePackage(kind);
  return [...devicePackage.runtimePanel.controls, ...devicePackage.runtimePanel.visualizers];
}

export function getEventParsersForPackage(kind: DevicePackageKind): readonly DeviceRuntimeEventParser[] {
  return getDevicePackage(kind).runtimePanel.eventParsers;
}
