/**
 * Reusable runtime adapter for bus-connected sensors.
 *
 * Protocol Runtime Registry v1 now owns protocol-level discovery. This module
 * remains the sensor-specific runtime layer: it consumes registry sensor
 * devices, manages channel state, creates native Renode control requests, and
 * delegates transaction decoding to the sensor protocol codec registry.
 */
import type { RuntimeBusManifestEntry, RuntimeBusTimelineEvent } from './runtime-timeline';
import {
  getSensorPackageSdk,
  isSensorPackageKind,
} from './sensor-packages';
import type { SensorChannelKind, SensorPackageKind, SensorPackageSdk, SensorPackageSdkChannel, SensorTransactionCodec } from './sensor-packages';
import {
  createProtocolRuntimeRegistry,
  getProtocolRuntimeSensorDevices,
} from './protocol-runtime-registry';
import type { ProtocolRuntimeDevice, ProtocolRuntimeRegistry } from './protocol-runtime-registry';
import {
  SensorProtocolBrokerTransaction,
  findSensorProtocolCodec,
} from './sensor-protocol-codecs';
import { findRenodeNativePeripheralCatalogEntry } from './renode-native-peripheral-catalog';

export const BUS_SENSOR_RUNTIME_SCHEMA_VERSION = 2;

export type NativeSensorRuntimeAttachment = 'renode-native' | 'broker-only' | 'visual-only';
export type NativeSensorRuntimeReadiness = 'ready' | 'needs-native-path' | 'needs-codec' | 'not-native';

export type NativeSensorRuntimeContract = {
  schemaVersion: typeof BUS_SENSOR_RUNTIME_SCHEMA_VERSION;
  attachment: NativeSensorRuntimeAttachment;
  readiness: NativeSensorRuntimeReadiness;
  canApplyNativeControls: boolean;
  canDecodeTransactions: boolean;
  canReadThroughUserFirmware: boolean;
  expectedRenodePath: string | null;
  expectedResult: string;
  reasons: string[];
};

export type RuntimeBusSensorDevice = {
  id: string;
  componentId: string;
  componentKind: string | null;
  devicePackageKind?: string | null;
  devicePackageSchemaVersion?: number | null;
  label: string;
  address: number | null;
  model: string;
  sensorPackage?: SensorPackageKind;
  sensorPackageTitle?: string;
  sensorPackageSdkSchemaVersion?: number;
  nativeCatalogId?: string | null;
  nativeControlTransport?: string | null;
  controlChannels?: ProtocolRuntimeDevice['controlChannels'];
  nativeRenodeName?: string | null;
  nativeRenodePath?: string | null;
  busId: string;
  busLabel: string;
  package: RuntimeBusSensorPackageMetadata;
  channels: readonly RuntimeBusSensorChannelDefinition[];
  transactionCodec: SensorTransactionCodec | null;
  nativeRuntime: NativeSensorRuntimeContract;
};

export type RuntimeBusSensorChannelDefinition = SensorPackageSdkChannel | {
  id: string;
  label: string;
  unit: SensorPackageSdkChannel['unit'] | 'pascal' | 'raw' | 'hex' | string;
  minimum: number;
  maximum: number;
  defaultValue: number;
  step: number;
  renodeProperty: string;
  ui: {
    precision: number;
  };
};

export type RuntimeBusSensorPackageMetadata = Pick<SensorPackageSdk, 'title' | 'protocol'> & {
  kind: string;
  nativeCatalogId?: string | null;
  busRuntime?: {
    transactionCodec?: SensorTransactionCodec | null;
  };
};

export type BusSensorRuntimeChannelState = {
  id: SensorChannelKind;
  label: string;
  unit: string;
  minimum: number;
  maximum: number;
  step: number;
  precision: number;
  renodeProperty: string;
  configuredValue: number;
  lastReadValue: number | null;
};

export type BusSensorRuntimeDeviceState = {
  schemaVersion: typeof BUS_SENSOR_RUNTIME_SCHEMA_VERSION;
  deviceId: string;
  componentId: string;
  label: string;
  sensorPackage?: SensorPackageKind;
  nativeCatalogId?: string | null;
  busId: string;
  busLabel: string;
  address: number;
  nativeRenodePath: string | null;
  nativeRuntime: NativeSensorRuntimeContract;
  channels: Record<string, BusSensorRuntimeChannelState>;
  transactionCount: number;
  nativeApplyCount: number;
  lastNativeApplyHostTimeMs: number | null;
  lastNativeApplyValues: Record<string, number>;
  lastBusReadHostTimeMs: number | null;
  updatedAtVirtualTimeNs: number | null;
  protocolState: unknown | null;
};

export type BusSensorRuntimeState = {
  schemaVersion: typeof BUS_SENSOR_RUNTIME_SCHEMA_VERSION;
  devices: Record<string, BusSensorRuntimeDeviceState>;
};

export type NativeSensorControlChannelRequest = {
  id: string;
  renodeProperty: string;
  value: number;
  minimum: number;
  maximum: number;
};

export type NativeSensorControlRequestPayload = {
  schemaVersion: typeof BUS_SENSOR_RUNTIME_SCHEMA_VERSION;
  deviceId: string;
  componentId: string;
  path: string;
  sensorPackage?: SensorPackageKind;
  nativeCatalogId?: string | null;
  runtimeContract: NativeSensorRuntimeContract;
  channels: NativeSensorControlChannelRequest[];
};

export type BusSensorBrokerTransaction = SensorProtocolBrokerTransaction;

/**
 * Narrows the generic protocol runtime device into a sensor runtime device.
 * Sensor panels need SDK channels and codec metadata, so this adapter is the
 * bridge from "I2C device discovered" to "render sliders and decode reads".
 */
function createRuntimeSensorDevice(device: ProtocolRuntimeDevice): RuntimeBusSensorDevice[] {
  if (device.protocol !== 'i2c' || device.role !== 'sensor') {
    return [];
  }

  const sensorPackage = isSensorPackageKind(device.sensorPackage) ? getSensorPackageSdk(device.sensorPackage) : null;
  const catalogEntry = findRenodeNativePeripheralCatalogEntry(device.nativeCatalogId);
  const controlChannels = device.controlChannels ?? catalogEntry?.control.channels ?? [];
  if (!sensorPackage && controlChannels.length === 0) {
    return [];
  }
  const channels: readonly RuntimeBusSensorChannelDefinition[] = sensorPackage
    ? sensorPackage.channels
    : controlChannels.map((channel) => ({
        ...channel,
        defaultValue: channel.defaultValue ?? (channel.minimum <= 0 && channel.maximum >= 0 ? 0 : channel.minimum),
        ui: {
          precision: channel.step < 1 ? 1 : 0,
        },
      }));
  const packageMetadata: RuntimeBusSensorPackageMetadata = sensorPackage ?? {
    kind: device.devicePackageKind ?? device.nativeCatalogId ?? device.model,
    title: catalogEntry?.devicePackage.title ?? device.label,
    nativeCatalogId: catalogEntry?.id ?? device.nativeCatalogId,
    protocol: {
      bus: 'i2c',
      addressMode: 'seven-bit',
      defaultAddress: device.address ?? catalogEntry?.defaultAddress ?? 0,
      transactionModel: 'mcu-initiated-reads',
    },
    busRuntime: {
      transactionCodec: null,
    },
  };
  const transactionCodec = packageMetadata.busRuntime?.transactionCodec ?? null;
  const hasCodec = Boolean(transactionCodec && findSensorProtocolCodec(transactionCodec));
  const hasNativePath = Boolean(device.nativeRenodePath);
  const canApplyNativeControls = Boolean(hasNativePath && (device.nativeControlTransport || controlChannels.length > 0));
  const attachment: NativeSensorRuntimeAttachment = hasNativePath
    ? 'renode-native'
    : device.nativeControlTransport || device.nativeRenodeName
      ? 'broker-only'
      : 'visual-only';
  const reasons = [
    hasNativePath ? `Renode path ${device.nativeRenodePath} is available.` : 'No native Renode monitor path was generated for this sensor.',
    canApplyNativeControls ? 'Native monitor property controls can be applied while simulation is running.' : 'Native monitor property controls are not available for this sensor.',
    hasCodec ? `Protocol codec ${transactionCodec} can decode I2C reads.` : 'No protocol codec is registered yet; rely on UART/user firmware output for read validation.',
  ];
  const nativeRuntime: NativeSensorRuntimeContract = {
    schemaVersion: BUS_SENSOR_RUNTIME_SCHEMA_VERSION,
    attachment,
    readiness: hasNativePath ? (hasCodec ? 'ready' : 'needs-codec') : device.nativeControlTransport ? 'needs-native-path' : 'not-native',
    canApplyNativeControls,
    canDecodeTransactions: hasCodec,
    canReadThroughUserFirmware: hasNativePath,
    expectedRenodePath: device.nativeRenodePath ?? null,
    expectedResult: hasCodec
      ? 'User firmware can read the native sensor through MCU I2C and the UI can decode matching bus transactions.'
      : 'User firmware can read the native sensor through MCU I2C; add a protocol codec for UI-side transaction decoding.',
    reasons,
  };

  return [
    {
      id: device.id,
      componentId: device.componentId ?? device.id,
      componentKind: device.componentKind,
      devicePackageKind: device.devicePackageKind,
      devicePackageSchemaVersion: device.devicePackageSchemaVersion,
      label: device.label,
      address: device.address,
      model: device.model,
      ...(sensorPackage ? { sensorPackage: sensorPackage.kind } : {}),
      sensorPackageTitle: device.sensorPackageTitle,
      sensorPackageSdkSchemaVersion: device.sensorPackageSdkSchemaVersion,
      nativeCatalogId: catalogEntry?.id ?? device.nativeCatalogId,
      nativeControlTransport: device.nativeControlTransport,
      controlChannels: device.controlChannels,
      nativeRenodeName: device.nativeRenodeName,
      nativeRenodePath: device.nativeRenodePath,
      busId: device.busId ?? 'i2c:visual',
      busLabel: device.busLabel ?? 'I2C Visual Bus',
      package: packageMetadata,
      channels,
      transactionCodec,
      nativeRuntime,
    },
  ];
}

function clamp(value: number, min: number, max: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return min;
  }
  return Math.min(max, Math.max(min, numericValue));
}

function createChannelState(channel: RuntimeBusSensorChannelDefinition): BusSensorRuntimeChannelState {
  return {
    id: channel.id,
    label: channel.label,
    unit: channel.unit,
    minimum: channel.minimum,
    maximum: channel.maximum,
    step: channel.step,
    precision: channel.ui.precision,
    renodeProperty: channel.renodeProperty,
    configuredValue: channel.defaultValue,
    lastReadValue: null,
  };
}

function createProtocolState(device: RuntimeBusSensorDevice): unknown | null {
  // Each sensor codec owns protocol-specific rolling state. More codecs can add
  // their own state objects without changing the React panel contract.
  const codec = device.transactionCodec ? findSensorProtocolCodec(device.transactionCodec) : null;
  return codec ? codec.createInitialState(device.address ?? device.package.protocol.defaultAddress) : null;
}

function createDeviceState(device: RuntimeBusSensorDevice): BusSensorRuntimeDeviceState {
  return {
    schemaVersion: BUS_SENSOR_RUNTIME_SCHEMA_VERSION,
    deviceId: device.id,
    componentId: device.componentId,
    label: device.label,
    sensorPackage: device.sensorPackage,
    nativeCatalogId: device.nativeCatalogId ?? null,
    busId: device.busId,
    busLabel: device.busLabel,
    address: device.address ?? device.package.protocol.defaultAddress,
    nativeRenodePath: device.nativeRenodePath ?? null,
    nativeRuntime: device.nativeRuntime,
    channels: Object.fromEntries(device.channels.map((channel) => [channel.id, createChannelState(channel)])),
    transactionCount: 0,
    nativeApplyCount: 0,
    lastNativeApplyHostTimeMs: null,
    lastNativeApplyValues: {},
    lastBusReadHostTimeMs: null,
    updatedAtVirtualTimeNs: null,
    protocolState: createProtocolState(device),
  };
}

export function getBusSensorRuntimeDevices(busManifest: readonly RuntimeBusManifestEntry[]): RuntimeBusSensorDevice[] {
  // Backward-compatible API for existing scripts/tests. New code should usually
  // build ProtocolRuntimeRegistry once and call getBusSensorRuntimeDevicesFromProtocolRegistry.
  return getBusSensorRuntimeDevicesFromProtocolRegistry(
    createProtocolRuntimeRegistry({
      busManifest,
    })
  );
}

export function getBusSensorRuntimeDevicesFromProtocolRegistry(
  registry: ProtocolRuntimeRegistry
): RuntimeBusSensorDevice[] {
  return getProtocolRuntimeSensorDevices(registry).flatMap((device) => createRuntimeSensorDevice(device));
}

export function createBusSensorRuntimeState(devices: readonly RuntimeBusSensorDevice[] = []): BusSensorRuntimeState {
  return {
    schemaVersion: BUS_SENSOR_RUNTIME_SCHEMA_VERSION,
    devices: Object.fromEntries(devices.map((device) => [device.id, createDeviceState(device)])),
  };
}

export function syncBusSensorRuntimeDevices(
  state: BusSensorRuntimeState,
  devices: readonly RuntimeBusSensorDevice[]
): BusSensorRuntimeState {
  // Preserve user-configured channel values when the wiring changes but the
  // same sensor device still exists in the regenerated manifest.
  const nextDevices = Object.fromEntries(
    devices.map((device) => {
      const fresh = createDeviceState(device);
      const current = state.devices[device.id];
      if (!current) {
        return [device.id, fresh];
      }

      const channels = Object.fromEntries(
        Object.entries(fresh.channels).map(([channelId, channel]) => {
          const currentChannel = current.channels[channelId];
          return [
            channelId,
            currentChannel
              ? {
                  ...channel,
                  configuredValue: clamp(currentChannel.configuredValue, channel.minimum, channel.maximum),
                  lastReadValue: currentChannel.lastReadValue,
                }
              : channel,
          ];
        })
      );

      return [
        device.id,
        {
          ...fresh,
          channels,
          transactionCount: current.transactionCount,
          nativeApplyCount: current.nativeApplyCount,
          lastNativeApplyHostTimeMs: current.lastNativeApplyHostTimeMs,
          lastNativeApplyValues: current.lastNativeApplyValues,
          lastBusReadHostTimeMs: current.lastBusReadHostTimeMs,
          updatedAtVirtualTimeNs: current.updatedAtVirtualTimeNs,
          protocolState: current.protocolState ?? fresh.protocolState,
        },
      ];
    })
  );

  return {
    schemaVersion: BUS_SENSOR_RUNTIME_SCHEMA_VERSION,
    devices: nextDevices,
  };
}

export function updateBusSensorChannelConfiguration(
  state: BusSensorRuntimeState,
  deviceId: string,
  channelId: string,
  value: number
): BusSensorRuntimeState {
  const device = state.devices[deviceId];
  const channel = device?.channels[channelId];
  if (!device || !channel) {
    return state;
  }

  return {
    ...state,
    devices: {
      ...state.devices,
      [deviceId]: {
        ...device,
        channels: {
          ...device.channels,
          [channelId]: {
            ...channel,
            configuredValue: clamp(value, channel.minimum, channel.maximum),
          },
        },
      },
    },
  };
}

export function createNativeSensorControlRequest(
  device: RuntimeBusSensorDevice,
  state: BusSensorRuntimeDeviceState
): NativeSensorControlRequestPayload | null {
  // Native Renode sensors are controlled through monitor properties. Devices
  // without a native path can still emit timeline transactions, but cannot push
  // values into Renode's C# model.
  if (!device.nativeRenodePath) {
    return null;
  }

  return {
    schemaVersion: BUS_SENSOR_RUNTIME_SCHEMA_VERSION,
    deviceId: device.id,
    componentId: device.componentId,
    path: device.nativeRenodePath,
    sensorPackage: device.sensorPackage,
    nativeCatalogId: device.nativeCatalogId,
    runtimeContract: device.nativeRuntime,
    channels: Object.values(state.channels).map((channel) => ({
      id: channel.id,
      renodeProperty: channel.renodeProperty,
      value: channel.configuredValue,
      minimum: channel.minimum,
      maximum: channel.maximum,
    })),
  };
}

export function applyNativeSensorControlValues(
  state: BusSensorRuntimeState,
  path: string | null | undefined,
  values: Record<string, number | null | undefined>
): BusSensorRuntimeState {
  if (!path) {
    return state;
  }

  const entry = Object.entries(state.devices).find(([, device]) => device.nativeRenodePath === path);
  if (!entry) {
    return state;
  }

  const [deviceId, device] = entry;
  const channels = { ...device.channels };
  const appliedValues: Record<string, number> = {};
  Object.entries(values).forEach(([channelId, value]) => {
    const channel = channels[channelId];
    if (!channel || value === null || typeof value === 'undefined') {
      return;
    }
    const nextValue = clamp(value, channel.minimum, channel.maximum);
    channels[channelId] = {
      ...channel,
      configuredValue: nextValue,
      lastReadValue: nextValue,
    };
    appliedValues[channelId] = nextValue;
  });

  return {
    ...state,
    devices: {
      ...state.devices,
      [deviceId]: {
        ...device,
        channels,
        nativeApplyCount: device.nativeApplyCount + 1,
        lastNativeApplyHostTimeMs: Date.now(),
        lastNativeApplyValues: {
          ...device.lastNativeApplyValues,
          ...appliedValues,
        },
      },
    },
  };
}

function applyCodecRuntimeEvent(
  runtimeDevice: RuntimeBusSensorDevice,
  device: BusSensorRuntimeDeviceState,
  event: RuntimeBusTimelineEvent
): BusSensorRuntimeDeviceState {
  const codec = runtimeDevice.transactionCodec ? findSensorProtocolCodec(runtimeDevice.transactionCodec) : null;
  if (!codec) {
    return device;
  }
  const result = codec.applyEvent({
    state: device.protocolState,
    address: device.address,
    event,
  });
  const channels = { ...device.channels };
  Object.entries(result.readings).forEach(([channelId, value]) => {
    const channel = channels[channelId];
    if (!channel || value === null || typeof value === 'undefined') {
      return;
    }
    channels[channelId] = {
      ...channel,
      lastReadValue: value,
    };
  });

  return {
    ...device,
    channels,
    protocolState: result.state,
    transactionCount: result.transactionCount,
    lastBusReadHostTimeMs: Object.keys(result.readings).length > 0 ? Date.now() : device.lastBusReadHostTimeMs,
    updatedAtVirtualTimeNs: result.updatedAtVirtualTimeNs,
  };
}

export function applyBusSensorRuntimeEvent(
  state: BusSensorRuntimeState,
  event: RuntimeBusTimelineEvent,
  devices: readonly RuntimeBusSensorDevice[]
): BusSensorRuntimeState {
  // This is the runtime decode point. A bus transaction arrives from Electron,
  // the registry tells us which sensor it belongs to, and the codec updates the
  // visual channel readouts.
  if (event.protocol !== 'i2c' || event.kind !== 'bus-transaction') {
    return state;
  }

  let changed = false;
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const nextDevices = { ...state.devices };
  Object.entries(state.devices).forEach(([deviceId, device]) => {
    const runtimeDevice = deviceById.get(deviceId);
    if (!runtimeDevice || runtimeDevice.busId !== event.busId || event.address !== device.address) {
      return;
    }

    nextDevices[deviceId] = applyCodecRuntimeEvent(runtimeDevice, device, event);
    changed = true;
  });

  return changed
    ? {
        ...state,
        devices: nextDevices,
      }
    : state;
}

export function createBusSensorReadTransactions(
  device: RuntimeBusSensorDevice,
  state: BusSensorRuntimeDeviceState,
  channelId: string
): BusSensorBrokerTransaction[] {
  // UI-triggered reads are timeline/demo helpers. Real MCU reads still happen
  // inside Renode through the generated/user firmware and native sensor model.
  const codec = device.transactionCodec ? findSensorProtocolCodec(device.transactionCodec) : null;
  if (!codec) {
    return [];
  }
  return codec.createReadTransactions({
    busId: device.busId,
    busLabel: device.busLabel,
    componentId: device.componentId,
    address: device.address ?? device.package.protocol.defaultAddress,
    channelId,
    channels: state.channels,
  });
}

export function formatSensorChannelValue(channel: BusSensorRuntimeChannelState, value: number | null): string {
  if (value === null) {
    return 'none';
  }
  const suffix =
    channel.unit === 'celsius'
      ? ' C'
      : channel.unit === 'percent-rh'
        ? ' %RH'
        : channel.unit === 'pascal'
          ? ' Pa'
          : '';
  if (channel.unit === 'hex') {
    return `0x${Math.trunc(value).toString(16).toUpperCase()}`;
  }
  return `${value.toFixed(channel.precision)}${suffix}`;
}

export function summarizeNativeSensorRuntime(
  state: BusSensorRuntimeState,
  devices: readonly RuntimeBusSensorDevice[]
): {
  schemaVersion: typeof BUS_SENSOR_RUNTIME_SCHEMA_VERSION;
  deviceCount: number;
  nativeReadyCount: number;
  decodableCount: number;
  appliedCount: number;
  transactionCount: number;
} {
  return {
    schemaVersion: BUS_SENSOR_RUNTIME_SCHEMA_VERSION,
    deviceCount: devices.length,
    nativeReadyCount: devices.filter((device) => device.nativeRuntime.canReadThroughUserFirmware).length,
    decodableCount: devices.filter((device) => device.nativeRuntime.canDecodeTransactions).length,
    appliedCount: Object.values(state.devices).reduce((total, device) => total + device.nativeApplyCount, 0),
    transactionCount: Object.values(state.devices).reduce((total, device) => total + device.transactionCount, 0),
  };
}
