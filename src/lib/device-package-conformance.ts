/**
 * Device Package Conformance Test v1.
 *
 * This is the reusable consistency layer for the package ecosystem. It checks
 * whether a package has enough metadata to generate Netlist nodes, Renode
 * manifests, runtime panels, example firmware hints, and protocol codecs
 * without the UI hard-coding a concrete device kind.
 */
import type { ComponentPackageSdk } from './component-packs';
import {
  DEVICE_PACKAGE_COMPILER_VERSION,
  DEVICE_PACKAGE_SCHEMA_VERSION,
  type DevicePackage,
  type DevicePackageCatalog,
} from './device-package-types';
import { findSensorProtocolCodec } from './sensor-protocol-codecs';
import { getSensorPackageSdk, isSensorPackageKind } from './sensor-packages';

export const DEVICE_PACKAGE_CONFORMANCE_SCHEMA_VERSION = 1;

export type DevicePackageConformanceSeverity = 'error' | 'warning';
export type DevicePackageConformanceIssueCode =
  | 'schema-version'
  | 'compiler-version'
  | 'missing-metadata'
  | 'pin-handle-duplicate'
  | 'pin-protocol-mismatch'
  | 'backend-manifest-mismatch'
  | 'backend-incomplete'
  | 'runtime-panel-missing'
  | 'runtime-parser-missing'
  | 'sensor-sdk-mismatch'
  | 'sensor-codec-missing'
  | 'legacy-link-missing';

export type DevicePackageConformanceIssue = {
  packageKind: string;
  severity: DevicePackageConformanceSeverity;
  code: DevicePackageConformanceIssueCode;
  message: string;
};

export type DevicePackageConformanceReport = {
  schemaVersion: typeof DEVICE_PACKAGE_CONFORMANCE_SCHEMA_VERSION;
  packageCount: number;
  errorCount: number;
  warningCount: number;
  issues: readonly DevicePackageConformanceIssue[];
};

function pushIssue(
  issues: DevicePackageConformanceIssue[],
  packageKind: string,
  severity: DevicePackageConformanceSeverity,
  code: DevicePackageConformanceIssueCode,
  message: string
) {
  issues.push({ packageKind, severity, code, message });
}

function assertPackage(
  issues: DevicePackageConformanceIssue[],
  devicePackage: DevicePackage,
  condition: boolean,
  code: DevicePackageConformanceIssueCode,
  message: string
) {
  if (!condition) {
    pushIssue(issues, devicePackage.kind, 'error', code, message);
  }
}

function warnPackage(
  issues: DevicePackageConformanceIssue[],
  devicePackage: DevicePackage,
  condition: boolean,
  code: DevicePackageConformanceIssueCode,
  message: string
) {
  if (!condition) {
    pushIssue(issues, devicePackage.kind, 'warning', code, message);
  }
}

function getRuntimePanels(devicePackage: DevicePackage): readonly string[] {
  return [...devicePackage.runtimePanel.controls, ...devicePackage.runtimePanel.visualizers];
}

function validatePins(devicePackage: DevicePackage, issues: DevicePackageConformanceIssue[]) {
  assertPackage(issues, devicePackage, devicePackage.pins.length > 0, 'missing-metadata', 'Package must expose at least one pin or virtual endpoint.');

  const handleIds = new Set<string>();
  devicePackage.pins.forEach((pin) => {
    assertPackage(issues, devicePackage, Boolean(pin.id && pin.label && pin.role), 'missing-metadata', `Pin ${pin.id || '<missing>'} is incomplete.`);
    if (handleIds.has(pin.terminal.handleId)) {
      pushIssue(issues, devicePackage.kind, 'error', 'pin-handle-duplicate', `Duplicate terminal handle ${pin.terminal.handleId}.`);
    }
    handleIds.add(pin.terminal.handleId);

    if (pin.netKind !== 'power' && pin.netKind !== 'ground' && pin.netKind !== 'virtual') {
      assertPackage(
        issues,
        devicePackage,
        pin.protocols.includes(devicePackage.protocol.primary),
        'pin-protocol-mismatch',
        `${pin.id} does not include primary protocol ${devicePackage.protocol.primary}.`
      );
    }
  });
}

function validateBackend(devicePackage: DevicePackage, issues: DevicePackageConformanceIssue[]) {
  assertPackage(
    issues,
    devicePackage,
    devicePackage.renodeBackend.manifest === devicePackage.validationFixture.expectedManifest,
    'backend-manifest-mismatch',
    'Validation fixture expectedManifest must match renodeBackend.manifest.'
  );

  if (devicePackage.renodeBackend.type === 'signal-broker') {
    assertPackage(issues, devicePackage, devicePackage.renodeBackend.manifest === 'runtime-signal-manifest', 'backend-manifest-mismatch', 'Signal broker packages must emit runtime-signal-manifest.');
    assertPackage(issues, devicePackage, devicePackage.runtimePanel.eventParsers.includes('gpio-level'), 'runtime-parser-missing', 'Signal broker packages must parse gpio-level events.');
  }

  if (devicePackage.renodeBackend.type === 'bus-transaction-broker') {
    assertPackage(issues, devicePackage, devicePackage.renodeBackend.manifest === 'runtime-bus-manifest', 'backend-manifest-mismatch', 'Bus transaction packages must emit runtime-bus-manifest.');
    assertPackage(issues, devicePackage, Boolean(devicePackage.renodeBackend.model), 'backend-incomplete', 'Bus transaction backend must declare a model.');
    assertPackage(issues, devicePackage, devicePackage.runtimePanel.eventParsers.includes('bus-transaction'), 'runtime-parser-missing', 'Bus transaction packages must parse bus-transaction events.');
  }

  if (devicePackage.renodeBackend.type === 'virtual-uart-terminal') {
    assertPackage(issues, devicePackage, devicePackage.renodeBackend.manifest === 'board-runtime', 'backend-manifest-mismatch', 'Virtual UART terminal must attach to board-runtime.');
    assertPackage(issues, devicePackage, devicePackage.runtimePanel.eventParsers.includes('uart-line-buffer'), 'runtime-parser-missing', 'UART terminal must parse UART line events.');
  }

  if (devicePackage.renodeBackend.type === 'renode-native-sensor') {
    assertPackage(issues, devicePackage, devicePackage.renodeBackend.manifest === 'runtime-bus-manifest', 'backend-manifest-mismatch', 'Native sensors must emit runtime-bus-manifest.');
    assertPackage(issues, devicePackage, Boolean(devicePackage.renodeBackend.nativeRenodeType), 'backend-incomplete', 'Native sensors must declare the Renode peripheral type.');
    assertPackage(issues, devicePackage, isSensorPackageKind(devicePackage.renodeBackend.sensorPackage), 'sensor-sdk-mismatch', 'Native sensor backend must reference a known sensor package.');

    if (isSensorPackageKind(devicePackage.renodeBackend.sensorPackage)) {
      const sensorSdk = getSensorPackageSdk(devicePackage.renodeBackend.sensorPackage);
      assertPackage(
        issues,
        devicePackage,
        sensorSdk.protocol.defaultAddress === devicePackage.renodeBackend.address,
        'sensor-sdk-mismatch',
        'Device package address must match the sensor SDK default address.'
      );
      assertPackage(
        issues,
        devicePackage,
        Boolean(findSensorProtocolCodec(sensorSdk.busRuntime.transactionCodec)),
        'sensor-codec-missing',
        `Missing protocol codec ${sensorSdk.busRuntime.transactionCodec}.`
      );
    }
  }
}

function validateRuntimePanels(devicePackage: DevicePackage, issues: DevicePackageConformanceIssue[]) {
  const runtimePanels = getRuntimePanels(devicePackage);
  assertPackage(issues, devicePackage, runtimePanels.length > 0, 'runtime-panel-missing', 'Package must expose at least one runtime panel.');
  assertPackage(issues, devicePackage, devicePackage.runtimePanel.eventParsers.length > 0, 'runtime-parser-missing', 'Package must expose at least one event parser.');

  devicePackage.validationFixture.expectedPanels.forEach((panel) => {
    assertPackage(issues, devicePackage, runtimePanels.includes(panel), 'runtime-panel-missing', `Validation fixture expects missing runtime panel ${panel}.`);
  });
}

function validateLegacyLinks(
  devicePackage: DevicePackage,
  componentPackageKinds: ReadonlySet<string>,
  issues: DevicePackageConformanceIssue[]
) {
  if (!devicePackage.visual.library.visible) {
    return;
  }
  warnPackage(
    issues,
    devicePackage,
    Boolean(devicePackage.legacy.componentPackageKind && componentPackageKinds.has(devicePackage.legacy.componentPackageKind)),
    'legacy-link-missing',
    'Visible library packages should still link to a legacy component template until the canvas is fully device-package native.'
  );
}

export function validateDevicePackageConformance(options: {
  devicePackage: DevicePackage;
  componentPackageKinds?: ReadonlySet<string>;
}): readonly DevicePackageConformanceIssue[] {
  const issues: DevicePackageConformanceIssue[] = [];
  const devicePackage = options.devicePackage;

  assertPackage(issues, devicePackage, devicePackage.schemaVersion === DEVICE_PACKAGE_SCHEMA_VERSION, 'schema-version', `Package must use Device Package schema v${DEVICE_PACKAGE_SCHEMA_VERSION}.`);
  assertPackage(issues, devicePackage, devicePackage.compiler.version === DEVICE_PACKAGE_COMPILER_VERSION, 'compiler-version', `Package must be compiled by compiler v${DEVICE_PACKAGE_COMPILER_VERSION}.`);
  assertPackage(issues, devicePackage, Boolean(devicePackage.kind && devicePackage.title && devicePackage.version), 'missing-metadata', 'Package identity metadata is incomplete.');
  assertPackage(issues, devicePackage, Boolean(devicePackage.visual && devicePackage.protocol && devicePackage.renodeBackend), 'missing-metadata', 'Package must expose visual, protocol, and Renode backend metadata.');

  validatePins(devicePackage, issues);
  validateBackend(devicePackage, issues);
  validateRuntimePanels(devicePackage, issues);

  if (options.componentPackageKinds) {
    validateLegacyLinks(devicePackage, options.componentPackageKinds, issues);
  }

  return issues;
}

export function validateDevicePackageCatalogConformance(options: {
  catalog: DevicePackageCatalog;
  componentPackages?: readonly ComponentPackageSdk[];
}): DevicePackageConformanceReport {
  const componentPackageKinds = new Set((options.componentPackages ?? []).map((componentPackage) => componentPackage.kind));
  const issues = options.catalog.packages.flatMap((devicePackage) =>
    validateDevicePackageConformance({
      devicePackage,
      componentPackageKinds,
    })
  );

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    schemaVersion: DEVICE_PACKAGE_CONFORMANCE_SCHEMA_VERSION,
    packageCount: options.catalog.packages.length,
    errorCount,
    warningCount,
    issues,
  };
}
