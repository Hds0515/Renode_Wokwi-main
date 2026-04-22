import { CircuitNetlist } from './netlist';

export const SIGNAL_BROKER_SCHEMA_VERSION = 1;
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

export type SignalSample = {
  id: string;
  signalId: string;
  value: SignalLevel;
  timestampMs: number;
  source: SignalSampleSource;
};

export type SignalValue = {
  value: SignalLevel;
  timestampMs: number;
  source: SignalSampleSource;
};

export type SignalBrokerState = {
  schemaVersion: typeof SIGNAL_BROKER_SCHEMA_VERSION;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  definitions: SignalDefinition[];
  values: Record<string, SignalValue>;
  samples: SignalSample[];
};

export type SignalBrokerSummary = {
  signalCount: number;
  inputCount: number;
  outputCount: number;
  sampleCount: number;
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
        source: 'system' as SignalSampleSource,
      },
    ])
  );

  return {
    schemaVersion: SIGNAL_BROKER_SCHEMA_VERSION,
    startedAtMs: nowMs,
    lastUpdatedAtMs: nowMs,
    definitions: [...definitions],
    values,
    samples: definitions.map((definition) => ({
      id: sampleId(definition.id, nowMs, 'system'),
      signalId: definition.id,
      value: 0,
      timestampMs: nowMs,
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
  };
}

export function recordSignalSample(
  state: SignalBrokerState,
  request: {
    peripheralId: string;
    value: number | boolean;
    source: SignalSampleSource;
    timestampMs?: number;
    sampleLimit?: number;
  }
): SignalBrokerState {
  const definition = state.definitions.find((candidate) => candidate.peripheralId === request.peripheralId);
  if (!definition) {
    return state;
  }

  const timestampMs = request.timestampMs ?? Date.now();
  const value = normalizeSignalLevel(request.value);
  const previousValue = state.values[definition.id];
  const values = {
    ...state.values,
    [definition.id]: {
      value,
      timestampMs,
      source: request.source,
    },
  };

  const shouldAppend = !previousValue || previousValue.value !== value;
  const nextSamples = shouldAppend
    ? [
        ...state.samples,
        {
          id: sampleId(definition.id, timestampMs, request.source),
          signalId: definition.id,
          value,
          timestampMs,
          source: request.source,
        },
      ].slice(-(request.sampleLimit ?? DEFAULT_SIGNAL_SAMPLE_LIMIT))
    : state.samples;

  return {
    ...state,
    lastUpdatedAtMs: Math.max(state.lastUpdatedAtMs, timestampMs),
    values,
    samples: nextSamples,
  };
}

export function getSignalSamples(state: SignalBrokerState, signalId: string): SignalSample[] {
  return state.samples.filter((sample) => sample.signalId === signalId);
}
