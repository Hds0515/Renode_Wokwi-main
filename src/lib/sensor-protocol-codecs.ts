/**
 * Sensor protocol codec registry.
 *
 * A sensor package declares what protocol codec it needs; this registry owns
 * the codec implementations. Adding a new I2C/SPI sensor should normally mean:
 * 1. add a codec here or in a sibling module,
 * 2. point the Device/Sensor Package at that codec,
 * 3. let Bus Sensor Runtime render controls and decode events generically.
 */
import type { RuntimeBusTimelineEvent } from './runtime-timeline';
import type { SensorChannelKind, SensorTransactionCodec } from './sensor-packages';
import {
  SI7021_DEFAULT_ADDRESS,
  Si70xxMeasurementKind,
  Si70xxState,
  applySi70xxTransaction,
  createSi70xxMeasurementTransactions,
  createSi70xxState,
} from './si70xx';

export const SENSOR_PROTOCOL_CODEC_REGISTRY_SCHEMA_VERSION = 1;

export type SensorProtocolBrokerTransaction = {
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

export type SensorProtocolChannelRuntimeInput = {
  configuredValue: number;
};

export type SensorProtocolApplyResult = {
  state: unknown;
  readings: Record<SensorChannelKind, number | null | undefined>;
  transactionCount: number;
  updatedAtVirtualTimeNs: number | null;
};

export type SensorProtocolCodec = {
  id: SensorTransactionCodec;
  protocol: 'i2c';
  family: string;
  description: string;
  supportedChannels: readonly SensorChannelKind[];
  createInitialState: (address: number) => unknown;
  applyEvent: (options: {
    state: unknown | null;
    address: number;
    event: RuntimeBusTimelineEvent;
  }) => SensorProtocolApplyResult;
  createReadTransactions: (options: {
    busId: string;
    busLabel: string;
    componentId: string;
    address: number;
    channelId: SensorChannelKind;
    channels: Readonly<Record<string, SensorProtocolChannelRuntimeInput | undefined>>;
  }) => SensorProtocolBrokerTransaction[];
};

function asSi70xxState(state: unknown | null, address: number): Si70xxState {
  if (state && typeof state === 'object' && (state as Si70xxState).model === 'SI7021') {
    return state as Si70xxState;
  }
  return createSi70xxState(address || SI7021_DEFAULT_ADDRESS);
}

export const SI70XX_SENSOR_PROTOCOL_CODEC: SensorProtocolCodec = {
  id: 'si70xx-compatible',
  protocol: 'i2c',
  family: 'Silicon Labs SI70xx',
  description: 'Decodes SI7021/SI70xx temperature and humidity command/read transactions.',
  supportedChannels: ['temperature', 'humidity'],
  createInitialState: (address) => createSi70xxState(address || SI7021_DEFAULT_ADDRESS),
  applyEvent: ({ state, address, event }) => {
    const next = applySi70xxTransaction(asSi70xxState(state, address), event);
    return {
      state: next,
      readings: {
        temperature: next.lastReadTemperatureC,
        humidity: next.lastReadHumidityPercent,
      },
      transactionCount: next.transactionCount,
      updatedAtVirtualTimeNs: next.updatedAtVirtualTimeNs,
    };
  },
  createReadTransactions: ({ busId, busLabel, componentId, address, channelId, channels }) => {
    if (channelId !== 'temperature' && channelId !== 'humidity') {
      return [];
    }

    return createSi70xxMeasurementTransactions({
      busId,
      busLabel,
      componentId,
      address,
      temperatureC: channels.temperature?.configuredValue ?? 24,
      humidityPercent: channels.humidity?.configuredValue ?? 45,
      kind: channelId as Si70xxMeasurementKind,
    });
  },
};

export const SENSOR_PROTOCOL_CODECS = [SI70XX_SENSOR_PROTOCOL_CODEC] as const satisfies readonly SensorProtocolCodec[];

const SENSOR_PROTOCOL_CODEC_MAP = new Map<SensorTransactionCodec, SensorProtocolCodec>(
  SENSOR_PROTOCOL_CODECS.map((codec) => [codec.id, codec])
);

export function findSensorProtocolCodec(codecId: unknown): SensorProtocolCodec | null {
  return typeof codecId === 'string' && SENSOR_PROTOCOL_CODEC_MAP.has(codecId as SensorTransactionCodec)
    ? SENSOR_PROTOCOL_CODEC_MAP.get(codecId as SensorTransactionCodec) ?? null
    : null;
}

export function getSensorProtocolCodec(codecId: SensorTransactionCodec): SensorProtocolCodec {
  const codec = findSensorProtocolCodec(codecId);
  if (!codec) {
    throw new Error(`Unknown sensor protocol codec: ${codecId}`);
  }
  return codec;
}
