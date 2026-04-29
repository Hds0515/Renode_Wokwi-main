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
import type { SensorChannelKind, SensorPackageKind, SensorPackageSdk, SensorPackageSdkChannel } from './sensor-packages';
import {
  createProtocolRuntimeRegistry,
  getProtocolRuntimeSensorDevices,
} from './protocol-runtime-registry';
import type { ProtocolRuntimeDevice, ProtocolRuntimeRegistry } from './protocol-runtime-registry';
import {
  SensorProtocolBrokerTransaction,
  getSensorProtocolCodec,
} from './sensor-protocol-codecs';

export const BUS_SENSOR_RUNTIME_SCHEMA_VERSION = 1;

export type RuntimeBusSensorDevice = {
  id: string;
  componentId: string;
  componentKind: string | null;
  devicePackageKind?: string | null;
  devicePackageSchemaVersion?: number | null;
  label: string;
  address: number | null;
  model: string;
  sensorPackage: SensorPackageKind;
  sensorPackageTitle?: string;
  sensorPackageSdkSchemaVersion?: number;
  nativeControlTransport?: string | null;
  controlChannels?: ProtocolRuntimeDevice['controlChannels'];
  nativeRenodeName?: string | null;
  nativeRenodePath?: string | null;
  busId: string;
  busLabel: string;
  package: SensorPackageSdk;
  channels: readonly SensorPackageSdkChannel[];
};

export type BusSensorRuntimeChannelState = {
  id: SensorChannelKind;
  label: string;
  unit: SensorPackageSdkChannel['unit'];
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
  sensorPackage: SensorPackageKind;
  busId: string;
  busLabel: string;
  address: number;
  nativeRenodePath: string | null;
  channels: Record<string, BusSensorRuntimeChannelState>;
  transactionCount: number;
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
  path: string;
  sensorPackage: SensorPackageKind;
  channels: NativeSensorControlChannelRequest[];
};

export type BusSensorBrokerTransaction = SensorProtocolBrokerTransaction;

/**
 * Narrows the generic protocol runtime device into a sensor runtime device.
 * Sensor panels need SDK channels and codec metadata, so this adapter is the
 * bridge from "I2C device discovered" to "render sliders and decode reads".
 */
function createRuntimeSensorDevice(device: ProtocolRuntimeDevice): RuntimeBusSensorDevice[] {
  if (device.protocol !== 'i2c' || !isSensorPackageKind(device.sensorPackage)) {
    return [];
  }

  const sensorPackage = getSensorPackageSdk(device.sensorPackage);
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
      sensorPackage: device.sensorPackage,
      sensorPackageTitle: device.sensorPackageTitle,
      sensorPackageSdkSchemaVersion: device.sensorPackageSdkSchemaVersion,
      nativeControlTransport: device.nativeControlTransport,
      controlChannels: device.controlChannels,
      nativeRenodeName: device.nativeRenodeName,
      nativeRenodePath: device.nativeRenodePath,
      busId: device.busId ?? 'i2c:visual',
      busLabel: device.busLabel ?? 'I2C Visual Bus',
      package: sensorPackage,
      channels: sensorPackage.channels,
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

function createChannelState(channel: SensorPackageSdkChannel): BusSensorRuntimeChannelState {
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
  return getSensorProtocolCodec(device.package.busRuntime.transactionCodec).createInitialState(
    device.address ?? device.package.protocol.defaultAddress
  );
}

function createDeviceState(device: RuntimeBusSensorDevice): BusSensorRuntimeDeviceState {
  return {
    schemaVersion: BUS_SENSOR_RUNTIME_SCHEMA_VERSION,
    deviceId: device.id,
    componentId: device.componentId,
    label: device.label,
    sensorPackage: device.sensorPackage,
    busId: device.busId,
    busLabel: device.busLabel,
    address: device.address ?? device.package.protocol.defaultAddress,
    nativeRenodePath: device.nativeRenodePath ?? null,
    channels: Object.fromEntries(device.channels.map((channel) => [channel.id, createChannelState(channel)])),
    transactionCount: 0,
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
    path: device.nativeRenodePath,
    sensorPackage: device.sensorPackage,
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
  Object.entries(values).forEach(([channelId, value]) => {
    const channel = channels[channelId];
    if (!channel || value === null || typeof value === 'undefined') {
      return;
    }
    channels[channelId] = {
      ...channel,
      configuredValue: clamp(value, channel.minimum, channel.maximum),
      lastReadValue: clamp(value, channel.minimum, channel.maximum),
    };
  });

  return {
    ...state,
    devices: {
      ...state.devices,
      [deviceId]: {
        ...device,
        channels,
      },
    },
  };
}

function applyCodecRuntimeEvent(
  runtimeDevice: RuntimeBusSensorDevice,
  device: BusSensorRuntimeDeviceState,
  event: RuntimeBusTimelineEvent
): BusSensorRuntimeDeviceState {
  const result = getSensorProtocolCodec(runtimeDevice.package.busRuntime.transactionCodec).applyEvent({
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
  return getSensorProtocolCodec(device.package.busRuntime.transactionCodec).createReadTransactions({
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
  const suffix = channel.unit === 'celsius' ? ' C' : channel.unit === 'percent-rh' ? ' %RH' : '';
  return `${value.toFixed(channel.precision)}${suffix}`;
}
