export {};

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
  bridgePort?: number;
  gdbPort?: number;
  machineName?: string;
};

type StartSimulationResult = {
  success: boolean;
  message: string;
  workspaceDir?: string;
  rescPath?: string;
  replPath?: string;
  gdbPort?: number;
  bridgePort?: number;
  monitorPort?: number;
  bridgeReady?: boolean;
};

type PeripheralEventResult = {
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
  schemaVersion: 1;
  savedAt: string;
  board: {
    id: string;
    name: string;
  };
  templates?: {
    catalogVersion: number;
    kinds: string[];
  };
  wiring: {
    peripherals: Array<{
      id: string;
      kind: 'button' | 'led';
      label: string;
      padId: string | null;
      sourcePeripheralId: string | null;
      templateKind?: 'button' | 'led' | 'buzzer' | 'rgb-led';
      groupId?: string | null;
      groupLabel?: string | null;
      endpointId?: string | null;
      endpointLabel?: string | null;
      accentColor?: string | null;
    }>;
  };
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
      type: 'bridge';
      status: 'connected' | 'disconnected' | 'ready' | 'button-event';
      ledHooked?: boolean;
      ledHookError?: string | null;
      peripheralIds?: string[];
      id?: string;
      state?: number;
    }
  | {
      type: 'simulation';
      status: 'running' | 'stopped';
      workspaceDir?: string;
      gdbPort?: number;
      bridgePort?: number;
      monitorPort?: number;
      exitCode?: number | null;
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
      startDebugging: (request: StartDebuggingRequest) => Promise<StartDebuggingResult>;
      stopDebugging: () => Promise<{ success: boolean; message: string }>;
      debugAction: (request: DebugActionRequest) => Promise<{ success: boolean; message?: string; token?: number }>;
      saveProject: (request: SaveProjectRequest) => Promise<SaveProjectResult>;
      loadProject: (request?: LoadProjectRequest) => Promise<LoadProjectResult>;
      onSimulationEvent: (callback: (event: RuntimeEvent) => void) => () => void;
    };
  }
}
