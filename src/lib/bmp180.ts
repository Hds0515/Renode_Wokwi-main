import type { RuntimeBusTimelineEvent } from './runtime-timeline';

export const BMP180_DEFAULT_ADDRESS = 0x77;
export const BMP180_MIN_TEMPERATURE_C = -40;
export const BMP180_MAX_TEMPERATURE_C = 85;
export const BMP180_MIN_UNCOMPENSATED_PRESSURE = 300;
export const BMP180_MAX_UNCOMPENSATED_PRESSURE = 1100;

export type Bmp180MeasurementKind = 'temperature' | 'pressure';
export type Bmp180Command = Bmp180MeasurementKind | 'register-pointer' | 'unknown';

export type Bmp180State = {
  address: number;
  model: 'BMP180';
  lastCommand: Bmp180Command | null;
  lastReadTemperatureC: number | null;
  lastReadPressureRaw: number | null;
  updatedAtVirtualTimeNs: number | null;
  transactionCount: number;
};

export type Bmp180BrokerTransaction = {
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

export function createBmp180State(address = BMP180_DEFAULT_ADDRESS): Bmp180State {
  return {
    address,
    model: 'BMP180',
    lastCommand: null,
    lastReadTemperatureC: null,
    lastReadPressureRaw: null,
    updatedAtVirtualTimeNs: null,
    transactionCount: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function encodeTemperature(temperatureC: number): number[] {
  const raw = Math.round((clamp(temperatureC, BMP180_MIN_TEMPERATURE_C, BMP180_MAX_TEMPERATURE_C) + 40) * 10);
  return [(raw >> 8) & 0xff, raw & 0xff];
}

function decodeTemperature(bytes: number[]): number {
  const raw = (((bytes[0] ?? 0) & 0xff) << 8) | ((bytes[1] ?? 0) & 0xff);
  return raw / 10 - 40;
}

function encodePressureRaw(pressureRaw: number): number[] {
  const raw = Math.round(clamp(pressureRaw, BMP180_MIN_UNCOMPENSATED_PRESSURE, BMP180_MAX_UNCOMPENSATED_PRESSURE));
  return [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
}

function decodePressureRaw(bytes: number[]): number {
  return (((bytes[0] ?? 0) & 0xff) << 16) | (((bytes[1] ?? 0) & 0xff) << 8) | ((bytes[2] ?? 0) & 0xff);
}

function classifyWrite(bytes: number[]): Bmp180Command {
  if (bytes[0] === 0xf4 && bytes[1] === 0x2e) {
    return 'temperature';
  }
  if (bytes[0] === 0xf4 && bytes[1] === 0x34) {
    return 'pressure';
  }
  if (bytes[0] === 0xf6) {
    return 'register-pointer';
  }
  return 'unknown';
}

export function createBmp180MeasurementTransactions(options: {
  busId: string;
  busLabel: string;
  componentId: string;
  address?: number;
  temperatureC: number;
  pressureRaw: number;
  kind: Bmp180MeasurementKind;
}): Bmp180BrokerTransaction[] {
  const address = options.address ?? BMP180_DEFAULT_ADDRESS;
  const isTemperature = options.kind === 'temperature';
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
      data: [0xf4, isTemperature ? 0x2e : 0x34],
    },
    {
      protocol: 'i2c',
      source: 'ui',
      status: 'data',
      busId: options.busId,
      busLabel: options.busLabel,
      peripheralName: options.componentId,
      direction: 'write',
      address,
      data: [0xf6],
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
      data: isTemperature ? encodeTemperature(options.temperatureC) : encodePressureRaw(options.pressureRaw),
    },
  ];
}

export function applyBmp180Transaction(state: Bmp180State, event: RuntimeBusTimelineEvent): Bmp180State {
  if (event.protocol !== 'i2c' || event.address !== state.address) {
    return state;
  }

  if (event.direction === 'write') {
    const command = classifyWrite(event.payload.bytes);
    return {
      ...state,
      lastCommand: command === 'register-pointer' ? state.lastCommand : command,
      updatedAtVirtualTimeNs: event.clock.virtualTimeNs,
      transactionCount: state.transactionCount + 1,
    };
  }

  if (event.direction !== 'read' || event.payload.bytes.length < 2) {
    return state;
  }

  const nextState = {
    ...state,
    updatedAtVirtualTimeNs: event.clock.virtualTimeNs,
    transactionCount: state.transactionCount + 1,
  };

  if (state.lastCommand === 'temperature') {
    return {
      ...nextState,
      lastReadTemperatureC: decodeTemperature(event.payload.bytes),
    };
  }

  if (state.lastCommand === 'pressure') {
    return {
      ...nextState,
      lastReadPressureRaw: decodePressureRaw(event.payload.bytes),
    };
  }

  return nextState;
}
