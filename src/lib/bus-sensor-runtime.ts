/**
 * Reusable runtime adapter for bus-connected sensors.
 *
 * Runtime bus manifests describe which sensor packages are connected to which
 * bus. This module turns that manifest into UI state, native Renode control
 * requests, and transaction read/parse helpers. SI70xx is the first codec.
 */
import type { RuntimeBusManifestEntry, RuntimeBusTimelineEvent } from './runtime-timeline';
import {
  getSensorPackageSdk,
  isSensorPackageKind,
} from './sensor-packages';
import type { SensorChannelKind, SensorPackageKind, SensorPackageSdk, SensorPackageSdkChannel } from './sensor-packages';
import {
  SI7021_DEFAULT_ADDRESS,
  applySi70xxTransaction,
  createSi70xxMeasurementTransactions,
  createSi70xxState,
} from './si70xx';
import type { Si70xxMeasurementKind, Si70xxState } from './si70xx';

export const BUS_SENSOR_RUNTIME_SCHEMA_VERSION = 1;

export type RuntimeBusSensorDevice = NonNullable<RuntimeBusManifestEntry['devices']>[number] & {
  busId: string;
  busLabel: string;
  sensorPackage: SensorPackageKind;
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
  protocolState: Si70xxState | null;
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

export type BusSensorBrokerTransaction = {
  protocol: 'i2c';
  source: 'ui';
  status: 'data';
  busId: string;
  busLabel: string;
  peripheralName: string;
  direction: 'read' | 'write';
  address: number;
  data: number[];
};

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

function createProtocolState(device: RuntimeBusSensorDevice): Si70xxState | null {
  if (device.package.busRuntime.transactionCodec !== 'si70xx-compatible') {
    return null;
  }
  return createSi70xxState(device.address ?? SI7021_DEFAULT_ADDRESS);
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
  return busManifest.flatMap((entry) => {
    if (entry.protocol !== 'i2c' || !Array.isArray(entry.devices)) {
      return [];
    }

    return entry.devices.flatMap((device): RuntimeBusSensorDevice[] => {
      if (!isSensorPackageKind(device.sensorPackage)) {
        return [];
      }
      const sensorPackage = getSensorPackageSdk(device.sensorPackage);
      return [
        {
          ...device,
          busId: entry.id,
          busLabel: entry.label,
          sensorPackage: device.sensorPackage,
          package: sensorPackage,
          channels: sensorPackage.channels,
        },
      ];
    });
  });
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

function applySi70xxRuntimeEvent(
  device: BusSensorRuntimeDeviceState,
  event: RuntimeBusTimelineEvent
): BusSensorRuntimeDeviceState {
  const protocolState = applySi70xxTransaction(device.protocolState ?? createSi70xxState(device.address), event);
  const channels = { ...device.channels };
  if (channels.temperature && protocolState.lastReadTemperatureC !== null) {
    channels.temperature = {
      ...channels.temperature,
      lastReadValue: protocolState.lastReadTemperatureC,
    };
  }
  if (channels.humidity && protocolState.lastReadHumidityPercent !== null) {
    channels.humidity = {
      ...channels.humidity,
      lastReadValue: protocolState.lastReadHumidityPercent,
    };
  }

  return {
    ...device,
    channels,
    protocolState,
    transactionCount: protocolState.transactionCount,
    updatedAtVirtualTimeNs: protocolState.updatedAtVirtualTimeNs,
  };
}

export function applyBusSensorRuntimeEvent(
  state: BusSensorRuntimeState,
  event: RuntimeBusTimelineEvent,
  devices: readonly RuntimeBusSensorDevice[]
): BusSensorRuntimeState {
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

    if (runtimeDevice.package.busRuntime.transactionCodec === 'si70xx-compatible') {
      nextDevices[deviceId] = applySi70xxRuntimeEvent(device, event);
      changed = true;
    }
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
  if (device.package.busRuntime.transactionCodec !== 'si70xx-compatible') {
    return [];
  }
  if (channelId !== 'temperature' && channelId !== 'humidity') {
    return [];
  }

  return createSi70xxMeasurementTransactions({
    busId: device.busId,
    busLabel: device.busLabel,
    componentId: device.componentId,
    address: device.address ?? device.package.protocol.defaultAddress,
    temperatureC: state.channels.temperature?.configuredValue ?? 24,
    humidityPercent: state.channels.humidity?.configuredValue ?? 45,
    kind: channelId as Si70xxMeasurementKind,
  });
}

export function formatSensorChannelValue(channel: BusSensorRuntimeChannelState, value: number | null): string {
  if (value === null) {
    return 'none';
  }
  const suffix = channel.unit === 'celsius' ? ' C' : channel.unit === 'percent-rh' ? ' %RH' : '';
  return `${value.toFixed(channel.precision)}${suffix}`;
}
