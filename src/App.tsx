import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Cpu,
  FileCode2,
  FileJson,
  FolderOpen,
  Lightbulb,
  LoaderCircle,
  Play,
  RefreshCcw,
  Save,
  Square,
  Terminal,
  ToggleLeft,
  Trash2,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_DEMO_WIRING,
  DEFAULT_GDB_PORT,
  DEFAULT_TRANSACTION_BROKER_PORT,
  DEFAULT_LINKER_FILENAME,
  DEFAULT_LINKER_SCRIPT,
  DEFAULT_MAIN_SOURCE,
  DEFAULT_STARTUP_SOURCE,
  DEMO_PERIPHERAL_TEMPLATES,
  MAX_PERIPHERALS,
  DemoBoardConnector,
  DemoBoardPad,
  DemoPeripheral,
  DemoPeripheralKind,
  DemoPeripheralTemplateKind,
  DemoWiringRuleIssue,
  DemoWire,
  DemoWorkbenchDevice,
  DemoWiring,
  buildWorkbenchDevices,
  countPeripheralTemplateInstances,
  createPeripheralTemplate,
  describePad,
  formatPadCapabilities,
  getConnectedPeripherals,
  getPadCapabilities,
  getPeripheralsByKind,
  getPeripheralEndpointDefinition,
  getPeripheralTemplateDefinition,
  getPeripheralTemplateKind,
  getWiringWires,
  getWorkbenchDeviceId,
  isDemoPeripheralTemplateKind,
  resolveSelectablePad,
  synchronizeWiringWires,
  validateWiringRules,
} from './lib/firmware';
import { ACTIVE_BOARD_SCHEMA, BOARD_SCHEMAS, BoardSchema, getBoardSchema } from './lib/boards';
import { COMPONENT_PACKAGE_CATALOG_VERSION, getComponentPackage } from './lib/component-packs';
import {
  CircuitNetlistIssue,
  compileNetlistToRenodeArtifacts,
  createNetlistFromWiring,
  summarizeNetlist,
  validateNetlist,
} from './lib/netlist';
import {
  ProjectDocument,
  createProjectDocument,
  normalizeLoadedProjectDocument,
} from './lib/project';
import { EXAMPLE_PROJECTS, getExampleProject, getExamplesForBoard } from './lib/examples';
import {
  DEFAULT_LOGIC_ANALYZER_WINDOW_MS,
  SignalBrokerState,
  SignalDefinition,
  SignalSample,
  createSignalBrokerState,
  createSignalDefinitionsFromNetlist,
  createRuntimeSignalManifest,
  getSignalEdgeCount,
  getSignalSamples,
  recordSignalSample,
  summarizeSignalBroker,
} from './lib/signal-broker';
import {
  createRuntimeBusManifest,
  createRuntimeTimelineState,
  formatVirtualTime,
  recordRuntimeTimelineEvent,
  summarizeRuntimeTimeline,
  syncRuntimeTimelineClock,
} from './lib/runtime-timeline';
import type { RuntimeBusManifestEntry, RuntimeBusTimelineEvent, RuntimeTimelineEvent, RuntimeTimelineState } from './lib/runtime-timeline';
import {
  applySsd1306Transaction,
  createSsd1306State,
  getSsd1306Pixel,
} from './lib/ssd1306';
import type { Ssd1306State } from './lib/ssd1306';

type ToolingStatus = {
  found: boolean;
  path: string | null;
  source: string;
};

type ToolingReport = {
  renode: ToolingStatus;
  gcc: ToolingStatus;
  gdb: ToolingStatus;
};

type BuildResult = {
  success: boolean;
  message: string;
  workspaceDir?: string;
  elfPath?: string;
  mapPath?: string;
  stdout?: string;
  stderr?: string;
};

type RuntimeLog = {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
};

type SimulationState = {
  running: boolean;
  bridgeConnected: boolean;
  uartConnected: boolean;
  workspaceDir: string | null;
  gdbPort: number;
  bridgePort: number;
  transactionBrokerPort: number | null;
  uartPort: number | null;
};

type DebugFrame = {
  func: string | null;
  file: string | null;
  fullname: string | null;
  line: number | null;
};

type DebugState = {
  connected: boolean;
  running: boolean;
  lastReason: string | null;
  frame: DebugFrame | null;
  lastMessage: string;
};

type CodeMode = 'generated' | 'manual';
type EditorTab = 'code' | 'repl' | 'resc' | 'uart';
type PeripheralPosition = {
  x: number;
  y: number;
};

const DEFAULT_BOARD = ACTIVE_BOARD_SCHEMA;
/*
const ONBOARD_FEATURES = [
  { label: 'LD1', detail: 'PB0 · Green LED' },
  { label: 'LD2', detail: 'PE1 · Yellow LED' },
  { label: 'LD3', detail: 'PB14 · Red LED' },
  { label: 'B1', detail: 'PC13 · User Button' },
];
*/

const BOARD_CONNECTOR_LAYOUT = DEFAULT_BOARD.visual.connectorFrames;

const WOKWI_CURATED_PAD_IDS = new Set<string>(DEFAULT_BOARD.teaching.curatedPadIds);

const BOARD_CANVAS_WIDTH = DEFAULT_BOARD.visual.canvas.width;
const BOARD_CANVAS_BASE_HEIGHT = DEFAULT_BOARD.visual.canvas.baseHeight;
const PERIPHERAL_CARD_WIDTH = DEFAULT_BOARD.visual.canvas.peripheralCardWidth;
const PERIPHERAL_CARD_HEIGHT = DEFAULT_BOARD.visual.canvas.peripheralCardHeight;
const PERIPHERALS_PER_ROW = DEFAULT_BOARD.visual.canvas.peripheralsPerRow;
const PERIPHERAL_ROW_GAP = DEFAULT_BOARD.visual.canvas.peripheralRowGap;
const PAD_HOTSPOT_SIZE = DEFAULT_BOARD.visual.canvas.padHotspotSize;
const PAD_HOVER_LABEL_WIDTH = DEFAULT_BOARD.visual.canvas.padHoverLabelWidth;
const BOARD_TOP_VIEW_HEIGHT = DEFAULT_BOARD.visual.canvas.boardTopViewHeight;
const LIBRARY_TEMPLATE_MIME = 'application/x-local-wokwi-peripheral';

const createLogEntry = (message: string, level: RuntimeLog['level'] = 'info'): RuntimeLog => ({
  id: Date.now() + Math.floor(Math.random() * 1000),
  level,
  message,
});

function getCanvasHeightForPeripheralCount(count: number) {
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / PERIPHERALS_PER_ROW));
  return BOARD_CANVAS_BASE_HEIGHT + Math.max(0, rows - 1) * (PERIPHERAL_CARD_HEIGHT + PERIPHERAL_ROW_GAP);
}

function parseLibraryTemplateKind(rawValue: string | null | undefined): DemoPeripheralTemplateKind | null {
  return isDemoPeripheralTemplateKind(rawValue) ? rawValue : null;
}

function getBoardPads(board: BoardSchema): DemoBoardPad[] {
  return board.connectors.all.flatMap((connector) => connector.pins);
}

function getPadDescription(padId: string | null, board: BoardSchema, fallback: string): string {
  if (!padId) {
    return fallback;
  }

  return describePad(resolveSelectablePad(padId, getBoardPads(board)));
}

function reconcileWiringForBoard(wiring: DemoWiring, board: BoardSchema): DemoWiring {
  const selectablePadIds = new Set(board.connectors.selectablePads.map((pad) => pad.id));
  return synchronizeWiringWires({
    peripherals: wiring.peripherals.map((peripheral) =>
      peripheral.padId && !selectablePadIds.has(peripheral.padId)
        ? {
            ...peripheral,
            padId: null,
          }
        : peripheral
    ),
  });
}

function getBoardArtwork(board: BoardSchema) {
  if (board.family === 'stm32f4') {
    return {
      surface: '#c9d8db',
      pcb: 'linear-gradient(180deg, #12343b 0%, #0f2f35 100%)',
      pcbInset: 'linear-gradient(180deg, #16424a 0%, #0f343d 100%)',
      pcbBorder: '#8fd3db',
      text: '#dffcff',
      mutedText: '#8fd3db',
      railLeft: 'GPIOA / Arduino',
      railRight: 'GPIOB-C / GPIOD',
      sideLeft: 'DISCOVERY',
      sideRight: 'EXP GPIO',
      centerKicker: 'STM32F4',
      centerTitle: 'DISCOVERY',
      usbLabel: 'USB OTG / ST-LINK',
      chipLabel: 'STM32F407VG',
      badge: 'F4 DISCOVERY',
    };
  }

  if (board.family === 'stm32f1') {
    return {
      surface: '#c5d7ef',
      pcb: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
      pcbInset: 'linear-gradient(180deg, #3b82f6 0%, #1e40af 100%)',
      pcbBorder: '#93c5fd',
      text: '#eff6ff',
      mutedText: '#bfdbfe',
      railLeft: 'GPIOA header',
      railRight: 'GPIOB header',
      sideLeft: 'BLUE PILL',
      sideRight: 'F103C8',
      centerKicker: 'STM32F103',
      centerTitle: 'GPIO LAB',
      usbLabel: 'Micro USB',
      chipLabel: 'STM32F103C8',
      badge: 'BLUE PILL STYLE',
    };
  }

  return {
    surface: '#d5d9e0',
    pcb: 'linear-gradient(180deg, #fbfbf8 0%, #f4f3ee 100%)',
    pcbInset: 'linear-gradient(180deg, #fbfbf8 0%, #f4f3ee 100%)',
    pcbBorder: '#deded8',
    text: '#465dd7',
    mutedText: '#465dd7',
    railLeft: 'Arduino / Zio',
    railRight: 'Arduino / Zio',
    sideLeft: 'Morpho',
    sideRight: 'Morpho',
    centerKicker: 'NUCLEO',
    centerTitle: 'H753ZI',
    usbLabel: 'ST-LINK USB',
    chipLabel: 'STM32H753ZI',
    badge: 'NUCLEO-144',
  };
}

function getDeviceEndpointAnchor(position: PeripheralPosition, endpointIndex: number, endpointCount: number) {
  if (endpointCount <= 1) {
    return getPeripheralCardAnchor(position);
  }

  const spacing = PERIPHERAL_CARD_WIDTH / (endpointCount + 1);
  return {
    x: position.x + spacing * (endpointIndex + 1),
    y: position.y,
  };
}

function getTemplatePalette(templateKind: DemoPeripheralTemplateKind) {
  const definition = getPeripheralTemplateDefinition(templateKind);

  if (templateKind === 'button') {
    return {
      title: definition.title,
      subtitle: definition.subtitle,
      accent: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/20',
      ghost: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
      icon: ToggleLeft,
    };
  }

  if (templateKind === 'buzzer') {
    return {
      title: definition.title,
      subtitle: definition.subtitle,
      accent: 'border-teal-500/40 bg-teal-500/10 text-teal-100 hover:bg-teal-500/20',
      ghost: 'border-teal-200 bg-teal-50 text-teal-700',
      icon: Wrench,
    };
  }

  if (templateKind === 'rgb-led') {
    return {
      title: definition.title,
      subtitle: definition.subtitle,
      accent: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20',
      ghost: 'border-cyan-200 bg-cyan-50 text-cyan-700',
      icon: Cpu,
    };
  }

  if (templateKind === 'ssd1306-oled') {
    return {
      title: definition.title,
      subtitle: definition.subtitle,
      accent: 'border-sky-500/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20',
      ghost: 'border-sky-200 bg-sky-50 text-sky-700',
      icon: Terminal,
    };
  }

  return {
    title: definition.title,
    subtitle: definition.subtitle,
    accent: 'border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20',
    ghost: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: Lightbulb,
  };
}

function getRgbDeviceGlow(device: DemoWorkbenchDevice, ledStates: Record<string, boolean>) {
  const activeColors = device.members
    .filter((member) => Boolean(ledStates[member.id]))
    .map((member) => member.accentColor ?? '#ffffff');

  if (activeColors.length === 0) {
    return {
      background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.92), rgba(226,232,240,0.7))',
      glow: 'none',
    };
  }

  if (activeColors.length === 1) {
    const color = activeColors[0];
    return {
      background: `radial-gradient(circle at 30% 30%, #ffffff, ${color})`,
      glow: `0 0 18px ${color}88`,
    };
  }

  return {
    background: `conic-gradient(${activeColors.join(', ')})`,
    glow: `0 0 22px ${activeColors[0]}66`,
  };
}

function ToolBadge({ label, status }: { label: string; status: ToolingStatus | null }) {
  if (!status) {
    return (
      <div className="rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-400">
        {label}: checking...
      </div>
    );
  }

  return (
    <div
      className={`rounded-full border px-3 py-1.5 text-xs ${
        status.found
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
      }`}
    >
      {label}: {status.found ? status.source : 'missing'}
    </div>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <div
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : 'border-slate-700 bg-slate-900 text-slate-400'
      }`}
    >
      {label}
    </div>
  );
}

function findPeripheralForPad(wiring: DemoWiring, padId: string): DemoPeripheral | null {
  return wiring.peripherals.find((peripheral) => peripheral.padId === padId) ?? null;
}

function getRuleIssueTone(issue: Pick<DemoWiringRuleIssue | CircuitNetlistIssue, 'severity'>): string {
  return issue.severity === 'error'
    ? 'border-rose-500/35 bg-rose-500/10 text-rose-200'
    : 'border-amber-500/35 bg-amber-500/10 text-amber-200';
}

function getTemplateRequirementSummary(templateKind: DemoPeripheralTemplateKind): string {
  const componentPackage = getComponentPackage(templateKind);
  return componentPackage.pins
    .map((pin) => `${pin.label}: ${pin.requiredPadCapabilities.join(' + ')}`)
    .join(' / ');
}

function buildLogicAnalyzerPoints(options: {
  samples: SignalSample[];
  currentValue: 0 | 1;
  nowMs: number;
  windowMs: number;
  width: number;
  highY: number;
  lowY: number;
}): string {
  const startMs = options.nowMs - options.windowMs;
  const sortedSamples = [...options.samples].sort((left, right) => left.timestampMs - right.timestampMs);
  const yForValue = (value: 0 | 1) => (value === 1 ? options.highY : options.lowY);
  const xForTime = (timestampMs: number) =>
    Math.max(0, Math.min(options.width, ((timestampMs - startMs) / options.windowMs) * options.width));

  let value: 0 | 1 = 0;
  sortedSamples.forEach((sample) => {
    if (sample.timestampMs <= startMs) {
      value = sample.value;
    }
  });

  const points = [`0,${yForValue(value)}`];
  sortedSamples
    .filter((sample) => sample.timestampMs > startMs && sample.timestampMs <= options.nowMs)
    .forEach((sample) => {
      const x = xForTime(sample.timestampMs).toFixed(1);
      points.push(`${x},${yForValue(value)}`, `${x},${yForValue(sample.value)}`);
      value = sample.value;
    });

  points.push(`${options.width},${yForValue(options.currentValue)}`);
  return points.join(' ');
}

function formatSignalAge(timestampMs: number | null | undefined, nowMs: number): string {
  if (!timestampMs) {
    return 'never';
  }

  const ageMs = Math.max(0, nowMs - timestampMs);
  if (ageMs < 1000) {
    return `${Math.round(ageMs)} ms ago`;
  }
  if (ageMs < 60000) {
    return `${(ageMs / 1000).toFixed(1)} s ago`;
  }
  return `${Math.round(ageMs / 60000)} min ago`;
}

function GpioMonitorPanel({ state, nowMs }: { state: SignalBrokerState; nowMs: number }) {
  const summary = summarizeSignalBroker(state);

  return (
    <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">GPIO Monitor</div>
          <div className="mt-1 text-sm text-slate-300">
            Signal Broker v{state.schemaVersion} tracks each connected GPIO endpoint with runtime manifest metadata.
          </div>
        </div>
        <div className="flex shrink-0 gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-200">
            {summary.signalCount} pins
          </span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-200">
            {summary.edgeCount} edges
          </span>
        </div>
      </div>

      <div className="mt-3 max-h-[240px] overflow-auto rounded-2xl border border-slate-800 bg-slate-950/60">
        {state.definitions.length === 0 ? (
          <div className="px-3 py-3 text-xs text-slate-400">No GPIO signals are connected yet.</div>
        ) : (
          <div className="divide-y divide-slate-900">
            {state.definitions.map((definition) => {
              const currentValue = state.values[definition.id];
              const value = currentValue?.value ?? 0;
              const edgeCount = getSignalEdgeCount(state, definition.id);
              return (
                <div key={definition.id} className="grid grid-cols-[minmax(0,1.3fr)_74px_78px_76px_90px] items-center gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: definition.color }} />
                      <span className="truncate font-semibold text-slate-100">{definition.label}</span>
                    </div>
                    <div className="mt-1 truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      {definition.netId} / {definition.componentId}.{definition.pinId}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      definition.direction === 'input' ? 'bg-fuchsia-500/15 text-fuchsia-200' : 'bg-amber-500/15 text-amber-200'
                    }`}
                  >
                    {definition.direction}
                  </span>
                  <span className={value === 1 ? 'rounded-full bg-emerald-500/15 px-2 py-1 text-center font-semibold text-emerald-200' : 'rounded-full bg-slate-800 px-2 py-1 text-center font-semibold text-slate-400'}>
                    {value === 1 ? 'HIGH' : 'LOW'}
                  </span>
                  <span className="rounded-full bg-slate-800 px-2 py-1 text-center text-slate-300">{definition.mcuPinId ?? definition.padId ?? 'unmapped'}</span>
                  <div className="text-right text-[10px] text-slate-500">
                    <div>{edgeCount} edge{edgeCount === 1 ? '' : 's'}</div>
                    <div>{formatSignalAge(currentValue?.lastChangedAtMs, nowMs)}</div>
                    <div className="uppercase tracking-[0.16em] text-slate-600">{currentValue?.source ?? 'system'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function LogicAnalyzerPanel({
  state,
  nowMs,
  onClear,
}: {
  state: SignalBrokerState;
  nowMs: number;
  onClear: () => void;
}) {
  const summary = summarizeSignalBroker(state);
  const width = 420;
  const rowHeight = 38;
  const windowMs = DEFAULT_LOGIC_ANALYZER_WINDOW_MS;

  return (
    <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Signal Broker / Logic Analyzer</div>
          <div className="mt-1 text-sm text-slate-300">
            Runtime GPIO samples are normalized into one signal bus before the waveforms are drawn.
          </div>
        </div>
        <button
          onClick={onClear}
          className="rounded-2xl border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
        >
          Clear
        </button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-slate-300">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Signals</div>
          <div className="mt-1 font-semibold text-white">{summary.signalCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Inputs</div>
          <div className="mt-1 font-semibold text-white">{summary.inputCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Outputs</div>
          <div className="mt-1 font-semibold text-white">{summary.outputCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Samples</div>
          <div className="mt-1 font-semibold text-white">{summary.sampleCount}</div>
        </div>
      </div>

      <div className="mt-3 max-h-[300px] overflow-auto rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
        {state.definitions.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
            Connect at least one GPIO endpoint to create observable signals.
          </div>
        ) : (
          state.definitions.map((definition: SignalDefinition) => {
            const value = state.values[definition.id]?.value ?? 0;
            const samples = getSignalSamples(state, definition.id);
            const points = buildLogicAnalyzerPoints({
              samples,
              currentValue: value,
              nowMs,
              windowMs,
              width,
              highY: 8,
              lowY: 28,
            });

            return (
              <div key={definition.id} className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2 border-b border-slate-900 py-2 last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-100">{definition.label}</div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] uppercase tracking-[0.14em]">
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        definition.direction === 'input' ? 'bg-fuchsia-500/15 text-fuchsia-200' : 'bg-amber-500/15 text-amber-200'
                      }`}
                    >
                      {definition.direction}
                    </span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">{definition.mcuPinId ?? definition.padId ?? 'unmapped'}</span>
                    <span className={value === 1 ? 'text-emerald-300' : 'text-slate-500'}>{value === 1 ? 'HIGH' : 'LOW'}</span>
                  </div>
                </div>
                <svg viewBox={`0 0 ${width} ${rowHeight}`} className="h-[38px] w-full overflow-hidden rounded-xl bg-slate-950">
                  <line x1="0" y1="8" x2={width} y2="8" stroke="rgba(148,163,184,0.18)" strokeDasharray="4 7" />
                  <line x1="0" y1="28" x2={width} y2="28" stroke="rgba(148,163,184,0.14)" strokeDasharray="4 7" />
                  <polyline points={points} fill="none" stroke={definition.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatPayloadPreview(bytes: number[], text: string | null): string {
  if (text && text.trim().length > 0) {
    return text.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  }
  if (bytes.length === 0) {
    return 'no payload';
  }
  const preview = bytes.slice(0, 24).map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  return bytes.length > 24 ? `${preview} ... (${bytes.length} bytes)` : preview;
}

function RuntimeTimelinePanel({
  state,
  busManifest,
  transactionBrokerPort,
}: {
  state: RuntimeTimelineState;
  busManifest: RuntimeBusManifestEntry[];
  transactionBrokerPort: number | null;
}) {
  const summary = summarizeRuntimeTimeline(state);
  const busEvents = state.events
    .filter((event): event is RuntimeBusTimelineEvent => event.protocol !== 'gpio')
    .slice(-8)
    .reverse();
  const recentEvents = state.events.slice(-8).reverse();

  return (
    <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">SimulationClock / Bus Broker</div>
          <div className="mt-1 text-sm text-slate-300">
            GPIO, UART, I2C, and SPI share one timestamped runtime timeline. Native brokers can stream JSONL transactions into port {transactionBrokerPort ?? 'auto'}.
          </div>
        </div>
        <div className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200">
          {state.lastClock.syncMode}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-slate-300">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Virtual Time</div>
          <div className="mt-1 font-semibold text-white">{formatVirtualTime(state.lastClock)}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Sequence</div>
          <div className="mt-1 font-semibold text-white">#{summary.lastSequence}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">GPIO Events</div>
          <div className="mt-1 font-semibold text-white">{summary.gpioEventCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Bus Txn</div>
          <div className="mt-1 font-semibold text-white">{summary.busTransactionCount}</div>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">Runtime Bus Manifest</div>
        {busManifest.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
            No UART/I2C/SPI capability has been discovered for this board profile.
          </div>
        ) : (
          <div className="grid gap-2">
            {busManifest.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">{entry.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${
                      entry.status === 'active' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'
                    }`}
                  >
                    {entry.protocol} / {entry.status}
                  </span>
                </div>
                <div className="mt-1 truncate text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  {entry.endpoints.map((endpoint) => endpoint.label).join('  ')}
                </div>
                {entry.devices && entry.devices.length > 0 ? (
                  <div className="mt-2 rounded-xl border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-100">
                    {entry.devices.map((device) => `${device.label} @ 0x${(device.address ?? 0).toString(16).toUpperCase()}`).join(', ')}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">Bus Transactions</div>
          {busEvents.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
              UART traffic and JSONL broker transactions will appear here.
            </div>
          ) : (
            <div className="grid gap-1">
              {busEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100">{event.busLabel}</span>
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      {event.direction} @ {formatVirtualTime(event.clock)}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-cyan-100">
                    {formatPayloadPreview(event.payload.bytes, event.payload.text)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">Unified Event Stream</div>
          {recentEvents.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
              Start simulation to populate the unified runtime stream.
            </div>
          ) : (
            <div className="grid gap-1">
              {recentEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-100">{event.summary}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      {event.protocol} #{event.clock.sequence}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Ssd1306PreviewPanel({ state }: { state: Ssd1306State }) {
  const pixelSize = 2;
  const width = state.width * pixelSize;
  const height = state.height * pixelSize;

  return (
    <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">SSD1306 OLED Demo</div>
          <div className="mt-1 text-sm text-slate-300">
            I2C write transactions at 0x{state.address.toString(16).toUpperCase()} are decoded into a 128x64 framebuffer preview.
          </div>
        </div>
        <div className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
          state.displayOn ? 'border-sky-500/30 bg-sky-500/10 text-sky-200' : 'border-slate-700 bg-slate-950 text-slate-500'
        }`}>
          {state.displayOn ? 'display on' : 'waiting'}
        </div>
      </div>

      <div className="mt-3 rounded-[24px] border border-slate-800 bg-black p-3 shadow-inner">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full rounded-2xl bg-[#020617]"
          style={{ imageRendering: 'pixelated' }}
        >
          <rect x="0" y="0" width={width} height={height} fill="#020617" />
          {Array.from({ length: state.height }).flatMap((_, y) =>
            Array.from({ length: state.width }).map((__, x) =>
              getSsd1306Pixel(state, x, y) ? (
                <rect
                  key={`${x}:${y}`}
                  x={x * pixelSize}
                  y={y * pixelSize}
                  width={pixelSize}
                  height={pixelSize}
                  fill="#7dd3fc"
                />
              ) : null
            )
          )}
        </svg>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-300">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Transactions</div>
          <div className="mt-1 font-semibold text-white">{state.transactionCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Cursor</div>
          <div className="mt-1 font-semibold text-white">P{state.page} C{state.column}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Virtual Time</div>
          <div className="mt-1 font-semibold text-white">
            {state.updatedAtVirtualTimeNs === null ? 'none' : `${(state.updatedAtVirtualTimeNs / 1000000).toFixed(2)} ms`}
          </div>
        </div>
      </div>
    </div>
  );
}

function getPeripheralDisplayTone(
  peripheral: DemoPeripheral,
  armedPeripheralId: string | null,
  ledStates: Record<string, boolean>,
  buttonStates: Record<string, boolean>
) {
  const armed = armedPeripheralId === peripheral.id;

  if (peripheral.kind === 'button') {
    return buttonStates[peripheral.id]
      ? `border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-50 ${armed ? 'ring-2 ring-cyan-400/70' : ''}`
      : `border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100 ${armed ? 'ring-2 ring-cyan-400/70' : ''}`;
  }

  return ledStates[peripheral.id]
    ? `border-amber-200 bg-amber-400/20 text-amber-50 shadow-[0_0_18px_rgba(251,191,36,0.35)] ${armed ? 'ring-2 ring-cyan-400/70' : ''}`
    : `border-amber-500/40 bg-amber-500/10 text-amber-100 ${armed ? 'ring-2 ring-cyan-400/70' : ''}`;
}

function getPadTone(
  pad: DemoBoardPad,
  wiring: DemoWiring,
  armedPeripheralId: string | null,
  ledStates: Record<string, boolean>,
  buttonStates: Record<string, boolean>,
  disabled: boolean
) {
  const occupant = findPeripheralForPad(wiring, pad.id);

  if (!pad.selectable) {
    if (pad.role === 'power') {
      return 'border-emerald-900/60 bg-emerald-950/30 text-emerald-100/80';
    }
    if (pad.role === 'ground') {
      return 'border-slate-700 bg-slate-900/80 text-slate-300';
    }
    if (pad.blockedReason) {
      return 'border-cyan-900/70 bg-cyan-950/25 text-cyan-100/80';
    }
    return 'border-slate-800 bg-slate-900/70 text-slate-500';
  }

  if (occupant) {
    return `${getPeripheralDisplayTone(occupant, armedPeripheralId, ledStates, buttonStates)} ${disabled ? 'cursor-not-allowed' : ''}`;
  }

  return disabled
    ? 'border-slate-800 bg-slate-900/70 text-slate-500 cursor-not-allowed'
    : `border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-600 hover:text-white ${
        armedPeripheralId ? 'ring-1 ring-cyan-400/35' : ''
      }`;
}

function buildWorkbenchConnectorGroups(wiring: DemoWiring, showFullPinout: boolean, board: BoardSchema = DEFAULT_BOARD) {
  const curatedPadIds = new Set<string>(board.teaching.curatedPadIds);
  const connectedPadIds = new Set(
    getConnectedPeripherals(wiring)
      .map((peripheral) => peripheral.padId)
      .filter((padId): padId is string => Boolean(padId))
  );

  const filterConnector = (connector: DemoBoardConnector | null) => {
    if (!connector) {
      return null;
    }

    if (showFullPinout) {
      return connector;
    }

    const isVisiblePad = (pad: DemoBoardPad) => connectedPadIds.has(pad.id) || curatedPadIds.has(pad.id);

    const pins =
      connector.layout === 'dual'
        ? (() => {
            const oddPins = connector.pins.filter((pad) => pad.column === 'odd');
            const evenPins = connector.pins.filter((pad) => pad.column === 'even');
            const pairedPins: DemoBoardPad[] = [];

            oddPins.forEach((oddPin, index) => {
              const evenPin = evenPins[index];
              if (isVisiblePad(oddPin) || (evenPin ? isVisiblePad(evenPin) : false)) {
                pairedPins.push(oddPin);
                if (evenPin) {
                  pairedPins.push(evenPin);
                }
              }
            });

            return pairedPins;
          })()
        : connector.pins.filter(isVisiblePad);

    return pins.length > 0 ? { ...connector, pins } : null;
  };

  const leftMorpho = filterConnector(board.connectors.leftMorpho);
  const left = board.connectors.left.map(filterConnector).filter((connector): connector is DemoBoardConnector => Boolean(connector));
  const right = board.connectors.right.map(filterConnector).filter((connector): connector is DemoBoardConnector => Boolean(connector));
  const rightMorpho = filterConnector(board.connectors.rightMorpho);

  const connectors = [
    ...(leftMorpho ? [leftMorpho] : []),
    ...left,
    ...right,
    ...(rightMorpho ? [rightMorpho] : []),
  ];
  const visibleSelectablePads = connectors.flatMap((connector) => connector.pins).filter((pad) => pad.selectable).length;

  return {
    leftMorpho,
    left,
    right,
    rightMorpho,
    connectors,
    visibleSelectablePads,
  };
}

function BoardPadChip({
  pad,
  wiring,
  armedPeripheralId,
  ledStates,
  buttonStates,
  disabled,
  onAssign,
  compact = false,
}: {
  pad: DemoBoardPad;
  wiring: DemoWiring;
  armedPeripheralId: string | null;
  ledStates: Record<string, boolean>;
  buttonStates: Record<string, boolean>;
  disabled: boolean;
  onAssign: (pad: DemoBoardPad) => void;
  compact?: boolean;
}) {
  const occupant = findPeripheralForPad(wiring, pad.id);

  return (
    <button
      onClick={() => onAssign(pad)}
      disabled={disabled || !pad.selectable}
      className={`rounded-2xl border p-2.5 text-left transition ${getPadTone(
        pad,
        wiring,
        armedPeripheralId,
        ledStates,
        buttonStates,
        disabled
      )}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className={`${compact ? 'text-[11px]' : 'text-xs'} uppercase tracking-[0.18em] text-current/70`}>
            Pin {pad.pinNumber}
          </div>
          <div className={`${compact ? 'mt-0.5 text-[13px]' : 'mt-1 text-sm'} font-semibold`}>{pad.pinLabel}</div>
        </div>
        <div className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em]">
          {occupant ? occupant.label : pad.selectable ? 'FREE' : pad.role.toUpperCase()}
        </div>
      </div>

      <div className={`mt-2 ${compact ? 'text-[11px]' : 'text-xs'} text-current/80`}>
        {pad.mcuPinId || pad.signalName}
      </div>
      {pad.selectable ? (
        <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-current/60">
          {formatPadCapabilities(getPadCapabilities(pad))}
        </div>
      ) : null}
      {pad.note ? <div className="mt-1 text-[11px] text-current/65">{pad.note}</div> : null}
      {!pad.note && pad.blockedReason ? <div className="mt-1 text-[11px] text-current/65">{pad.blockedReason}</div> : null}
    </button>
  );
}

function SingleConnectorCard(props: {
  connector: DemoBoardConnector;
  wiring: DemoWiring;
  armedPeripheralId: string | null;
  ledStates: Record<string, boolean>;
  buttonStates: Record<string, boolean>;
  disabled: boolean;
  onAssign: (pad: DemoBoardPad) => void;
}) {
  const { connector, wiring, armedPeripheralId, ledStates, buttonStates, disabled, onAssign } = props;

  return (
    <div className="rounded-[28px] border border-slate-800/90 bg-slate-950/80 p-4 shadow-xl backdrop-blur">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{connector.title}</div>
          <div className="mt-1 text-sm font-semibold text-white">{connector.subtitle}</div>
        </div>
        <div className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
          Zio
        </div>
      </div>

      <div className="space-y-2">
        {connector.pins.map((pad) => (
          <div key={pad.id}>
            <BoardPadChip
              pad={pad}
              wiring={wiring}
              armedPeripheralId={armedPeripheralId}
              ledStates={ledStates}
              buttonStates={buttonStates}
              disabled={disabled}
              onAssign={onAssign}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function DualConnectorCard(props: {
  connector: DemoBoardConnector;
  wiring: DemoWiring;
  armedPeripheralId: string | null;
  ledStates: Record<string, boolean>;
  buttonStates: Record<string, boolean>;
  disabled: boolean;
  onAssign: (pad: DemoBoardPad) => void;
}) {
  const { connector, wiring, armedPeripheralId, ledStates, buttonStates, disabled, onAssign } = props;
  const oddPins = connector.pins.filter((pad) => pad.column === 'odd');
  const evenPins = connector.pins.filter((pad) => pad.column === 'even');

  return (
    <div className="rounded-[28px] border border-slate-800/90 bg-slate-950/85 p-4 shadow-xl backdrop-blur">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{connector.title}</div>
          <div className="mt-1 text-sm font-semibold text-white">{connector.subtitle}</div>
        </div>
        <div className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
          ST Morpho
        </div>
      </div>

      <div className="space-y-2">
        {oddPins.map((oddPin, index) => {
          const evenPin = evenPins[index];
          return (
            <div key={oddPin.id} className="grid grid-cols-2 gap-2">
              <BoardPadChip
                pad={oddPin}
                wiring={wiring}
                armedPeripheralId={armedPeripheralId}
                ledStates={ledStates}
                buttonStates={buttonStates}
                disabled={disabled}
                onAssign={onAssign}
                compact
              />
              {evenPin ? (
                <BoardPadChip
                  pad={evenPin}
                  wiring={wiring}
                  armedPeripheralId={armedPeripheralId}
                  ledStates={ledStates}
                  buttonStates={buttonStates}
                  disabled={disabled}
                  onAssign={onAssign}
                  compact
                />
              ) : (
                <div />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getPadAnchor(pad: DemoBoardPad, board: BoardSchema = DEFAULT_BOARD): { x: number; y: number } {
  const frame = board.visual.connectorFrames[pad.connectorId];
  if (!frame) {
    return { x: BOARD_CANVAS_WIDTH / 2, y: 180 };
  }

  if (frame.layout === 'single') {
    const connector = board.connectors.all.find((item) => item.id === pad.connectorId)!;
    const index = connector.pins.findIndex((item) => item.id === pad.id);
    const dotX = frame.x + 18;
    const dotY = frame.y + 28 + index * 12;
    return {
      x: pad.connectorPlacement === 'left' ? dotX : frame.x + frame.width - 18,
      y: dotY,
    };
  }

  const connector = board.connectors.all.find((item) => item.id === pad.connectorId)!;
  if (pad.column === 'odd') {
    const oddPins = connector.pins.filter((item) => item.column === 'odd');
    const index = oddPins.findIndex((item) => item.id === pad.id);
    return {
      x: frame.x + 20,
      y: frame.y + 28 + index * 10,
    };
  }

  const evenPins = connector.pins.filter((item) => item.column === 'even');
  const index = evenPins.findIndex((item) => item.id === pad.id);
  return {
    x: frame.x + frame.width - 20,
    y: frame.y + 28 + index * 10,
  };
}

function createDefaultPeripheralPosition(index: number): PeripheralPosition {
  const row = Math.floor(index / PERIPHERALS_PER_ROW);
  const column = index % PERIPHERALS_PER_ROW;
  const startX = 96;
  const startY = BOARD_TOP_VIEW_HEIGHT + 52 + row * (PERIPHERAL_CARD_HEIGHT + PERIPHERAL_ROW_GAP);
  const x = startX + column * (PERIPHERAL_CARD_WIDTH + 18);
  const y = startY;
  return { x, y };
}

function clampPeripheralPosition(position: PeripheralPosition, canvasHeight: number): PeripheralPosition {
  return {
    x: Math.max(24, Math.min(BOARD_CANVAS_WIDTH - PERIPHERAL_CARD_WIDTH - 24, position.x)),
    y: Math.max(BOARD_TOP_VIEW_HEIGHT + 28, Math.min(canvasHeight - PERIPHERAL_CARD_HEIGHT - 12, position.y)),
  };
}

function getPeripheralCardAnchor(position: PeripheralPosition) {
  return {
    x: position.x + PERIPHERAL_CARD_WIDTH / 2,
    y: position.y,
  };
}

function buildWirePath(start: { x: number; y: number }, end: { x: number; y: number }) {
  const controlOffset = Math.max(36, Math.abs(end.x - start.x) * 0.28);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y - controlOffset}, ${end.x} ${end.y + controlOffset}, ${end.x} ${end.y}`;
}

function getWireColor(wire: DemoWire, peripheral: DemoPeripheral): string {
  if (wire.color) {
    return wire.color;
  }
  if (peripheral.kind === 'button') {
    return '#d946ef';
  }
  if (peripheral.kind === 'i2c') {
    return peripheral.endpointId === 'sda' ? '#0ea5e9' : '#38bdf8';
  }
  return getPeripheralTemplateKind(peripheral) === 'buzzer' ? '#14b8a6' : '#f59e0b';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProjectPosition(value: unknown): PeripheralPosition | null {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    return null;
  }

  return {
    x: value.x,
    y: value.y,
  };
}

function buildDefaultPeripheralPositions(wiring: DemoWiring): Record<string, PeripheralPosition> {
  const devices = buildWorkbenchDevices(wiring);
  const canvasHeight = getCanvasHeightForPeripheralCount(devices.length);
  return Object.fromEntries(
    devices.map((device, index) => [device.id, clampPeripheralPosition(createDefaultPeripheralPosition(index), canvasHeight)])
  );
}

function normalizePeripheralPositions(value: unknown, wiring: DemoWiring): Record<string, PeripheralPosition> {
  const defaults = buildDefaultPeripheralPositions(wiring);
  if (!isRecord(value)) {
    return defaults;
  }

  const devices = buildWorkbenchDevices(wiring);
  const canvasHeight = getCanvasHeightForPeripheralCount(devices.length);
  return Object.fromEntries(
    devices.map((device) => {
      const candidate = normalizeProjectPosition(value[device.id]);
      return [device.id, candidate ? clampPeripheralPosition(candidate, canvasHeight) : defaults[device.id]];
    })
  );
}

function MiniConnectorStrip({
  connector,
  wiring,
  ledStates,
  buttonStates,
}: {
  connector: DemoBoardConnector;
  wiring: DemoWiring;
  ledStates: Record<string, boolean>;
  buttonStates: Record<string, boolean>;
}) {
  const oddPins = connector.layout === 'dual' ? connector.pins.filter((pad) => pad.column === 'odd') : [];
  const evenPins = connector.layout === 'dual' ? connector.pins.filter((pad) => pad.column === 'even') : [];

  const dotTone = (pad: DemoBoardPad) => {
    const occupant = findPeripheralForPad(wiring, pad.id);
    if (occupant?.kind === 'button') {
      return buttonStates[occupant.id]
        ? 'border-fuchsia-300 bg-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.65)]'
        : 'border-fuchsia-300 bg-fuchsia-200/80';
    }
    if (occupant?.kind === 'led') {
      if (occupant.accentColor) {
        return ledStates[occupant.id]
          ? 'border-white bg-white shadow-[0_0_12px_rgba(255,255,255,0.75)]'
          : 'border-white/70 bg-white/80';
      }
      return ledStates[occupant.id]
        ? 'border-amber-200 bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.75)]'
        : 'border-amber-300 bg-amber-200/80';
    }
    if (occupant?.kind === 'i2c') {
      return 'border-sky-200 bg-sky-300/80 shadow-[0_0_12px_rgba(56,189,248,0.55)]';
    }
    if (!pad.selectable) {
      if (pad.role === 'power') {
        return 'border-emerald-300/60 bg-emerald-100/80';
      }
      if (pad.role === 'ground') {
        return 'border-slate-400/70 bg-slate-500/50';
      }
      if (pad.blockedReason) {
        return 'border-cyan-400/70 bg-cyan-200/80';
      }
      return 'border-slate-300/80 bg-slate-200/70';
    }
    return 'border-[#3c2f0a] bg-[#c59e2a]';
  };

  return (
    <div className="rounded-[20px] border border-slate-300/70 bg-[#16181f]/95 p-2 shadow-md">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200">{connector.title}</div>
        <div className="text-[9px] uppercase tracking-[0.18em] text-slate-400">{connector.layout === 'dual' ? 'Morpho' : 'Zio'}</div>
      </div>

      {connector.layout === 'single' ? (
        <div className="mt-2 grid grid-cols-1 gap-1.5">
          {connector.pins.map((pad) => (
            <div key={pad.id} className="flex items-center gap-2">
              <div className={`h-3.5 w-3.5 rounded-full border ${dotTone(pad)}`} />
              <div className="text-[9px] leading-none text-slate-300">{pad.pinNumber}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 grid gap-1.5">
          {oddPins.map((oddPin, index) => {
            const evenPin = evenPins[index];
            return (
              <div key={oddPin.id} className="grid grid-cols-[1fr_1fr] gap-2">
                <div className="flex items-center gap-1.5">
                  <div className={`h-3.5 w-3.5 rounded-full border ${dotTone(oddPin)}`} />
                  <div className="text-[9px] leading-none text-slate-300">{oddPin.pinNumber}</div>
                </div>
                {evenPin ? (
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="text-[9px] leading-none text-slate-300">{evenPin.pinNumber}</div>
                    <div className={`h-3.5 w-3.5 rounded-full border ${dotTone(evenPin)}`} />
                  </div>
                ) : (
                  <div />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PeripheralRackCard({
  board,
  peripheral,
  buttons,
  armed,
  simulationRunning,
  ledOn,
  buttonPressed,
  onArm,
  onDisconnect,
  onRemove,
  onPress,
  onSourceChange,
}: {
  board: BoardSchema;
  peripheral: DemoPeripheral;
  buttons: DemoPeripheral[];
  armed: boolean;
  simulationRunning: boolean;
  ledOn: boolean;
  buttonPressed: boolean;
  onArm: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
  onPress: (pressed: boolean) => void;
  onSourceChange: (sourceId: string | null) => void;
}) {
  const templateKind = getPeripheralTemplateKind(peripheral);
  const palette = getTemplatePalette(templateKind);
  const baseTone =
    peripheral.kind === 'button'
      ? buttonPressed
        ? 'border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-50'
        : 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100'
      : templateKind === 'buzzer'
        ? ledOn
          ? 'border-teal-200 bg-teal-400/20 text-teal-50 shadow-[0_0_18px_rgba(20,184,166,0.35)]'
          : 'border-teal-500/40 bg-teal-500/10 text-teal-100'
        : ledOn
          ? 'border-amber-200 bg-amber-400/20 text-amber-50 shadow-[0_0_18px_rgba(251,191,36,0.35)]'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-100';

  return (
    <div className={`rounded-[26px] border p-4 transition ${baseTone} ${armed ? 'ring-2 ring-cyan-400/70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-current/70">{palette.title}</div>
          <div className="mt-1 text-lg font-semibold">{peripheral.label}</div>
          {peripheral.endpointLabel && templateKind !== 'button' ? (
            <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-current/70">{peripheral.endpointLabel}</div>
          ) : null}
        </div>
        <button
          onClick={onRemove}
          className="rounded-full border border-current/25 p-2 text-current/80 transition hover:bg-white/10"
          title="Remove peripheral"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-3 rounded-2xl border border-current/20 bg-black/10 px-3 py-2 text-sm">
        {getPadDescription(peripheral.padId, board, 'Not connected to a board pad')}
      </div>

      {peripheral.kind === 'led' ? (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-[0.22em] text-current/70">Driven By</div>
          <select
            value={peripheral.sourcePeripheralId ?? ''}
            onChange={(event) => onSourceChange(event.target.value || null)}
            className="mt-2 w-full rounded-2xl border border-current/25 bg-black/10 px-3 py-2 text-sm text-white"
          >
            <option value="">No button selected</option>
            {buttons.map((button) => (
              <option key={button.id} value={button.id} className="text-slate-900">
                {button.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          onClick={onArm}
          className="rounded-2xl border border-current/25 bg-black/10 px-3 py-2 text-sm font-medium transition hover:bg-white/10"
        >
          {armed ? 'Cancel wiring' : 'Connect wire'}
        </button>
        <button
          onClick={onDisconnect}
          disabled={!peripheral.padId}
          className={`rounded-2xl px-3 py-2 text-sm font-medium transition ${
            peripheral.padId ? 'border border-current/25 bg-black/10 hover:bg-white/10' : 'cursor-not-allowed border border-current/10 bg-black/5 text-current/40'
          }`}
        >
          Disconnect
        </button>
      </div>

      {peripheral.kind === 'button' ? (
        <button
          onMouseDown={() => onPress(true)}
          onMouseUp={() => onPress(false)}
          onMouseLeave={() => onPress(false)}
          onTouchStart={() => onPress(true)}
          onTouchEnd={() => onPress(false)}
          disabled={!simulationRunning || !peripheral.padId}
          className={`mt-3 w-full rounded-2xl border px-3 py-3 text-sm font-semibold uppercase tracking-[0.2em] transition ${
            simulationRunning && peripheral.padId
              ? buttonPressed
                ? 'border-fuchsia-300 bg-fuchsia-500 text-white'
                : 'border-current/25 bg-black/10 hover:bg-white/10'
              : 'cursor-not-allowed border-current/10 bg-black/5 text-current/40'
          }`}
        >
          {simulationRunning && peripheral.padId ? 'Press button' : 'Run simulation to press'}
        </button>
      ) : (
        <div className="mt-3 rounded-2xl border border-current/20 bg-black/10 px-3 py-3 text-center text-sm font-semibold">
          {templateKind === 'buzzer' ? (ledOn ? 'Buzzer is active' : 'Buzzer is idle') : ledOn ? 'LED is glowing' : 'LED is idle'}
        </div>
      )}
    </div>
  );
}

function PeripheralLibraryCard({
  kind,
  disabled,
  onAdd,
  onDragStateChange,
}: {
  kind: DemoPeripheralTemplateKind;
  disabled: boolean;
  onAdd: () => void;
  onDragStateChange: (kind: DemoPeripheralTemplateKind | null) => void;
}) {
  const palette = getTemplatePalette(kind);
  const Icon = palette.icon;

  return (
    <div
      draggable={!disabled}
      onDragStart={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(LIBRARY_TEMPLATE_MIME, kind);
        event.dataTransfer.setData('text/plain', kind);
        onDragStateChange(kind);
      }}
      onDragEnd={() => onDragStateChange(null)}
      className={`rounded-[28px] border px-4 py-4 transition ${
        disabled ? 'cursor-not-allowed border-slate-800 bg-slate-900/50 text-slate-500' : `${palette.accent} cursor-grab active:cursor-grabbing`
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-2xl border px-3 py-2 ${disabled ? 'border-current/15 bg-black/10' : palette.ghost}`}>
          <Icon size={18} />
        </div>
        <div className="rounded-full border border-current/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]">
          Drag in
        </div>
      </div>

      <div className="mt-4">
        <div className="text-sm font-semibold">{palette.title}</div>
              <div className="mt-1 text-xs text-current/75">{palette.subtitle}</div>
      </div>

      <div className="mt-4 rounded-2xl border border-current/15 bg-black/10 px-3 py-2 text-[11px] text-current/75">
        Drag this part into the workbench, or click below to spawn one instantly.
      </div>

      <div className="mt-2 rounded-2xl border border-current/15 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-current/65">
        Needs {getTemplateRequirementSummary(kind)}
      </div>

      <button
        onClick={onAdd}
        disabled={disabled}
        className={`mt-4 w-full rounded-2xl border px-3 py-2 text-sm font-medium transition ${
          disabled ? 'cursor-not-allowed border-current/10 bg-black/5 text-current/45' : 'border-current/20 bg-black/10 hover:bg-white/10'
        }`}
      >
        Add {palette.title}
      </button>
    </div>
  );
}

function BoardTopView({
  board,
  wiring,
  ledStates,
  buttonStates,
  peripheralPositions,
  visiblePads,
  armedPeripheralId,
  libraryDragKind,
  workbenchDevices,
  simulationRunning,
  onAssignPad,
  onAssignPadToPeripheral,
  onCreatePeripheral,
  onBeginWiring,
  onDisconnectPeripheral,
  onMovePeripheral,
  onPressPeripheral,
}: {
  board: BoardSchema;
  wiring: DemoWiring;
  ledStates: Record<string, boolean>;
  buttonStates: Record<string, boolean>;
  peripheralPositions: Record<string, PeripheralPosition>;
  visiblePads: DemoBoardPad[];
  armedPeripheralId: string | null;
  libraryDragKind: DemoPeripheralTemplateKind | null;
  workbenchDevices: DemoWorkbenchDevice[];
  simulationRunning: boolean;
  onAssignPad: (pad: DemoBoardPad) => void;
  onAssignPadToPeripheral: (peripheralId: string, pad: DemoBoardPad) => void;
  onCreatePeripheral: (kind: DemoPeripheralTemplateKind, position: PeripheralPosition) => void;
  onBeginWiring: (peripheralId: string) => void;
  onDisconnectPeripheral: (peripheralId: string) => void;
  onMovePeripheral: (peripheralId: string, position: PeripheralPosition) => void;
  onPressPeripheral: (peripheralId: string, pressed: boolean) => void;
}) {
  const canvasHeight = getCanvasHeightForPeripheralCount(workbenchDevices.length);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const deviceDragStateRef = useRef<{
    peripheralId: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const wireDragStateRef = useRef<{
    peripheralId: string;
    pointerId: number;
  } | null>(null);
  const [hoveredPadId, setHoveredPadId] = useState<string | null>(null);
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);
  const [libraryPreviewPosition, setLibraryPreviewPosition] = useState<PeripheralPosition | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const boardPads = useMemo(() => getBoardPads(board), [board]);
  const artwork = useMemo(() => getBoardArtwork(board), [board]);

  const resolveCanvasPosition = useCallback(
    (deviceId: string, index: number) =>
      clampPeripheralPosition(peripheralPositions[deviceId] ?? createDefaultPeripheralPosition(index), canvasHeight),
    [canvasHeight, peripheralPositions]
  );

  const resolveBoardPointFromClient = useCallback((clientX: number, clientY: number) => {
    if (!surfaceRef.current) {
      return null;
    }

    const rect = surfaceRef.current.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const resolvePadFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const padElement = element?.closest('[data-board-pad-id]') as HTMLElement | null;
      const padId = padElement?.dataset.boardPadId;
      return padId ? visiblePads.find((pad) => pad.id === padId) ?? null : null;
    },
    [visiblePads]
  );

  const wires = useMemo(() => {
    const deviceIndexById = new Map(workbenchDevices.map((device, index) => [device.id, index]));
    const deviceByMemberId = new Map<string, DemoWorkbenchDevice>();
    workbenchDevices.forEach((device) => {
      device.members.forEach((member) => deviceByMemberId.set(member.id, device));
    });

    return getWiringWires(wiring)
      .map((wire) => {
        const peripheral = wiring.peripherals.find((item) => item.id === wire.peripheralId);
        const device = peripheral ? deviceByMemberId.get(peripheral.id) : null;
        if (!peripheral || !device) {
          return null;
        }

        const deviceIndex = deviceIndexById.get(device.id);
        const endpointIndex = device.members.findIndex((member) => member.id === peripheral.id);
        if (deviceIndex === undefined || endpointIndex < 0) {
          return null;
        }

        const pad = resolveSelectablePad(wire.padId, boardPads);
        const padAnchor = getPadAnchor(pad, board);
        const cardAnchor = getDeviceEndpointAnchor(
          resolveCanvasPosition(device.id, deviceIndex),
          endpointIndex,
          device.members.length
        );
        return {
          ...wire,
          peripheral,
          pad,
          path: buildWirePath(cardAnchor, padAnchor),
          color: getWireColor(wire, peripheral),
          midpoint: {
            x: (cardAnchor.x + padAnchor.x) / 2,
            y: (cardAnchor.y + padAnchor.y) / 2,
          },
        };
      })
      .filter(Boolean) as Array<
      DemoWire & {
        peripheral: DemoPeripheral;
        pad: DemoBoardPad;
        path: string;
        color: string;
        midpoint: { x: number; y: number };
      }
    >;
  }, [board, boardPads, resolveCanvasPosition, wiring, workbenchDevices]);
  const selectedWire = selectedWireId ? wires.find((wire) => wire.id === selectedWireId) ?? null : null;

  useEffect(() => {
    if (selectedWireId && !wires.some((wire) => wire.id === selectedWireId)) {
      setSelectedWireId(null);
    }
  }, [selectedWireId, wires]);

  useEffect(() => {
    if (!selectedWire || simulationRunning) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }
      event.preventDefault();
      onDisconnectPeripheral(selectedWire.peripheralId);
      setSelectedWireId(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDisconnectPeripheral, selectedWire, simulationRunning]);

  const armedPeripheral = armedPeripheralId ? wiring.peripherals.find((peripheral) => peripheral.id === armedPeripheralId) ?? null : null;
  const hoveredPad = hoveredPadId ? visiblePads.find((pad) => pad.id === hoveredPadId) ?? null : null;
  const previewPath = useMemo(() => {
    if (!armedPeripheral) {
      return null;
    }

    const armedDeviceIndex = workbenchDevices.findIndex((device) => device.members.some((member) => member.id === armedPeripheral.id));
    if (armedDeviceIndex < 0) {
      return null;
    }

    const armedDevice = workbenchDevices[armedDeviceIndex];
    const endpointIndex = armedDevice.members.findIndex((member) => member.id === armedPeripheral.id);
    const start = getDeviceEndpointAnchor(resolveCanvasPosition(armedDevice.id, armedDeviceIndex), endpointIndex, armedDevice.members.length);
    const end = hoveredPad ? getPadAnchor(hoveredPad, board) : pointerPosition;
    if (!end) {
      return null;
    }

    return buildWirePath(start, end);
  }, [armedPeripheral, board, hoveredPad, pointerPosition, resolveCanvasPosition, workbenchDevices]);

  const beginPeripheralDrag = useCallback(
    (peripheralId: string, position: PeripheralPosition, event: React.PointerEvent<HTMLDivElement>) => {
      if (simulationRunning || !surfaceRef.current) {
        return;
      }

      const rect = surfaceRef.current.getBoundingClientRect();
      deviceDragStateRef.current = {
        peripheralId,
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left - position.x,
        offsetY: event.clientY - rect.top - position.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [simulationRunning]
  );

  const updatePeripheralDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = deviceDragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId || !surfaceRef.current) {
        return;
      }

      const rect = surfaceRef.current.getBoundingClientRect();
      onMovePeripheral(dragState.peripheralId, {
        x: event.clientX - rect.left - dragState.offsetX,
        y: event.clientY - rect.top - dragState.offsetY,
      });
    },
    [onMovePeripheral]
  );

  const endPeripheralDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = deviceDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    deviceDragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const beginWireDrag = useCallback(
    (peripheralId: string, event: React.PointerEvent<HTMLButtonElement>) => {
      if (simulationRunning) {
        return;
      }

      setSelectedWireId(null);
      wireDragStateRef.current = {
        peripheralId,
        pointerId: event.pointerId,
      };
      onBeginWiring(peripheralId);
      event.currentTarget.setPointerCapture(event.pointerId);
      const nextPoint = resolveBoardPointFromClient(event.clientX, event.clientY);
      if (nextPoint) {
        setPointerPosition(nextPoint);
      }
      const pointedPad = resolvePadFromClient(event.clientX, event.clientY);
      setHoveredPadId(pointedPad?.id ?? null);
    },
    [onBeginWiring, resolveBoardPointFromClient, resolvePadFromClient, simulationRunning]
  );

  const updateWireDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const dragState = wireDragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const nextPoint = resolveBoardPointFromClient(event.clientX, event.clientY);
      if (nextPoint) {
        setPointerPosition(nextPoint);
      }
      const pointedPad = resolvePadFromClient(event.clientX, event.clientY);
      setHoveredPadId(pointedPad?.id ?? null);
    },
    [resolveBoardPointFromClient, resolvePadFromClient]
  );

  const endWireDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const dragState = wireDragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      wireDragStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const pointedPad = resolvePadFromClient(event.clientX, event.clientY);
      if (pointedPad) {
        onAssignPadToPeripheral(dragState.peripheralId, pointedPad);
      }
      setSelectedWireId(null);
      setHoveredPadId(null);
      setPointerPosition(null);
    },
    [onAssignPadToPeripheral, resolvePadFromClient]
  );

  const trackPointerPreview = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!armedPeripheralId || !surfaceRef.current || wireDragStateRef.current) {
        return;
      }

      const nextPoint = resolveBoardPointFromClient(event.clientX, event.clientY);
      if (nextPoint) {
        setPointerPosition(nextPoint);
      }
      const pointedPad = resolvePadFromClient(event.clientX, event.clientY);
      setHoveredPadId(pointedPad?.id ?? null);
    },
    [armedPeripheralId, resolveBoardPointFromClient, resolvePadFromClient]
  );

  const handleLibraryDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const droppedKind = libraryDragKind ?? parseLibraryTemplateKind(event.dataTransfer.getData(LIBRARY_TEMPLATE_MIME));
      if (!droppedKind || simulationRunning) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const nextPoint = resolveBoardPointFromClient(event.clientX, event.clientY);
      if (!nextPoint) {
        return;
      }

      setLibraryPreviewPosition(
        clampPeripheralPosition(
          {
            x: nextPoint.x - PERIPHERAL_CARD_WIDTH / 2,
            y: nextPoint.y - PERIPHERAL_CARD_HEIGHT / 2,
          },
          canvasHeight
        )
      );
    },
    [canvasHeight, libraryDragKind, resolveBoardPointFromClient, simulationRunning]
  );

  const handleLibraryDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const droppedKind = libraryDragKind ?? parseLibraryTemplateKind(event.dataTransfer.getData(LIBRARY_TEMPLATE_MIME));
      if (!droppedKind || simulationRunning) {
        return;
      }

      event.preventDefault();
      const nextPoint = resolveBoardPointFromClient(event.clientX, event.clientY);
      if (!nextPoint) {
        return;
      }

      onCreatePeripheral(
        droppedKind,
        clampPeripheralPosition(
          {
            x: nextPoint.x - PERIPHERAL_CARD_WIDTH / 2,
            y: nextPoint.y - PERIPHERAL_CARD_HEIGHT / 2,
          },
          canvasHeight
        )
      );
      setLibraryPreviewPosition(null);
    },
    [canvasHeight, libraryDragKind, onCreatePeripheral, resolveBoardPointFromClient, simulationRunning]
  );

  const handleLibraryDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setLibraryPreviewPosition(null);
  }, []);

  const selectedWireActionPosition = selectedWire
    ? {
        left: Math.max(18, Math.min(BOARD_CANVAS_WIDTH - 244, selectedWire.midpoint.x - 122)),
        top: Math.max(18, Math.min(canvasHeight - 118, selectedWire.midpoint.y - 58)),
      }
    : null;

  return (
    <div className="rounded-[30px] border border-slate-300 bg-[#f6f7fb] p-4 shadow-inner">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Board Top View</div>
          <div className="mt-1 text-sm text-slate-600">
            Drag parts from the library into the workbench, then drag each part&apos;s wire stub directly onto a live board hotspot.
          </div>
        </div>
        <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          Drag parts + wires
        </div>
      </div>

      <div
        className={`relative overflow-hidden rounded-[30px] border px-5 py-5 shadow-inner transition ${
          libraryDragKind ? 'border-cyan-400' : 'border-slate-300'
        }`}
        style={{
          minHeight: canvasHeight + 32,
          background: libraryDragKind
            ? `linear-gradient(180deg, rgba(14,165,233,0.16), rgba(255,255,255,0.24)), ${artwork.surface}`
            : artwork.surface,
        }}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1">1. Drag a device in</div>
          <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1">2. Pull its wire stub</div>
          <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1">3. Drop on a cyan hotspot</div>
          <div className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-cyan-700">Click a wire to rewire or delete</div>
        </div>

        <div
          ref={surfaceRef}
          onPointerMove={trackPointerPreview}
          onPointerLeave={() => {
            if (!wireDragStateRef.current) {
              setHoveredPadId(null);
              setPointerPosition(null);
            }
          }}
          onDragOver={handleLibraryDragOver}
          onDragLeave={handleLibraryDragLeave}
          onDrop={handleLibraryDrop}
          className="relative mx-auto overflow-hidden rounded-[38px]"
          style={{ width: BOARD_CANVAS_WIDTH, minHeight: canvasHeight }}
        >
          <svg
            className="pointer-events-none absolute inset-0 z-20 h-full w-full"
            viewBox={`0 0 ${BOARD_CANVAS_WIDTH} ${canvasHeight}`}
            preserveAspectRatio="none"
          >
            {wires.map((wire) => (
              <g key={wire.id}>
                <path
                  d={wire.path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="18"
                  strokeLinecap="round"
                  style={{ pointerEvents: simulationRunning ? 'none' : 'stroke', cursor: simulationRunning ? 'default' : 'pointer' }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedWireId((current) => (current === wire.id ? null : wire.id));
                  }}
                />
                <path
                  d={wire.path}
                  fill="none"
                  stroke={wire.color}
                  strokeWidth={selectedWireId === wire.id ? '5' : '3'}
                  strokeLinecap="round"
                  opacity={selectedWireId === wire.id ? '1' : '0.92'}
                  className={selectedWireId === wire.id ? 'drop-shadow-[0_0_8px_rgba(34,211,238,0.55)]' : ''}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            ))}
            {previewPath ? (
              <path
                d={previewPath}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="3"
                strokeDasharray="10 8"
                strokeLinecap="round"
                opacity="0.88"
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
          </svg>

          {selectedWire && selectedWireActionPosition ? (
            <div
              className="absolute z-30 w-[244px] rounded-[22px] border border-cyan-300 bg-slate-950/95 px-3 py-3 text-xs text-cyan-50 shadow-[0_18px_42px_rgba(8,47,73,0.38)]"
              style={selectedWireActionPosition}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/75">Selected wire</div>
                  <div className="mt-1 font-semibold text-white">{selectedWire.label}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedWireId(null)}
                  className="rounded-full border border-white/15 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-white/10"
                >
                  Close
                </button>
              </div>
              <div className="mt-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-cyan-50/80">
                {selectedWire.peripheral.label} to {describePad(selectedWire.pad)}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onBeginWiring(selectedWire.peripheralId);
                    setSelectedWireId(null);
                  }}
                  disabled={simulationRunning}
                  className="rounded-2xl border border-cyan-300/35 bg-cyan-300/15 px-3 py-2 font-semibold text-cyan-50 transition hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Rewire
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDisconnectPeripheral(selectedWire.peripheralId);
                    setSelectedWireId(null);
                  }}
                  disabled={simulationRunning}
                  className="rounded-2xl border border-rose-300/35 bg-rose-400/15 px-3 py-2 font-semibold text-rose-50 transition hover:bg-rose-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
              <div className="mt-2 text-[11px] text-cyan-100/65">Shortcut: press Delete or Backspace while this wire is selected.</div>
            </div>
          ) : null}

          <div
            className="absolute inset-x-6 top-6 h-[290px] rounded-[36px] border shadow-[0_16px_28px_rgba(15,23,42,0.12)]"
            style={{
              background: artwork.pcb,
              borderColor: artwork.pcbBorder,
            }}
          />
          <div
            className="absolute inset-x-10 top-10 h-[282px] rounded-[34px] border"
            style={{
              background: artwork.pcbInset,
              borderColor: artwork.pcbBorder,
            }}
          />
          <div className="absolute left-12 right-12 top-[338px] bottom-5 rounded-[30px] border border-dashed border-slate-400/60 bg-white/40 shadow-inner" />
          <div className="pointer-events-none absolute left-16 top-[350px] rounded-full border border-slate-300 bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Workbench area
          </div>
          <div className="pointer-events-none absolute right-16 top-[350px] rounded-full border border-slate-300 bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Drag parts here
          </div>

          {[{ left: 42, top: 34 }, { left: 688, top: 34 }, { left: 42, top: 280 }, { left: 688, top: 280 }].map((hole, index) => (
            <div
              key={index}
              className="absolute h-7 w-7 rounded-full border border-slate-300 bg-slate-200/80 shadow-inner"
              style={{ left: hole.left, top: hole.top }}
            >
              <div className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-300 bg-white/80" />
            </div>
          ))}

          {board.connectors.leftMorpho ? (
            <div className="absolute left-0 top-6 w-[108px]">
              <MiniConnectorStrip connector={board.connectors.leftMorpho} wiring={wiring} ledStates={ledStates} buttonStates={buttonStates} />
            </div>
          ) : null}

          <div className="absolute left-[128px] top-[50px] w-[90px]">
            {board.connectors.left.map((connector) => (
              <div key={connector.id} className="mb-3 last:mb-0">
                <MiniConnectorStrip connector={connector} wiring={wiring} ledStates={ledStates} buttonStates={buttonStates} />
              </div>
            ))}
          </div>

          <div className="absolute right-[128px] top-[50px] w-[90px]">
            {board.connectors.right.map((connector) => (
              <div key={connector.id} className="mb-3 last:mb-0">
                <MiniConnectorStrip connector={connector} wiring={wiring} ledStates={ledStates} buttonStates={buttonStates} />
              </div>
            ))}
          </div>

          {board.connectors.rightMorpho ? (
            <div className="absolute right-0 top-6 w-[108px]">
              <MiniConnectorStrip connector={board.connectors.rightMorpho} wiring={wiring} ledStates={ledStates} buttonStates={buttonStates} />
            </div>
          ) : null}

          {Object.entries(board.visual.connectorFrames).map(([connectorId, frame]) => (
            <div
              key={connectorId}
              className="pointer-events-none absolute text-[10px] font-semibold uppercase tracking-[0.24em] text-[#465dd7]"
              style={{
                left: frame.x + (frame.layout === 'dual' ? 22 : frame.width / 2 - 16),
                top: frame.y - 14,
              }}
            >
              {connectorId}
            </div>
          ))}

          <div
            className="absolute left-1/2 top-0 h-14 w-24 -translate-x-1/2 rounded-b-[18px] border shadow-md"
            style={{
              background: board.family === 'stm32f1' ? '#1d4ed8' : '#cbd5e1',
              borderColor: artwork.pcbBorder,
            }}
          />
          <div
            className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.18em]"
            style={{
              borderColor: artwork.pcbBorder,
              background: 'rgba(15,23,42,0.2)',
              color: artwork.text,
            }}
          >
            {artwork.usbLabel}
          </div>
          <div className="absolute left-1/2 top-[72px] h-5 w-10 -translate-x-1/2 rounded-full border border-slate-500 bg-slate-900/80" />

          <div className="absolute left-1/2 top-[124px] flex -translate-x-1/2 items-start gap-5">
            <div
              className="rounded-[26px] border px-4 py-3 shadow-sm"
              style={{
                borderColor: artwork.pcbBorder,
                background: board.family === 'stm32h7' ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.2)',
              }}
            >
              <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: artwork.text }}>
                USER
              </div>
              <div className={`mt-2 h-12 w-12 rounded-full border ${Object.values(buttonStates).some(Boolean) ? 'border-fuchsia-300 bg-fuchsia-400 shadow-[0_0_16px_rgba(217,70,239,0.45)]' : 'border-slate-300 bg-slate-100'}`} />
            </div>
            <div
              className="rounded-[26px] border px-4 py-3 shadow-sm"
              style={{
                borderColor: artwork.pcbBorder,
                background: board.family === 'stm32h7' ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.2)',
              }}
            >
              <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: artwork.text }}>
                RESET
              </div>
              <div className="mt-2 h-12 w-12 rounded-full border border-slate-400 bg-slate-900/85" />
            </div>
            <div
              className="rounded-[26px] border px-4 py-3 shadow-sm"
              style={{
                borderColor: artwork.pcbBorder,
                background: board.family === 'stm32h7' ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.2)',
              }}
            >
              <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: artwork.text }}>
                {board.family === 'stm32f4' ? 'LD3 / LD4 / LD5 / LD6' : board.family === 'stm32f1' ? 'PC13 LED' : 'LD1 / LD2 / LD3'}
              </div>
              <div className="mt-2 flex gap-2">
                <div className="h-4 w-4 rounded-full border border-emerald-300 bg-emerald-300/70" />
                <div className="h-4 w-4 rounded-full border border-amber-300 bg-amber-300/70" />
                <div className="h-4 w-4 rounded-full border border-rose-300 bg-rose-300/70" />
                {board.family === 'stm32f4' ? <div className="h-4 w-4 rounded-full border border-blue-300 bg-blue-300/70" /> : null}
              </div>
            </div>
          </div>

          <div className="absolute left-1/2 top-[244px] grid w-[260px] -translate-x-1/2 gap-4">
            <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-[30px] border border-slate-700 bg-slate-900 shadow-[0_18px_36px_rgba(15,23,42,0.25)]">
              <Cpu size={46} className="text-cyan-300" />
            </div>
            <div
              className="rounded-[28px] border px-5 py-4 text-center shadow-sm"
              style={{
                borderColor: artwork.pcbBorder,
                background: board.family === 'stm32h7' ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,42,0.18)',
              }}
            >
              <div className="text-xs uppercase tracking-[0.24em]" style={{ color: artwork.mutedText }}>
                MCU
              </div>
              <div className="mt-1 text-xl font-semibold tracking-tight" style={{ color: board.family === 'stm32h7' ? '#0f172a' : artwork.text }}>
                {artwork.chipLabel}
              </div>
              <div className="mt-1 text-sm" style={{ color: board.family === 'stm32h7' ? '#475569' : artwork.mutedText }}>
                {board.runtime.renodePlatformPath}
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute left-[228px] top-[52px] text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: artwork.text }}>
            {artwork.railLeft}
          </div>
          <div className="pointer-events-none absolute right-[228px] top-[52px] text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: artwork.text }}>
            {artwork.railRight}
          </div>
          <div className="pointer-events-none absolute left-[18px] top-[156px] -rotate-90 text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: artwork.text }}>
            {artwork.sideLeft}
          </div>
          <div className="pointer-events-none absolute right-[12px] top-[156px] rotate-90 text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: artwork.text }}>
            {artwork.sideRight}
          </div>
          <div className="pointer-events-none absolute left-1/2 top-[258px] -translate-x-1/2 text-center">
            <div className="text-sm font-semibold uppercase tracking-[0.32em]" style={{ color: artwork.mutedText }}>
              {artwork.centerKicker}
            </div>
            <div className="mt-1 max-w-[260px] text-[28px] leading-none tracking-tight" style={{ color: artwork.text }}>
              {artwork.centerTitle}
            </div>
            <div
              className="mx-auto mt-2 w-max rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{
                borderColor: artwork.pcbBorder,
                color: artwork.text,
                background: board.family === 'stm32h7' ? 'rgba(255,255,255,0.72)' : 'rgba(15,23,42,0.18)',
              }}
            >
              {artwork.badge}
            </div>
          </div>

          {visiblePads.map((pad) => {
            const anchor = getPadAnchor(pad, board);
            const occupant = findPeripheralForPad(wiring, pad.id);
            const isHovered = hoveredPadId === pad.id;
            const accent = occupant?.kind === 'button' ? '#d946ef' : occupant?.accentColor ?? (occupant?.kind === 'led' ? '#f59e0b' : '#06b6d4');

            return (
              <div key={pad.id}>
                <button
                  onClick={() => onAssignPad(pad)}
                  onPointerEnter={() => setHoveredPadId(pad.id)}
                  onPointerLeave={() => setHoveredPadId((current) => (current === pad.id ? null : current))}
                  disabled={simulationRunning}
                  data-board-pad-id={pad.id}
                  className={`absolute rounded-full border transition ${
                    simulationRunning
                      ? 'cursor-not-allowed border-slate-300/60 bg-white/70'
                      : occupant
                        ? 'border-white/90 bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.25)]'
                        : armedPeripheralId
                          ? 'border-cyan-300 bg-cyan-200/95 hover:scale-110 hover:bg-cyan-300'
                          : 'border-slate-300 bg-white/90 hover:border-cyan-300 hover:bg-cyan-100'
                  }`}
                  style={{
                    left: anchor.x - PAD_HOTSPOT_SIZE / 2,
                    top: anchor.y - PAD_HOTSPOT_SIZE / 2,
                    width: PAD_HOTSPOT_SIZE,
                    height: PAD_HOTSPOT_SIZE,
                    boxShadow: occupant ? `0 0 0 3px ${accent}33` : undefined,
                  }}
                  title={describePad(pad)}
                />
                {isHovered || occupant ? (
                  <div
                    className="pointer-events-none absolute rounded-xl border border-slate-300 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-md"
                    style={{
                      left: Math.max(12, Math.min(BOARD_CANVAS_WIDTH - PAD_HOVER_LABEL_WIDTH - 12, anchor.x - PAD_HOVER_LABEL_WIDTH / 2)),
                      top: anchor.y + 16,
                      width: PAD_HOVER_LABEL_WIDTH,
                    }}
                  >
                    <div className="font-semibold text-slate-900">{pad.pinLabel}</div>
                    <div className="mt-0.5 text-slate-600">{pad.mcuPinId}</div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {workbenchDevices.map((device, index) => {
            const frame = resolveCanvasPosition(device.id, index);
            const palette = getTemplatePalette(device.templateKind);
            const isMultiEndpoint = device.members.length > 1;

            if (device.templateKind === 'ssd1306-oled') {
              return (
                <div
                  key={device.id}
                  className="absolute rounded-[24px] border border-sky-200 bg-sky-50/95 px-4 py-3 text-slate-900 shadow-lg transition"
                  style={{ left: frame.x, top: frame.y, width: PERIPHERAL_CARD_WIDTH + 42, minHeight: PERIPHERAL_CARD_HEIGHT + 64 }}
                >
                  {device.members.map((member, endpointIndex) => {
                    const anchor = getDeviceEndpointAnchor(frame, endpointIndex, device.members.length);
                    return (
                      <button
                        key={member.id}
                        onPointerDown={(event) => beginWireDrag(member.id, event)}
                        onPointerMove={updateWireDrag}
                        onPointerUp={endWireDrag}
                        onPointerCancel={endWireDrag}
                        className={`absolute top-[-10px] flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-slate-900 transition ${
                          armedPeripheralId === member.id ? 'shadow-[0_0_0_6px_rgba(56,189,248,0.2)]' : ''
                        }`}
                        style={{ left: anchor.x - frame.x, touchAction: 'none' }}
                        title={`Drag ${member.endpointLabel ?? member.label} wire`}
                      >
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.accentColor ?? '#38bdf8' }} />
                      </button>
                    );
                  })}

                  <div className="flex items-start justify-between gap-2">
                    <div className="rounded-full border border-sky-300 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                      I2C display
                    </div>
                    <div
                      onPointerDown={(event) => beginPeripheralDrag(device.id, frame, event)}
                      onPointerMove={updatePeripheralDrag}
                      onPointerUp={endPeripheralDrag}
                      onPointerCancel={endPeripheralDrag}
                      className={`rounded-full border border-current/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        simulationRunning ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing'
                      }`}
                    >
                      Drag
                    </div>
                  </div>

                  <div className="mt-3 rounded-[18px] border border-slate-900 bg-slate-950 p-2 shadow-inner">
                    <div className="grid gap-[1px]" style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}>
                      {Array.from({ length: 64 }).map((_, pixel) => (
                        <div
                          key={pixel}
                          className={`h-1.5 rounded-[1px] ${(pixel + Math.floor(pixel / 16)) % 5 === 0 ? 'bg-sky-300' : 'bg-slate-800'}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{palette.title}</div>
                    <div className="mt-1 text-sm font-semibold">{device.label}</div>
                    <div className="mt-1 text-xs text-slate-600">Address 0x3C, decoded by the I2C Transaction Broker.</div>
                  </div>

                  <div className="mt-3 grid gap-2">
                    {device.members.map((member) => (
                      <div key={member.id} className="rounded-2xl border border-sky-100 bg-white/80 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: member.accentColor ?? '#0284c7' }}>
                          {member.endpointLabel}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600">
                          {getPadDescription(member.padId, board, 'Wire this endpoint to a matching I2C pad')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            if (isMultiEndpoint) {
              const rgbGlow = getRgbDeviceGlow(device, ledStates);

              return (
                <div
                  key={device.id}
                  className="absolute rounded-[24px] border border-cyan-200 bg-cyan-50/95 px-4 py-3 text-slate-900 shadow-lg transition"
                  style={{ left: frame.x, top: frame.y, width: PERIPHERAL_CARD_WIDTH + 26, minHeight: PERIPHERAL_CARD_HEIGHT + 42 }}
                >
                  {device.members.map((member, endpointIndex) => {
                    const anchor = getDeviceEndpointAnchor(frame, endpointIndex, device.members.length);
                    const sourceLabel = member.sourcePeripheralId
                      ? wiring.peripherals.find((item) => item.id === member.sourcePeripheralId)?.label ?? 'Button'
                      : null;

                    return (
                      <button
                        key={member.id}
                        onPointerDown={(event) => beginWireDrag(member.id, event)}
                        onPointerMove={updateWireDrag}
                        onPointerUp={endWireDrag}
                        onPointerCancel={endWireDrag}
                        className={`absolute top-[-10px] flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-slate-900 transition ${
                          armedPeripheralId === member.id ? 'shadow-[0_0_0_6px_rgba(34,211,238,0.18)]' : ''
                        }`}
                        style={{ left: anchor.x - frame.x, touchAction: 'none' }}
                        title={`Drag ${member.endpointLabel ?? member.label} wire`}
                      >
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.accentColor ?? '#06b6d4' }} />
                      </button>
                    );
                  })}

                  <div className="flex items-start justify-between gap-2">
                    <div className="rounded-full border border-cyan-300 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
                      Multi-endpoint
                    </div>
                    <div
                      onPointerDown={(event) => beginPeripheralDrag(device.id, frame, event)}
                      onPointerMove={updatePeripheralDrag}
                      onPointerUp={endPeripheralDrag}
                      onPointerCancel={endPeripheralDrag}
                      className={`rounded-full border border-current/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        simulationRunning ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing'
                      }`}
                    >
                      Drag
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <div
                      className="h-11 w-11 rounded-full border border-white/80"
                      style={{
                        background: rgbGlow.background,
                        boxShadow: rgbGlow.glow,
                      }}
                    />
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{palette.title}</div>
                      <div className="mt-1 text-sm font-semibold">{device.label}</div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {device.members.map((member) => {
                      const active = Boolean(ledStates[member.id]);
                      const sourceLabel = member.sourcePeripheralId
                        ? wiring.peripherals.find((item) => item.id === member.sourcePeripheralId)?.label ?? 'Button'
                        : null;

                      return (
                        <div key={member.id} className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: member.accentColor ?? '#0f172a' }}>
                              {member.endpointLabel}
                            </div>
                            <div className="text-[11px] text-slate-500">{active ? 'On' : sourceLabel ? `<= ${sourceLabel}` : 'No driver'}</div>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-600">
                            {getPadDescription(member.padId, board, 'Wire this channel to a GPIO pad')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const peripheral = device.members[0];
            const templateKind = getPeripheralTemplateKind(peripheral);
            const isButton = peripheral.kind === 'button';
            const active = isButton ? buttonStates[peripheral.id] : ledStates[peripheral.id];
            const sourceLabel =
              peripheral.kind === 'led' && peripheral.sourcePeripheralId
                ? wiring.peripherals.find((item) => item.id === peripheral.sourcePeripheralId)?.label ?? 'Button'
                : null;
            const baseTone = isButton
              ? active
                ? 'border-fuchsia-300 bg-fuchsia-500/90 text-white'
                : 'border-fuchsia-200 bg-fuchsia-50/95 text-slate-900'
              : templateKind === 'buzzer'
                ? active
                  ? 'border-teal-200 bg-teal-300/95 text-slate-950'
                  : 'border-teal-200 bg-teal-50/95 text-slate-900'
                : active
                  ? 'border-amber-200 bg-amber-300/95 text-slate-950'
                  : 'border-amber-200 bg-amber-50/95 text-slate-900';

            return (
              <div
                key={device.id}
                className={`absolute rounded-[24px] border px-4 py-3 shadow-lg transition ${baseTone}`}
                style={{ left: frame.x, top: frame.y, width: PERIPHERAL_CARD_WIDTH, minHeight: PERIPHERAL_CARD_HEIGHT }}
              >
                <button
                  onPointerDown={(event) => beginWireDrag(peripheral.id, event)}
                  onPointerMove={updateWireDrag}
                  onPointerUp={endWireDrag}
                  onPointerCancel={endWireDrag}
                  className={`absolute left-1/2 top-[-10px] flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-slate-900 transition ${
                    armedPeripheralId === peripheral.id ? 'shadow-[0_0_0_6px_rgba(34,211,238,0.18)]' : ''
                  }`}
                  style={{ touchAction: 'none' }}
                  title="Drag wire from this terminal"
                >
                  <div className="h-2.5 w-2.5 rounded-full bg-cyan-300" />
                </button>
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                      armedPeripheralId === peripheral.id ? 'border-cyan-300 bg-cyan-500/20 text-cyan-50' : 'border-current/25 bg-white/20 text-current/80'
                    }`}
                  >
                    {armedPeripheralId === peripheral.id ? 'Wire armed' : 'Wire stub'}
                  </div>
                  <div
                    onPointerDown={(event) => beginPeripheralDrag(device.id, frame, event)}
                    onPointerMove={updatePeripheralDrag}
                    onPointerUp={endPeripheralDrag}
                    onPointerCancel={endPeripheralDrag}
                    className={`rounded-full border border-current/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                      simulationRunning ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing'
                    }`}
                  >
                    Drag
                  </div>
                </div>
                <div className="mt-2 text-[11px] uppercase tracking-[0.2em] text-current/70">{palette.title}</div>
                <div className="mt-1 text-sm font-semibold">{device.label}</div>
                <div className="mt-2 text-xs text-current/75">
                  {getPadDescription(peripheral.padId, board, 'Unplaced device')}
                </div>
                <div className="mt-3">
                  {isButton ? (
                    <button
                      onMouseDown={() => onPressPeripheral(peripheral.id, true)}
                      onMouseUp={() => onPressPeripheral(peripheral.id, false)}
                      onMouseLeave={() => onPressPeripheral(peripheral.id, false)}
                      onTouchStart={() => onPressPeripheral(peripheral.id, true)}
                      onTouchEnd={() => onPressPeripheral(peripheral.id, false)}
                      disabled={!simulationRunning || !peripheral.padId}
                      className={`w-full rounded-2xl border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                        simulationRunning && peripheral.padId
                          ? buttonStates[peripheral.id]
                            ? 'border-fuchsia-300 bg-fuchsia-500 text-white'
                            : 'border-current/25 bg-white/20 hover:bg-white/30'
                          : 'cursor-not-allowed border-current/10 bg-black/5 text-current/45'
                      }`}
                    >
                      {simulationRunning && peripheral.padId ? 'Hold To Drive' : 'Run To Press'}
                    </button>
                  ) : (
                    <div className="rounded-2xl border border-current/20 bg-white/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
                      {templateKind === 'buzzer'
                        ? active
                          ? 'Buzzing'
                          : sourceLabel
                            ? `Driven By ${sourceLabel}`
                            : 'Awaiting Button Source'
                        : active
                          ? 'Glow On'
                          : sourceLabel
                            ? `Driven By ${sourceLabel}`
                            : 'Awaiting Button Source'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {libraryDragKind && libraryPreviewPosition ? (
            <div
              className={`pointer-events-none absolute rounded-[24px] border border-dashed px-4 py-3 opacity-80 ${getTemplatePalette(libraryDragKind).ghost}`}
              style={{
                left: libraryPreviewPosition.x,
                top: libraryPreviewPosition.y,
                width: PERIPHERAL_CARD_WIDTH,
                minHeight: PERIPHERAL_CARD_HEIGHT,
              }}
            >
              <div className="text-[11px] uppercase tracking-[0.2em]">Preview</div>
              <div className="mt-1 text-sm font-semibold">{getTemplatePalette(libraryDragKind).title} Template</div>
              <div className="mt-2 text-xs">Release here to drop a new part into the workbench.</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WiringWorkbench({
  board,
  wiring,
  armedPeripheralId,
  ledStates,
  buttonStates,
  simulationRunning,
  showFullPinout,
  peripheralPositions,
  onAssign,
  onAssignPeripheralToPad,
  onAddPeripheral,
  onBeginWiring,
  onArmPeripheral,
  onDisconnectPeripheral,
  onRemoveDevice,
  onRemovePeripheral,
  onPressPeripheral,
  onSourceChange,
  onToggleFullPinout,
  onMovePeripheral,
}: {
  board: BoardSchema;
  wiring: DemoWiring;
  armedPeripheralId: string | null;
  ledStates: Record<string, boolean>;
  buttonStates: Record<string, boolean>;
  simulationRunning: boolean;
  showFullPinout: boolean;
  peripheralPositions: Record<string, PeripheralPosition>;
  onAssign: (pad: DemoBoardPad) => void;
  onAssignPeripheralToPad: (peripheralId: string, pad: DemoBoardPad) => void;
  onAddPeripheral: (kind: DemoPeripheralTemplateKind, position?: PeripheralPosition) => void;
  onBeginWiring: (peripheralId: string) => void;
  onArmPeripheral: (peripheralId: string) => void;
  onDisconnectPeripheral: (peripheralId: string) => void;
  onRemoveDevice: (deviceId: string) => void;
  onRemovePeripheral: (peripheralId: string) => void;
  onPressPeripheral: (peripheralId: string, pressed: boolean) => void;
  onSourceChange: (peripheralId: string, sourceId: string | null) => void;
  onToggleFullPinout: () => void;
  onMovePeripheral: (peripheralId: string, position: PeripheralPosition) => void;
}) {
  const buttons = getPeripheralsByKind(wiring, 'button');
  const leds = getPeripheralsByKind(wiring, 'led');
  const workbenchDevices = useMemo(() => buildWorkbenchDevices(wiring), [wiring]);
  const [libraryDragKind, setLibraryDragKind] = useState<DemoPeripheralTemplateKind | null>(null);
  const workbenchConnectors = useMemo(() => buildWorkbenchConnectorGroups(wiring, showFullPinout, board), [board, wiring, showFullPinout]);
  const hiddenPadCount = Math.max(0, board.connectors.selectablePads.length - workbenchConnectors.visibleSelectablePads);
  const deviceCounts = useMemo(
    () => ({
      button: workbenchDevices.filter((device) => device.templateKind === 'button').length,
      led: workbenchDevices.filter((device) => device.templateKind === 'led').length,
      buzzer: workbenchDevices.filter((device) => device.templateKind === 'buzzer').length,
      rgb: workbenchDevices.filter((device) => device.templateKind === 'rgb-led').length,
      oled: workbenchDevices.filter((device) => device.templateKind === 'ssd1306-oled').length,
    }),
    [workbenchDevices]
  );
  const visibleCanvasPads = useMemo(
    () => workbenchConnectors.connectors.flatMap((connector) => connector.pins).filter((pad) => pad.selectable),
    [workbenchConnectors]
  );

  return (
    <div className="min-w-[1320px] space-y-6">
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-[32px] border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
          <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Peripheral Library</div>
          <div className="mt-3 text-sm text-slate-300">
            Pull a part straight into the board canvas, then drag its wire stub to a hotspot just like Wokwi.
          </div>

          <div className="mt-5 grid gap-3">
            {DEMO_PERIPHERAL_TEMPLATES.map((template) => (
              <div key={template.kind}>
                <PeripheralLibraryCard
                  kind={template.kind}
                  disabled={workbenchDevices.length >= MAX_PERIPHERALS || simulationRunning}
                  onAdd={() => onAddPeripheral(template.kind)}
                  onDragStateChange={setLibraryDragKind}
                />
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Armed Device</div>
            <div className="mt-1 font-semibold text-white">
              {armedPeripheralId
                ? wiring.peripherals.find((peripheral) => peripheral.id === armedPeripheralId)?.label ?? 'Unknown device'
                : 'None'}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {armedPeripheralId
                ? 'Drag the cyan wire stub onto any free hotspot, or click a free pad to complete the connection.'
                : 'Start by dragging a library part into the workbench or clicking Add on a template card.'}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Device Count</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-xs text-slate-500">Buttons</div>
                <div className="mt-1 text-lg font-semibold text-white">{deviceCounts.button}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-xs text-slate-500">LEDs</div>
                <div className="mt-1 text-lg font-semibold text-white">{deviceCounts.led}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-xs text-slate-500">Buzzers</div>
                <div className="mt-1 text-lg font-semibold text-white">{deviceCounts.buzzer}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-xs text-slate-500">RGB LEDs</div>
                <div className="mt-1 text-lg font-semibold text-white">{deviceCounts.rgb}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-xs text-slate-500">OLEDs</div>
                <div className="mt-1 text-lg font-semibold text-white">{deviceCounts.oled}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-xs text-slate-500">Free Pads</div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {board.connectors.selectablePads.length - getConnectedPeripherals(wiring).length}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[36px] border border-slate-800 bg-gradient-to-b from-slate-100 to-slate-200 p-5 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.55)]">
          <div className="rounded-[28px] border border-slate-300 bg-white/85 p-4 shadow-inner">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.26em] text-slate-500">Board</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{board.name}</div>
                <div className="mt-2 max-w-3xl text-sm text-slate-600">{board.tagline}</div>
              </div>
              <div className="grid gap-2 text-right text-xs text-slate-500">
                <div className="rounded-2xl border border-slate-300 bg-slate-100 px-3 py-1">Renode board file</div>
                <div className="font-mono text-slate-700">{board.renodePlatformPath}</div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Selectable pads</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{board.connectors.selectablePads.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Connected devices</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{getConnectedPeripherals(wiring).length}</div>
              </div>
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Compiler target</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{board.compiler.gccArgs.join(' ')}</div>
              </div>
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Board I/O</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {showFullPinout ? 'Full connector map exposed' : 'Common pads first, full pinout on demand'}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {board.visual.onboardFeatures.map((feature) => (
                <div key={feature.label} className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{feature.label}</span> · {feature.detail}
                </div>
              ))}
            </div>

            <div className="mt-5">
              <BoardTopView
                board={board}
                wiring={wiring}
                ledStates={ledStates}
                buttonStates={buttonStates}
                peripheralPositions={peripheralPositions}
                visiblePads={visibleCanvasPads}
                armedPeripheralId={armedPeripheralId}
                libraryDragKind={libraryDragKind}
                workbenchDevices={workbenchDevices}
                simulationRunning={simulationRunning}
                onAssignPad={onAssign}
                onAssignPadToPeripheral={onAssignPeripheralToPad}
                onCreatePeripheral={onAddPeripheral}
                onBeginWiring={onBeginWiring}
                onDisconnectPeripheral={onDisconnectPeripheral}
                onMovePeripheral={onMovePeripheral}
                onPressPeripheral={onPressPeripheral}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[32px] border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Peripheral Rack</div>
            <div className="mt-2 text-sm text-slate-300">
              Each card represents an external part. Add, wire, drive, and remove parts without touching the board definition itself.
            </div>
          </div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
            {armedPeripheralId ? 'Drag the active wire stub to a hotspot or click a pad to finish' : 'Use any rack card for quick edits'}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {workbenchDevices.map((device) => {
            if (device.members.length === 1) {
              const peripheral = device.members[0];
              return (
                <div key={device.id}>
                  <PeripheralRackCard
                    board={board}
                    peripheral={peripheral}
                    buttons={buttons}
                    armed={armedPeripheralId === peripheral.id}
                    simulationRunning={simulationRunning}
                    ledOn={Boolean(ledStates[peripheral.id])}
                    buttonPressed={Boolean(buttonStates[peripheral.id])}
                    onArm={() => onArmPeripheral(peripheral.id)}
                    onDisconnect={() => onDisconnectPeripheral(peripheral.id)}
                    onRemove={() => onRemovePeripheral(peripheral.id)}
                    onPress={(pressed) => onPressPeripheral(peripheral.id, pressed)}
                    onSourceChange={(sourceId) => onSourceChange(peripheral.id, sourceId)}
                  />
                </div>
              );
            }

            if (device.templateKind === 'ssd1306-oled') {
              return (
                <div key={device.id} className="rounded-[26px] border border-sky-500/40 bg-sky-500/10 p-4 text-sky-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.22em] text-sky-100/80">SSD1306 OLED</div>
                      <div className="mt-1 text-lg font-semibold">{device.label}</div>
                    </div>
                    <button
                      onClick={() => onRemoveDevice(device.id)}
                      className="rounded-full border border-current/25 p-2 text-current/80 transition hover:bg-white/10"
                      title="Remove device"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="mt-3 rounded-2xl border border-sky-200/20 bg-black/30 px-3 py-3 text-sm text-sky-50/90">
                    Wire SCL and SDA to matching I2C-capable pads. Runtime transactions at address 0x3C update the OLED preview panel.
                  </div>

                  <div className="mt-3 space-y-3">
                    {device.members.map((member) => (
                      <div key={member.id} className="rounded-2xl border border-current/20 bg-black/10 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: member.accentColor ?? '#fff' }}>
                            {member.endpointLabel}
                          </div>
                          <button
                            onClick={() => onArmPeripheral(member.id)}
                            className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                              armedPeripheralId === member.id ? 'border-sky-300 bg-sky-500/20 text-sky-50' : 'border-current/25 bg-white/10 text-current/80'
                            }`}
                          >
                            {armedPeripheralId === member.id ? 'Wiring' : 'Connect wire'}
                          </button>
                        </div>
                        <div className="mt-2 text-sm text-sky-50/90">
                          {getPadDescription(member.padId, board, 'Not connected to an I2C-capable board pad')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            const rgbGlow = getRgbDeviceGlow(device, ledStates);

            return (
              <div key={device.id} className="rounded-[26px] border border-cyan-500/40 bg-cyan-500/10 p-4 text-cyan-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-cyan-100/80">RGB LED</div>
                    <div className="mt-1 text-lg font-semibold">{device.label}</div>
                  </div>
                  <button
                    onClick={() => onRemoveDevice(device.id)}
                    className="rounded-full border border-current/25 p-2 text-current/80 transition hover:bg-white/10"
                    title="Remove device"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-3 rounded-2xl border border-current/20 bg-black/10 px-3 py-3">
                  <div
                    className="h-12 w-12 rounded-full border border-white/80"
                    style={{
                      background: rgbGlow.background,
                      boxShadow: rgbGlow.glow,
                    }}
                  />
                  <div className="text-sm text-cyan-50/90">Three independent channels. Wire each color to a GPIO and choose which button will drive it.</div>
                </div>

                <div className="mt-3 space-y-3">
                  {device.members.map((member) => (
                    <div key={member.id} className="rounded-2xl border border-current/20 bg-black/10 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: member.accentColor ?? '#fff' }}>
                          {member.endpointLabel}
                        </div>
                        <button
                          onClick={() => onArmPeripheral(member.id)}
                          className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                            armedPeripheralId === member.id ? 'border-cyan-300 bg-cyan-500/20 text-cyan-50' : 'border-current/25 bg-white/10 text-current/80'
                          }`}
                        >
                          {armedPeripheralId === member.id ? 'Wiring' : 'Connect wire'}
                        </button>
                      </div>
                      <div className="mt-2 text-sm text-cyan-50/90">
                        {getPadDescription(member.padId, board, 'Not connected to a board pad')}
                      </div>
                      <div className="mt-3">
                        <div className="text-xs uppercase tracking-[0.22em] text-current/70">Driven By</div>
                        <select
                          value={member.sourcePeripheralId ?? ''}
                          onChange={(event) => onSourceChange(member.id, event.target.value || null)}
                          className="mt-2 w-full rounded-2xl border border-current/25 bg-black/10 px-3 py-2 text-sm text-white"
                        >
                          <option value="">No button selected</option>
                          {buttons.map((button) => (
                            <option key={button.id} value={button.id} className="text-slate-900">
                              {button.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button
                          onClick={() => onDisconnectPeripheral(member.id)}
                          disabled={!member.padId}
                          className={`rounded-2xl px-3 py-2 text-sm font-medium transition ${
                            member.padId ? 'border border-current/25 bg-black/10 hover:bg-white/10' : 'cursor-not-allowed border border-current/10 bg-black/5 text-current/40'
                          }`}
                        >
                          Disconnect
                        </button>
                        <div className="rounded-2xl border border-current/20 bg-black/10 px-3 py-2 text-center text-sm font-semibold">
                          {ledStates[member.id] ? 'Channel On' : 'Channel Idle'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[32px] border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Pin Chooser</div>
              <div className="mt-2 text-sm text-slate-300">
                This view follows the Wokwi idea: only common teaching-friendly pads are shown by default, and any pad you already wired stays visible.
              </div>
            </div>
            <button
              onClick={onToggleFullPinout}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              <ToggleLeft size={14} />
              {showFullPinout ? 'Collapse To Common Pins' : 'Show Full Pinout'}
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Visible pads</div>
              <div className="mt-1 text-2xl font-semibold text-white">{workbenchConnectors.visibleSelectablePads}</div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Connected pads</div>
              <div className="mt-1 text-2xl font-semibold text-white">{getConnectedPeripherals(wiring).length}</div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Hidden advanced pads</div>
              <div className="mt-1 text-2xl font-semibold text-white">{showFullPinout ? 0 : hiddenPadCount}</div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {workbenchConnectors.connectors.map((connector) => (
              <div key={connector.id}>
                {connector.layout === 'dual' ? (
                  <DualConnectorCard
                    connector={connector}
                    wiring={wiring}
                    armedPeripheralId={armedPeripheralId}
                    ledStates={ledStates}
                    buttonStates={buttonStates}
                    disabled={simulationRunning}
                    onAssign={onAssign}
                  />
                ) : (
                  <SingleConnectorCard
                    connector={connector}
                    wiring={wiring}
                    armedPeripheralId={armedPeripheralId}
                    ledStates={ledStates}
                    buttonStates={buttonStates}
                    disabled={simulationRunning}
                    onAssign={onAssign}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[32px] border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
          <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Wokwi-like flow</div>
          <div className="mt-4 grid gap-3 text-sm text-slate-300">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              1. Drag a <span className="font-semibold text-white">Button</span>, <span className="font-semibold text-white">LED</span>, <span className="font-semibold text-white">Buzzer</span>, <span className="font-semibold text-white">RGB LED</span>, or <span className="font-semibold text-white">SSD1306 OLED</span> template into the workbench.
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              2. Pull the device&apos;s <span className="font-semibold text-white">wire stub</span> onto a cyan hotspot on the board.
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              3. Use the default common pads first, or open the full pinout when you need more advanced GPIOs.
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              4. Any pad you already connected stays visible, so the board never loses the context of your wiring.
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              5. Compile, start Renode, and press each external button card to drive the wired outputs in real time.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<EditorTab>('code');
  const [selectedBoardId, setSelectedBoardId] = useState(DEFAULT_BOARD.id);
  const [tooling, setTooling] = useState<ToolingReport | null>(null);
  const [logs, setLogs] = useState<RuntimeLog[]>([
    createLogEntry(`${DEFAULT_BOARD.name} workbench ready. Pick a board, add peripherals, and the app will regenerate firmware and Renode wiring automatically.`),
  ]);
  const [wiring, setWiring] = useState<DemoWiring>(DEFAULT_DEMO_WIRING);
  const [armedPeripheralId, setArmedPeripheralId] = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [simulation, setSimulation] = useState<SimulationState>({
    running: false,
    bridgeConnected: false,
    uartConnected: false,
    workspaceDir: null,
    gdbPort: DEFAULT_GDB_PORT,
    bridgePort: DEFAULT_BRIDGE_PORT,
    transactionBrokerPort: DEFAULT_TRANSACTION_BROKER_PORT,
    uartPort: null,
  });
  const [buttonStates, setButtonStates] = useState<Record<string, boolean>>({});
  const [ledStates, setLedStates] = useState<Record<string, boolean>>({});
  const [signalBrokerState, setSignalBrokerState] = useState<SignalBrokerState>(() => createSignalBrokerState([]));
  const [runtimeTimelineState, setRuntimeTimelineState] = useState<RuntimeTimelineState>(() => createRuntimeTimelineState());
  const [ssd1306State, setSsd1306State] = useState<Ssd1306State>(() => createSsd1306State());
  const [logicAnalyzerClock, setLogicAnalyzerClock] = useState(Date.now());
  const [codeMode, setCodeMode] = useState<CodeMode>('generated');
  const [code, setCode] = useState(DEFAULT_MAIN_SOURCE);
  const [uartTranscript, setUartTranscript] = useState('UART terminal idle. Start Renode to attach the board UART socket.\n');
  const [uartInput, setUartInput] = useState('');
  const [codeDirty, setCodeDirty] = useState(true);
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState<string | null>(null);
  const [projectDirty, setProjectDirty] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [selectedExampleId, setSelectedExampleId] = useState(EXAMPLE_PROJECTS[0]?.id ?? '');
  const [showFullPinout, setShowFullPinout] = useState(false);
  const [peripheralPositions, setPeripheralPositions] = useState<Record<string, PeripheralPosition>>(() =>
    Object.fromEntries(buildWorkbenchDevices(DEFAULT_DEMO_WIRING).map((device, index) => [device.id, createDefaultPeripheralPosition(index)]))
  );
  const [debugState, setDebugState] = useState<DebugState>({
    connected: false,
    running: false,
    lastReason: null,
    frame: null,
    lastMessage: 'Debugger idle.',
  });
  const codeEditorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const projectDirtyMountedRef = useRef(false);
  const suppressNextProjectDirtyRef = useRef(false);

  const selectedBoard = useMemo(() => getBoardSchema(selectedBoardId), [selectedBoardId]);
  const selectedBoardPads = useMemo(() => getBoardPads(selectedBoard), [selectedBoard]);
  const connectedButtons = useMemo(() => getConnectedPeripherals(wiring, 'button'), [wiring]);
  const connectedLeds = useMemo(() => getConnectedPeripherals(wiring, 'led'), [wiring]);
  const workbenchDevices = useMemo(() => buildWorkbenchDevices(wiring), [wiring]);
  const circuitNetlist = useMemo(() => createNetlistFromWiring(wiring, selectedBoard), [selectedBoard, wiring]);
  const netlistSummary = useMemo(() => summarizeNetlist(circuitNetlist), [circuitNetlist]);
  const signalDefinitions = useMemo(() => createSignalDefinitionsFromNetlist(circuitNetlist), [circuitNetlist]);
  const runtimeSignalManifest = useMemo(() => createRuntimeSignalManifest(signalDefinitions), [signalDefinitions]);
  const runtimeBusManifest = useMemo(() => createRuntimeBusManifest(selectedBoard, circuitNetlist), [circuitNetlist, selectedBoard]);
  const hasSsd1306Device = useMemo(
    () => runtimeBusManifest.some((entry) => entry.devices?.some((device) => device.model === 'ssd1306')),
    [runtimeBusManifest]
  );
  const renodeArtifacts = useMemo(
    () =>
      compileNetlistToRenodeArtifacts({
        netlist: circuitNetlist,
        board: selectedBoard,
        elfPath: buildResult?.elfPath ?? null,
        gdbPort: simulation.gdbPort,
        bridgePort: simulation.bridgePort,
        uartPort: simulation.uartPort,
      }),
    [buildResult?.elfPath, circuitNetlist, selectedBoard, simulation.bridgePort, simulation.gdbPort, simulation.uartPort]
  );
  const generatedCode = renodeArtifacts.mainSource;
  const boardRepl = renodeArtifacts.boardRepl;
  const peripheralManifest = renodeArtifacts.peripheralManifest;
  const wiringRuleIssues = useMemo(() => validateWiringRules(wiring, selectedBoardPads), [selectedBoardPads, wiring]);
  const wiringRuleErrors = useMemo(() => wiringRuleIssues.filter((issue) => issue.severity === 'error'), [wiringRuleIssues]);
  const wiringRuleWarnings = useMemo(() => wiringRuleIssues.filter((issue) => issue.severity === 'warning'), [wiringRuleIssues]);
  const netlistIssues = useMemo(() => validateNetlist(circuitNetlist, selectedBoard), [circuitNetlist, selectedBoard]);
  const netlistErrors = useMemo(() => netlistIssues.filter((issue) => issue.severity === 'error'), [netlistIssues]);
  const netlistWarnings = useMemo(() => netlistIssues.filter((issue) => issue.severity === 'warning'), [netlistIssues]);
  const blockingValidationErrors = useMemo(
    () => [...wiringRuleErrors, ...netlistErrors],
    [netlistErrors, wiringRuleErrors]
  );
  const uartPeripheralName = selectedBoard.runtime.uart?.peripheralName ?? null;
  const rescPreview = renodeArtifacts.rescPreview;
  const projectDisplayName = projectFilePath?.split(/[\\/]/).pop() ?? projectTitle ?? 'Untitled project';
  const boardExamples = useMemo(() => getExamplesForBoard(selectedBoard.id), [selectedBoard.id]);
  const selectedExample = useMemo(() => getExampleProject(selectedExampleId, selectedBoard.id), [selectedBoard.id, selectedExampleId]);
  const logicAnalyzerNow = simulation.running ? logicAnalyzerClock : signalBrokerState.lastUpdatedAtMs;

  const appendLog = useCallback((message: string, level: RuntimeLog['level'] = 'info') => {
    setLogs((current) => [...current, createLogEntry(message, level)]);
  }, []);

  const refreshTooling = useCallback(async () => {
    if (!window.localWokwi) {
      appendLog('Electron preload API is unavailable. Run the desktop app through `npm run dev` or `npm run start`.', 'warn');
      return;
    }

    setTooling(await window.localWokwi.getTooling());
  }, [appendLog]);

  const resetDebugState = useCallback((message = 'Debugger idle.') => {
    setDebugState({
      connected: false,
      running: false,
      lastReason: null,
      frame: null,
      lastMessage: message,
    });
  }, []);

  const switchBoard = useCallback(
    (boardId: string) => {
      if (simulation.running) {
        appendLog('Stop the simulation before switching boards.', 'warn');
        return;
      }

      const nextBoard = getBoardSchema(boardId);
      if (nextBoard.id === selectedBoard.id) {
        return;
      }

      setSelectedBoardId(nextBoard.id);
      setWiring((current) => reconcileWiringForBoard(current, nextBoard));
      setShowFullPinout(false);
      setBuildResult(null);
      setCodeDirty(true);
      setArmedPeripheralId(null);
      setButtonStates({});
      setLedStates({});
      setUartTranscript(`UART terminal idle. ${nextBoard.runtime.uart?.displayName ?? 'No board UART'} socket will attach when Renode starts.\n`);
      setProjectTitle(null);
      setProjectDirty(true);
      resetDebugState('Board changed. Debugger idle.');
      appendLog(`Board switched to ${nextBoard.name}. Incompatible wires were disconnected and generated files now target ${nextBoard.family.toUpperCase()}.`);
    },
    [appendLog, resetDebugState, selectedBoard.id, simulation.running]
  );

  const setRunningVisualState = useCallback((running: boolean) => {
    setSimulation((current) => ({
      ...current,
      running,
      bridgeConnected: running ? current.bridgeConnected : false,
      uartConnected: running ? current.uartConnected : false,
    }));

    if (!running) {
      setButtonStates({});
      setLedStates({});
      setUartTranscript((current) => current + '\n[system] Simulation stopped.\n');
    }
  }, []);

  useEffect(() => {
    refreshTooling();
  }, [refreshTooling]);

  useEffect(() => {
    const nowMs = Date.now();
    setSignalBrokerState(createSignalBrokerState(signalDefinitions, nowMs));
    setRuntimeTimelineState(createRuntimeTimelineState(nowMs));
    setSsd1306State(createSsd1306State());
    setLogicAnalyzerClock(nowMs);
  }, [runtimeBusManifest, signalDefinitions]);

  useEffect(() => {
    if (!simulation.running) {
      return undefined;
    }

    const interval = window.setInterval(() => setLogicAnalyzerClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [simulation.running]);

  useEffect(() => {
    setCodeDirty(true);
    if (codeMode === 'generated') {
      setCode(generatedCode);
    }
  }, [codeMode, generatedCode]);

  useEffect(() => {
    if (boardExamples.length > 0 && !boardExamples.some((example) => example.id === selectedExampleId)) {
      setSelectedExampleId(boardExamples[0].id);
    }
  }, [boardExamples, selectedExampleId]);

  useEffect(() => {
    if (!projectDirtyMountedRef.current) {
      projectDirtyMountedRef.current = true;
      return;
    }

    if (suppressNextProjectDirtyRef.current) {
      suppressNextProjectDirtyRef.current = false;
      return;
    }

    setProjectDirty(true);
  }, [code, codeMode, peripheralPositions, selectedBoardId, showFullPinout, wiring]);

  useEffect(() => {
    setPeripheralPositions((current) => {
      const nextEntries = workbenchDevices.map((device, index) => [
        device.id,
        current[device.id] ?? createDefaultPeripheralPosition(index),
      ] as const);
      const next = Object.fromEntries(nextEntries);
      const currentKeys = Object.keys(current);
      if (
        currentKeys.length === nextEntries.length &&
        nextEntries.every(([deviceId, position]) => current[deviceId]?.x === position.x && current[deviceId]?.y === position.y)
      ) {
        return current;
      }
      return next;
    });
  }, [workbenchDevices]);

  useEffect(() => {
    const editor = codeEditorRef.current;
    const monaco = monacoRef.current;
    const line = debugState.frame?.line ?? null;

    if (!editor || !monaco) {
      return;
    }

    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      line
        ? [
            {
              range: new monaco.Range(line, 1, line, 1),
              options: {
                isWholeLine: true,
                className: 'debug-current-line',
                glyphMarginClassName: 'debug-current-glyph',
              },
            },
          ]
        : []
    );
  }, [debugState.frame?.line]);

  useEffect(() => {
    if (!window.localWokwi) {
      return undefined;
    }

    return window.localWokwi.onSimulationEvent((event) => {
      if (event.type === 'log') {
        appendLog(event.message, event.level ?? 'info');
        return;
      }

      if (event.type === 'clock') {
        setRuntimeTimelineState((current) => syncRuntimeTimelineClock(current, event.clock as RuntimeTimelineEvent['clock']));
        return;
      }

      if (event.type === 'timeline') {
        const timelineEvent = event.event as RuntimeTimelineEvent;
        setRuntimeTimelineState((current) => recordRuntimeTimelineEvent(current, timelineEvent));
        if (timelineEvent.protocol === 'i2c' && timelineEvent.kind === 'bus-transaction') {
          setSsd1306State((current) => applySsd1306Transaction(current, timelineEvent as RuntimeBusTimelineEvent));
        }
        return;
      }

      if (event.type === 'signal') {
        setSignalBrokerState((current) =>
          recordSignalSample(current, {
            peripheralId: event.peripheralId,
            value: event.value,
            source: event.source,
            timestampMs: event.timestampMs ?? Date.now(),
            clock: event.clock as RuntimeTimelineEvent['clock'] | undefined,
          })
        );
        return;
      }

      if (event.type === 'led') {
        setLedStates((current) => ({
          ...current,
          [event.id]: event.state === 1,
        }));
        return;
      }

      if (event.type === 'bridge') {
        const bridgeReady = event.status === 'connected' || event.status === 'ready';
        setSimulation((current) => ({
          ...current,
          bridgeConnected: bridgeReady,
        }));

        if (event.status === 'button-event' && event.id) {
          setButtonStates((current) => ({
            ...current,
            [event.id!]: event.state === 1,
          }));
          return;
        }

        if (event.status === 'ready') {
          if (event.ledHooked === false) {
            appendLog(`Bridge connected, but LED hook failed: ${event.ledHookError ?? 'unknown error'}`, 'error');
          } else {
            appendLog(`Bridge ready for ${event.peripheralIds?.length ?? peripheralManifest.length} peripheral(s).`);
          }
        }
        return;
      }

      if (event.type === 'broker') {
        if (event.status === 'listening') {
          setSimulation((current) => ({
            ...current,
            transactionBrokerPort: event.port ?? current.transactionBrokerPort,
          }));
          appendLog(`Transaction Broker Bridge listening on ${event.port}.`);
        } else if (event.status === 'error') {
          appendLog(`Transaction Broker Bridge error: ${event.message ?? 'unknown error'}`, 'warn');
        }
        return;
      }

      if (event.type === 'simulation') {
        const running = event.status === 'running';
        setRunningVisualState(running);
        if (!running) {
          setSimulation((current) => ({
            ...current,
            workspaceDir: event.workspaceDir ?? current.workspaceDir,
            transactionBrokerPort: event.transactionBrokerPort ?? current.transactionBrokerPort,
          }));
          resetDebugState('Simulation stopped.');
        }
        return;
      }

      if (event.type === 'uart') {
        if (event.status === 'connected' || event.status === 'disconnected' || event.status === 'error') {
          setSimulation((current) => ({
            ...current,
            uartConnected: event.status === 'connected',
            uartPort: event.port ?? current.uartPort,
          }));
        }
        const data =
          event.stream === 'system'
            ? `[system] ${event.data ?? ''}`
            : event.stream === 'tx'
              ? `[tx] ${event.data ?? ''}`
              : event.data ?? '';
        setUartTranscript((current) => `${current}${data}`.slice(-24000));
        return;
      }

      if (event.type === 'debug') {
        if (event.stream === 'stderr') {
          appendLog(`[GDB] ${event.message}`, 'error');
          return;
        }
        if (event.stream === 'console' && event.message) {
          appendLog(`[GDB] ${event.message}`);
          return;
        }
        if (event.status === 'connected') {
          setDebugState((current) => ({
            ...current,
            connected: true,
            running: false,
            lastMessage: `Debugger connected on port ${event.gdbPort ?? simulation.gdbPort}.`,
          }));
          appendLog(`Debugger connected on port ${event.gdbPort ?? simulation.gdbPort}.`);
          return;
        }
        if (event.status === 'disconnected') {
          resetDebugState('Debugger disconnected.');
          appendLog('Debugger disconnected.');
          return;
        }
        if (event.status === 'running') {
          setDebugState((current) => ({
            ...current,
            connected: true,
            running: true,
            lastMessage: 'Target running.',
          }));
          return;
        }
        if (event.status === 'stopped') {
          setDebugState((current) => ({
            ...current,
            connected: true,
            running: false,
            lastReason: event.reason ?? null,
            frame: event.frame ?? null,
            lastMessage: event.frame?.line
              ? `Stopped at line ${event.frame.line}${event.reason ? ` (${event.reason})` : ''}.`
              : `Stopped${event.reason ? ` (${event.reason})` : ''}.`,
          }));
          return;
        }
        if (event.status === 'error') {
          appendLog(`[GDB] ${event.message ?? event.raw ?? 'Unknown debugger error.'}`, 'error');
          return;
        }
      }
    });
  }, [appendLog, peripheralManifest.length, resetDebugState, setRunningVisualState, simulation.gdbPort]);

  const buildProjectDocument = useCallback(
    (): ProjectDocument => createProjectDocument({
      board: selectedBoard,
      wiring,
      showFullPinout,
      peripheralPositions,
      codeMode,
      mainSource: codeMode === 'generated' ? generatedCode : code,
    }),
    [code, codeMode, generatedCode, peripheralPositions, selectedBoard, showFullPinout, wiring]
  );

  const applyProjectDocumentToWorkspace = useCallback(
    (project: ProjectDocument, options: { filePath?: string | null; title?: string | null; dirty?: boolean; logMessage: string }) => {
      const projectBoard = getBoardSchema(project.board.id);
      const nextCode =
        project.code.mode === 'generated'
          ? compileNetlistToRenodeArtifacts({
              netlist: project.netlist,
              board: projectBoard,
              gdbPort: simulation.gdbPort,
              bridgePort: simulation.bridgePort,
              uartPort: simulation.uartPort,
            }).mainSource
          : project.code.mainSource;

      suppressNextProjectDirtyRef.current = true;
      setSelectedBoardId(projectBoard.id);
      setWiring(project.wiring);
      setShowFullPinout(project.layout.showFullPinout);
      setPeripheralPositions(normalizePeripheralPositions(project.layout.peripheralPositions, project.wiring));
      setCodeMode(project.code.mode);
      setCode(nextCode);
      setCodeDirty(true);
      setBuildResult(null);
      setArmedPeripheralId(null);
      setButtonStates({});
      setLedStates({});
      setProjectFilePath(options.filePath ?? null);
      setProjectTitle(options.title ?? null);
      setProjectDirty(options.dirty ?? false);
      resetDebugState('Project loaded. Debugger idle.');
      appendLog(`${options.logMessage} Board: ${projectBoard.name}.`);
    },
    [appendLog, resetDebugState]
  );

  const saveProject = useCallback(
    async (saveAs = false) => {
      if (!window.localWokwi) {
        appendLog('Electron preload API is unavailable. Project files can only be saved from the desktop shell.', 'warn');
        return;
      }

      setProjectBusy(true);
      let result;
      try {
        result = await window.localWokwi.saveProject({
          filePath: saveAs ? undefined : projectFilePath ?? undefined,
          saveAs,
          project: buildProjectDocument(),
        });
      } catch (error) {
        setProjectBusy(false);
        appendLog(error instanceof Error ? error.message : 'Project save failed.', 'error');
        return;
      }
      setProjectBusy(false);

      if (result.success) {
        setProjectFilePath(result.filePath ?? projectFilePath);
        setProjectTitle(null);
        setProjectDirty(false);
        appendLog(result.message || `Project saved${result.filePath ? `: ${result.filePath}` : ''}.`);
        return;
      }

      if (!result.canceled) {
        appendLog(result.message || 'Project save failed.', 'error');
      }
    },
    [appendLog, buildProjectDocument, projectFilePath]
  );

  const loadProject = useCallback(async () => {
    if (simulation.running) {
      appendLog('Stop the simulation before loading another project file.', 'warn');
      return;
    }

    if (!window.localWokwi) {
      appendLog('Electron preload API is unavailable. Project files can only be loaded from the desktop shell.', 'warn');
      return;
    }

    setProjectBusy(true);
    let result;
    try {
      result = await window.localWokwi.loadProject();
    } catch (error) {
      setProjectBusy(false);
      appendLog(error instanceof Error ? error.message : 'Project load failed.', 'error');
      return;
    }
    setProjectBusy(false);

    if (!result.success) {
      if (!result.canceled) {
        appendLog(result.message || 'Project load failed.', 'error');
      }
      return;
    }

    const loadResult = normalizeLoadedProjectDocument(result.project);
    if (!loadResult) {
      appendLog('The selected file is not a valid Renode Local Visualizer project.', 'error');
      return;
    }

    applyProjectDocumentToWorkspace(loadResult.project, {
      filePath: result.filePath ?? null,
      title: null,
      dirty: false,
      logMessage: `Project loaded${result.filePath ? `: ${result.filePath}` : ''}.`,
    });
    loadResult.warnings.forEach((warning) => appendLog(`[Project] ${warning}`, 'warn'));
  }, [appendLog, applyProjectDocumentToWorkspace, simulation.running]);

  const openExampleProject = useCallback(() => {
    if (simulation.running) {
      appendLog('Stop the simulation before opening a bundled example.', 'warn');
      return;
    }

    const example = getExampleProject(selectedExampleId, selectedBoard.id);
    if (!example) {
      appendLog('Choose a bundled example first.', 'warn');
      return;
    }

    const loadResult = normalizeLoadedProjectDocument(example.project);
    if (!loadResult) {
      appendLog(`Bundled example "${example.title}" is not a valid project document.`, 'error');
      return;
    }

    applyProjectDocumentToWorkspace(loadResult.project, {
      filePath: null,
      title: example.title,
      dirty: true,
      logMessage: `Example opened: ${example.title}. Use Save As when you want to keep your own copy.`,
    });
    loadResult.warnings.forEach((warning) => appendLog(`[Example] ${warning}`, 'warn'));
  }, [appendLog, applyProjectDocumentToWorkspace, selectedBoard.id, selectedExampleId, simulation.running]);

  const addPeripheral = useCallback(
    (templateKind: DemoPeripheralTemplateKind, preferredPosition?: PeripheralPosition) => {
      if (simulation.running) {
        appendLog('Stop the simulation before adding or removing external peripherals.', 'warn');
        return;
      }
      const nextDeviceCount = workbenchDevices.length + 1;
      if (nextDeviceCount > MAX_PERIPHERALS) {
        appendLog(`The current workbench is capped at ${MAX_PERIPHERALS} external parts.`, 'warn');
        return;
      }

      const firstButton = getPeripheralsByKind(wiring, 'button')[0] ?? null;
      const ordinal = countPeripheralTemplateInstances(wiring, templateKind) + 1;
      const nextPeripherals = createPeripheralTemplate(templateKind, ordinal).map((peripheral) =>
        peripheral.kind === 'led'
          ? {
              ...peripheral,
              sourcePeripheralId: firstButton?.id ?? null,
            }
          : peripheral
      );
      const deviceId = getWorkbenchDeviceId(nextPeripherals[0]);

      setWiring((current) => ({
        peripherals: [...current.peripherals, ...nextPeripherals],
      }));
      setPeripheralPositions((current) => ({
        ...current,
        [deviceId]: clampPeripheralPosition(
          preferredPosition ?? createDefaultPeripheralPosition(workbenchDevices.length),
          getCanvasHeightForPeripheralCount(nextDeviceCount)
        ),
      }));
      setArmedPeripheralId(nextPeripherals[0].id);
      appendLog(`${nextPeripherals[0].groupLabel ?? nextPeripherals[0].label} added. Drag its wire stub onto a free board hotspot to place it.`);
    },
    [appendLog, simulation.running, wiring, workbenchDevices.length]
  );

  const assignPadToPeripheral = useCallback(
    (peripheralId: string, pad: DemoBoardPad) => {
      if (simulation.running) {
        appendLog('Stop the simulation before moving wires to another header pin.', 'warn');
        return;
      }
      if (!pad.selectable) {
        appendLog(`${pad.connectorTitle} pin ${pad.pinNumber} is not routable for external GPIO wiring.`, 'warn');
        return;
      }

      const occupiedBy = findPeripheralForPad(wiring, pad.id);
      if (occupiedBy && occupiedBy.id !== peripheralId) {
        appendLog(`${describePad(pad)} is already used by ${occupiedBy.label}. Disconnect it first or pick another pad.`, 'warn');
        return;
      }

      const peripheral = wiring.peripherals.find((item) => item.id === peripheralId);
      if (!peripheral) {
        return;
      }
      const endpoint = getPeripheralEndpointDefinition(peripheral);

      const proposedWiring = {
        peripherals: wiring.peripherals.map((item) =>
          item.id === peripheralId
            ? {
                ...item,
                padId: pad.id,
              }
            : item
        ),
      };
      const blockingIssue = validateWiringRules(proposedWiring, selectedBoardPads).find(
        (issue) => issue.severity === 'error' && (issue.peripheralId === peripheralId || issue.padId === pad.id)
      );
      if (blockingIssue) {
        appendLog(blockingIssue.message, 'warn');
        return;
      }

      setWiring(proposedWiring);
      setArmedPeripheralId((current) => (current === peripheralId ? null : current));
      appendLog(`Wired ${peripheral.label} ${endpoint.label} to ${describePad(pad)}.`);
    },
    [appendLog, selectedBoardPads, simulation.running, wiring]
  );

  const assignPeripheralToPad = useCallback(
    (pad: DemoBoardPad) => {
      if (!armedPeripheralId) {
        appendLog('Choose a device card and start wiring before selecting a board pad.', 'warn');
        return;
      }

      assignPadToPeripheral(armedPeripheralId, pad);
    },
    [appendLog, armedPeripheralId, assignPadToPeripheral]
  );

  const toggleArmPeripheral = useCallback((peripheralId: string) => {
    setArmedPeripheralId((current) => (current === peripheralId ? null : peripheralId));
  }, []);

  const disconnectPeripheral = useCallback(
    (peripheralId: string) => {
      if (simulation.running) {
        appendLog('Stop the simulation before disconnecting wires.', 'warn');
        return;
      }

      setWiring((current) => ({
        peripherals: current.peripherals.map((item) =>
          item.id === peripheralId
            ? {
                ...item,
                padId: null,
              }
            : item
        ),
      }));
      appendLog('Peripheral wire removed from the board.');
    },
    [appendLog, simulation.running]
  );

  const removePeripheral = useCallback(
    (peripheralId: string) => {
      if (simulation.running) {
        appendLog('Stop the simulation before removing external peripherals.', 'warn');
        return;
      }

      const peripheral = wiring.peripherals.find((item) => item.id === peripheralId);
      if (!peripheral) {
        return;
      }

      setWiring((current) => {
        const nextPeripherals = current.peripherals
          .filter((item) => item.id !== peripheralId)
          .map((item) =>
            item.kind === 'led' && item.sourcePeripheralId === peripheralId
              ? {
                  ...item,
                  sourcePeripheralId: null,
                }
              : item
          );
        return { peripherals: nextPeripherals };
      });

      setArmedPeripheralId((current) => (current === peripheralId ? null : current));
      setButtonStates((current) => {
        const next = { ...current };
        delete next[peripheralId];
        return next;
      });
      setLedStates((current) => {
        const next = { ...current };
        delete next[peripheralId];
        return next;
      });
      appendLog(`${peripheral.label} removed from the workbench.`);
    },
    [appendLog, simulation.running, wiring]
  );

  const removeDevice = useCallback(
    (deviceId: string) => {
      if (simulation.running) {
        appendLog('Stop the simulation before removing external peripherals.', 'warn');
        return;
      }

      const members = wiring.peripherals.filter((peripheral) => getWorkbenchDeviceId(peripheral) === deviceId);
      if (members.length === 0) {
        return;
      }

      const removedIds = new Set<string>(members.map((member) => member.id));
      const deviceLabel = members[0].groupLabel ?? members[0].label;

      setWiring((current) => ({
        peripherals: current.peripherals
          .filter((item) => !removedIds.has(item.id))
          .map((item) =>
            item.kind === 'led' && item.sourcePeripheralId && removedIds.has(item.sourcePeripheralId)
              ? {
                  ...item,
                  sourcePeripheralId: null,
                }
              : item
          ),
      }));
      setArmedPeripheralId((current) => (current && removedIds.has(current) ? null : current));
      setButtonStates((current) => {
        const next = { ...current };
        Array.from(removedIds).forEach((id) => delete next[id]);
        return next;
      });
      setLedStates((current) => {
        const next = { ...current };
        Array.from(removedIds).forEach((id) => delete next[id]);
        return next;
      });
      appendLog(`${deviceLabel} removed from the workbench.`);
    },
    [appendLog, simulation.running, wiring]
  );

  const updateLedSource = useCallback((ledId: string, sourceId: string | null) => {
    setWiring((current) => ({
      peripherals: current.peripherals.map((item) =>
        item.id === ledId
          ? {
              ...item,
              sourcePeripheralId: sourceId,
            }
          : item
      ),
    }));
  }, []);

  const movePeripheral = useCallback((peripheralId: string, position: PeripheralPosition) => {
    const canvasHeight = getCanvasHeightForPeripheralCount(workbenchDevices.length);
    setPeripheralPositions((current) => ({
      ...current,
      [peripheralId]: clampPeripheralPosition(position, canvasHeight),
    }));
  }, [workbenchDevices.length]);

  const beginWiring = useCallback((peripheralId: string) => {
    setArmedPeripheralId(peripheralId);
  }, []);

  const sendButtonState = useCallback(
    async (peripheralId: string, pressed: boolean) => {
      if (!simulation.running || !window.localWokwi) {
        return;
      }

      setButtonStates((current) => ({
        ...current,
        [peripheralId]: pressed,
      }));
      setSignalBrokerState((current) =>
        recordSignalSample(current, {
          peripheralId,
          value: pressed,
          source: 'ui',
          timestampMs: Date.now(),
        })
      );

      const result = await window.localWokwi.sendPeripheralEvent({
        type: 'button',
        id: peripheralId,
        state: pressed ? 1 : 0,
      });

      if (!result.success) {
        appendLog(result.message || 'Failed to send button event.', 'error');
      }
    },
    [appendLog, simulation.running]
  );

  const sendUartText = useCallback(
    async (lineMode = false) => {
      if (!window.localWokwi) {
        appendLog('Electron preload API is unavailable.', 'warn');
        return;
      }
      if (!simulation.running || !simulation.uartConnected) {
        appendLog('Start the simulation and wait for the UART terminal to connect before sending text.', 'warn');
        return;
      }

      const payload = lineMode ? `${uartInput}\r\n` : uartInput;
      if (!payload) {
        return;
      }

      const result = await window.localWokwi.sendUartData({ data: payload });
      if (!result.success) {
        appendLog(result.message ?? 'Failed to send UART data.', 'error');
        return;
      }
      setUartInput('');
    },
    [appendLog, simulation.running, simulation.uartConnected, uartInput]
  );

  const clearLogicAnalyzer = useCallback(() => {
    const nowMs = Date.now();
    setSignalBrokerState(createSignalBrokerState(signalDefinitions, nowMs));
    setRuntimeTimelineState(createRuntimeTimelineState(nowMs));
    setSsd1306State(createSsd1306State());
    setLogicAnalyzerClock(nowMs);
  }, [signalDefinitions]);

  const useGeneratedDemoCode = useCallback(() => {
    setCode(generatedCode);
    setCodeMode('generated');
    setCodeDirty(true);
    appendLog(`Regenerated demo firmware from ${connectedButtons.length} button(s) and ${connectedLeds.length} output endpoint(s).`);
  }, [appendLog, connectedButtons.length, connectedLeds.length, generatedCode]);

  const compileFirmware = useCallback(async () => {
    if (!window.localWokwi) {
      appendLog('Electron preload API is unavailable.', 'warn');
      return null;
    }

    if (blockingValidationErrors.length > 0) {
      appendLog(`Fix validation issues before compiling: ${blockingValidationErrors[0].message}`, 'error');
      return null;
    }

    const sourceToCompile = codeMode === 'generated' ? generatedCode : code;
    if (codeMode === 'generated' && code !== sourceToCompile) {
      setCode(sourceToCompile);
    }

    setIsCompiling(true);
    appendLog(
      `Compile requested for ${connectedButtons.length} button(s), ${connectedLeds.length} output endpoint(s), ${peripheralManifest.length} connected peripheral endpoint(s).`
    );

    const result = await window.localWokwi.compileFirmware({
      workspaceDir: buildResult?.workspaceDir ?? undefined,
      mainSource: sourceToCompile,
      startupSource: DEFAULT_STARTUP_SOURCE,
      linkerScript: selectedBoard.runtime.compiler.linkerScript,
      linkerFileName: selectedBoard.runtime.compiler.linkerFileName,
      gccArgs: [...selectedBoard.runtime.compiler.gccArgs],
    });

    setIsCompiling(false);
    setBuildResult(result);

    if (result.success) {
      setCodeDirty(false);
      appendLog(`Compilation succeeded: ${result.elfPath}`);
      if (result.workspaceDir) {
        setSimulation((current) => ({
          ...current,
          workspaceDir: result.workspaceDir ?? current.workspaceDir,
        }));
      }
    } else {
      appendLog(result.message, 'error');
    }

    if (result.stdout) {
      appendLog(result.stdout.trimEnd());
    }
    if (result.stderr) {
      appendLog(result.stderr.trimEnd(), result.success ? 'warn' : 'error');
    }

    await refreshTooling();
    return result;
  }, [
    appendLog,
    buildResult?.workspaceDir,
    code,
    codeMode,
    connectedButtons.length,
    connectedLeds.length,
    generatedCode,
    peripheralManifest.length,
    refreshTooling,
    selectedBoard.runtime.compiler.gccArgs,
    selectedBoard.runtime.compiler.linkerFileName,
    selectedBoard.runtime.compiler.linkerScript,
    blockingValidationErrors,
  ]);

  const startSimulation = useCallback(async () => {
    if (!window.localWokwi) {
      appendLog('Electron preload API is unavailable.', 'warn');
      return;
    }

    if (peripheralManifest.length === 0 && !hasSsd1306Device) {
      appendLog('Connect at least one external peripheral before starting Renode.', 'warn');
      return;
    }

    if (blockingValidationErrors.length > 0) {
      appendLog(`Fix validation issues before starting Renode: ${blockingValidationErrors[0].message}`, 'error');
      return;
    }

    let compileResult = buildResult;
    if (!compileResult?.success || !compileResult.elfPath || codeDirty) {
      compileResult = await compileFirmware();
    }

    if (!compileResult?.success || !compileResult.elfPath || !compileResult.workspaceDir) {
      appendLog('Simulation was not started because the build step did not produce a valid ELF.', 'error');
      return;
    }

    appendLog(`Starting Renode with ${peripheralManifest.length} GPIO endpoint(s), Transaction Broker Bridge, and ${hasSsd1306Device ? 'SSD1306 I2C broker demo' : 'no I2C display'}...`);

    const result = await window.localWokwi.startSimulation({
      workspaceDir: compileResult.workspaceDir,
      elfPath: compileResult.elfPath,
      boardRepl,
      peripheralManifest,
      signalManifest: runtimeSignalManifest,
      busManifest: runtimeBusManifest,
      bridgePort: simulation.bridgePort,
      gdbPort: simulation.gdbPort,
      transactionBrokerPort: simulation.transactionBrokerPort ?? undefined,
      machineName: selectedBoard.machineName,
      uartPeripheralName,
      enableI2cDemoFeed: true,
    });

    if (!result.success) {
      appendLog(result.message, 'error');
      return;
    }

    setSimulation((current) => ({
      ...current,
      running: true,
      workspaceDir: result.workspaceDir ?? current.workspaceDir,
      bridgePort: result.bridgePort ?? current.bridgePort,
      gdbPort: result.gdbPort ?? current.gdbPort,
      transactionBrokerPort: result.transactionBrokerPort ?? current.transactionBrokerPort,
      uartPort: result.uartPort ?? current.uartPort,
      uartConnected: result.uartReady ?? current.uartConnected,
    }));
    setButtonStates({});
    setLedStates({});
    const nowMs = Date.now();
    setSignalBrokerState(createSignalBrokerState(signalDefinitions, nowMs));
    setRuntimeTimelineState(createRuntimeTimelineState(nowMs));
    setSsd1306State(createSsd1306State());
    setUartTranscript(
      `UART terminal starting for ${selectedBoard.runtime.uart?.displayName ?? uartPeripheralName ?? 'board UART'} (${uartPeripheralName ?? 'none'}).\n`
    );
    appendLog(`Renode launched. Transaction Broker Bridge is listening on ${result.transactionBrokerPort ?? simulation.transactionBrokerPort}.`);
  }, [
    appendLog,
    boardRepl,
    buildResult,
    codeDirty,
    compileFirmware,
    peripheralManifest,
    hasSsd1306Device,
    runtimeBusManifest,
    runtimeSignalManifest,
    selectedBoard.machineName,
    selectedBoard.runtime.uart?.displayName,
    signalDefinitions,
    simulation.bridgePort,
    simulation.gdbPort,
    simulation.transactionBrokerPort,
    uartPeripheralName,
    blockingValidationErrors,
  ]);

  const stopSimulation = useCallback(async () => {
    if (!window.localWokwi) {
      return;
    }
    await window.localWokwi.stopSimulation();
    setRunningVisualState(false);
    resetDebugState('Simulation stopped.');
    appendLog('Simulation stop requested.');
  }, [appendLog, resetDebugState, setRunningVisualState, simulation.bridgePort, simulation.gdbPort, simulation.uartPort]);

  const startDebugger = useCallback(async () => {
    if (!window.localWokwi || !buildResult?.elfPath) {
      appendLog('Compile and start the simulation before attaching GDB.', 'warn');
      return;
    }
    const result = await window.localWokwi.startDebugging({
      workspaceDir: buildResult.workspaceDir,
      elfPath: buildResult.elfPath,
      gdbPort: simulation.gdbPort,
    });
    if (!result.success) {
      appendLog(result.message, 'error');
    }
  }, [appendLog, buildResult?.elfPath, buildResult?.workspaceDir, simulation.gdbPort]);

  const stopDebugger = useCallback(async () => {
    if (!window.localWokwi) {
      return;
    }
    const result = await window.localWokwi.stopDebugging();
    if (!result.success) {
      appendLog(result.message, 'warn');
    }
  }, [appendLog]);

  const runDebugAction = useCallback(
    async (action: 'continue' | 'next' | 'step' | 'interrupt' | 'break-main' | 'break-line') => {
      if (!window.localWokwi) {
        return;
      }

      const line = debugState.frame?.line ?? 1;
      const result = await window.localWokwi.debugAction({
        action,
        line: action === 'break-line' ? line : undefined,
      });

      if (!result.success && result.message) {
        appendLog(result.message, 'warn');
      }
    },
    [appendLog, debugState.frame?.line]
  );

  return (
    <div className="h-full bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_30%),linear-gradient(180deg,#070b17,#020617)] text-white">
      <div className="flex h-full min-w-[1660px]">
        <div className="flex min-w-0 flex-1 flex-col border-r border-slate-800/80">
          <div className="border-b border-slate-800/80 px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 text-cyan-300">
                  <Wrench size={18} />
                  <span className="text-xs uppercase tracking-[0.28em]">Local Board Lab</span>
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                  Build with visible wires on a live {selectedBoard.name} board
                </h1>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
                  Add external peripherals, arm a device, click a free board pad, and the workbench will regenerate{' '}
                  <span className="font-semibold text-white">main.c</span>, <span className="font-semibold text-white">board.repl</span>,
                  compile the firmware, and keep the live Renode simulation synchronized with your wiring.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <ToolBadge label="Renode" status={tooling?.renode ?? null} />
                <ToolBadge label="GCC" status={tooling?.gcc ?? null} />
                <ToolBadge label="GDB" status={tooling?.gdb ?? null} />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill active={Boolean(buildResult?.success)} label="ELF ready" />
              <StatusPill active={simulation.running} label="Renode running" />
              <StatusPill active={simulation.bridgeConnected} label="Bridge online" />
              <StatusPill active={simulation.uartConnected} label="UART online" />
              <StatusPill active={debugState.connected} label="Debugger attached" />
              <StatusPill active={wiringRuleErrors.length === 0} label="Pin rules OK" />
              <StatusPill active={netlistErrors.length === 0} label="Netlist OK" />
              <StatusPill active={signalDefinitions.length > 0} label="Signal broker" />
            </div>

            <div className="mt-4 grid gap-3 rounded-[28px] border border-slate-800 bg-slate-950/70 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Board Selector</div>
                <div className="mt-2 text-sm text-slate-300">
                  Select an STM32 board profile. The visible pins, generated firmware, Renode platform, compiler target, and examples all follow this choice.
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
                  <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-cyan-200">{selectedBoard.family}</span>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">{selectedBoard.status}</span>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
                    {selectedBoard.connectors.selectablePads.length} GPIO pads
                  </span>
                </div>
              </div>
              <select
                value={selectedBoard.id}
                onChange={(event) => switchBoard(event.target.value)}
                disabled={simulation.running}
                className="h-12 rounded-2xl border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-slate-100 outline-none transition hover:border-cyan-500 disabled:cursor-not-allowed disabled:text-slate-500"
              >
                {BOARD_SCHEMAS.map((board) => (
                  <option key={board.id} value={board.id} className="text-slate-950">
                    {board.name} {board.status === 'experimental' ? '(experimental)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
            <WiringWorkbench
              board={selectedBoard}
              wiring={wiring}
              armedPeripheralId={armedPeripheralId}
              ledStates={ledStates}
              buttonStates={buttonStates}
              simulationRunning={simulation.running}
              showFullPinout={showFullPinout}
              peripheralPositions={peripheralPositions}
              onAssign={assignPeripheralToPad}
              onAssignPeripheralToPad={assignPadToPeripheral}
              onAddPeripheral={addPeripheral}
              onBeginWiring={beginWiring}
              onArmPeripheral={toggleArmPeripheral}
              onDisconnectPeripheral={disconnectPeripheral}
              onRemoveDevice={removeDevice}
              onRemovePeripheral={removePeripheral}
              onPressPeripheral={(peripheralId, pressed) => void sendButtonState(peripheralId, pressed)}
              onSourceChange={updateLedSource}
              onToggleFullPinout={() => setShowFullPinout((current) => !current)}
              onMovePeripheral={movePeripheral}
            />
          </div>
        </div>

        <div className="flex w-[640px] shrink-0 flex-col bg-slate-950/80">
          <div className="border-b border-slate-800 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Control</div>
                <div className="mt-1 text-sm text-slate-300">
                  Build the current peripheral graph into a real ELF, then launch the local Renode runtime.
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void compileFirmware()}
                  disabled={isCompiling || simulation.running || blockingValidationErrors.length > 0}
                  className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition ${
                    isCompiling || simulation.running || blockingValidationErrors.length > 0
                      ? 'cursor-not-allowed bg-slate-800 text-slate-500'
                      : 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20 hover:bg-cyan-400'
                  }`}
                >
                  {isCompiling ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
                  {isCompiling ? 'Compiling...' : 'Compile'}
                </button>

                {simulation.running ? (
                  <button
                    onClick={() => void stopSimulation()}
                    className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-rose-600/20 transition hover:bg-rose-500"
                  >
                    <Square size={15} fill="currentColor" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => void startSimulation()}
                    disabled={isCompiling || blockingValidationErrors.length > 0}
                    className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      isCompiling || blockingValidationErrors.length > 0
                        ? 'cursor-not-allowed bg-slate-800 text-slate-500'
                        : 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400'
                    }`}
                  >
                    <Play size={15} fill="currentColor" />
                    Start
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Project</div>
                  <div className="mt-1 flex items-center gap-2 text-sm text-slate-300">
                    <span className="truncate font-semibold text-white">{projectDisplayName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
                      projectDirty ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'
                    }`}>
                      {projectDirty ? 'Unsaved' : 'Saved'}
                    </span>
                  </div>
                  <div className="mt-1 max-w-[360px] truncate text-xs text-slate-500">
                    {projectFilePath ?? 'Save this wiring as a .renode-wokwi.json project file.'}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    onClick={() => void saveProject(false)}
                    disabled={projectBusy}
                    className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-medium transition ${
                      projectBusy ? 'cursor-not-allowed bg-slate-800 text-slate-500' : 'bg-slate-100 text-slate-950 hover:bg-white'
                    }`}
                  >
                    {projectBusy ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}
                    Save
                  </button>
                  <button
                    onClick={() => void saveProject(true)}
                    disabled={projectBusy}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    <FileJson size={14} />
                    Save As
                  </button>
                  <button
                    onClick={() => void loadProject()}
                    disabled={projectBusy || simulation.running}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    <FolderOpen size={14} />
                    Load
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Examples</div>
                    <div className="mt-1 text-xs text-slate-400">
                      Open a known-good project and run it immediately, then Save As to make your own copy.
                    </div>
                  </div>
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                    {boardExamples.length} demos
                  </span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    value={selectedExampleId}
                    onChange={(event) => setSelectedExampleId(event.target.value)}
                    disabled={projectBusy || simulation.running}
                    className="min-w-0 rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    {boardExamples.map((example) => (
                      <option key={example.id} value={example.id} className="text-slate-950">
                        {example.title}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => openExampleProject()}
                    disabled={projectBusy || simulation.running || !selectedExample}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-3 py-2 text-xs font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                  >
                    <FolderOpen size={14} />
                    Open Example
                  </button>
                </div>

                {selectedExample ? (
                  <div className="mt-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
                    <span className="font-semibold uppercase tracking-[0.16em] text-slate-300">{selectedExample.difficulty}</span>
                    <span className="mx-2 text-slate-600">/</span>
                    {selectedExample.summary}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Pin Rule Check</div>
                  <div className="mt-1 text-sm text-slate-300">
                    {wiringRuleErrors.length === 0
                      ? 'Every wired endpoint matches the selected board pad capabilities.'
                      : `${wiringRuleErrors.length} blocking issue(s) must be fixed before compile/start.`}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200">
                    {wiringRuleErrors.length} errors
                  </span>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
                    {wiringRuleWarnings.length} warnings
                  </span>
                </div>
              </div>

              <div className="mt-3 grid gap-2">
                {wiringRuleIssues.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    Schema validation passed: GPIO inputs go to digital input-capable pads, outputs go to digital output-capable pads, and no pad is shared.
                  </div>
                ) : (
                  wiringRuleIssues.slice(0, 4).map((issue) => (
                    <div key={issue.id} className={`rounded-2xl border px-3 py-2 text-xs ${getRuleIssueTone(issue)}`}>
                      {issue.message}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Netlist / IR</div>
                  <div className="mt-1 text-sm text-slate-300">
                    {netlistErrors.length === 0
                      ? 'Unified circuit IR is ready for Renode artifact generation.'
                      : `${netlistErrors.length} IR issue(s) block Renode generation.`}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-200">
                    pkg v{COMPONENT_PACKAGE_CATALOG_VERSION}
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-slate-300">
                    {netlistWarnings.length} warnings
                  </span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-300">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Components</div>
                  <div className="mt-1 font-semibold text-white">{netlistSummary.packageComponentCount}</div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Nets</div>
                  <div className="mt-1 font-semibold text-white">{netlistSummary.netCount}</div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Edges</div>
                  <div className="mt-1 font-semibold text-white">{netlistSummary.connectionCount}</div>
                </div>
              </div>

              <div className="mt-3 grid gap-2">
                {netlistIssues.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    IR validation passed: component packages, board pads, GPIO nets, and Renode compile artifacts are aligned.
                  </div>
                ) : (
                  netlistIssues.slice(0, 4).map((issue) => (
                    <div key={issue.id} className={`rounded-2xl border px-3 py-2 text-xs ${getRuleIssueTone(issue)}`}>
                      {issue.message}
                    </div>
                  ))
                )}
              </div>
            </div>

            <GpioMonitorPanel state={signalBrokerState} nowMs={logicAnalyzerNow} />

            <LogicAnalyzerPanel state={signalBrokerState} nowMs={logicAnalyzerNow} onClear={clearLogicAnalyzer} />

            <RuntimeTimelinePanel
              state={runtimeTimelineState}
              busManifest={runtimeBusManifest}
              transactionBrokerPort={simulation.transactionBrokerPort}
            />

            {hasSsd1306Device ? <Ssd1306PreviewPanel state={ssd1306State} /> : null}

            <div className="mt-4 grid gap-2 text-sm text-slate-300">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Build artifact</div>
                <div className="mt-1 break-all">{buildResult?.elfPath || 'No ELF generated yet'}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Connected peripherals</div>
                <div className="mt-1">
                  {peripheralManifest.length === 0
                    ? 'No external peripherals connected'
                    : peripheralManifest.map((item) => item.label).join(', ')}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Bridge port</div>
                  <div className="mt-1">{simulation.bridgePort}</div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">GDB port</div>
                  <div className="mt-1">{simulation.gdbPort}</div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">UART terminal</div>
                <div className="mt-1">
                  {selectedBoard.runtime.uart
                    ? `${selectedBoard.runtime.uart.displayName} via Renode ${selectedBoard.runtime.uart.peripheralName}${simulation.uartPort ? ` on socket ${simulation.uartPort}` : ''}`
                    : 'No UART socket terminal configured for this board'}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Debugger</div>
                  <div className="mt-1 text-sm text-slate-300">{debugState.lastMessage}</div>
                </div>
                <div className="flex gap-2">
                  {debugState.connected ? (
                    <button
                      onClick={() => void stopDebugger()}
                      className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
                    >
                      Detach GDB
                    </button>
                  ) : (
                    <button
                      onClick={() => void startDebugger()}
                      disabled={!simulation.running || !buildResult?.elfPath}
                      className={`rounded-2xl px-3 py-1.5 text-xs font-medium transition ${
                        !simulation.running || !buildResult?.elfPath
                          ? 'cursor-not-allowed bg-slate-800 text-slate-500'
                          : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                      }`}
                    >
                      Attach GDB
                    </button>
                  )}
                  <button
                    onClick={() => void runDebugAction('break-main')}
                    disabled={!debugState.connected}
                    className={`rounded-2xl px-3 py-1.5 text-xs font-medium transition ${
                      debugState.connected
                        ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                        : 'cursor-not-allowed bg-slate-800 text-slate-500'
                    }`}
                  >
                    Break main
                  </button>
                  <button
                    onClick={() => void runDebugAction('break-line')}
                    disabled={!debugState.connected}
                    className={`rounded-2xl px-3 py-1.5 text-xs font-medium transition ${
                      debugState.connected
                        ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                        : 'cursor-not-allowed bg-slate-800 text-slate-500'
                    }`}
                  >
                    Break line
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2">
                <button
                  onClick={() => void runDebugAction('interrupt')}
                  disabled={!debugState.connected || !debugState.running}
                  className={`rounded-2xl px-3 py-2 text-xs font-medium transition ${
                    debugState.connected && debugState.running
                      ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                      : 'cursor-not-allowed bg-slate-800 text-slate-500'
                  }`}
                >
                  Pause
                </button>
                <button
                  onClick={() => void runDebugAction('continue')}
                  disabled={!debugState.connected}
                  className={`rounded-2xl px-3 py-2 text-xs font-medium transition ${
                    debugState.connected
                      ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                      : 'cursor-not-allowed bg-slate-800 text-slate-500'
                  }`}
                >
                  Continue
                </button>
                <button
                  onClick={() => void runDebugAction('next')}
                  disabled={!debugState.connected}
                  className={`rounded-2xl px-3 py-2 text-xs font-medium transition ${
                    debugState.connected
                      ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                      : 'cursor-not-allowed bg-slate-800 text-slate-500'
                  }`}
                >
                  Step Over
                </button>
                <button
                  onClick={() => void runDebugAction('step')}
                  disabled={!debugState.connected}
                  className={`rounded-2xl px-3 py-2 text-xs font-medium transition ${
                    debugState.connected
                      ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                      : 'cursor-not-allowed bg-slate-800 text-slate-500'
                  }`}
                >
                  Step Into
                </button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-b border-slate-800">
            <div className="flex items-end justify-between border-b border-slate-800 bg-slate-950 px-2 pt-2">
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveTab('code')}
                  className={`inline-flex items-center gap-2 rounded-t-2xl px-4 py-2 text-xs font-mono ${
                    activeTab === 'code'
                      ? 'border-x border-t border-slate-800 bg-[#181d28] text-amber-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <FileCode2 size={14} />
                  main.c
                </button>
                <button
                  onClick={() => setActiveTab('repl')}
                  className={`inline-flex items-center gap-2 rounded-t-2xl px-4 py-2 text-xs font-mono ${
                    activeTab === 'repl'
                      ? 'border-x border-t border-slate-800 bg-[#181d28] text-sky-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <FileJson size={14} />
                  board.repl
                </button>
                <button
                  onClick={() => setActiveTab('resc')}
                  className={`inline-flex items-center gap-2 rounded-t-2xl px-4 py-2 text-xs font-mono ${
                    activeTab === 'resc'
                      ? 'border-x border-t border-slate-800 bg-[#181d28] text-emerald-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Code2 size={14} />
                  run.resc
                </button>
                <button
                  onClick={() => setActiveTab('uart')}
                  className={`inline-flex items-center gap-2 rounded-t-2xl px-4 py-2 text-xs font-mono ${
                    activeTab === 'uart'
                      ? 'border-x border-t border-slate-800 bg-[#181d28] text-fuchsia-300'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Terminal size={14} />
                  UART
                </button>
              </div>

              <div className="mb-1 flex items-center gap-2 pr-2 text-xs text-slate-500">
                {codeMode === 'manual' ? (
                  <button
                    onClick={() => useGeneratedDemoCode()}
                    className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-100 transition hover:bg-cyan-500/20"
                  >
                    Use generated demo code
                  </button>
                ) : null}

                {codeDirty ? (
                  <>
                    <TriangleAlert size={13} />
                    source or wiring changed since last build
                  </>
                ) : buildResult?.success ? (
                  <>
                    <CheckCircle2 size={13} />
                    build artifact is current
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex-1 overflow-hidden bg-[#151922]">
              {activeTab === 'code' ? (
                <Editor
                  height="100%"
                  defaultLanguage="c"
                  theme="vs-dark"
                  value={code}
                  onMount={(editor, monaco) => {
                    codeEditorRef.current = editor;
                    monacoRef.current = monaco;
                  }}
                  onChange={(value) => {
                    const nextValue = value || '';
                    setCode(nextValue);
                    setCodeDirty(true);
                    setCodeMode(nextValue === generatedCode ? 'generated' : 'manual');
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    glyphMargin: true,
                    scrollBeyondLastLine: false,
                    readOnly: simulation.running,
                    padding: { top: 16 },
                  }}
                />
              ) : activeTab === 'repl' ? (
                <Editor
                  height="100%"
                  defaultLanguage="plaintext"
                  theme="vs-dark"
                  value={boardRepl}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    readOnly: true,
                    padding: { top: 16 },
                  }}
                />
              ) : activeTab === 'resc' ? (
                <Editor
                  height="100%"
                  defaultLanguage="plaintext"
                  theme="vs-dark"
                  value={rescPreview}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    readOnly: true,
                    padding: { top: 16 },
                  }}
                />
              ) : (
                <div className="flex h-full flex-col bg-[#070b12] font-mono text-xs leading-5 text-fuchsia-100">
                  <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-800 pb-3 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    <span className="px-4 pt-4">
                      {selectedBoard.runtime.uart
                        ? `${selectedBoard.runtime.uart.displayName} (${selectedBoard.runtime.uart.peripheralName}) socket${simulation.uartPort ? `:${simulation.uartPort}` : ''}`
                        : 'UART terminal'}
                    </span>
                    <button
                      onClick={() => setUartTranscript('UART terminal cleared.\n')}
                      className="mr-4 mt-4 rounded-full border border-slate-700 px-3 py-1 text-slate-300 transition hover:border-slate-500 hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                  <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 pb-4">{uartTranscript}</pre>
                  <div className="border-t border-slate-800 bg-slate-950/80 p-3">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                      {simulation.uartConnected ? 'UART connected, input is sent to MCU RX' : 'UART input waits for simulation'}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <input
                        value={uartInput}
                        onChange={(event) => setUartInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void sendUartText(true);
                          }
                        }}
                        disabled={!simulation.running || !simulation.uartConnected}
                        placeholder="Type text to send over UART..."
                        className="min-w-0 rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-fuchsia-50 outline-none transition placeholder:text-slate-600 focus:border-fuchsia-400 disabled:cursor-not-allowed disabled:text-slate-500"
                      />
                      <button
                        onClick={() => void sendUartText(false)}
                        disabled={!simulation.running || !simulation.uartConnected || !uartInput}
                        className="rounded-2xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-100 transition hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
                      >
                        Send
                      </button>
                      <button
                        onClick={() => void sendUartText(true)}
                        disabled={!simulation.running || !simulation.uartConnected || !uartInput}
                        className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
                      >
                        Send Line
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex h-72 flex-col">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-950 px-4 text-xs uppercase tracking-[0.28em] text-slate-500">
              <Terminal size={14} />
              runtime log
            </div>
            <div className="flex-1 overflow-auto bg-[#0b1120] px-4 py-3 font-mono text-xs">
              {logs.map((entry) => (
                <div
                  key={entry.id}
                  className={`mb-1 whitespace-pre-wrap ${
                    entry.level === 'error' ? 'text-rose-300' : entry.level === 'warn' ? 'text-amber-300' : 'text-slate-300'
                  }`}
                >
                  {entry.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
