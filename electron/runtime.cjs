const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { connectExternalControlClient } = require('./external-control.cjs');

const APP_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BRIDGE_PORT = 9001;
const DEFAULT_GDB_PORT = 3333;
const LOCAL_RENODE_PATH = path.join(APP_ROOT, 'renode', 'renode', 'renode.exe');

function normalizeForRenode(filePath) {
  return filePath.replace(/\\/g, '/');
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function createWorkspaceDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'local-wokwi-workspace-'));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a free TCP port.')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function parseMiOutOfBandRecord(line) {
  const normalizedLine = line.replace(/^\d+/, '');
  const payload = {
    raw: normalizedLine,
    type: 'debug',
    stream: 'mi',
  };

  if (normalizedLine.startsWith('*running')) {
    return {
      ...payload,
      status: 'running',
    };
  }

  if (normalizedLine.startsWith('*stopped')) {
    const reason = /reason="([^"]+)"/.exec(normalizedLine)?.[1] ?? 'stopped';
    const func = /func="([^"]+)"/.exec(normalizedLine)?.[1] ?? null;
    const file = /file="([^"]+)"/.exec(normalizedLine)?.[1] ?? null;
    const fullname = /fullname="([^"]+)"/.exec(normalizedLine)?.[1] ?? file;
    const lineNumber = /line="([^"]+)"/.exec(normalizedLine)?.[1];
    const breakpoint = /bkptno="([^"]+)"/.exec(normalizedLine)?.[1] ?? null;

    return {
      ...payload,
      status: 'stopped',
      reason,
      breakpoint,
      frame: {
        func,
        file,
        fullname,
        line: lineNumber ? Number(lineNumber) : null,
      },
    };
  }

  if (normalizedLine.startsWith('=breakpoint-created') || normalizedLine.startsWith('=breakpoint-modified')) {
    const number = /number="([^"]+)"/.exec(normalizedLine)?.[1] ?? null;
    const file = /file="([^"]+)"/.exec(normalizedLine)?.[1] ?? null;
    const fullname = /fullname="([^"]+)"/.exec(normalizedLine)?.[1] ?? file;
    const lineNumber = /line="([^"]+)"/.exec(normalizedLine)?.[1];

    return {
      ...payload,
      status: 'breakpoint',
      breakpoint: {
        number,
        file,
        fullname,
        line: lineNumber ? Number(lineNumber) : null,
      },
    };
  }

  if (/^\^done/.test(normalizedLine)) {
    return {
      ...payload,
      status: 'done',
    };
  }

  if (/^\^error/.test(normalizedLine)) {
    return {
      ...payload,
      status: 'error',
      message: /msg="([^"]+)"/.exec(normalizedLine)?.[1] ?? normalizedLine,
    };
  }

  return payload;
}

function createRuntimeService(options = {}) {
  const emitter = new EventEmitter();
  const state = {
    renodeProcess: null,
    bridgeClient: null,
    bridgePollTimer: null,
    bridgePolling: false,
    bridgeManifest: [],
    ledStateCache: new Map(),
    debugProcess: null,
    debugBuffer: '',
    debugSequence: 1,
    activeWorkspaceDir: null,
  };

  function emit(payload) {
    emitter.emit('event', payload);
    if (typeof options.onEvent === 'function') {
      options.onEvent(payload);
    }
  }

  function log(message, level = 'info') {
    emit({
      type: 'log',
      level,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  async function runProcess(command, args, runOptions = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: runOptions.cwd,
        env: runOptions.env ?? process.env,
        shell: false,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', reject);
      child.on('close', (code) => {
        resolve({
          code,
          stdout,
          stderr,
        });
      });
    });
  }

  async function resolveFromWhere(commandName) {
    try {
      const result = await runProcess('where', [commandName]);
      if (result.code !== 0) {
        return null;
      }
      return result.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean) ?? null;
    } catch {
      return null;
    }
  }

  async function getTooling() {
    const renodePath = fileExists(LOCAL_RENODE_PATH)
      ? LOCAL_RENODE_PATH
      : await resolveFromWhere('renode');
    const gccPath = await resolveFromWhere('arm-none-eabi-gcc');
    const gdbPath = await resolveFromWhere('arm-none-eabi-gdb');

    return {
      renode: {
        found: Boolean(renodePath),
        path: renodePath,
        source: renodePath === LOCAL_RENODE_PATH ? 'bundled' : renodePath ? 'system' : 'missing',
      },
      gcc: {
        found: Boolean(gccPath),
        path: gccPath,
        source: gccPath ? 'system' : 'missing',
      },
      gdb: {
        found: Boolean(gdbPath),
        path: gdbPath,
        source: gdbPath ? 'system' : 'missing',
      },
    };
  }

  function clearBridgePolling() {
    if (state.bridgePollTimer) {
      clearInterval(state.bridgePollTimer);
      state.bridgePollTimer = null;
    }
    state.bridgePolling = false;
  }

  function closeBridgeSession() {
    clearBridgePolling();

    if (state.bridgeClient) {
      try {
        state.bridgeClient.close();
      } catch {
        // ignore shutdown failures
      }
    }

    if (state.bridgeClient || state.bridgeManifest.length > 0) {
      emit({ type: 'bridge', status: 'disconnected' });
    }

    state.bridgeClient = null;
    state.bridgeManifest = [];
    state.ledStateCache = new Map();
  }

  function startBridgePolling() {
    clearBridgePolling();

    const ledEntries = state.bridgeManifest.filter((entry) => entry.kind === 'led');
    if (!state.bridgeClient || ledEntries.length === 0) {
      return;
    }

    const poll = async () => {
      if (!state.bridgeClient || state.bridgePolling) {
        return;
      }

      state.bridgePolling = true;

      try {
        const states = await state.bridgeClient.getPeripheralStates(ledEntries);
        for (const entry of ledEntries) {
          const nextState = Boolean(states.get(entry.id));
          const previousState = state.ledStateCache.get(entry.id);
          if (previousState === nextState) {
            continue;
          }

          state.ledStateCache.set(entry.id, nextState);
          emit({
            type: 'led',
            id: entry.id,
            state: nextState ? 1 : 0,
          });
        }
      } catch (error) {
        const message = String(error);
        if (!state.bridgeClient || /client closed|socket closed/i.test(message)) {
          return;
        }
        log(`External control poll failed: ${message}`, 'error');
        closeBridgeSession();
      } finally {
        state.bridgePolling = false;
      }
    };

    void poll();
    state.bridgePollTimer = setInterval(() => {
      void poll();
    }, 120);
  }

  async function connectBridge(port, machineName, peripheralManifest) {
    const manifest = Array.isArray(peripheralManifest) ? peripheralManifest : [];
    const startedAt = Date.now();
    log(`Waiting for Renode external control on port ${port}...`);

    try {
      const client = await connectExternalControlClient({
        port,
        machineName,
        peripheralManifest: manifest,
        attempts: 80,
        delayMs: 250,
      });

      state.bridgeClient = client;
      state.bridgeManifest = manifest;
      state.ledStateCache = new Map();

      emit({ type: 'bridge', status: 'connected' });
      emit({
        type: 'bridge',
        status: 'ready',
        ledHooked: true,
        ledHookError: null,
        peripheralIds: manifest.map((entry) => entry.id),
      });

      log(`External control connected after ${Date.now() - startedAt} ms.`);
      startBridgePolling();
      return true;
    } catch (error) {
      log(`Renode external control was unavailable on port ${port} after ${Date.now() - startedAt} ms: ${String(error)}`, 'warn');
      return false;
    }
  }

  function parseDebugStdout(chunk) {
    state.debugBuffer += chunk.toString();
    let newlineIndex = state.debugBuffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const rawLine = state.debugBuffer.slice(0, newlineIndex).trim();
      state.debugBuffer = state.debugBuffer.slice(newlineIndex + 1);

      if (rawLine) {
        if (rawLine.startsWith('~') || rawLine.startsWith('&') || rawLine.startsWith('@')) {
          emit({
            type: 'debug',
            stream: 'console',
            message: rawLine,
          });
        } else if (
          rawLine.startsWith('*') ||
          rawLine.startsWith('=') ||
          rawLine.startsWith('^') ||
          /^\d+\^/.test(rawLine)
        ) {
          emit(parseMiOutOfBandRecord(rawLine));
        }
      }

      newlineIndex = state.debugBuffer.indexOf('\n');
    }
  }

  function stopDebuggingInternal() {
    if (state.debugProcess) {
      try {
        state.debugProcess.kill();
      } catch {
        // ignore cleanup failures
      }
      state.debugProcess = null;
    }
    state.debugBuffer = '';
  }

  function attachRenodeProcessHandlers(child) {
    child.stdout.on('data', (chunk) => {
      const message = chunk.toString().trimEnd();
      if (message) {
        log(message);
      }
    });

    child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trimEnd();
      if (message) {
        log(message, 'error');
      }
    });

    child.on('close', (code) => {
      closeBridgeSession();
      stopDebuggingInternal();
      state.renodeProcess = null;
      emit({
        type: 'simulation',
        status: 'stopped',
        exitCode: code,
      });
      log(`Renode exited with code ${code ?? 'unknown'}.`, code === 0 ? 'info' : 'warn');
    });
  }

  function stopSimulationInternal() {
    closeBridgeSession();
    stopDebuggingInternal();

    if (state.renodeProcess) {
      try {
        state.renodeProcess.kill();
      } catch {
        // ignore already-exited child
      }
      state.renodeProcess = null;
    }
  }

  async function compileFirmware(request) {
    const tooling = await getTooling();
    if (!tooling.gcc.found || !tooling.gcc.path) {
      return {
        success: false,
        message: 'Missing arm-none-eabi-gcc. Install the ARM GCC toolchain and expose it on PATH.',
      };
    }

    const workspaceDir = request.workspaceDir || createWorkspaceDir();
    const buildDir = path.join(workspaceDir, 'build');
    ensureDirectory(buildDir);

    const mainPath = path.join(workspaceDir, 'main.c');
    const startupPath = path.join(workspaceDir, 'startup.c');
    const linkerFileName = request.linkerFileName || 'firmware.ld';
    const linkerPath = path.join(workspaceDir, linkerFileName);
    const elfPath = path.join(buildDir, 'firmware.elf');
    const mapPath = path.join(buildDir, 'firmware.map');

    fs.writeFileSync(mainPath, request.mainSource, 'utf8');
    fs.writeFileSync(startupPath, request.startupSource, 'utf8');
    fs.writeFileSync(linkerPath, request.linkerScript, 'utf8');

    const args = [
      ...(Array.isArray(request.gccArgs) && request.gccArgs.length > 0 ? request.gccArgs : ['-mcpu=cortex-m4', '-mthumb']),
      '-O0',
      '-g3',
      '-ffreestanding',
      '-fdata-sections',
      '-ffunction-sections',
      '-Wall',
      '-Wextra',
      '-Wl,--gc-sections',
      `-Wl,-Map,${mapPath}`,
      `-Wl,-T,${linkerPath}`,
      '-nostdlib',
      '-nostartfiles',
      mainPath,
      startupPath,
      '-o',
      elfPath,
    ];

    log('Starting local ARM GCC build...');

    try {
      const result = await runProcess(tooling.gcc.path, args, { cwd: workspaceDir });
      if (result.code !== 0) {
        return {
          success: false,
          message: 'Compilation failed.',
          stdout: result.stdout,
          stderr: result.stderr,
          workspaceDir,
        };
      }

      state.activeWorkspaceDir = workspaceDir;

      return {
        success: true,
        message: 'Compilation succeeded.',
        workspaceDir,
        elfPath,
        mapPath,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      return {
        success: false,
        message: `Compiler process could not start: ${String(error)}`,
        workspaceDir,
      };
    }
  }

  async function startSimulation(request) {
    if (state.renodeProcess) {
      return {
        success: false,
        message: 'Simulation is already running.',
      };
    }

    const tooling = await getTooling();
    if (!tooling.renode.found || !tooling.renode.path) {
      return {
        success: false,
        message: 'Missing Renode runtime. Provide renode on PATH or keep renode/renode/renode.exe in this repository.',
      };
    }

    if (!fileExists(request.elfPath)) {
      return {
        success: false,
        message: 'Compiled ELF file was not found. Compile first.',
      };
    }

    const workspaceDir = request.workspaceDir || state.activeWorkspaceDir || createWorkspaceDir();
    ensureDirectory(workspaceDir);

    const replPath = path.join(workspaceDir, 'board.repl');
    const rescPath = path.join(workspaceDir, 'run.resc');
    const bridgePort = request.bridgePort || DEFAULT_BRIDGE_PORT;
    const gdbPort = request.gdbPort || DEFAULT_GDB_PORT;
    const monitorPort = await getFreePort();
    const machineName = request.machineName || 'NUCLEO-H753ZI GPIO Workbench';
    const relativeElfPath = path
      .relative(workspaceDir, request.elfPath)
      .replace(/\\/g, '/');

    fs.writeFileSync(replPath, request.boardRepl, 'utf8');

    const rescContent = [
      `$name?="${machineName}"`,
      'mach create $name',
      '',
      'machine LoadPlatformDescription @board.repl',
      'using sysbus',
      `sysbus LoadELF @${relativeElfPath}`,
      `emulation CreateExternalControlServer "local-control" ${bridgePort}`,
      `machine StartGdbServer ${gdbPort}`,
      'start',
      '',
    ].join('\n');

    fs.writeFileSync(rescPath, rescContent, 'utf8');

    log('Launching Renode locally...');

    try {
      const child = spawn(
        tooling.renode.path,
        [
          '--disable-gui',
          '--hide-analyzers',
          '--plain',
          '-P',
          String(monitorPort),
          '-e',
          's @run.resc',
        ],
        {
          cwd: workspaceDir,
          windowsHide: true,
        }
      );

      state.renodeProcess = child;
      state.activeWorkspaceDir = workspaceDir;
      attachRenodeProcessHandlers(child);

      const bridgeReady = await connectBridge(bridgePort, machineName, request.peripheralManifest);
      if (!bridgeReady) {
        log(`Renode started, but the external control bridge on port ${bridgePort} did not answer in time.`, 'warn');
      }

      emit({
        type: 'simulation',
        status: 'running',
        workspaceDir,
        gdbPort,
        bridgePort,
        monitorPort,
      });

      return {
        success: true,
        message: 'Simulation started.',
        workspaceDir,
        rescPath,
        replPath,
        gdbPort,
        bridgePort,
        monitorPort,
        bridgeReady,
      };
    } catch (error) {
      state.renodeProcess = null;
      closeBridgeSession();
      return {
        success: false,
        message: `Failed to launch Renode: ${String(error)}`,
      };
    }
  }

  async function sendPeripheralEvent(request) {
    if (!state.bridgeClient) {
      return {
        success: false,
        message: 'External control bridge is not connected.',
      };
    }

    const entry = state.bridgeManifest.find((candidate) => candidate.id === request.id && candidate.kind === 'button');
    if (!entry) {
      return {
        success: false,
        message: `Unknown button peripheral: ${request.id}`,
      };
    }

    try {
      await state.bridgeClient.setPeripheralState(entry, request.state === 1);
      emit({
        type: 'bridge',
        status: 'button-event',
        id: request.id,
        state: request.state,
      });
      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to drive button state: ${String(error)}`,
      };
    }
  }

  function sendDebugCommand(command) {
    if (!state.debugProcess) {
      return {
        success: false,
        message: 'Debugger is not connected.',
      };
    }

    const token = state.debugSequence++;
    state.debugProcess.stdin.write(`${token}${command}\n`);
    return {
      success: true,
      token,
    };
  }

  async function startDebugging(request) {
    if (state.debugProcess) {
      return {
        success: false,
        message: 'Debugger is already connected.',
      };
    }

    const tooling = await getTooling();
    if (!tooling.gdb.found || !tooling.gdb.path) {
      return {
        success: false,
        message: 'Missing arm-none-eabi-gdb. Install the ARM GDB toolchain and expose it on PATH.',
      };
    }

    if (!request.elfPath || !fileExists(request.elfPath)) {
      return {
        success: false,
        message: 'Debugger requires a compiled ELF file.',
      };
    }

    if (!state.renodeProcess) {
      return {
        success: false,
        message: 'Start the simulation before attaching GDB.',
      };
    }

    const gdbPort = request.gdbPort || DEFAULT_GDB_PORT;

    try {
      const child = spawn(
        tooling.gdb.path,
        [request.elfPath, '--interpreter=mi2', '-q'],
        {
          cwd: request.workspaceDir || state.activeWorkspaceDir || APP_ROOT,
          windowsHide: true,
        }
      );

      state.debugProcess = child;
      state.debugBuffer = '';
      state.debugSequence = 1;

      child.stdout.on('data', parseDebugStdout);
      child.stderr.on('data', (chunk) => {
        emit({
          type: 'debug',
          stream: 'stderr',
          message: chunk.toString().trimEnd(),
        });
      });
      child.on('close', (code) => {
        state.debugProcess = null;
        state.debugBuffer = '';
        emit({
          type: 'debug',
          status: 'disconnected',
          exitCode: code,
        });
      });

      sendDebugCommand('-gdb-set mi-async on');
      sendDebugCommand(`-target-select remote 127.0.0.1:${gdbPort}`);

      emit({
        type: 'debug',
        status: 'connected',
        gdbPort,
      });

      return {
        success: true,
        message: 'Debugger connected.',
        gdbPort,
      };
    } catch (error) {
      state.debugProcess = null;
      return {
        success: false,
        message: `Failed to start GDB: ${String(error)}`,
      };
    }
  }

  async function stopDebugging() {
    const result = sendDebugCommand('-gdb-exit');
    stopDebuggingInternal();
    return {
      success: result.success,
      message: result.success ? 'Debugger disconnected.' : 'Debugger was not connected.',
    };
  }

  async function debugAction(request) {
    const action = request?.action;
    if (!action) {
      return {
        success: false,
        message: 'Missing debugger action.',
      };
    }

    if (action === 'continue') {
      return sendDebugCommand('-exec-continue');
    }
    if (action === 'next') {
      return sendDebugCommand('-exec-next');
    }
    if (action === 'step') {
      return sendDebugCommand('-exec-step');
    }
    if (action === 'interrupt') {
      return sendDebugCommand('-exec-interrupt');
    }
    if (action === 'break-main') {
      return sendDebugCommand('-break-insert main');
    }
    if (action === 'break-line') {
      if (!request.line) {
        return {
          success: false,
          message: 'Line breakpoint requires a line number.',
        };
      }
      return sendDebugCommand(`-break-insert main.c:${request.line}`);
    }

    return {
      success: false,
      message: `Unsupported debugger action: ${action}`,
    };
  }

  async function stopSimulation() {
    stopSimulationInternal();
    return {
      success: true,
      message: 'Stop signal sent.',
    };
  }

  return {
    APP_ROOT,
    DEFAULT_BRIDGE_PORT,
    DEFAULT_GDB_PORT,
    createWorkspaceDir,
    on: (...args) => emitter.on(...args),
    off: (...args) => emitter.off(...args),
    getTooling,
    compileFirmware,
    startSimulation,
    stopSimulation,
    sendPeripheralEvent,
    startDebugging,
    stopDebugging,
    debugAction,
  };
}

module.exports = {
  createRuntimeService,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_GDB_PORT,
  createWorkspaceDir,
};
