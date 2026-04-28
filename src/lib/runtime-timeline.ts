/**
 * Unified runtime event timeline.
 *
 * Electron emits GPIO, UART, I2C/SPI, sensor, and clock events in slightly
 * different shapes. This module normalizes them for timeline panels, logic
 * analysis, bus transaction views, OLED previews, and sensor controls.
 */
import type { BoardSchema } from './boards';
import { getComponentPackage } from './component-packs';
import { getDevicePackageForTemplate } from './device-packages';
import type { DemoPeripheralTemplateKind } from './firmware';
import type { CircuitNetlist } from './netlist';
import type { SignalDirection, SignalLevel, SignalSampleSource } from './signal-broker';
import {
  buildRenodeSensorPath,
  buildRenodeSensorPeripheralName,
  findSensorPackage,
  getSensorPackageSdk,
} from './sensor-packages';
import type { SensorPackageKind } from './sensor-packages';

export const SIMULATION_CLOCK_SCHEMA_VERSION = 1;
export const RUNTIME_TIMELINE_SCHEMA_VERSION = 1;
export const DEFAULT_RUNTIME_TIMELINE_EVENT_LIMIT = 180;

export type RuntimeProtocol = 'gpio' | 'uart' | 'i2c' | 'spi';
export type SimulationClockSyncMode = 'host-estimated' | 'renode-virtual' | 'external';
export type RuntimeTimelineSource = SignalSampleSource | 'debugger' | 'uart' | 'i2c' | 'spi';
export type BusTransactionDirection = 'rx' | 'tx' | 'read' | 'write' | 'transfer' | 'system';
export type RuntimeBusManifestStatus = 'active' | 'planned';
export type RuntimeBusEndpointRole = 'tx' | 'rx' | 'scl' | 'sda' | 'sck' | 'miso' | 'mosi' | 'cs';

export type SimulationClockSnapshot = {
  schemaVersion: typeof SIMULATION_CLOCK_SCHEMA_VERSION;
  sequence: number;
  wallTimeMs: number;
  virtualTimeNs: number;
  virtualTimeMs: number;
  elapsedWallMs: number;
  syncMode: SimulationClockSyncMode;
  timeScale: number;
  paused: boolean;
};

export type RuntimeBusManifestEndpoint = {
  role: RuntimeBusEndpointRole;
  padId: string | null;
  mcuPinId: string | null;
  label: string;
};

export type RuntimeBusDeviceManifestEntry = {
  id: string;
  componentId: string;
  componentKind: string;
  devicePackageKind?: string;
  devicePackageSchemaVersion?: number;
  label: string;
  address: number | null;
  model: string;
  sensorPackage?: SensorPackageKind;
  sensorPackageTitle?: string;
  sensorPackageSdkSchemaVersion?: number;
  nativeControlTransport?: string | null;
  controlChannels?: Array<{
    id: string;
    label: string;
    unit: string;
    renodeProperty: string;
    minimum: number;
    maximum: number;
    step: number;
  }>;
  nativeRenodeName?: string | null;
  nativeRenodePath?: string | null;
};

export type RuntimeBusManifestEntry = {
  schemaVersion: typeof RUNTIME_TIMELINE_SCHEMA_VERSION;
  id: string;
  protocol: Exclude<RuntimeProtocol, 'gpio'>;
  label: string;
  renodePeripheralName: string | null;
  status: RuntimeBusManifestStatus;
  adapter: 'socket-terminal' | 'transaction-broker-planned';
  endpoints: RuntimeBusManifestEndpoint[];
  devices?: RuntimeBusDeviceManifestEntry[];
};

export type RuntimeTimelineBaseEvent = {
  schemaVersion: typeof RUNTIME_TIMELINE_SCHEMA_VERSION;
  id: string;
  protocol: RuntimeProtocol;
  source: RuntimeTimelineSource;
  clock: SimulationClockSnapshot;
  summary: string;
};

export type RuntimeGpioTimelineEvent = RuntimeTimelineBaseEvent & {
  protocol: 'gpio';
  kind: 'gpio-sample';
  signalId: string;
  peripheralId: string;
  label: string;
  direction: SignalDirection;
  value: SignalLevel;
  changed: boolean;
  netId: string | null;
  componentId: string | null;
  pinId: string | null;
  padId: string | null;
  mcuPinId: string | null;
};

export type RuntimeBusTimelineEvent = RuntimeTimelineBaseEvent & {
  protocol: Exclude<RuntimeProtocol, 'gpio'>;
  kind: 'bus-transaction';
  busId: string;
  busLabel: string;
  renodePeripheralName: string | null;
  direction: BusTransactionDirection;
  status: 'data' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'planned';
  address: number | null;
  payload: {
    bytes: number[];
    text: string | null;
    bitLength: number;
    truncated: boolean;
  };
};

export type RuntimeTimelineEvent = RuntimeGpioTimelineEvent | RuntimeBusTimelineEvent;

export type RuntimeTimelineState = {
  schemaVersion: typeof RUNTIME_TIMELINE_SCHEMA_VERSION;
  startedAtWallTimeMs: number;
  lastClock: SimulationClockSnapshot;
  events: RuntimeTimelineEvent[];
  protocolCounts: Record<RuntimeProtocol, number>;
  busTransactionCount: number;
  gpioEventCount: number;
};

export type RuntimeTimelineSummary = {
  eventCount: number;
  gpioEventCount: number;
  busTransactionCount: number;
  lastVirtualTimeMs: number;
  lastSequence: number;
  activeProtocolCount: number;
};

function createInitialClock(nowMs: number): SimulationClockSnapshot {
  return {
    schemaVersion: SIMULATION_CLOCK_SCHEMA_VERSION,
    sequence: 0,
    wallTimeMs: nowMs,
    virtualTimeNs: 0,
    virtualTimeMs: 0,
    elapsedWallMs: 0,
    syncMode: 'host-estimated',
    timeScale: 1,
    paused: false,
  };
}

function emptyProtocolCounts(): Record<RuntimeProtocol, number> {
  return {
    gpio: 0,
    uart: 0,
    i2c: 0,
    spi: 0,
  };
}

function normalizeBusId(protocol: Exclude<RuntimeProtocol, 'gpio'>, value: string): string {
  return `${protocol}:${value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
}

function findPadByMcuPin(board: BoardSchema, mcuPinId: string | null | undefined) {
  if (!mcuPinId) {
    return null;
  }
  return board.connectors.all.flatMap((connector) => connector.pins).find((pad) => pad.mcuPinId === mcuPinId) ?? null;
}

function formatEndpointLabel(role: RuntimeBusEndpointRole, mcuPinId: string | null): string {
  return `${role.toUpperCase()}${mcuPinId ? ` ${mcuPinId}` : ''}`;
}

function createUartManifestEntry(board: BoardSchema): RuntimeBusManifestEntry | null {
  const uart = board.runtime.uart;
  if (!uart) {
    return null;
  }

  const txPad = findPadByMcuPin(board, uart.txPinId);
  const rxPad = findPadByMcuPin(board, uart.rxPinId);

  return {
    schemaVersion: RUNTIME_TIMELINE_SCHEMA_VERSION,
    id: normalizeBusId('uart', uart.peripheralName),
    protocol: 'uart',
    label: uart.displayName,
    renodePeripheralName: uart.peripheralName,
    status: 'active',
    adapter: 'socket-terminal',
    endpoints: [
      {
        role: 'tx',
        padId: txPad?.id ?? null,
        mcuPinId: uart.txPinId ?? null,
        label: formatEndpointLabel('tx', uart.txPinId ?? null),
      },
      {
        role: 'rx',
        padId: rxPad?.id ?? null,
        mcuPinId: uart.rxPinId ?? null,
        label: formatEndpointLabel('rx', uart.rxPinId ?? null),
      },
    ],
  };
}

function inferI2cBusIdFromPad(board: BoardSchema, padId: string | null | undefined): string | null {
  if (!padId) {
    return null;
  }
  const pad = board.connectors.all.flatMap((connector) => connector.pins).find((candidate) => candidate.id === padId);
  if (!pad) {
    return null;
  }
  const descriptor = `${pad.pinLabel} ${pad.signalName ?? ''}`.toUpperCase();
  const busMatch = /I2C(\d*)/.exec(descriptor);
  return busMatch ? normalizeBusId('i2c', `i2c${busMatch[1] || ''}`) : null;
}

function getRenodePeripheralNameFromBusId(protocol: 'i2c' | 'spi', busId: string): string | null {
  const prefix = `${protocol}:`;
  if (!busId.startsWith(prefix)) {
    return null;
  }
  const candidate = busId.slice(prefix.length).trim().toLowerCase();
  return /^[a-z][a-z0-9_]*$/.test(candidate) ? candidate : null;
}

function collectBusManifestEntries(
  board: BoardSchema,
  protocol: 'i2c' | 'spi'
): RuntimeBusManifestEntry[] {
  const rolesByBus = new Map<string, RuntimeBusManifestEndpoint[]>();
  const pads = board.connectors.selectablePads;

  pads.forEach((pad) => {
    const descriptor = `${pad.pinLabel} ${pad.signalName ?? ''}`.toUpperCase();
    const busMatch = protocol === 'i2c' ? /I2C(\d*)/.exec(descriptor) : /SPI(\d*)/.exec(descriptor);
    if (!busMatch) {
      return;
    }

    const role =
      protocol === 'i2c'
        ? descriptor.includes('SCL')
          ? 'scl'
          : descriptor.includes('SDA')
            ? 'sda'
            : null
        : descriptor.includes('SCK')
          ? 'sck'
          : descriptor.includes('MISO')
            ? 'miso'
            : descriptor.includes('MOSI')
              ? 'mosi'
              : null;

    if (!role) {
      return;
    }

    const rawBusId = `${protocol}${busMatch[1] || ''}`;
    const busId = normalizeBusId(protocol, rawBusId);
    const endpoints = rolesByBus.get(busId) ?? [];
    endpoints.push({
      role,
      padId: pad.id,
      mcuPinId: pad.mcuPinId,
      label: `${role.toUpperCase()} ${pad.pinLabel}`,
    });
    rolesByBus.set(busId, endpoints);
  });

  return [...rolesByBus.entries()]
    .map(([id, endpoints]) => ({
      schemaVersion: RUNTIME_TIMELINE_SCHEMA_VERSION as typeof RUNTIME_TIMELINE_SCHEMA_VERSION,
      id,
      protocol,
      label: id.replace(':', ' ').toUpperCase(),
      renodePeripheralName: null,
      status: 'planned' as RuntimeBusManifestStatus,
      adapter: 'transaction-broker-planned' as const,
      endpoints: endpoints.sort((left, right) => left.role.localeCompare(right.role)),
      devices: [],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function collectI2cDevicesFromNetlist(board: BoardSchema, netlist: CircuitNetlist | null | undefined): Map<string, RuntimeBusDeviceManifestEntry[]> {
  const devicesByBusId = new Map<string, RuntimeBusDeviceManifestEntry[]>();
  if (!netlist) {
    return devicesByBusId;
  }

  netlist.components
    .filter((component) => {
      if (component.kind === 'board') {
        return false;
      }
      const templateKind = component.kind as DemoPeripheralTemplateKind;
      const runtime = getComponentPackage(templateKind).runtime;
      return runtime.type === 'renode-i2c-broker';
    })
    .forEach((component) => {
      const templateKind = component.kind as DemoPeripheralTemplateKind;
      const runtime = getComponentPackage(templateKind).runtime;
      if (runtime.type !== 'renode-i2c-broker') {
        return;
      }
      const sensorPackage = findSensorPackage(templateKind);
      const sensorPackageSdk = sensorPackage ? getSensorPackageSdk(sensorPackage.kind) : null;
      const devicePackage = getDevicePackageForTemplate(templateKind);
      const model = runtime.model ?? 'generic-i2c';
      const sclNet = netlist.nets.find(
        (net) => net.kind === 'i2c' && net.connections.some((connection) => connection.componentId === component.id && connection.pinId === 'scl')
      );
      const sdaNet = netlist.nets.find(
        (net) => net.kind === 'i2c' && net.connections.some((connection) => connection.componentId === component.id && connection.pinId === 'sda')
      );
      const busId =
        inferI2cBusIdFromPad(board, sclNet?.metadata?.padId) ??
        inferI2cBusIdFromPad(board, sdaNet?.metadata?.padId) ??
        normalizeBusId('i2c', 'visual');
      const nativeRenodeName = sensorPackage ? buildRenodeSensorPeripheralName(sensorPackage.kind, component.id) : null;
      const renodeBusName = getRenodePeripheralNameFromBusId('i2c', busId);
      const devices = devicesByBusId.get(busId) ?? [];
      devices.push({
        id: `${component.id}:${model}`,
        componentId: component.id,
        componentKind: component.kind,
        devicePackageKind: devicePackage.kind,
        devicePackageSchemaVersion: devicePackage.schemaVersion,
        label: component.label,
        address: sensorPackage ? sensorPackage.native.defaultAddress : runtime.type === 'renode-i2c-broker' ? runtime.address : null,
        model,
        sensorPackage: sensorPackage?.kind,
        sensorPackageTitle: sensorPackageSdk?.title,
        sensorPackageSdkSchemaVersion: sensorPackageSdk?.schemaVersion,
        nativeControlTransport: sensorPackageSdk?.native.sdkControl.transport ?? null,
        controlChannels: sensorPackageSdk?.channels.map((channel) => ({
          id: channel.id,
          label: channel.label,
          unit: channel.unit,
          renodeProperty: channel.renodeProperty,
          minimum: channel.minimum,
          maximum: channel.maximum,
          step: channel.step,
        })),
        nativeRenodeName,
        nativeRenodePath:
          sensorPackage && renodeBusName && nativeRenodeName
            ? buildRenodeSensorPath(sensorPackage.kind, renodeBusName, nativeRenodeName)
            : null,
      });
      devicesByBusId.set(busId, devices);
    });

  return devicesByBusId;
}

export function createRuntimeBusManifest(board: BoardSchema, netlist?: CircuitNetlist | null): RuntimeBusManifestEntry[] {
  const devicesByBusId = collectI2cDevicesFromNetlist(board, netlist);
  const entries = [
    createUartManifestEntry(board),
    ...collectBusManifestEntries(board, 'i2c'),
    ...collectBusManifestEntries(board, 'spi'),
  ].filter((entry): entry is RuntimeBusManifestEntry => Boolean(entry));

  devicesByBusId.forEach((devices, busId) => {
    const entry = entries.find((candidate) => candidate.id === busId);
    if (entry) {
      entry.devices = [...(entry.devices ?? []), ...devices];
      return;
    }
    entries.push({
      schemaVersion: RUNTIME_TIMELINE_SCHEMA_VERSION,
      id: busId,
      protocol: 'i2c',
      label: busId.replace(':', ' ').toUpperCase(),
      renodePeripheralName: null,
      status: 'planned',
      adapter: 'transaction-broker-planned',
      endpoints: [],
      devices,
    });
  });

  return entries;
}

export function createRuntimeTimelineState(nowMs = Date.now()): RuntimeTimelineState {
  return {
    schemaVersion: RUNTIME_TIMELINE_SCHEMA_VERSION,
    startedAtWallTimeMs: nowMs,
    lastClock: createInitialClock(nowMs),
    events: [],
    protocolCounts: emptyProtocolCounts(),
    busTransactionCount: 0,
    gpioEventCount: 0,
  };
}

export function syncRuntimeTimelineClock(
  state: RuntimeTimelineState,
  clock: SimulationClockSnapshot
): RuntimeTimelineState {
  return {
    ...state,
    lastClock: clock.sequence >= state.lastClock.sequence ? clock : state.lastClock,
  };
}

export function recordRuntimeTimelineEvent(
  state: RuntimeTimelineState,
  event: RuntimeTimelineEvent,
  limit = DEFAULT_RUNTIME_TIMELINE_EVENT_LIMIT
): RuntimeTimelineState {
  const protocolCounts = {
    ...state.protocolCounts,
    [event.protocol]: (state.protocolCounts[event.protocol] ?? 0) + 1,
  };

  return {
    ...state,
    lastClock: event.clock.sequence >= state.lastClock.sequence ? event.clock : state.lastClock,
    events: [...state.events, event].slice(-limit),
    protocolCounts,
    busTransactionCount: state.busTransactionCount + (event.protocol === 'gpio' ? 0 : 1),
    gpioEventCount: state.gpioEventCount + (event.protocol === 'gpio' ? 1 : 0),
  };
}

export function summarizeRuntimeTimeline(state: RuntimeTimelineState): RuntimeTimelineSummary {
  return {
    eventCount: state.events.length,
    gpioEventCount: state.gpioEventCount,
    busTransactionCount: state.busTransactionCount,
    lastVirtualTimeMs: state.lastClock.virtualTimeMs,
    lastSequence: state.lastClock.sequence,
    activeProtocolCount: Object.values(state.protocolCounts).filter((count) => count > 0).length,
  };
}

export function formatVirtualTime(clock: SimulationClockSnapshot): string {
  if (clock.virtualTimeMs < 1000) {
    return `${clock.virtualTimeMs.toFixed(3)} ms`;
  }
  return `${(clock.virtualTimeMs / 1000).toFixed(3)} s`;
}
