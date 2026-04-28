/**
 * Runtime Device Package catalog.
 *
 * This file intentionally stays small: independent package sources live under
 * packages/devices, while Device Package Compiler v1 normalizes them and adapts
 * any legacy component package that has not moved to an independent package yet.
 */
import { DEVICE_PACKAGE_SOURCES } from '../../packages/devices';
import { COMPONENT_PACKAGE_SDKS, getComponentPackageSdk } from './component-packs';
import type { DemoPeripheralTemplateKind } from './firmware';
import type { SensorPackageKind } from './sensor-packages';
import { compileDevicePackageCatalog } from './device-package-compiler';
import type { DevicePackage, DevicePackageKind } from './device-package-types';

export * from './device-package-types';
export { DEVICE_PACKAGE_SOURCES } from '../../packages/devices';
export {
  compileComponentDevicePackage,
  compileDevicePackageCatalog,
  compileDevicePackageSource,
} from './device-package-compiler';

export const DEVICE_PACKAGE_CATALOG = compileDevicePackageCatalog({
  componentPackages: COMPONENT_PACKAGE_SDKS,
  sources: DEVICE_PACKAGE_SOURCES,
});

export const DEVICE_PACKAGES = DEVICE_PACKAGE_CATALOG.packages;
export const DEVICE_PACKAGE_LIBRARY_ITEMS = DEVICE_PACKAGES.filter(
  (devicePackage) => devicePackage.visual.library.visible && devicePackage.legacy.componentPackageKind
).sort((left, right) => left.visual.library.order - right.visual.library.order);

const DEVICE_PACKAGE_MAP = new Map<DevicePackageKind, DevicePackage>(
  DEVICE_PACKAGES.map((devicePackage) => [devicePackage.kind, devicePackage])
);
const DEVICE_PACKAGE_BY_TEMPLATE = new Map<DemoPeripheralTemplateKind, DevicePackage>(
  DEVICE_PACKAGES.flatMap((devicePackage) =>
    devicePackage.legacy.componentPackageKind ? [[devicePackage.legacy.componentPackageKind, devicePackage] as const] : []
  )
);

export function getDevicePackage(kind: DevicePackageKind): DevicePackage {
  const devicePackage = DEVICE_PACKAGE_MAP.get(kind);
  if (!devicePackage) {
    throw new Error(`Unknown device package kind: ${kind}`);
  }
  return devicePackage;
}

export function getDevicePackageForTemplate(kind: DemoPeripheralTemplateKind): DevicePackage {
  const devicePackage = DEVICE_PACKAGE_BY_TEMPLATE.get(kind);
  if (!devicePackage) {
    return getDevicePackage(getComponentPackageSdk(kind).kind);
  }
  return devicePackage;
}

export function findDevicePackage(kind: unknown): DevicePackage | null {
  return typeof kind === 'string' && DEVICE_PACKAGE_MAP.has(kind as DevicePackageKind)
    ? getDevicePackage(kind as DevicePackageKind)
    : null;
}

export function getSensorDevicePackage(kind: SensorPackageKind): DevicePackage {
  const match = DEVICE_PACKAGES.find((devicePackage) => devicePackage.legacy.sensorPackageKind === kind);
  if (!match) {
    throw new Error(`No device package registered for sensor package: ${kind}`);
  }
  return match;
}
