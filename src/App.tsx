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
  DEFAULT_GDB_PORT,
  DEFAULT_LINKER_SCRIPT,
  DEFAULT_MAIN_SOURCE,
  DEFAULT_STARTUP_SOURCE,
  DEMO_LEFT_PIN_BANKS,
  DEMO_RIGHT_PIN_BANKS,
  DemoBoardPin,
  DemoPinBank,
  DemoWiring,
  generateBoardRepl,
  generateDemoMainSource,
  generateRescPreview,
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

function PinBankCard({
  bank,
  wiring,
  placementTool,
  ledOn,
  buttonPressed,
  disabled,
  onAssign,
}: {
  bank: DemoPinBank;
  wiring: DemoWiring;
  placementTool: PlacementTool;
  ledOn: boolean;
  buttonPressed: boolean;
  disabled: boolean;
  onAssign: (pin: DemoBoardPin) => void;
}) {
  return (
    <div className="rounded-3xl border border-slate-800/90 bg-slate-950/75 p-4 shadow-xl backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Pin Bank</div>
          <div className="mt-1 text-sm font-semibold text-white">{bank.title}</div>
        </div>
        <div className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-500">
          {bank.side === 'left' ? 'Left Rail' : 'Right Rail'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {bank.pins.map((pin) => {
          const isButton = wiring.buttonPinId === pin.id;
          const isLed = wiring.ledPinId === pin.id;
          const isSelected = placementTool === 'button' ? isButton : placementTool === 'led' ? isLed : false;
          const accent = isButton
            ? buttonPressed
              ? 'border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-100'
              : 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100'
            : isLed
              ? ledOn
                ? 'border-amber-200 bg-amber-400/25 text-amber-50 shadow-[0_0_18px_rgba(251,191,36,0.35)]'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
              : 'border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white';
          const assignment = isButton ? 'Button' : isLed ? 'LED' : disabled ? 'locked' : 'free';

          return (
            <button
              key={pin.id}
              onClick={() => onAssign(pin)}
              disabled={disabled}
              className={`rounded-2xl border px-3 py-2 text-left transition ${accent} ${
                disabled ? 'cursor-not-allowed opacity-70' : ''
              } ${isSelected ? 'ring-2 ring-cyan-400/60' : ''}`}
            >
              <div className="text-sm font-semibold">{pin.id}</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">{assignment}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'code' | 'repl' | 'resc'>('code');
  const [tooling, setTooling] = useState<ToolingReport | null>(null);
  const [logs, setLogs] = useState<RuntimeLog[]>([
    createLogEntry('GPIO demo board ready. Place the external button and LED on any STM32F4 GPIO pins, then compile and start Renode.'),
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
      appendLog('Electron preload API is unavailable. Run the app through `npm run dev` or `npm run start`.', 'warn');
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

  const assignPeripheralToPin = useCallback(
    (pin: DemoBoardPin) => {
      if (simulation.running) {
        appendLog('Stop the simulation before moving peripherals to another GPIO.', 'warn');
        return;
      }

      if (!placementTool) {
        appendLog('Choose "Place Button" or "Place LED", then click a GPIO pin.', 'warn');
        return;
      }

      if (placementTool === 'button' && pin.id === wiring.ledPinId) {
        appendLog(`GPIO ${pin.id} is already used by the LED. Pick another pin for the button.`, 'warn');
        return;
      }

      if (placementTool === 'led' && pin.id === wiring.buttonPinId) {
        appendLog(`GPIO ${pin.id} is already used by the button. Pick another pin for the LED.`, 'warn');
        return;
      }

      setWiring((current) => ({
        ...current,
        buttonPinId: placementTool === 'button' ? pin.id : current.buttonPinId,
        ledPinId: placementTool === 'led' ? pin.id : current.ledPinId,
      }));
      appendLog(`Placed the external ${placementTool} on ${pin.id}. Generated Renode config and demo firmware are now updated.`);
    },
    [appendLog, placementTool, simulation.running, wiring.buttonPinId, wiring.ledPinId]
  );

  const useGeneratedDemoCode = useCallback(() => {
    setCode(generatedCode);
    setCodeMode('generated');
    setCodeDirty(true);
    appendLog(`Regenerated demo firmware from the current wiring: button ${wiring.buttonPinId}, LED ${wiring.ledPinId}.`);
  }, [appendLog, generatedCode, wiring.buttonPinId, wiring.ledPinId]);

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
      `Compile requested for button ${wiring.buttonPinId} -> LED ${wiring.ledPinId}. Writing bare-metal startup, linker and board files...`
    );

    const result = await window.localWokwi.compileFirmware({
      workspaceDir: buildResult?.workspaceDir ?? undefined,
      mainSource: sourceToCompile,
      startupSource: DEFAULT_STARTUP_SOURCE,
      linkerScript: DEFAULT_LINKER_SCRIPT,
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
    code,
    codeMode,
    generatedCode,
    refreshTooling,
    wiring.buttonPinId,
    wiring.ledPinId,
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

    appendLog(`Starting Renode with button on ${wiring.buttonPinId} and LED on ${wiring.ledPinId}...`);

    const result = await window.localWokwi.startSimulation({
      workspaceDir: compileResult.workspaceDir,
      elfPath: compileResult.elfPath,
      boardRepl,
      bridgePort: simulation.bridgePort,
      gdbPort: simulation.gdbPort,
      machineName: 'STM32F4 GPIO Explorer',
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
    appendLog('Renode launched. Press and hold the external button card to drive the LED.');
  }, [
    appendLog,
    boardRepl,
    buildResult,
    codeDirty,
    compileFirmware,
    simulation.bridgePort,
    simulation.gdbPort,
    wiring.buttonPinId,
    wiring.ledPinId,
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
    resetDebugState('Debugger disconnected.');
  }, [appendLog, resetDebugState]);

  const runDebugAction = useCallback(
    async (action: 'continue' | 'next' | 'step' | 'interrupt' | 'break-main' | 'break-line') => {
      if (!window.localWokwi) {
        return;
      }

      const request: {
        action: 'continue' | 'next' | 'step' | 'interrupt' | 'break-main' | 'break-line';
        line?: number;
      } = { action };
      if (action === 'break-line') {
        const position = codeEditorRef.current?.getPosition?.();
        if (!position?.lineNumber) {
          appendLog('Open the source editor and place the caret on a line before setting a breakpoint.', 'warn');
          return;
        }
        request.line = position.lineNumber;
      }

      const result = await window.localWokwi.debugAction(request);
      if (!result.success) {
        appendLog(result.message || 'Debugger command failed.', 'error');
      }
    },
    [appendLog]
  );

  return (
    <div className="flex h-screen w-full flex-col bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.2),_transparent_35%),linear-gradient(160deg,_#020617_0%,_#0f172a_45%,_#111827_100%)] text-slate-100">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800/90 bg-slate-950/70 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-2 text-cyan-300">
            <Cpu size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Renode Local Visualizer</h1>
            <p className="text-xs text-slate-400">
              pin-level demo board to generated Renode config to local runtime bridge
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ToolBadge label="Renode" status={tooling?.renode ?? null} />
          <ToolBadge label="GCC" status={tooling?.gcc ?? null} />
          <ToolBadge label="GDB" status={tooling?.gdb ?? null} />
          <button
            onClick={() => void refreshTooling()}
            className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-slate-300 transition hover:border-slate-500 hover:text-white"
            title="Refresh tooling"
          >
            <RefreshCcw size={15} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto border-r border-slate-800/80">
          <div className="mx-auto max-w-[1300px] p-6">
            <div className="rounded-[2rem] border border-slate-800/90 bg-slate-950/80 p-5 shadow-2xl backdrop-blur">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-2xl">
                  <div className="text-xs uppercase tracking-[0.28em] text-cyan-300">Demo Flow</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">Selectable GPIO board demo</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Pick a real STM32F4 GPIO pin for the external button and LED, auto-generate the Renode platform,
                    compile the matching bare-metal firmware, then interact with the running simulation live.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:w-[420px]">
                  <PlacementButton
                    active={placementTool === 'button'}
                    disabled={simulation.running}
                    label="Place Button"
                    detail={`Current pin: ${wiring.buttonPinId}`}
                    accent="fuchsia"
                    onClick={() => setPlacementTool((current) => (current === 'button' ? null : 'button'))}
                  />
                  <PlacementButton
                    active={placementTool === 'led'}
                    disabled={simulation.running}
                    label="Place LED"
                    detail={`Current pin: ${wiring.ledPinId}`}
                    accent="amber"
                    onClick={() => setPlacementTool((current) => (current === 'led' ? null : 'led'))}
                  />
                  <button
                    onClick={() => {
                      setWiring(DEFAULT_DEMO_WIRING);
                      setPlacementTool(null);
                      appendLog('Reset the demo wiring back to Button PB0 and LED PA5.');
                    }}
                    disabled={simulation.running}
                    className={`rounded-3xl border px-4 py-3 text-left transition ${
                      simulation.running
                        ? 'cursor-not-allowed border-slate-800 bg-slate-900/50 text-slate-500'
                        : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600 hover:text-white'
                    }`}
                  >
                    <div className="text-sm font-semibold">Reset Wiring</div>
                    <div className="mt-1 text-xs text-slate-400">Back to PB0 button and PA5 LED</div>
                  </button>
                  <button
                    onClick={() => useGeneratedDemoCode()}
                    className="rounded-3xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-left text-cyan-100 transition hover:bg-cyan-500/15"
                  >
                    <div className="text-sm font-semibold">Regenerate Demo Code</div>
                    <div className="mt-1 text-xs text-cyan-200/80">Sync `main.c` with the selected GPIO pins</div>
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill active={Boolean(buildResult?.success)} label="ELF ready" />
                <StatusPill active={simulation.running} label="Renode running" />
                <StatusPill active={simulation.bridgeConnected} label="Bridge online" />
                <StatusPill active={codeMode === 'generated'} label="Auto demo code" />
              </div>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
              <div className="space-y-4">
                {DEMO_LEFT_PIN_BANKS.map((bank) => (
                  <div key={bank.id}>
                    <PinBankCard
                      bank={bank}
                      wiring={wiring}
                      placementTool={placementTool}
                      ledOn={ledOn}
                      buttonPressed={buttonPressed}
                      disabled={simulation.running}
                      onAssign={assignPeripheralToPin}
                    />
                  </div>
                ))}
              </div>

              <div className="rounded-[2.5rem] border border-slate-800/90 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.9))] p-6 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Board Canvas</div>
                    <div className="mt-2 text-xl font-semibold">STM32F4 GPIO Explorer</div>
                    <div className="mt-2 text-sm text-slate-400">
                      Demo board backed by Renode&apos;s `platforms/cpus/stm32f4.repl`. Click a placement tool, then
                      click any GPIO pad on either side rail.
                    </div>
                  </div>
                  <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-cyan-300">
                    <Wrench size={20} />
                  </div>
                </div>

                <div className="mt-6 rounded-[2rem] border border-slate-700/70 bg-slate-900/60 p-6">
                  <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-[2rem] border border-slate-700 bg-slate-950 shadow-[0_18px_50px_rgba(8,15,30,0.45)]">
                    <div className="text-center">
                      <Cpu size={30} className="mx-auto text-cyan-300" />
                      <div className="mt-2 text-xs uppercase tracking-[0.26em] text-slate-500">STM32F4</div>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="rounded-3xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.24em] text-fuchsia-200/70">External Input</div>
                          <div className="mt-1 text-lg font-semibold text-white">Button</div>
                        </div>
                        <ToggleLeft size={22} className="text-fuchsia-300" />
                      </div>
                      <div className="mt-3 rounded-2xl border border-fuchsia-500/30 bg-slate-950/40 px-3 py-2 text-sm text-fuchsia-100">
                        Assigned pin: <span className="font-semibold">{wiring.buttonPinId}</span>
                      </div>
                      <button
                        onPointerDown={() => void sendButtonState(true)}
                        onPointerUp={() => void sendButtonState(false)}
                        onPointerLeave={() => void sendButtonState(false)}
                        disabled={!simulation.running}
                        className={`mt-4 w-full rounded-2xl py-3 text-sm font-semibold transition ${
                          !simulation.running
                            ? 'cursor-not-allowed bg-slate-800 text-slate-500'
                            : buttonPressed
                              ? 'translate-y-0.5 bg-fuchsia-700 text-white shadow-inner'
                              : 'bg-fuchsia-500 text-white shadow-[0_6px_0_rgb(112,26,117)] hover:bg-fuchsia-400'
                        }`}
                      >
                        {buttonPressed ? 'PRESSING GPIO' : 'PRESS BUTTON'}
                      </button>
                    </div>

                    <div
                      className={`rounded-3xl border p-4 transition-all ${
                        ledOn
                          ? 'border-amber-200 bg-amber-400/15 shadow-[0_0_40px_rgba(251,191,36,0.15)]'
                          : 'border-slate-700 bg-slate-900/70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">External Output</div>
                          <div className="mt-1 text-lg font-semibold text-white">LED</div>
                        </div>
                        <Lightbulb
                          size={24}
                          className={ledOn ? 'text-amber-200 drop-shadow-[0_0_14px_rgba(251,191,36,0.75)]' : 'text-slate-500'}
                        />
                      </div>
                      <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-200">
                        Assigned pin: <span className="font-semibold">{wiring.ledPinId}</span>
                      </div>
                      <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/40 px-3 py-4 text-center text-sm">
                        {ledOn ? 'GPIO is high. LED is glowing.' : 'GPIO is low. LED is off.'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 text-sm text-slate-300">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      1. Choose <span className="font-semibold text-white">Place Button</span> or{' '}
                      <span className="font-semibold text-white">Place LED</span>.
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      2. Click any real GPIO pad, such as <span className="font-semibold text-white">PA5</span> or{' '}
                      <span className="font-semibold text-white">PC13</span>.
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      3. The app regenerates <span className="font-semibold text-white">main.c</span> and{' '}
                      <span className="font-semibold text-white">board.repl</span> from that wiring.
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      4. Compile, start Renode, then hold the button card to drive the LED in real time.
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Current Wiring Summary</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2">
                      Button input: <span className="font-semibold text-white">{wiring.buttonPinId}</span>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2">
                      LED output: <span className="font-semibold text-white">{wiring.ledPinId}</span>
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
                {DEMO_RIGHT_PIN_BANKS.map((bank) => (
                  <div key={bank.id}>
                    <PinBankCard
                      bank={bank}
                      wiring={wiring}
                      placementTool={placementTool}
                      ledOn={ledOn}
                      buttonPressed={buttonPressed}
                      disabled={simulation.running}
                      onAssign={assignPeripheralToPin}
                    />
                  </div>
                ))}
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
                  Build the current GPIO wiring into a real ELF, then launch the local Renode runtime.
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
                    Button {wiring.buttonPinId} {'->'} LED {wiring.ledPinId}
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
