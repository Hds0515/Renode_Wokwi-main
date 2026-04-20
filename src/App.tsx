import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  DemoBoardConnector,
  DemoBoardPad,
  DemoWiring,
  describePad,
  generateBoardRepl,
  generateDemoMainSource,
  generateRescPreview,
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

type PlacementTool = 'button' | 'led' | null;
type CodeMode = 'generated' | 'manual';

const ONBOARD_FEATURES = [
  { label: 'LD1', detail: 'PB0 · Green LED' },
  { label: 'LD2', detail: 'PE1 · Yellow LED' },
  { label: 'LD3', detail: 'PB14 · Red LED' },
  { label: 'B1', detail: 'PC13 · User Button' },
];

const createLogEntry = (message: string, level: RuntimeLog['level'] = 'info'): RuntimeLog => ({
  id: Date.now() + Math.floor(Math.random() * 1000),
  level,
  message,
});

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

function PlacementButton({
  active,
  disabled,
  label,
  detail,
  accent,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  detail: string;
  accent: 'fuchsia' | 'amber';
  onClick: () => void;
}) {
  const activeClass =
    accent === 'fuchsia'
      ? 'border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100'
      : 'border-amber-300 bg-amber-500/10 text-amber-100';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-3xl border px-4 py-3 text-left transition ${
        disabled
          ? 'cursor-not-allowed border-slate-800 bg-slate-900/50 text-slate-500'
          : active
            ? activeClass
            : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600 hover:text-white'
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-1 text-xs text-slate-400">{detail}</div>
    </button>
  );
}

function padTone(
  pad: DemoBoardPad,
  wiring: DemoWiring,
  ledOn: boolean,
  buttonPressed: boolean,
  placementTool: PlacementTool,
  disabled: boolean
) {
  const isButton = wiring.buttonPadId === pad.id;
  const isLed = wiring.ledPadId === pad.id;
  const isSelected = placementTool === 'button' ? isButton : placementTool === 'led' ? isLed : false;

  if (!pad.selectable) {
    if (pad.role === 'power') {
      return {
        className: 'border-emerald-900/60 bg-emerald-950/30 text-emerald-100/80',
        badge: 'PWR',
        selected: false,
      };
    }
    if (pad.role === 'ground') {
      return {
        className: 'border-slate-700 bg-slate-900/80 text-slate-300',
        badge: 'GND',
        selected: false,
      };
    }
    if (pad.blockedReason) {
      return {
        className: 'border-cyan-900/70 bg-cyan-950/25 text-cyan-100/80',
        badge: 'ON-BOARD',
        selected: false,
      };
    }
    return {
      className: 'border-slate-800 bg-slate-900/70 text-slate-500',
      badge: 'CTRL',
      selected: false,
    };
  }

  if (isButton) {
    return {
      className: buttonPressed
        ? 'border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-50'
        : 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100',
      badge: 'BUTTON',
      selected: isSelected,
    };
  }

  if (isLed) {
    return {
      className: ledOn
        ? 'border-amber-200 bg-amber-400/20 text-amber-50 shadow-[0_0_18px_rgba(251,191,36,0.35)]'
        : 'border-amber-500/40 bg-amber-500/10 text-amber-100',
      badge: 'LED',
      selected: isSelected,
    };
  }

  return {
    className: disabled
      ? 'border-slate-800 bg-slate-900/70 text-slate-500'
      : 'border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-600 hover:text-white',
    badge: pad.role === 'gpio' ? 'GPIO' : 'FREE',
    selected: isSelected,
  };
}

function BoardPadChip({
  pad,
  wiring,
  placementTool,
  ledOn,
  buttonPressed,
  disabled,
  onAssign,
  compact = false,
}: {
  pad: DemoBoardPad;
  wiring: DemoWiring;
  placementTool: PlacementTool;
  ledOn: boolean;
  buttonPressed: boolean;
  disabled: boolean;
  onAssign: (pad: DemoBoardPad) => void;
  compact?: boolean;
}) {
  const tone = padTone(pad, wiring, ledOn, buttonPressed, placementTool, disabled);
  const muted = !pad.selectable;

  return (
    <button
      onClick={() => onAssign(pad)}
      disabled={disabled || !pad.selectable}
      className={`rounded-2xl border p-2.5 text-left transition ${tone.className} ${
        disabled || !pad.selectable ? 'cursor-not-allowed' : ''
      } ${tone.selected ? 'ring-2 ring-cyan-400/70' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className={`${compact ? 'text-[11px]' : 'text-xs'} uppercase tracking-[0.18em] ${muted ? 'text-current/70' : 'text-current/70'}`}>
            Pin {pad.pinNumber}
          </div>
          <div className={`${compact ? 'mt-0.5 text-[13px]' : 'mt-1 text-sm'} font-semibold`}>{pad.pinLabel}</div>
        </div>
        <div className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${muted ? 'border-current/20' : 'border-current/25'}`}>
          {tone.badge}
        </div>
      </div>

      <div className={`mt-2 ${compact ? 'text-[11px]' : 'text-xs'} ${muted ? 'text-current/70' : 'text-current/80'}`}>
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
  placementTool: PlacementTool;
  ledOn: boolean;
  buttonPressed: boolean;
  disabled: boolean;
  onAssign: (pad: DemoBoardPad) => void;
}) {
  const { connector, wiring, placementTool, ledOn, buttonPressed, disabled, onAssign } = props;

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
              placementTool={placementTool}
              ledOn={ledOn}
              buttonPressed={buttonPressed}
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
  placementTool: PlacementTool;
  ledOn: boolean;
  buttonPressed: boolean;
  disabled: boolean;
  onAssign: (pad: DemoBoardPad) => void;
}) {
  const { connector, wiring, placementTool, ledOn, buttonPressed, disabled, onAssign } = props;
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
                placementTool={placementTool}
                ledOn={ledOn}
                buttonPressed={buttonPressed}
                disabled={disabled}
                onAssign={onAssign}
                compact
              />
              {evenPin ? (
                <BoardPadChip
                  pad={evenPin}
                  wiring={wiring}
                  placementTool={placementTool}
                  ledOn={ledOn}
                  buttonPressed={buttonPressed}
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

function MiniConnectorStrip({
  connector,
  buttonPadId,
  ledPadId,
  compact = false,
}: {
  connector: DemoBoardConnector;
  buttonPadId: string;
  ledPadId: string;
  compact?: boolean;
}) {
  const oddPins = connector.layout === 'dual' ? connector.pins.filter((pad) => pad.column === 'odd') : [];
  const evenPins = connector.layout === 'dual' ? connector.pins.filter((pad) => pad.column === 'even') : [];

  const padClassName = (pad: DemoBoardPad) => {
    if (buttonPadId === pad.id) {
      return 'border-fuchsia-300 bg-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.65)]';
    }
    if (ledPadId === pad.id) {
      return 'border-amber-200 bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.75)]';
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
    <div className={`rounded-[20px] border border-slate-300/70 bg-[#16181f]/95 ${compact ? 'p-2' : 'p-2.5'} shadow-md`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-semibold uppercase tracking-[0.2em] text-slate-200`}>
          {connector.title}
        </div>
        <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} uppercase tracking-[0.18em] text-slate-400`}>
          {connector.layout === 'dual' ? 'Morpho' : 'Zio'}
        </div>
      </div>

      {connector.layout === 'single' ? (
        <div className={`mt-2 grid ${compact ? 'grid-cols-1 gap-1.5' : 'grid-cols-1 gap-2'}`}>
          {connector.pins.map((pad) => (
            <div key={pad.id} className="flex items-center gap-2">
              <div className={`h-3.5 w-3.5 rounded-full border ${padClassName(pad)}`} />
              <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} leading-none text-slate-300`}>{pad.pinNumber}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`mt-2 grid ${compact ? 'gap-1.5' : 'gap-2'}`}>
          {oddPins.map((oddPin, index) => {
            const evenPin = evenPins[index];
            return (
              <div key={oddPin.id} className="grid grid-cols-[1fr_1fr] gap-2">
                <div className="flex items-center gap-1.5">
                  <div className={`h-3.5 w-3.5 rounded-full border ${padClassName(oddPin)}`} />
                  <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} leading-none text-slate-300`}>
                    {oddPin.pinNumber}
                  </div>
                </div>
                {evenPin ? (
                  <div className="flex items-center justify-end gap-1.5">
                    <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} leading-none text-slate-300`}>
                      {evenPin.pinNumber}
                    </div>
                    <div className={`h-3.5 w-3.5 rounded-full border ${padClassName(evenPin)}`} />
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

function BoardTopView({
  buttonPad,
  ledPad,
  ledOn,
  buttonPressed,
}: {
  buttonPad: DemoBoardPad;
  ledPad: DemoBoardPad;
  ledOn: boolean;
  buttonPressed: boolean;
}) {
  return (
    <div className="rounded-[30px] border border-slate-300 bg-[#f6f7fb] p-4 shadow-inner">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Board Top View</div>
          <div className="mt-1 text-sm text-slate-600">Selected pads glow on the same connector block they belong to.</div>
        </div>
        <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
          Physical map
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[30px] border border-slate-300 bg-gradient-to-b from-slate-50 to-slate-200 px-10 py-6">
        <div className="absolute inset-x-10 top-0 h-24 rounded-b-[40px] bg-white/65" />
        <div className="absolute inset-y-10 left-0 w-16 rounded-r-[28px] bg-slate-300/35" />
        <div className="absolute inset-y-10 right-0 w-16 rounded-l-[28px] bg-slate-300/35" />

        <div className="relative mx-auto min-h-[470px] max-w-[760px]">
          {DEMO_LEFT_MORPHO_CONNECTOR ? (
            <div className="absolute left-0 top-6 w-[104px]">
              <MiniConnectorStrip connector={DEMO_LEFT_MORPHO_CONNECTOR} buttonPadId={buttonPad.id} ledPadId={ledPad.id} compact />
            </div>
          ) : null}

          <div className="absolute left-[122px] top-12 w-[88px]">
            {DEMO_LEFT_CONNECTORS.map((connector) => (
              <div key={connector.id} className="mb-3 last:mb-0">
                <MiniConnectorStrip connector={connector} buttonPadId={buttonPad.id} ledPadId={ledPad.id} compact />
              </div>
            ))}
          </div>

          <div className="absolute right-[122px] top-12 w-[88px]">
            {DEMO_RIGHT_CONNECTORS.map((connector) => (
              <div key={connector.id} className="mb-3 last:mb-0">
                <MiniConnectorStrip connector={connector} buttonPadId={buttonPad.id} ledPadId={ledPad.id} compact />
              </div>
            ))}
          </div>

          {DEMO_RIGHT_MORPHO_CONNECTOR ? (
            <div className="absolute right-0 top-6 w-[104px]">
              <MiniConnectorStrip connector={DEMO_RIGHT_MORPHO_CONNECTOR} buttonPadId={buttonPad.id} ledPadId={ledPad.id} compact />
            </div>
          ) : null}

          <div className="absolute left-1/2 top-2 h-14 w-24 -translate-x-1/2 rounded-b-[18px] border border-slate-400 bg-slate-300 shadow-md" />
          <div className="absolute left-1/2 top-20 h-5 w-10 -translate-x-1/2 rounded-full border border-slate-500 bg-slate-900/80" />

          <div className="absolute left-1/2 top-36 flex -translate-x-1/2 items-start gap-5">
            <div className="rounded-[26px] border border-slate-300 bg-white/90 px-4 py-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">USER</div>
              <div className={`mt-2 h-12 w-12 rounded-full border ${buttonPressed ? 'border-fuchsia-300 bg-fuchsia-400 shadow-[0_0_16px_rgba(217,70,239,0.45)]' : 'border-slate-300 bg-slate-100'}`} />
            </div>
            <div className="rounded-[26px] border border-slate-300 bg-white/90 px-4 py-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">RESET</div>
              <div className="mt-2 h-12 w-12 rounded-full border border-slate-400 bg-slate-900/85" />
            </div>
            <div className="rounded-[26px] border border-slate-300 bg-white/90 px-4 py-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">LD1 / LD2 / LD3</div>
              <div className="mt-2 flex gap-2">
                <div className="h-4 w-4 rounded-full border border-emerald-300 bg-emerald-300/70" />
                <div className="h-4 w-4 rounded-full border border-amber-300 bg-amber-300/70" />
                <div className="h-4 w-4 rounded-full border border-rose-300 bg-rose-300/70" />
              </div>
            </div>
          </div>

          <div className="absolute left-1/2 top-[252px] grid w-[260px] -translate-x-1/2 gap-4">
            <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-[30px] border border-slate-700 bg-slate-900 shadow-[0_18px_36px_rgba(15,23,42,0.25)]">
              <Cpu size={46} className="text-cyan-300" />
            </div>
            <div className="rounded-[28px] border border-slate-300 bg-white/92 px-5 py-4 text-center shadow-sm">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">MCU</div>
              <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">STM32H753ZIT6</div>
              <div className="mt-1 text-sm text-slate-600">Cortex-M7, real Renode board model</div>
            </div>
          </div>

          <div className="absolute bottom-4 left-[152px] rounded-[24px] border border-fuchsia-200 bg-fuchsia-50/95 px-4 py-3 shadow-sm">
            <div className="text-[11px] uppercase tracking-[0.2em] text-fuchsia-500">External button</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{buttonPad.connectorTitle} · Pin {buttonPad.pinNumber}</div>
            <div className="text-xs text-slate-600">{buttonPad.pinLabel} / {buttonPad.mcuPinId}</div>
          </div>

          <div className="absolute bottom-4 right-[152px] rounded-[24px] border border-amber-200 bg-amber-50/95 px-4 py-3 shadow-sm">
            <div className="text-[11px] uppercase tracking-[0.2em] text-amber-600">External LED</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{ledPad.connectorTitle} · Pin {ledPad.pinNumber}</div>
            <div className="text-xs text-slate-600">{ledPad.pinLabel} / {ledPad.mcuPinId}</div>
            <div className={`mt-2 h-3.5 w-3.5 rounded-full border ${ledOn ? 'border-amber-200 bg-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.85)]' : 'border-slate-300 bg-slate-200'}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function BoardSummaryCard({
  buttonPad,
  ledPad,
  ledOn,
  buttonPressed,
  simulationRunning,
  onButtonPress,
}: {
  buttonPad: DemoBoardPad;
  ledPad: DemoBoardPad;
  ledOn: boolean;
  buttonPressed: boolean;
  simulationRunning: boolean;
  onButtonPress: (pressed: boolean) => void;
}) {
  return (
    <div className="rounded-[36px] border border-slate-800 bg-gradient-to-b from-slate-100 to-slate-200 p-5 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.55)]">
      <div className="rounded-[28px] border border-slate-300 bg-white/85 p-4 shadow-inner">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.26em] text-slate-500">Board</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{DEMO_BOARD_NAME}</div>
            <div className="mt-2 max-w-xl text-sm text-slate-600">{DEMO_BOARD_TAGLINE}</div>
          </div>
          <div className="grid gap-2 text-right text-xs text-slate-500">
            <div className="rounded-2xl border border-slate-300 bg-slate-100 px-3 py-1">Renode board file</div>
            <div className="font-mono text-slate-700">platforms/boards/nucleo_h753zi.repl</div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.15fr]">
          <div className="rounded-[28px] border border-slate-300 bg-slate-50/90 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">MCU region</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">STM32H753ZIT6</div>
              </div>
              <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                Cortex-M7
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[120px_1fr]">
              <div className="flex items-center justify-center rounded-[28px] border border-slate-300 bg-slate-900 p-6">
                <Cpu size={52} className="text-cyan-300" />
              </div>
              <div className="grid gap-3">
                <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">External button</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{describePad(buttonPad)}</div>
                </div>
                <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">External LED</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{describePad(ledPad)}</div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {ONBOARD_FEATURES.map((feature) => (
                <div key={feature.label} className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{feature.label}</span> · {feature.detail}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[28px] border border-fuchsia-200 bg-fuchsia-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-fuchsia-500">External input</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">Momentary button</div>
                </div>
                <ToggleLeft size={28} className={buttonPressed ? 'text-fuchsia-500' : 'text-slate-400'} />
              </div>

              <div className="mt-3 rounded-2xl border border-fuchsia-200 bg-white px-3 py-2 text-sm text-slate-700">
                Routed to <span className="font-semibold text-slate-900">{buttonPad.pinLabel}</span> on{' '}
                <span className="font-semibold text-slate-900">{buttonPad.connectorTitle}</span>
              </div>

              <button
                onMouseDown={() => onButtonPress(true)}
                onMouseUp={() => onButtonPress(false)}
                onMouseLeave={() => onButtonPress(false)}
                onTouchStart={() => onButtonPress(true)}
                onTouchEnd={() => onButtonPress(false)}
                disabled={!simulationRunning}
                className={`mt-4 w-full rounded-[26px] border px-4 py-5 text-sm font-semibold uppercase tracking-[0.22em] transition ${
                  simulationRunning
                    ? buttonPressed
                      ? 'border-fuchsia-400 bg-fuchsia-500 text-white shadow-[0_16px_32px_rgba(217,70,239,0.35)]'
                      : 'border-fuchsia-300 bg-white text-fuchsia-700 hover:border-fuchsia-400 hover:bg-fuchsia-100'
                    : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                }`}
              >
                {simulationRunning ? (buttonPressed ? 'Button held low-level active' : 'Press button') : 'Start Renode to enable'}
              </button>
            </div>

            <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-amber-600">External output</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">Indicator LED</div>
                </div>
                <Lightbulb
                  size={28}
                  className={ledOn ? 'text-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,0.85)]' : 'text-slate-400'}
                />
              </div>

              <div className="mt-3 rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700">
                Routed to <span className="font-semibold text-slate-900">{ledPad.pinLabel}</span> on{' '}
                <span className="font-semibold text-slate-900">{ledPad.connectorTitle}</span>
              </div>

              <div className="mt-4 rounded-[26px] border border-amber-200 bg-white px-4 py-6 text-center">
                <div className={`mx-auto h-20 w-20 rounded-full border ${ledOn ? 'border-amber-200 bg-amber-300 shadow-[0_0_36px_rgba(251,191,36,0.75)]' : 'border-slate-300 bg-slate-200'}`} />
                <div className="mt-4 text-sm font-semibold text-slate-900">{ledOn ? 'GPIO high, LED glowing' : 'GPIO low, LED off'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <BoardTopView buttonPad={buttonPad} ledPad={ledPad} ledOn={ledOn} buttonPressed={buttonPressed} />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Selectable pads</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{DEMO_SELECTABLE_PADS.length}</div>
          </div>
          <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Connectors</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{DEMO_CONNECTORS.length}</div>
          </div>
          <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Compiler target</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{DEFAULT_GCC_ARGS.join(' ')}</div>
          </div>
          <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Flow</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">Place pins, regenerate, compile, start</div>
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
    createLogEntry('NUCLEO-H753ZI workbench ready. Pick a connector pad for the external button and LED, then compile and launch Renode.'),
  ]);
  const [wiring, setWiring] = useState<DemoWiring>(DEFAULT_DEMO_WIRING);
  const [placementTool, setPlacementTool] = useState<PlacementTool>(null);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [simulation, setSimulation] = useState<SimulationState>({
    running: false,
    bridgeConnected: false,
    workspaceDir: null,
    gdbPort: DEFAULT_GDB_PORT,
    bridgePort: DEFAULT_BRIDGE_PORT,
  });
  const [buttonPressed, setButtonPressed] = useState(false);
  const [ledOn, setLedOn] = useState(false);
  const [codeMode, setCodeMode] = useState<CodeMode>('generated');
  const [code, setCode] = useState(DEFAULT_MAIN_SOURCE);
  const [codeDirty, setCodeDirty] = useState(true);
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

  const buttonPad = resolveSelectablePad(wiring.buttonPadId);
  const ledPad = resolveSelectablePad(wiring.ledPadId);
  const generatedCode = generateDemoMainSource(wiring);
  const boardRepl = generateBoardRepl(wiring);
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

    const report = await window.localWokwi.getTooling();
    setTooling(report);
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
      setButtonPressed(false);
      setLedOn(false);
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
        setLedOn(event.state === 1);
        return;
      }

      if (event.type === 'bridge') {
        const bridgeReady = event.status === 'connected' || event.status === 'ready';
        setSimulation((current) => ({
          ...current,
          bridgeConnected: bridgeReady,
        }));
        if (event.status === 'ready' && event.ledHooked === false) {
          appendLog(`Bridge connected, but LED hook failed: ${event.ledHookError ?? 'unknown error'}`, 'error');
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
          if (event.frame?.line) {
            appendLog(
              `Debugger stopped at ${event.frame.fullname ?? event.frame.file ?? 'main.c'}:${event.frame.line}.`
            );
          }
          return;
        }

        if (event.status === 'error') {
          appendLog(`[GDB] ${event.message ?? event.raw ?? 'Unknown debugger error.'}`, 'error');
          return;
        }

        if (event.status === 'breakpoint' && typeof event.breakpoint === 'object' && event.breakpoint) {
          appendLog(
            `Breakpoint ${event.breakpoint.number ?? '?'} registered at ${
              event.breakpoint.fullname ?? event.breakpoint.file ?? 'main.c'
            }:${event.breakpoint.line ?? '?'}`
          );
        }
      }
    });
  }, [appendLog, resetDebugState, setRunningVisualState, simulation.gdbPort]);

  const assignPeripheralToPad = useCallback(
    (pad: DemoBoardPad) => {
      if (simulation.running) {
        appendLog('Stop the simulation before moving peripherals to another header pin.', 'warn');
        return;
      }

      if (!placementTool) {
        appendLog('Choose "Place Button" or "Place LED", then click a free connector pad.', 'warn');
        return;
      }

      if (!pad.selectable) {
        appendLog(`${pad.connectorTitle} pin ${pad.pinNumber} is not routable for external GPIO wiring.`, 'warn');
        return;
      }

      if (placementTool === 'button' && pad.id === wiring.ledPadId) {
        appendLog(`${describePad(pad)} is already used by the LED. Pick another connector pad for the button.`, 'warn');
        return;
      }

      if (placementTool === 'led' && pad.id === wiring.buttonPadId) {
        appendLog(`${describePad(pad)} is already used by the button. Pick another connector pad for the LED.`, 'warn');
        return;
      }

      setWiring((current) => ({
        ...current,
        buttonPadId: placementTool === 'button' ? pad.id : current.buttonPadId,
        ledPadId: placementTool === 'led' ? pad.id : current.ledPadId,
      }));

      appendLog(
        `Placed the external ${placementTool} on ${describePad(pad)}. The generated main.c and board.repl were refreshed for that header mapping.`
      );
    },
    [appendLog, placementTool, simulation.running, wiring.buttonPadId, wiring.ledPadId]
  );

  const useGeneratedDemoCode = useCallback(() => {
    setCode(generatedCode);
    setCodeMode('generated');
    setCodeDirty(true);
    appendLog(
      `Regenerated demo firmware from the current board wiring: button ${describePad(buttonPad)}, LED ${describePad(ledPad)}.`
    );
  }, [appendLog, buttonPad, generatedCode, ledPad]);

  const sendButtonState = useCallback(
    async (pressed: boolean) => {
      if (!simulation.running || !window.localWokwi) {
        return;
      }

      setButtonPressed(pressed);

      const result = await window.localWokwi.sendPeripheralEvent({
        type: 'button',
        id: 'externalButton',
        state: pressed ? 1 : 0,
      });

      if (!result.success) {
        appendLog(result.message || 'Failed to send button event.', 'error');
      }
    },
    [appendLog, simulation.running]
  );

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
      `Compile requested for ${describePad(buttonPad)} -> ${describePad(ledPad)}. Writing H753 startup, linker and board files...`
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
      appendLog(`Compilation succeeded: ${result.elfPath}`, 'info');
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
    buttonPad,
    code,
    codeMode,
    generatedCode,
    ledPad,
    refreshTooling,
  ]);

  const startSimulation = useCallback(async () => {
    if (!window.localWokwi) {
      appendLog('Electron preload API is unavailable.', 'warn');
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

    appendLog(`Starting Renode with button on ${describePad(buttonPad)} and LED on ${describePad(ledPad)}...`);

    const result = await window.localWokwi.startSimulation({
      workspaceDir: compileResult.workspaceDir,
      elfPath: compileResult.elfPath,
      boardRepl,
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
    setButtonPressed(false);
    setLedOn(false);
    appendLog('Renode launched. Press and hold the external button card to drive the LED in real time.');
  }, [
    appendLog,
    boardRepl,
    buildResult,
    buttonPad,
    codeDirty,
    compileFirmware,
    ledPad,
    simulation.bridgePort,
    simulation.gdbPort,
  ]);

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
                  Bind the Renode engine to a real NUCLEO-H753ZI board layout
                </h1>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
                  Choose actual connector pads on CN7, CN8, CN9, CN10, CN11, or CN12. The app regenerates{' '}
                  <span className="font-semibold text-white">main.c</span>, <span className="font-semibold text-white">board.repl</span>, compiles a
                  real ELF, starts the local Renode board model, and keeps the external button and LED synchronized with the UI.
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
            <div className="min-w-[1320px] space-y-6">
              <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="rounded-[32px] border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
                  <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Placement Tools</div>
                  <div className="mt-3 text-sm text-slate-300">
                    Pick a tool, then click any free connector pad. On-board LEDs and the built-in USER button are shown but blocked from external placement.
                  </div>

                  <div className="mt-5 grid gap-3">
                    <PlacementButton
                      active={placementTool === 'button'}
                      disabled={simulation.running}
                      label="Place Button"
                      detail="Route the external momentary switch to a board header pad."
                      accent="fuchsia"
                      onClick={() => setPlacementTool((current) => (current === 'button' ? null : 'button'))}
                    />
                    <PlacementButton
                      active={placementTool === 'led'}
                      disabled={simulation.running}
                      label="Place LED"
                      detail="Route the external LED to a board header pad and watch it glow live."
                      accent="amber"
                      onClick={() => setPlacementTool((current) => (current === 'led' ? null : 'led'))}
                    />
                  </div>

                  <button
                    onClick={() => useGeneratedDemoCode()}
                    disabled={simulation.running}
                    className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                      simulation.running
                        ? 'cursor-not-allowed border-slate-800 bg-slate-900 text-slate-500'
                        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20'
                    }`}
                  >
                    <RefreshCcw size={15} />
                    Regenerate Demo Code
                  </button>

                  <div className="mt-5 space-y-3 text-sm text-slate-300">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Button assignment</div>
                      <div className="mt-1 font-semibold text-white">{describePad(buttonPad)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">LED assignment</div>
                      <div className="mt-1 font-semibold text-white">{describePad(ledPad)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Pin selection hint</div>
                      <div className="mt-1 text-slate-300">
                        Zio headers are the fastest path. Morpho headers expose almost the full MCU and are perfect when you need less common GPIOs.
                      </div>
                    </div>
                  </div>
                </div>

                <BoardSummaryCard
                  buttonPad={buttonPad}
                  ledPad={ledPad}
                  ledOn={ledOn}
                  buttonPressed={buttonPressed}
                  simulationRunning={simulation.running}
                  onButtonPress={(pressed) => void sendButtonState(pressed)}
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(250px,300px)_minmax(280px,340px)_minmax(420px,1fr)_minmax(280px,340px)_minmax(250px,300px)]">
                {DEMO_LEFT_MORPHO_CONNECTOR ? (
                  <DualConnectorCard
                    connector={DEMO_LEFT_MORPHO_CONNECTOR}
                    wiring={wiring}
                    placementTool={placementTool}
                    ledOn={ledOn}
                    buttonPressed={buttonPressed}
                    disabled={simulation.running}
                    onAssign={assignPeripheralToPad}
                  />
                ) : (
                  <div />
                )}

                <div className="space-y-4">
                  {DEMO_LEFT_CONNECTORS.map((connector) => (
                    <div key={connector.id}>
                      <SingleConnectorCard
                        connector={connector}
                        wiring={wiring}
                        placementTool={placementTool}
                        ledOn={ledOn}
                        buttonPressed={buttonPressed}
                        disabled={simulation.running}
                        onAssign={assignPeripheralToPad}
                      />
                    </div>
                  ))}
                </div>

                <div className="rounded-[32px] border border-slate-800 bg-slate-950/70 p-5 shadow-xl">
                  <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Workflow</div>
                  <div className="mt-4 grid gap-3 text-sm text-slate-300">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      1. Choose <span className="font-semibold text-white">Place Button</span> or{' '}
                      <span className="font-semibold text-white">Place LED</span>.
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      2. Click any free pad on CN7, CN8, CN9, CN10, CN11, or CN12.
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      3. The app regenerates <span className="font-semibold text-white">main.c</span> and{' '}
                      <span className="font-semibold text-white">board.repl</span> for that exact connector mapping.
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      4. Compile, start Renode, then hold the external button card to drive the LED.
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                      5. Attach GDB if you want source-level stepping on the generated bare-metal firmware.
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
                    <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Current wiring snapshot</div>
                    <div className="mt-2 grid gap-2">
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                        Button input: <span className="font-semibold text-white">{describePad(buttonPad)}</span>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                        LED output: <span className="font-semibold text-white">{describePad(ledPad)}</span>
                      </div>
                    </div>
                    <div className="mt-4 text-xs text-slate-400">
                      Workspace:
                      <div className="mt-1 break-all text-slate-300">
                        {simulation.workspaceDir || 'No local workspace created yet'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {DEMO_RIGHT_CONNECTORS.map((connector) => (
                    <div key={connector.id}>
                      <SingleConnectorCard
                        connector={connector}
                        wiring={wiring}
                        placementTool={placementTool}
                        ledOn={ledOn}
                        buttonPressed={buttonPressed}
                        disabled={simulation.running}
                        onAssign={assignPeripheralToPad}
                      />
                    </div>
                  ))}
                </div>

                {DEMO_RIGHT_MORPHO_CONNECTOR ? (
                  <DualConnectorCard
                    connector={DEMO_RIGHT_MORPHO_CONNECTOR}
                    wiring={wiring}
                    placementTool={placementTool}
                    ledOn={ledOn}
                    buttonPressed={buttonPressed}
                    disabled={simulation.running}
                    onAssign={assignPeripheralToPad}
                  />
                ) : (
                  <div />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex w-[640px] shrink-0 flex-col bg-slate-950/80">
          <div className="border-b border-slate-800 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Control</div>
                <div className="mt-1 text-sm text-slate-300">
                  Build the current NUCLEO-H753ZI header wiring into a real ELF, then launch the local Renode runtime.
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
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Wiring snapshot</div>
                <div className="mt-1">
                  {buttonPad.pinLabel} ({buttonPad.mcuPinId}) {'->'} {ledPad.pinLabel} ({ledPad.mcuPinId})
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

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <div className="uppercase tracking-[0.22em] text-slate-500">Stop reason</div>
                  <div className="mt-1 text-slate-200">{debugState.lastReason || 'Not stopped'}</div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <div className="uppercase tracking-[0.22em] text-slate-500">Current frame</div>
                  <div className="mt-1 break-all text-slate-200">
                    {debugState.frame?.line
                      ? `${debugState.frame.fullname ?? debugState.frame.file ?? 'main.c'}:${debugState.frame.line}`
                      : 'No frame selected'}
                  </div>
                </div>
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
                    entry.level === 'error'
                      ? 'text-rose-300'
                      : entry.level === 'warn'
                        ? 'text-amber-300'
                        : 'text-slate-300'
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
