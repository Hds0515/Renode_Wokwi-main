import type { RuntimeBusTimelineEvent } from './runtime-timeline';

export const SI7021_DEFAULT_ADDRESS = 0x40;
export const SI7021_MODEL_ID = 0x15;
export const SI70XX_MIN_TEMPERATURE_C = -40;
export const SI70XX_MAX_TEMPERATURE_C = 85;
export const SI70XX_MIN_HUMIDITY_PERCENT = 0;
export const SI70XX_MAX_HUMIDITY_PERCENT = 100;

export type Si70xxCommand = 'measure-humidity' | 'measure-temperature' | 'read-electronic-id' | 'reset' | 'unknown';

export type Si70xxState = {
  address: number;
  model: 'SI7021';
  configuredTemperatureC: number;
  configuredHumidityPercent: number;
  lastReadTemperatureC: number | null;
  lastReadHumidityPercent: number | null;
  lastCommand: Si70xxCommand | null;
  lastCommandByte: number | null;
  updatedAtVirtualTimeNs: number | null;
  transactionCount: number;
};

/**
 * SI70xx protocol helpers.
 *
 * These helpers encode and decode SI7021/SI70xx-style temperature/humidity
 * values. Validation scripts and the reusable Bus Sensor Runtime share this
 * protocol behavior.
 */
export type Si70xxMeasurementKind = 'temperature' | 'humidity';

export type Si70xxBrokerTransaction = {
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

export function createSi70xxState(address = SI7021_DEFAULT_ADDRESS): Si70xxState {
  return {
    address,
    model: 'SI7021',
    configuredTemperatureC: 24,
    configuredHumidityPercent: 45,
    lastReadTemperatureC: null,
    lastReadHumidityPercent: null,
    lastCommand: null,
    lastCommandByte: null,
    updatedAtVirtualTimeNs: null,
    transactionCount: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function rawToBytes(raw: number): number[] {
  const normalized = Math.round(raw) & 0xffff;
  return [(normalized >> 8) & 0xff, normalized & 0xff];
}

function bytesToRaw(bytes: number[]): number {
  return (((bytes[0] ?? 0) & 0xff) << 8) | ((bytes[1] ?? 0) & 0xff);
}

export function encodeSi70xxHumidity(humidityPercent: number): number[] {
  const humidity = clamp(humidityPercent, SI70XX_MIN_HUMIDITY_PERCENT, SI70XX_MAX_HUMIDITY_PERCENT);
  return rawToBytes(((humidity + 6) * 65536) / 125);
}

export function decodeSi70xxHumidity(bytes: number[]): number {
  return (bytesToRaw(bytes) * 125) / 65536 - 6;
}

export function encodeSi70xxTemperature(temperatureC: number): number[] {
  const temperature = clamp(temperatureC, SI70XX_MIN_TEMPERATURE_C, SI70XX_MAX_TEMPERATURE_C);
  return rawToBytes(((temperature + 46.85) * 65536) / 175.72);
}

export function decodeSi70xxTemperature(bytes: number[]): number {
  return (bytesToRaw(bytes) * 175.72) / 65536 - 46.85;
}

export function classifySi70xxCommand(bytes: number[]): Si70xxCommand {
  const first = bytes[0];
  const second = bytes[1];
  if (first === 0xe5 || first === 0xf5) {
    return 'measure-humidity';
  }
  if (first === 0xe0 || first === 0xe3 || first === 0xf3) {
    return 'measure-temperature';
  }
  if ((first === 0xfa && second === 0x0f) || (first === 0xfc && second === 0xc9)) {
    return 'read-electronic-id';
  }
  if (first === 0xfe) {
    return 'reset';
  }
  return 'unknown';
}

export function createSi70xxMeasurementTransactions(options: {
  busId: string;
  busLabel: string;
  componentId: string;
  address?: number;
  temperatureC: number;
  humidityPercent: number;
  kind: Si70xxMeasurementKind;
}): Si70xxBrokerTransaction[] {
  const address = options.address ?? SI7021_DEFAULT_ADDRESS;
  const isHumidity = options.kind === 'humidity';
  return [
    {
      protocol: 'i2c',
      source: 'ui',
      status: 'data',
      busId: options.busId,
      busLabel: options.busLabel,
      peripheralName: options.componentId,
      direction: 'write',
      address,
      data: [isHumidity ? 0xe5 : 0xe3],
    },
    {
      protocol: 'i2c',
      source: 'ui',
      status: 'data',
      busId: options.busId,
      busLabel: options.busLabel,
      peripheralName: options.componentId,
      direction: 'read',
      address,
      data: isHumidity ? encodeSi70xxHumidity(options.humidityPercent) : encodeSi70xxTemperature(options.temperatureC),
    },
  ];
}

export function applySi70xxTransaction(state: Si70xxState, event: RuntimeBusTimelineEvent): Si70xxState {
  if (event.protocol !== 'i2c' || event.address !== state.address) {
    return state;
  }

  const bytes = event.payload.bytes;
  if (bytes.length === 0) {
    return state;
  }

  if (event.direction === 'write') {
    const command = classifySi70xxCommand(bytes);
    return {
      ...state,
      lastCommand: command,
      lastCommandByte: bytes[0] ?? null,
      updatedAtVirtualTimeNs: event.clock.virtualTimeNs,
      transactionCount: state.transactionCount + 1,
    };
  }

  if (event.direction !== 'read' || bytes.length < 2) {
    return state;
  }

  const nextState = {
    ...state,
    updatedAtVirtualTimeNs: event.clock.virtualTimeNs,
    transactionCount: state.transactionCount + 1,
  };

  if (state.lastCommand === 'measure-humidity') {
    return {
      ...nextState,
      lastReadHumidityPercent: decodeSi70xxHumidity(bytes),
    };
  }

  if (state.lastCommand === 'measure-temperature') {
    return {
      ...nextState,
      lastReadTemperatureC: decodeSi70xxTemperature(bytes),
    };
  }

  return nextState;
}
