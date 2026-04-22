import { CircuitNetlist } from './netlist';
import type { SimulationClockSnapshot } from './runtime-timeline';

export const SIGNAL_BROKER_SCHEMA_VERSION = 2;
export const DEFAULT_LOGIC_ANALYZER_WINDOW_MS = 6000;
export const DEFAULT_SIGNAL_SAMPLE_LIMIT = 480;

export type SignalDirection = 'input' | 'output';
export type SignalSampleSource = 'ui' | 'bridge' | 'renode' | 'system';
export type SignalLevel = 0 | 1;

export type SignalDefinition = {
  id: string;
  label: string;
  direction: SignalDirection;
  netId: string;
  componentId: string;
  pinId: string;
  peripheralId: string;
  endpointId: string | null;
  padId: string | null;
  mcuPinId: string | null;
  color: string;
};

export type RuntimeSignalManifestEntry = {
  schemaVersion: typeof SIGNAL_BROKER_SCHEMA_VERSION;
  id: string;
  peripheralId: string;
  label: string;
  direction: SignalDirection;
  netId: string;
  componentId: string;
  pinId: string;
  endpointId: string | null;
  padId: string | null;
  mcuPinId: string | null;
  color: string;
};

export type SignalSample = {
  id: string;
  signalId: string;
  value: SignalLevel;
  timestampMs: number;
  virtualTimeNs: number | null;
  sequence: number | null;
  source: SignalSampleSource;
};

export type SignalValue = {
  value: SignalLevel;
  timestampMs: number;
  virtualTimeNs: number | null;
  sequence: number | null;
  source: SignalSampleSource;
  lastChangedAtMs: number;
  lastChangedVirtualTimeNs: number | null;
};

export type SignalBrokerState = {
  schemaVersion: typeof SIGNAL_BROKER_SCHEMA_VERSION;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  definitions: SignalDefinition[];
  values: Record<string, SignalValue>;
  edgeCounts: Record<string, number>;
  samples: SignalSample[];
};

export type SignalBrokerSummary = {
  signalCount: number;
  inputCount: number;
  outputCount: number;
  sampleCount: number;
  edgeCount: number;
};

function normalizeSignalLevel(value: number | boolean): SignalLevel {
  return value === true || value === 1 ? 1 : 0;
}

function sampleId(signalId: string, timestampMs: number, source: SignalSampleSource): string {
  return `${signalId}:${Math.round(timestampMs)}:${source}`;
}

export function createSignalDefinitionsFromNetlist(netlist: CircuitNetlist): SignalDefinition[] {
  const componentById = new Map(netlist.components.map((component) => [component.id, component]));

  return netlist.nets
    .map((net): SignalDefinition | null => {
      const componentConnection = net.connections.find((connection) => connection.role === 'component-gpio');
      if (!componentConnection?.peripheralId) {
        return null;
      }

      const component = componentById.get(componentConnection.componentId);
      const pin = component?.pins.find((candidate) => candidate.id === componentConnection.pinId);
      if (!component || !pin) {
        return null;
      }

      return {
        id: `signal:${componentConnection.peripheralId}`,
        label: `${component.label} ${pin.label}`,
        direction: pin.direction === 'input' ? 'input' : 'output',
        netId: net.id,
        componentId: component.id,
        pinId: pin.id,
        peripheralId: componentConnection.peripheralId,
        endpointId: componentConnection.endpointId ?? null,
        padId: net.metadata?.padId ?? null,
        mcuPinId: net.metadata?.mcuPinId ?? null,
        color: pin.accentColor ?? '#22d3ee',
      };
    })
    .filter((definition): definition is SignalDefinition => Boolean(definition))
    .sort((left, right) => {
      if (left.direction !== right.direction) {
        return left.direction === 'input' ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });
}

export function createRuntimeSignalManifest(
  definitions: readonly SignalDefinition[]
): RuntimeSignalManifestEntry[] {
  return definitions.map((definition) => ({
    schemaVersion: SIGNAL_BROKER_SCHEMA_VERSION,
    id: definition.id,
    peripheralId: definition.peripheralId,
    label: definition.label,
    direction: definition.direction,
    netId: definition.netId,
    componentId: definition.componentId,
    pinId: definition.pinId,
    endpointId: definition.endpointId,
    padId: definition.padId,
    mcuPinId: definition.mcuPinId,
    color: definition.color,
  }));
}

export function createSignalBrokerState(
  definitions: readonly SignalDefinition[],
  nowMs = Date.now()
): SignalBrokerState {
  const values = Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      {
        value: 0 as SignalLevel,
        timestampMs: nowMs,
        virtualTimeNs: null,
        sequence: null,
        source: 'system' as SignalSampleSource,
        lastChangedAtMs: nowMs,
        lastChangedVirtualTimeNs: null,
      },
    ])
  );
  const edgeCounts = Object.fromEntries(definitions.map((definition) => [definition.id, 0]));

  return {
    schemaVersion: SIGNAL_BROKER_SCHEMA_VERSION,
    startedAtMs: nowMs,
    lastUpdatedAtMs: nowMs,
    definitions: [...definitions],
    values,
    edgeCounts,
    samples: definitions.map((definition) => ({
      id: sampleId(definition.id, nowMs, 'system'),
      signalId: definition.id,
      value: 0,
      timestampMs: nowMs,
      virtualTimeNs: null,
      sequence: null,
      source: 'system',
    })),
  };
}

export function summarizeSignalBroker(state: SignalBrokerState): SignalBrokerSummary {
  return {
    signalCount: state.definitions.length,
    inputCount: state.definitions.filter((definition) => definition.direction === 'input').length,
    outputCount: state.definitions.filter((definition) => definition.direction === 'output').length,
    sampleCount: state.samples.length,
    edgeCount: Object.values(state.edgeCounts).reduce((total, count) => total + count, 0),
  };
}

export function recordSignalSample(
  state: SignalBrokerState,
  request: {
    peripheralId: string;
    value: number | boolean;
    source: SignalSampleSource;
    timestampMs?: number;
    clock?: SimulationClockSnapshot;
    sampleLimit?: number;
  }
): SignalBrokerState {
  const definition = state.definitions.find((candidate) => candidate.peripheralId === request.peripheralId);
  if (!definition) {
    return state;
  }

  const timestampMs = request.clock?.wallTimeMs ?? request.timestampMs ?? Date.now();
  const virtualTimeNs = request.clock?.virtualTimeNs ?? null;
  const sequence = request.clock?.sequence ?? null;
  const value = normalizeSignalLevel(request.value);
  const previousValue = state.values[definition.id];
  const shouldAppend = !previousValue || previousValue.value !== value;
  const values = {
    ...state.values,
    [definition.id]: {
      value,
      timestampMs,
      virtualTimeNs,
      sequence,
      source: request.source,
      lastChangedAtMs: shouldAppend ? timestampMs : (previousValue?.lastChangedAtMs ?? timestampMs),
      lastChangedVirtualTimeNs: shouldAppend ? virtualTimeNs : (previousValue?.lastChangedVirtualTimeNs ?? virtualTimeNs),
    },
  };

  const edgeCounts = shouldAppend
    ? {
        ...state.edgeCounts,
        [definition.id]: (state.edgeCounts[definition.id] ?? 0) + 1,
      }
    : state.edgeCounts;
  const nextSamples = shouldAppend
    ? [
        ...state.samples,
        {
          id: sampleId(definition.id, timestampMs, request.source),
          signalId: definition.id,
          value,
          timestampMs,
          virtualTimeNs,
          sequence,
          source: request.source,
        },
      ].slice(-(request.sampleLimit ?? DEFAULT_SIGNAL_SAMPLE_LIMIT))
    : state.samples;

  return {
    ...state,
    lastUpdatedAtMs: Math.max(state.lastUpdatedAtMs, timestampMs),
    values,
    edgeCounts,
    samples: nextSamples,
  };
}

export function getSignalSamples(state: SignalBrokerState, signalId: string): SignalSample[] {
  return state.samples.filter((sample) => sample.signalId === signalId);
}

export function getSignalEdgeCount(state: SignalBrokerState, signalId: string): number {
  return state.edgeCounts[signalId] ?? 0;
}
