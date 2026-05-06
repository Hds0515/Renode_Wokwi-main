/**
 * Device Package Native Runtime v1.
 *
 * This module is the renderer-facing adapter for Device Packages. UI code asks
 * it how to render library cards, endpoint terminals, and new workbench
 * instances. Legacy peripheral templates are still used as the current Renode
 * generation compatibility layer, but that detail is isolated here instead of
 * leaking through App.tsx.
 */
import {
  DemoPeripheral,
  DemoPeripheralBehavior,
  DemoPeripheralKind,
  DemoPeripheralTemplateKind,
  DemoWiring,
  DemoWorkbenchDevice,
  buildWorkbenchDevices,
  createDefaultPeripheralBehavior,
  getPeripheralTemplateKind,
  getWorkbenchDeviceId,
  isDemoPeripheralTemplateKind,
} from './firmware';
import {
  DEVICE_PACKAGE_LIBRARY_ITEMS,
  findDevicePackage,
  getDevicePackage,
  getDevicePackageForTemplate,
} from './device-packages';
import type {
  DevicePackage,
  DevicePackageKind,
  DevicePackagePin,
} from './device-package-types';

export const DEVICE_PACKAGE_NATIVE_RUNTIME_SCHEMA_VERSION = 1;

export type DevicePackageNativeLibraryItem = {
  schemaVersion: typeof DEVICE_PACKAGE_NATIVE_RUNTIME_SCHEMA_VERSION;
  packageKind: DevicePackageKind;
  title: string;
  subtitle: string;
  category: DevicePackage['category'];
  group: DevicePackage['visual']['library']['group'];
  icon: DevicePackage['visual']['icon'];
  accentColor: string;
  order: number;
  draggable: boolean;
  canInstantiate: boolean;
  legacyTemplateKind: DemoPeripheralTemplateKind | null;
  endpointCount: number;
  requirementSummary: string;
};

function getLegacyTemplateKind(devicePackage: DevicePackage): DemoPeripheralTemplateKind | null {
  return isDemoPeripheralTemplateKind(devicePackage.legacy.componentPackageKind)
    ? devicePackage.legacy.componentPackageKind
    : isDemoPeripheralTemplateKind(devicePackage.kind)
      ? devicePackage.kind
      : null;
}

function getEndpointKind(devicePackage: DevicePackage, pin: DevicePackagePin): DemoPeripheralKind {
  if (pin.netKind === 'i2c' || pin.protocols.includes('i2c')) {
    return 'i2c';
  }
  if (devicePackage.category === 'input') {
    return 'button';
  }
  return 'led';
}

function createDefaultBehaviorForPackage(devicePackage: DevicePackage): DemoPeripheralBehavior {
  const legacyTemplateKind = getLegacyTemplateKind(devicePackage);
  if (legacyTemplateKind) {
    return createDefaultPeripheralBehavior(legacyTemplateKind);
  }

  if (devicePackage.category === 'input') {
    return {
      schemaVersion: 2,
      role: 'momentary-input',
      controller: null,
      powerRequired: false,
    };
  }
  if (devicePackage.category === 'display') {
    return {
      schemaVersion: 2,
      role: 'i2c-display',
      controller: null,
      powerRequired: false,
    };
  }
  if (devicePackage.category === 'sensor') {
    return {
      schemaVersion: 2,
      role: 'i2c-sensor',
      controller: null,
      powerRequired: false,
    };
  }
  return {
    schemaVersion: 2,
    role: 'gpio-output',
    controller: { type: 'firmware' },
    powerRequired: false,
  };
}

export function canInstantiateDevicePackage(devicePackage: DevicePackage): boolean {
  return Boolean(getLegacyTemplateKind(devicePackage)) && devicePackage.visual.library.addMode === 'legacy-template';
}

export function getDevicePackageLibraryItems(): readonly DevicePackageNativeLibraryItem[] {
  return DEVICE_PACKAGE_LIBRARY_ITEMS.map((devicePackage) => ({
    schemaVersion: DEVICE_PACKAGE_NATIVE_RUNTIME_SCHEMA_VERSION,
    packageKind: devicePackage.kind,
    title: devicePackage.title,
    subtitle: devicePackage.subtitle,
    category: devicePackage.category,
    group: devicePackage.visual.library.group,
    icon: devicePackage.visual.icon,
    accentColor: devicePackage.visual.accentColor,
    order: devicePackage.visual.library.order,
    draggable: devicePackage.visual.library.draggable,
    canInstantiate: canInstantiateDevicePackage(devicePackage),
    legacyTemplateKind: getLegacyTemplateKind(devicePackage),
    endpointCount: devicePackage.pins.filter((pin) => pin.terminal.connectable).length,
    requirementSummary: getDevicePackageRequirementSummary(devicePackage.kind),
  }));
}

export function getDevicePackageForPeripheral(peripheral: DemoPeripheral): DevicePackage {
  return getDevicePackageForTemplate(getPeripheralTemplateKind(peripheral));
}

export function getDevicePackageForWorkbenchDevice(device: DemoWorkbenchDevice): DevicePackage {
  return getDevicePackageForTemplate(device.templateKind);
}

export function getDevicePackagePinForPeripheral(peripheral: DemoPeripheral): DevicePackagePin | null {
  const devicePackage = getDevicePackageForPeripheral(peripheral);
  const endpointId = peripheral.endpointId ?? 'signal';
  return devicePackage.pins.find((pin) => pin.id === endpointId) ?? null;
}

export function getDevicePackageRequirementSummary(kind: DevicePackageKind): string {
  const devicePackage = getDevicePackage(kind);
  return devicePackage.pins
    .filter((pin) => pin.terminal.connectable && pin.netKind !== 'virtual')
    .map((pin) => `${pin.label}: ${pin.requiredPadCapabilities.join(' + ') || pin.protocols.join(' + ')}`)
    .join(' / ');
}

export function countDevicePackageInstances(wiring: DemoWiring, kind: DevicePackageKind): number {
  return buildWorkbenchDevices(wiring).filter((device) => getDevicePackageForWorkbenchDevice(device).kind === kind).length;
}

export function createPeripheralsFromDevicePackage(kind: DevicePackageKind, ordinal: number): DemoPeripheral[] {
  const devicePackage = getDevicePackage(kind);
  const templateKind = getLegacyTemplateKind(devicePackage);
  if (!templateKind || !canInstantiateDevicePackage(devicePackage)) {
    throw new Error(`${devicePackage.title} cannot be instantiated on the canvas yet.`);
  }

  const connectablePins = devicePackage.pins.filter((pin) => pin.terminal.connectable);
  const grouped = connectablePins.length > 1;
  const groupId = grouped ? `${devicePackage.kind}-${ordinal}` : null;
  const groupLabel = grouped ? `${devicePackage.title} ${ordinal}` : null;
  const behavior = createDefaultBehaviorForPackage(devicePackage);

  return connectablePins.map((pin) => {
    const id = grouped ? `${groupId}-${pin.id}` : `${devicePackage.kind}-${ordinal}`;
    const label = groupLabel ?? `${devicePackage.title} ${ordinal}`;
    const peripheral: DemoPeripheral = {
      id,
      kind: getEndpointKind(devicePackage, pin),
      label,
      padId: null,
      sourcePeripheralId: null,
      behavior: {
        ...behavior,
        controller: behavior.controller ? { ...behavior.controller } : null,
      },
      power: undefined,
      templateKind,
      groupId,
      groupLabel,
      endpointId: pin.id,
      endpointLabel: pin.label,
      accentColor: devicePackage.visual.accentColor,
    };
    return peripheral;
  });
}

export function findDevicePackageKind(rawValue: string | null | undefined): DevicePackageKind | null {
  const devicePackage = findDevicePackage(rawValue);
  return devicePackage ? devicePackage.kind : null;
}

export function getWorkbenchDevicePackageKind(device: DemoWorkbenchDevice): DevicePackageKind {
  return getDevicePackageForWorkbenchDevice(device).kind;
}

export function getWorkbenchDeviceIdFromPackagePeripherals(peripherals: readonly DemoPeripheral[]): string {
  if (!peripherals[0]) {
    throw new Error('Cannot resolve workbench id for an empty device package instance.');
  }
  return getWorkbenchDeviceId(peripherals[0]);
}
