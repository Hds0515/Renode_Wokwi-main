import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Cpu,
  FileCode2,
  FileJson,
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
  DEFAULT_GCC_ARGS,
  DEFAULT_GDB_PORT,
  DEFAULT_LINKER_FILENAME,
  DEFAULT_LINKER_SCRIPT,
  DEFAULT_MAIN_SOURCE,
  DEFAULT_STARTUP_SOURCE,
  DEMO_BOARD_NAME,
  DEMO_BOARD_TAGLINE,
  DEMO_CONNECTORS,
  DEMO_LEFT_CONNECTORS,
  DEMO_LEFT_MORPHO_CONNECTOR,
  DEMO_MACHINE_NAME,
  DEMO_RIGHT_CONNECTORS,
  DEMO_RIGHT_MORPHO_CONNECTOR,
  DEMO_SELECTABLE_PADS,
  MAX_PERIPHERALS,
  DemoBoardConnector,
  DemoBoardPad,
  DemoPeripheral,
  DemoPeripheralKind,
  DemoPeripheralTemplateKind,
  DemoWiring,
  buildPeripheralManifest,
  createPeripheralTemplate,
  describePad,
  generateBoardRepl,
  generateDemoMainSource,
  generateRescPreview,
  getConnectedPeripherals,
  getPeripheralsByKind,
  getPeripheralTemplateKind,
  resolveSelectablePad,
} from './lib/firmware';

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
  workspaceDir: string | null;
  gdbPort: number;
  bridgePort: number;
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
type PeripheralPosition = {
  x: number;
  y: number;
};

type WorkbenchDevice = {
  id: string;
  label: string;
  templateKind: DemoPeripheralTemplateKind;
  members: DemoPeripheral[];
};

const ONBOARD_FEATURES = [
  { label: 'LD1', detail: 'PB0 · Green LED' },
  { label: 'LD2', detail: 'PE1 · Yellow LED' },
  { label: 'LD3', detail: 'PB14 · Red LED' },
  { label: 'B1', detail: 'PC13 · User Button' },
];

const BOARD_CONNECTOR_LAYOUT = {
  CN11: { x: 0, y: 24, width: 108, layout: 'dual' as const },
  CN7: { x: 128, y: 50, width: 90, layout: 'single' as const },
  CN8: { x: 128, y: 228, width: 90, layout: 'single' as const },
  CN9: { x: 542, y: 50, width: 90, layout: 'single' as const },
  CN10: { x: 542, y: 228, width: 90, layout: 'single' as const },
  CN12: { x: 652, y: 24, width: 108, layout: 'dual' as const },
};

const WOKWI_CURATED_PAD_IDS = new Set<string>([
  'CN7-8',
  'CN7-9',
  'CN7-10',
  'CN7-11',
  'CN7-12',
  'CN7-13',
  'CN7-14',
  'CN7-15',
  'CN8-1',
  'CN8-2',
  'CN8-3',
  'CN8-4',
  'CN8-5',
  'CN8-6',
  'CN8-7',
  'CN8-8',
  'CN8-9',
  'CN8-10',
  'CN9-1',
  'CN9-3',
  'CN9-5',
  'CN9-7',
  'CN10-3',
  'CN10-5',
  'CN10-7',
  'CN10-9',
]);

const BOARD_CANVAS_WIDTH = 760;
const BOARD_CANVAS_BASE_HEIGHT = 510;
const PERIPHERAL_CARD_WIDTH = 138;
const PERIPHERAL_CARD_HEIGHT = 86;
const PERIPHERALS_PER_ROW = 4;
const PERIPHERAL_ROW_GAP = 18;
const PAD_HOTSPOT_SIZE = 18;
const PAD_HOVER_LABEL_WIDTH = 140;
const BOARD_TOP_VIEW_HEIGHT = 312;
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
  return rawValue === 'button' || rawValue === 'led' || rawValue === 'buzzer' || rawValue === 'rgb-led' ? rawValue : null;
}

function getWorkbenchDeviceId(peripheral: DemoPeripheral) {
  return peripheral.groupId ?? peripheral.id;
}

function buildWorkbenchDevices(wiring: DemoWiring): WorkbenchDevice[] {
  const orderedDeviceIds: string[] = [];
  const membersById = new Map<string, DemoPeripheral[]>();

  wiring.peripherals.forEach((peripheral) => {
    const deviceId = getWorkbenchDeviceId(peripheral);
    if (!membersById.has(deviceId)) {
      orderedDeviceIds.push(deviceId);
      membersById.set(deviceId, []);
    }
    membersById.get(deviceId)!.push(peripheral);
  });

  return orderedDeviceIds.map((deviceId) => {
    const members = membersById.get(deviceId)!;
    const lead = members[0];
    return {
      id: deviceId,
      label: lead.groupLabel ?? lead.label,
      templateKind: getPeripheralTemplateKind(lead),
      members,
    };
  });
}

function countTemplateInstances(wiring: DemoWiring, templateKind: DemoPeripheralTemplateKind) {
  return buildWorkbenchDevices(wiring).filter((device) => device.templateKind === templateKind).length;
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
  if (templateKind === 'button') {
    return {
      title: 'Button',
      subtitle: 'Momentary digital input',
      accent: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/20',
      ghost: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
      icon: ToggleLeft,
    };
  }

  if (templateKind === 'buzzer') {
    return {
      title: 'Buzzer',
      subtitle: 'Single-pin audible output',
      accent: 'border-teal-500/40 bg-teal-500/10 text-teal-100 hover:bg-teal-500/20',
      ghost: 'border-teal-200 bg-teal-50 text-teal-700',
      icon: Wrench,
    };
  }

  if (templateKind === 'rgb-led') {
    return {
      title: 'RGB LED',
      subtitle: 'Three output pins, one mixed glow',
      accent: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20',
      ghost: 'border-cyan-200 bg-cyan-50 text-cyan-700',
      icon: Cpu,
    };
  }

  return {
    title: 'LED',
    subtitle: 'Visual digital output',
    accent: 'border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20',
    ghost: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: Lightbulb,
  };
}

function getRgbDeviceGlow(device: WorkbenchDevice, ledStates: Record<string, boolean>) {
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

function buildWorkbenchConnectorGroups(wiring: DemoWiring, showFullPinout: boolean) {
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

    const isVisiblePad = (pad: DemoBoardPad) => connectedPadIds.has(pad.id) || WOKWI_CURATED_PAD_IDS.has(pad.id);

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

  const leftMorpho = filterConnector(DEMO_LEFT_MORPHO_CONNECTOR);
  const left = DEMO_LEFT_CONNECTORS.map(filterConnector).filter((connector): connector is DemoBoardConnector => Boolean(connector));
  const right = DEMO_RIGHT_CONNECTORS.map(filterConnector).filter((connector): connector is DemoBoardConnector => Boolean(connector));
  const rightMorpho = filterConnector(DEMO_RIGHT_MORPHO_CONNECTOR);

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

function getPadAnchor(pad: DemoBoardPad): { x: number; y: number } {
  const frame = BOARD_CONNECTOR_LAYOUT[pad.connectorId as keyof typeof BOARD_CONNECTOR_LAYOUT];
  if (!frame) {
    return { x: BOARD_CANVAS_WIDTH / 2, y: 180 };
  }

  if (frame.layout === 'single') {
    const connector = DEMO_CONNECTORS.find((item) => item.id === pad.connectorId)!;
    const index = connector.pins.findIndex((item) => item.id === pad.id);
    const dotX = frame.x + 18;
    const dotY = frame.y + 28 + index * 12;
    return {
      x: pad.connectorPlacement === 'left' ? dotX : frame.x + frame.width - 18,
      y: dotY,
    };
  }

  const connector = DEMO_CONNECTORS.find((item) => item.id === pad.connectorId)!;
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
        {peripheral.padId ? describePad(resolveSelectablePad(peripheral.padId)) : 'Not connected to a board pad'}
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
  onMovePeripheral,
  onPressPeripheral,
}: {
  wiring: DemoWiring;
  ledStates: Record<string, boolean>;
  buttonStates: Record<string, boolean>;
  peripheralPositions: Record<string, PeripheralPosition>;
  visiblePads: DemoBoardPad[];
  armedPeripheralId: string | null;
  libraryDragKind: DemoPeripheralTemplateKind | null;
  workbenchDevices: WorkbenchDevice[];
  simulationRunning: boolean;
  onAssignPad: (pad: DemoBoardPad) => void;
  onAssignPadToPeripheral: (peripheralId: string, pad: DemoBoardPad) => void;
  onCreatePeripheral: (kind: DemoPeripheralTemplateKind, position: PeripheralPosition) => void;
  onBeginWiring: (peripheralId: string) => void;
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

  const wires = useMemo(
    () =>
      workbenchDevices
        .flatMap((device, deviceIndex) =>
          device.members.map((peripheral, endpointIndex) => {
            if (!peripheral.padId) {
              return null;
            }
            const pad = resolveSelectablePad(peripheral.padId);
            const padAnchor = getPadAnchor(pad);
            const position = resolveCanvasPosition(device.id, deviceIndex);
            const cardAnchor = getDeviceEndpointAnchor(position, endpointIndex, device.members.length);
            return {
              id: peripheral.id,
              kind: peripheral.kind,
              path: buildWirePath(cardAnchor, padAnchor),
            };
          })
        )
        .filter(Boolean) as Array<{ id: string; kind: DemoPeripheralKind; path: string }>,
    [resolveCanvasPosition, workbenchDevices]
  );

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
    const end = hoveredPad ? getPadAnchor(hoveredPad) : pointerPosition;
    if (!end) {
      return null;
    }

    return buildWirePath(start, end);
  }, [armedPeripheral, hoveredPad, pointerPosition, resolveCanvasPosition, workbenchDevices]);

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
          libraryDragKind ? 'border-cyan-400 bg-[#dfe6f0]' : 'border-slate-300 bg-[#d5d9e0]'
        }`}
        style={{ minHeight: canvasHeight + 32 }}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1">1. Drag a device in</div>
          <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1">2. Pull its wire stub</div>
          <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1">3. Drop on a cyan hotspot</div>
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
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${BOARD_CANVAS_WIDTH} ${canvasHeight}`} preserveAspectRatio="none">
            {wires.map((wire) => (
              <path
                key={wire.id}
                d={wire.path}
                fill="none"
                stroke={wire.kind === 'button' ? '#d946ef' : '#f59e0b'}
                strokeWidth="3"
                strokeLinecap="round"
                opacity="0.92"
              />
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
              />
            ) : null}
          </svg>

          <div className="absolute inset-x-6 top-6 h-[290px] rounded-[36px] border border-[#deded8] bg-[#f8f7f2] shadow-[0_16px_28px_rgba(15,23,42,0.12)]" />
          <div
            className="absolute inset-x-10 top-10 h-[282px] rounded-[34px] border border-[#ebeae4]"
            style={{ backgroundImage: 'linear-gradient(180deg, #fbfbf8 0%, #f4f3ee 100%)' }}
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

          {DEMO_LEFT_MORPHO_CONNECTOR ? (
            <div className="absolute left-0 top-6 w-[108px]">
              <MiniConnectorStrip connector={DEMO_LEFT_MORPHO_CONNECTOR} wiring={wiring} ledStates={ledStates} buttonStates={buttonStates} />
            </div>
          ) : null}

          <div className="absolute left-[128px] top-[50px] w-[90px]">
            {DEMO_LEFT_CONNECTORS.map((connector) => (
              <div key={connector.id} className="mb-3 last:mb-0">
                <MiniConnectorStrip connector={connector} wiring={wiring} ledStates={ledStates} buttonStates={buttonStates} />
              </div>
            ))}
          </div>

          <div className="absolute right-[128px] top-[50px] w-[90px]">
            {DEMO_RIGHT_CONNECTORS.map((connector) => (
              <div key={connector.id} className="mb-3 last:mb-0">
                <MiniConnectorStrip connector={connector} wiring={wiring} ledStates={ledStates} buttonStates={buttonStates} />
              </div>
            ))}
          </div>

          {DEMO_RIGHT_MORPHO_CONNECTOR ? (
            <div className="absolute right-0 top-6 w-[108px]">
              <MiniConnectorStrip connector={DEMO_RIGHT_MORPHO_CONNECTOR} wiring={wiring} ledStates={ledStates} buttonStates={buttonStates} />
            </div>
          ) : null}

          {Object.entries(BOARD_CONNECTOR_LAYOUT).map(([connectorId, frame]) => (
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

          <div className="absolute left-1/2 top-0 h-14 w-24 -translate-x-1/2 rounded-b-[18px] border border-slate-400 bg-slate-300 shadow-md" />
          <div className="absolute left-1/2 top-[72px] h-5 w-10 -translate-x-1/2 rounded-full border border-slate-500 bg-slate-900/80" />

          <div className="absolute left-1/2 top-[124px] flex -translate-x-1/2 items-start gap-5">
            <div className="rounded-[26px] border border-slate-300 bg-white/90 px-4 py-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.2em] text-[#465dd7]">USER</div>
              <div className={`mt-2 h-12 w-12 rounded-full border ${Object.values(buttonStates).some(Boolean) ? 'border-fuchsia-300 bg-fuchsia-400 shadow-[0_0_16px_rgba(217,70,239,0.45)]' : 'border-slate-300 bg-slate-100'}`} />
            </div>
            <div className="rounded-[26px] border border-slate-300 bg-white/90 px-4 py-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.2em] text-[#465dd7]">RESET</div>
              <div className="mt-2 h-12 w-12 rounded-full border border-slate-400 bg-slate-900/85" />
            </div>
            <div className="rounded-[26px] border border-slate-300 bg-white/90 px-4 py-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.2em] text-[#465dd7]">LD1 / LD2 / LD3</div>
              <div className="mt-2 flex gap-2">
                <div className="h-4 w-4 rounded-full border border-emerald-300 bg-emerald-300/70" />
                <div className="h-4 w-4 rounded-full border border-amber-300 bg-amber-300/70" />
                <div className="h-4 w-4 rounded-full border border-rose-300 bg-rose-300/70" />
              </div>
            </div>
          </div>

          <div className="absolute left-1/2 top-[244px] grid w-[260px] -translate-x-1/2 gap-4">
            <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-[30px] border border-slate-700 bg-slate-900 shadow-[0_18px_36px_rgba(15,23,42,0.25)]">
              <Cpu size={46} className="text-cyan-300" />
            </div>
            <div className="rounded-[28px] border border-slate-300 bg-white/92 px-5 py-4 text-center shadow-sm">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">MCU</div>
              <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">STM32H753ZIT6</div>
              <div className="mt-1 text-sm text-slate-600">Renode-backed board, live GPIO wiring</div>
            </div>
          </div>

          <div className="pointer-events-none absolute left-[228px] top-[52px] text-[11px] font-semibold uppercase tracking-[0.28em] text-[#465dd7]">
            Arduino / Zio
          </div>
          <div className="pointer-events-none absolute right-[228px] top-[52px] text-[11px] font-semibold uppercase tracking-[0.28em] text-[#465dd7]">
            Arduino / Zio
          </div>
          <div className="pointer-events-none absolute left-[18px] top-[156px] -rotate-90 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#465dd7]">
            Morpho
          </div>
          <div className="pointer-events-none absolute right-[12px] top-[156px] rotate-90 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#465dd7]">
            Morpho
          </div>
          <div className="pointer-events-none absolute left-1/2 top-[258px] -translate-x-1/2 text-center">
            <div className="text-sm font-semibold uppercase tracking-[0.32em] text-[#465dd7]">NUCLEO</div>
            <div className="mt-1 text-[34px] tracking-tight text-[#2e3ab0]">H753ZI</div>
          </div>

          {visiblePads.map((pad) => {
            const anchor = getPadAnchor(pad);
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
                            {member.padId ? describePad(resolveSelectablePad(member.padId)) : 'Wire this channel to a GPIO pad'}
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
                  {peripheral.padId ? describePad(resolveSelectablePad(peripheral.padId)) : 'Unplaced device'}
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
  const workbenchConnectors = useMemo(() => buildWorkbenchConnectorGroups(wiring, showFullPinout), [wiring, showFullPinout]);
  const hiddenPadCount = Math.max(0, DEMO_SELECTABLE_PADS.length - workbenchConnectors.visibleSelectablePads);
  const deviceCounts = useMemo(
    () => ({
      button: workbenchDevices.filter((device) => device.templateKind === 'button').length,
      led: workbenchDevices.filter((device) => device.templateKind === 'led').length,
      buzzer: workbenchDevices.filter((device) => device.templateKind === 'buzzer').length,
      rgb: workbenchDevices.filter((device) => device.templateKind === 'rgb-led').length,
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
            <PeripheralLibraryCard
              kind="button"
              disabled={workbenchDevices.length >= MAX_PERIPHERALS || simulationRunning}
              onAdd={() => onAddPeripheral('button')}
              onDragStateChange={setLibraryDragKind}
            />

            <PeripheralLibraryCard
              kind="led"
              disabled={workbenchDevices.length >= MAX_PERIPHERALS || simulationRunning}
              onAdd={() => onAddPeripheral('led')}
              onDragStateChange={setLibraryDragKind}
            />

            <PeripheralLibraryCard
              kind="buzzer"
              disabled={workbenchDevices.length >= MAX_PERIPHERALS || simulationRunning}
              onAdd={() => onAddPeripheral('buzzer')}
              onDragStateChange={setLibraryDragKind}
            />

            <PeripheralLibraryCard
              kind="rgb-led"
              disabled={workbenchDevices.length >= MAX_PERIPHERALS || simulationRunning}
              onAdd={() => onAddPeripheral('rgb-led')}
              onDragStateChange={setLibraryDragKind}
            />
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
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2 col-span-2">
                <div className="text-xs text-slate-500">Free Pads</div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {DEMO_SELECTABLE_PADS.length - getConnectedPeripherals(wiring).length}
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
                <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{DEMO_BOARD_NAME}</div>
                <div className="mt-2 max-w-3xl text-sm text-slate-600">{DEMO_BOARD_TAGLINE}</div>
              </div>
              <div className="grid gap-2 text-right text-xs text-slate-500">
                <div className="rounded-2xl border border-slate-300 bg-slate-100 px-3 py-1">Renode board file</div>
                <div className="font-mono text-slate-700">platforms/boards/nucleo_h753zi.repl</div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Selectable pads</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{DEMO_SELECTABLE_PADS.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Connected devices</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{getConnectedPeripherals(wiring).length}</div>
              </div>
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Compiler target</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{DEFAULT_GCC_ARGS.join(' ')}</div>
              </div>
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Board I/O</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {showFullPinout ? 'Full connector map exposed' : 'Common pads first, full pinout on demand'}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {ONBOARD_FEATURES.map((feature) => (
                <div key={feature.label} className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{feature.label}</span> · {feature.detail}
                </div>
              ))}
            </div>

            <div className="mt-5">
              <BoardTopView
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
                        {member.padId ? describePad(resolveSelectablePad(member.padId)) : 'Not connected to a board pad'}
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
              1. Drag a <span className="font-semibold text-white">Button</span>, <span className="font-semibold text-white">LED</span>, <span className="font-semibold text-white">Buzzer</span>, or <span className="font-semibold text-white">RGB LED</span> template into the workbench.
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
  const [activeTab, setActiveTab] = useState<'code' | 'repl' | 'resc'>('code');
  const [tooling, setTooling] = useState<ToolingReport | null>(null);
  const [logs, setLogs] = useState<RuntimeLog[]>([
    createLogEntry('NUCLEO-H753ZI workbench ready. Add peripherals, wire them to pads, and the app will regenerate firmware and Renode wiring automatically.'),
  ]);
  const [wiring, setWiring] = useState<DemoWiring>(DEFAULT_DEMO_WIRING);
  const [armedPeripheralId, setArmedPeripheralId] = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [simulation, setSimulation] = useState<SimulationState>({
    running: false,
    bridgeConnected: false,
    workspaceDir: null,
    gdbPort: DEFAULT_GDB_PORT,
    bridgePort: DEFAULT_BRIDGE_PORT,
  });
  const [buttonStates, setButtonStates] = useState<Record<string, boolean>>({});
  const [ledStates, setLedStates] = useState<Record<string, boolean>>({});
  const [codeMode, setCodeMode] = useState<CodeMode>('generated');
  const [code, setCode] = useState(DEFAULT_MAIN_SOURCE);
  const [codeDirty, setCodeDirty] = useState(true);
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

  const connectedButtons = useMemo(() => getConnectedPeripherals(wiring, 'button'), [wiring]);
  const connectedLeds = useMemo(() => getConnectedPeripherals(wiring, 'led'), [wiring]);
  const workbenchDevices = useMemo(() => buildWorkbenchDevices(wiring), [wiring]);
  const generatedCode = useMemo(() => generateDemoMainSource(wiring), [wiring]);
  const boardRepl = useMemo(() => generateBoardRepl(wiring), [wiring]);
  const peripheralManifest = useMemo(() => buildPeripheralManifest(wiring), [wiring]);
  const rescPreview = generateRescPreview({
    elfPath: buildResult?.elfPath ?? null,
    gdbPort: simulation.gdbPort,
    bridgePort: simulation.bridgePort,
  });

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

  const setRunningVisualState = useCallback((running: boolean) => {
    setSimulation((current) => ({
      ...current,
      running,
      bridgeConnected: running ? current.bridgeConnected : false,
    }));

    if (!running) {
      setButtonStates({});
      setLedStates({});
    }
  }, []);

  useEffect(() => {
    refreshTooling();
  }, [refreshTooling]);

  useEffect(() => {
    setCodeDirty(true);
    if (codeMode === 'generated') {
      setCode(generatedCode);
    }
  }, [codeMode, generatedCode]);

  useEffect(() => {
    setPeripheralPositions((current) => {
      const nextEntries = workbenchDevices.map((device, index) => [
        device.id,
        current[device.id] ?? createDefaultPeripheralPosition(index),
      ] as const);
      return Object.fromEntries(nextEntries);
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

      if (event.type === 'simulation') {
        const running = event.status === 'running';
        setRunningVisualState(running);
        if (!running) {
          setSimulation((current) => ({
            ...current,
            workspaceDir: event.workspaceDir ?? current.workspaceDir,
          }));
          resetDebugState('Simulation stopped.');
        }
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
      const ordinal = countTemplateInstances(wiring, templateKind) + 1;
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

      setWiring((current) => ({
        peripherals: current.peripherals.map((item) =>
          item.id === peripheralId
            ? {
                ...item,
                padId: pad.id,
              }
            : item
        ),
      }));
      setArmedPeripheralId((current) => (current === peripheralId ? null : current));
      appendLog(`Wired ${peripheral.label} to ${describePad(pad)}.`);
    },
    [appendLog, simulation.running, wiring]
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
      linkerScript: DEFAULT_LINKER_SCRIPT,
      linkerFileName: DEFAULT_LINKER_FILENAME,
      gccArgs: [...DEFAULT_GCC_ARGS],
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
  ]);

  const startSimulation = useCallback(async () => {
    if (!window.localWokwi) {
      appendLog('Electron preload API is unavailable.', 'warn');
      return;
    }

    if (peripheralManifest.length === 0) {
      appendLog('Connect at least one external peripheral before starting Renode.', 'warn');
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

    appendLog(`Starting Renode with ${peripheralManifest.length} connected external peripheral(s)...`);

    const result = await window.localWokwi.startSimulation({
      workspaceDir: compileResult.workspaceDir,
      elfPath: compileResult.elfPath,
      boardRepl,
      peripheralManifest,
      bridgePort: simulation.bridgePort,
      gdbPort: simulation.gdbPort,
      machineName: DEMO_MACHINE_NAME,
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
    }));
    setButtonStates({});
    setLedStates({});
    appendLog('Renode launched. Use the peripheral rack buttons to drive the wired outputs.');
  }, [appendLog, boardRepl, buildResult, codeDirty, compileFirmware, peripheralManifest, simulation.bridgePort, simulation.gdbPort]);

  const stopSimulation = useCallback(async () => {
    if (!window.localWokwi) {
      return;
    }
    await window.localWokwi.stopSimulation();
    setRunningVisualState(false);
    resetDebugState('Simulation stopped.');
    appendLog('Simulation stop requested.');
  }, [appendLog, resetDebugState, setRunningVisualState]);

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
                  Build with visible wires on a live NUCLEO-H753ZI board
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
              <StatusPill active={debugState.connected} label="Debugger attached" />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
            <WiringWorkbench
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
                  disabled={isCompiling || simulation.running}
                  className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition ${
                    isCompiling || simulation.running
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
                    disabled={isCompiling}
                    className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      isCompiling
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
              ) : (
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
