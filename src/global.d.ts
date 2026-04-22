export {};

type SimulationClockSnapshot = {
  schemaVersion: number;
  sequence: number;
  wallTimeMs: number;
  virtualTimeNs: number;
  virtualTimeMs: number;
  elapsedWallMs: number;
  syncMode: 'host-estimated' | 'renode-virtual' | 'external';
  timeScale: number;
  paused: boolean;
};

type RuntimeBusManifestEntry = {
  schemaVersion: number;
  id: string;
  protocol: 'uart' | 'i2c' | 'spi';
  label: string;
  renodePeripheralName: string | null;
  status: 'active' | 'planned';
  adapter: 'socket-terminal' | 'transaction-broker-planned';
  endpoints: Array<{
    role: 'tx' | 'rx' | 'scl' | 'sda' | 'sck' | 'miso' | 'mosi' | 'cs';
    padId: string | null;
    mcuPinId: string | null;
    label: string;
  }>;
  devices?: Array<{
    id: string;
    componentId: string;
    componentKind: string;
    label: string;
    address: number | null;
    model: 'ssd1306' | 'generic-i2c';
  }>;
};

type RuntimeTimelineEvent = {
  schemaVersion: number;
  id: string;
  protocol: 'gpio' | 'uart' | 'i2c' | 'spi';
  kind: 'gpio-sample' | 'bus-transaction';
  source: 'ui' | 'bridge' | 'renode' | 'system' | 'debugger' | 'uart' | 'i2c' | 'spi';
  clock: SimulationClockSnapshot;
  summary: string;
  signalId?: string;
  peripheralId?: string;
  label?: string;
  direction?: 'input' | 'output' | 'rx' | 'tx' | 'read' | 'write' | 'transfer' | 'system';
  value?: 0 | 1;
  changed?: boolean;
  netId?: string | null;
  componentId?: string | null;
  pinId?: string | null;
  padId?: string | null;
  mcuPinId?: string | null;
  busId?: string;
  busLabel?: string;
  renodePeripheralName?: string | null;
  status?: 'data' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'planned';
  address?: number | null;
  payload?: {
    bytes: number[];
    text: string | null;
    bitLength: number;
    truncated: boolean;
  };
};

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

type CompileRequest = {
  workspaceDir?: string;
  mainSource: string;
  startupSource: string;
  linkerScript: string;
  linkerFileName?: string;
  gccArgs?: string[];
};

type CompileResult = {
  success: boolean;
  message: string;
  workspaceDir?: string;
  elfPath?: string;
  mapPath?: string;
  stdout?: string;
  stderr?: string;
};

type StartSimulationRequest = {
  workspaceDir?: string;
  elfPath: string;
  boardRepl: string;
  peripheralManifest?: Array<{
    id: string;
    kind: 'button' | 'led';
    label: string;
    renodeName: string;
    gpioPortName: string;
    gpioNumber: number;
    mcuPinId: string;
  }>;
  signalManifest?: Array<{
    schemaVersion: number;
    id: string;
    peripheralId: string;
    label: string;
    direction: 'input' | 'output';
    netId: string;
    componentId: string;
    pinId: string;
    endpointId: string | null;
    padId: string | null;
    mcuPinId: string | null;
    color: string;
  }>;
  busManifest?: RuntimeBusManifestEntry[];
  bridgePort?: number;
  gdbPort?: number;
  transactionBrokerPort?: number;
  machineName?: string;
  uartPeripheralName?: string | null;
  enableI2cDemoFeed?: boolean;
};

type StartSimulationResult = {
  success: boolean;
  message: string;
  workspaceDir?: string;
  rescPath?: string;
  replPath?: string;
  gdbPort?: number;
  bridgePort?: number;
  transactionBrokerPort?: number;
  transactionBrokerManifestPath?: string;
  monitorPort?: number;
  uartPeripheralName?: string | null;
  uartPort?: number | null;
  uartReady?: boolean;
  bridgeReady?: boolean;
};

type PeripheralEventResult = {
  success: boolean;
  message?: string;
};

type UartDataResult = {
  success: boolean;
  message?: string;
};

type StartDebuggingRequest = {
  workspaceDir?: string;
  elfPath: string;
  gdbPort?: number;
};

type StartDebuggingResult = {
  success: boolean;
  message: string;
  gdbPort?: number;
};

type DebugActionRequest = {
  action: 'continue' | 'next' | 'step' | 'interrupt' | 'break-main' | 'break-line';
  line?: number;
};

type LocalProjectDocument = {
  app: 'renode-local-visualizer';
  schemaVersion: 1 | 2;
  savedAt: string;
  board: {
    id: string;
    name: string;
  };
  templates?: {
    catalogVersion: number;
    kinds: string[];
  };
  componentPackages?: {
    schemaVersion: number;
    catalogVersion: number;
    kinds: string[];
  };
  wiring: {
    peripherals: Array<{
      id: string;
      kind: 'button' | 'led' | 'i2c';
      label: string;
      padId: string | null;
      sourcePeripheralId: string | null;
      templateKind?: 'button' | 'led' | 'buzzer' | 'rgb-led' | 'ssd1306-oled';
      groupId?: string | null;
      groupLabel?: string | null;
      endpointId?: string | null;
      endpointLabel?: string | null;
      accentColor?: string | null;
    }>;
    wires?: Array<{
      id: string;
      kind: 'gpio';
      peripheralId: string;
      padId: string;
      endpointId: string | null;
      label: string;
      color: string | null;
    }>;
  };
  netlist?: unknown;
  layout: {
    showFullPinout: boolean;
    peripheralPositions: Record<string, { x: number; y: number }>;
  };
  code: {
    mode: 'generated' | 'manual';
    mainSource: string;
  };
};

type SaveProjectRequest = {
  filePath?: string;
  saveAs?: boolean;
  project: LocalProjectDocument;
};

type SaveProjectResult = {
  success: boolean;
  canceled?: boolean;
  message: string;
  filePath?: string;
};

type LoadProjectRequest = {
  filePath?: string;
};

type LoadProjectResult = {
  success: boolean;
  canceled?: boolean;
  message: string;
  filePath?: string;
  project?: unknown;
};

type RuntimeEvent =
  | {
      type: 'log';
      level?: 'info' | 'warn' | 'error';
      message: string;
      timestamp?: string;
    }
  | {
      type: 'led';
      id: string;
      state: number;
    }
  | {
      type: 'signal';
      schemaVersion?: number;
      id: string;
      peripheralId: string;
      peripheralKind: 'button' | 'led';
      label: string;
      direction: 'input' | 'output';
      value: 0 | 1;
      source: 'ui' | 'bridge' | 'renode' | 'system';
      changed?: boolean;
      netId?: string | null;
      componentId?: string | null;
      pinId?: string | null;
      endpointId?: string | null;
      padId?: string | null;
      gpioPortName?: string;
      gpioNumber?: number;
      mcuPinId?: string;
      color?: string | null;
      timestampMs?: number;
      virtualTimeNs?: number;
      sequence?: number;
      timestamp?: string;
      clock?: SimulationClockSnapshot;
    }
  | {
      type: 'clock';
      status?: 'started' | 'sync' | 'stopped';
      clock: SimulationClockSnapshot;
    }
  | {
      type: 'timeline';
      event: RuntimeTimelineEvent;
    }
  | {
      type: 'bus';
      event: RuntimeTimelineEvent;
    }
  | {
      type: 'bridge';
      status: 'connected' | 'disconnected' | 'ready' | 'button-event';
      ledHooked?: boolean;
      ledHookError?: string | null;
      peripheralIds?: string[];
      id?: string;
      state?: number;
    }
  | {
      type: 'broker';
      status: 'listening' | 'connected' | 'disconnected' | 'transaction' | 'error';
      port?: number | null;
      peer?: string;
      protocol?: 'uart' | 'i2c' | 'spi';
      busId?: string | null;
      address?: number | null;
      message?: string;
    }
  | {
      type: 'simulation';
      status: 'running' | 'stopped';
      workspaceDir?: string;
      gdbPort?: number;
      bridgePort?: number;
      transactionBrokerPort?: number;
      monitorPort?: number;
      uartPeripheralName?: string | null;
      uartPort?: number | null;
      exitCode?: number | null;
    }
  | {
      type: 'uart';
      stream?: 'rx' | 'tx' | 'stdout' | 'stderr' | 'system';
      status?: 'connecting' | 'connected' | 'disconnected' | 'error' | 'data';
      peripheralName?: string | null;
      port?: number | null;
      data?: string;
      clock?: SimulationClockSnapshot;
      timestamp?: string;
    }
  | {
      type: 'debug';
      stream?: 'mi' | 'console' | 'stderr';
      status?: 'connected' | 'disconnected' | 'running' | 'stopped' | 'breakpoint' | 'done' | 'error';
      gdbPort?: number;
      exitCode?: number | null;
      reason?: string | null;
      message?: string;
      breakpoint?: string | null | { number: string | null; file: string | null; fullname: string | null; line: number | null };
      frame?: {
        func: string | null;
        file: string | null;
        fullname: string | null;
        line: number | null;
      } | null;
      raw?: string;
    };

declare global {
  interface Window {
    localWokwi?: {
      getTooling: () => Promise<ToolingReport>;
      compileFirmware: (request: CompileRequest) => Promise<CompileResult>;
      startSimulation: (request: StartSimulationRequest) => Promise<StartSimulationResult>;
      stopSimulation: () => Promise<{ success: boolean; message: string }>;
      sendPeripheralEvent: (request: { type: 'button'; id: string; state: 0 | 1 }) => Promise<PeripheralEventResult>;
      sendUartData: (request: { data: string }) => Promise<UartDataResult>;
      startDebugging: (request: StartDebuggingRequest) => Promise<StartDebuggingResult>;
      stopDebugging: () => Promise<{ success: boolean; message: string }>;
      debugAction: (request: DebugActionRequest) => Promise<{ success: boolean; message?: string; token?: number }>;
      saveProject: (request: SaveProjectRequest) => Promise<SaveProjectResult>;
      loadProject: (request?: LoadProjectRequest) => Promise<LoadProjectResult>;
      onSimulationEvent: (callback: (event: RuntimeEvent) => void) => () => void;
    };
  }
}
