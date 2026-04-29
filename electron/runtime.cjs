/**
 * Electron main-process runtime facade around local toolchains and Renode.
 *
 * The renderer never spawns compilers or Renode directly. IPC calls land here:
 * this file writes build workspaces, invokes arm-none-eabi-gcc, starts Renode,
 * opens UART / external-control / transaction broker bridges, and emits
 * normalized runtime events back to the React UI.
 */
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
const DEFAULT_TRANSACTION_BROKER_PORT = 9201;
const LOCAL_RENODE_PATH = path.join(APP_ROOT, 'renode', 'renode', 'renode.exe');
const SIMULATION_CLOCK_SCHEMA_VERSION = 1;
const RUNTIME_TIMELINE_SCHEMA_VERSION = 1;
const MAX_BUS_PAYLOAD_BYTES = 2048;
const MAX_BROKER_LINE_BYTES = 1024 * 1024;
const SSD1306_DEFAULT_ADDRESS = 0x3c;

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

function sanitizeFileName(fileName) {
  return String(fileName || 'firmware.elf').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function createWorkspaceDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'local-wokwi-workspace-'));
}

function createSimulationClockState(options = {}) {
  const nowMs = Date.now();
  return {
    startedAtWallTimeMs: options.startedAtWallTimeMs ?? nowMs,
    baseVirtualTimeNs: options.baseVirtualTimeNs ?? 0,
    sequence: 0,
    syncMode: options.syncMode ?? 'host-estimated',
    timeScale: options.timeScale ?? 1,
    paused: false,
  };
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
    signalStateCache: new Map(),
    signalManifest: new Map(),
    busManifest: new Map(),
    busManifestEntries: [],
    i2cDemoTimer: null,
    transactionBrokerServer: null,
    transactionBrokerSockets: new Set(),
    transactionBrokerBuffers: new Map(),
    transactionBrokerPort: null,
    monitorPort: null,
    monitorCommandQueue: Promise.resolve(),
    simulationClock: createSimulationClockState(),
    clockSyncTimer: null,
    debugProcess: null,
    debugBuffer: '',
    debugSequence: 1,
    activeWorkspaceDir: null,
    uartSocket: null,
    uartCapture: {
      enabled: false,
      connected: false,
      peripheralName: null,
      port: null,
      buffer: '',
      lineBuffer: '',
      lineFlushTimer: null,
    },
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

  function snapshotSimulationClock() {
    const wallTimeMs = Date.now();
    const elapsedWallMs = Math.max(0, wallTimeMs - state.simulationClock.startedAtWallTimeMs);
    const virtualTimeNs =
      state.simulationClock.baseVirtualTimeNs +
      Math.round(elapsedWallMs * 1000000 * state.simulationClock.timeScale);

    state.simulationClock.sequence += 1;

    return {
      schemaVersion: SIMULATION_CLOCK_SCHEMA_VERSION,
      sequence: state.simulationClock.sequence,
      wallTimeMs,
      virtualTimeNs,
      virtualTimeMs: virtualTimeNs / 1000000,
      elapsedWallMs,
      syncMode: state.simulationClock.syncMode,
      timeScale: state.simulationClock.timeScale,
      paused: state.simulationClock.paused,
    };
  }

  function resetSimulationClock(syncMode = 'host-estimated') {
    state.simulationClock = createSimulationClockState({ syncMode });
    return snapshotSimulationClock();
  }

  function emitClock(status = 'sync') {
    const clock = snapshotSimulationClock();
    emit({
      type: 'clock',
      status,
      clock,
    });
    return clock;
  }

  function clearClockSync() {
    if (state.clockSyncTimer) {
      clearInterval(state.clockSyncTimer);
      state.clockSyncTimer = null;
    }
  }

  function startClockSync() {
    clearClockSync();
    state.clockSyncTimer = setInterval(() => {
      emitClock('sync');
    }, 500);
  }

  function clearI2cDemoFeed() {
    if (state.i2cDemoTimer) {
      clearTimeout(state.i2cDemoTimer);
      state.i2cDemoTimer = null;
    }
  }

  function createSsd1306SplashPayload() {
    const bytes = [0x00, 0xae, 0x21, 0x00, 0x7f, 0x22, 0x00, 0x07, 0xaf, 0x40];
    for (let page = 0; page < 8; page += 1) {
      for (let column = 0; column < 128; column += 1) {
        const inFrame = column < 3 || column > 124 || page === 0 || page === 7;
        const stripe = (column + page * 9) % 18 < 9;
        const center = column > 22 && column < 106 && page > 1 && page < 6;
        bytes.push(inFrame ? 0xff : center ? (stripe ? 0x7e : 0x18) : 0x00);
      }
    }
    return bytes;
  }

  function startI2cDemoFeed() {
    clearI2cDemoFeed();
    const devices = getSsd1306Devices();
    if (devices.length === 0) {
      return;
    }

    state.i2cDemoTimer = setTimeout(() => {
      const payload = createSsd1306SplashPayload();
      devices.forEach((device) => {
        emitBusTransaction({
          protocol: 'i2c',
          busId: device.busId,
          busLabel: device.busLabel,
          peripheralName: device.componentId,
          direction: 'write',
          status: 'planned',
          address: device.address ?? SSD1306_DEFAULT_ADDRESS,
          data: payload,
          source: 'system',
        });
      });
      log(`I2C Transaction Broker demo emitted SSD1306 splash transaction for ${devices.length} OLED device(s).`);
      state.i2cDemoTimer = null;
    }, 750);
  }

  function normalizeProtocol(value) {
    const protocol = String(value ?? '').toLowerCase();
    return ['uart', 'i2c', 'spi'].includes(protocol) ? protocol : null;
  }

  function normalizeDirection(protocol, value) {
    const direction = String(value ?? '').toLowerCase();
    const allowed = protocol === 'uart' ? ['rx', 'tx', 'system'] : ['read', 'write', 'transfer', 'system'];
    return allowed.includes(direction) ? direction : null;
  }

  function parseMaybeHexNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }
    const normalized = value.trim();
    const parsed = normalized.toLowerCase().startsWith('0x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeBrokerBytes(message) {
    const candidate = message?.payload?.bytes ?? message?.bytes ?? message?.data;
    if (Array.isArray(candidate)) {
      return candidate.map((value) => Number(value) & 0xff);
    }

    if (Buffer.isBuffer(candidate)) {
      return [...candidate];
    }

    if (typeof candidate === 'string') {
      const encoding = String(message?.payload?.encoding ?? message?.encoding ?? '').toLowerCase();
      if (encoding === 'base64') {
        return [...Buffer.from(candidate, 'base64')];
      }
      if (/^[0-9a-f\s,]+$/i.test(candidate) && /[0-9a-f]{2}/i.test(candidate)) {
        return candidate
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((value) => Number.parseInt(value, 16) & 0xff);
      }
      return candidate;
    }

    return [];
  }

  function normalizeExternalClock(clockInput) {
    const clock = snapshotSimulationClock();
    if (!clockInput || typeof clockInput !== 'object') {
      return clock;
    }

    const virtualTimeNs = parseMaybeHexNumber(clockInput.virtualTimeNs);
    if (virtualTimeNs === null) {
      return clock;
    }

    return {
      ...clock,
      virtualTimeNs,
      virtualTimeMs: virtualTimeNs / 1000000,
      syncMode: 'renode-virtual',
      timeScale: typeof clockInput.timeScale === 'number' ? clockInput.timeScale : clock.timeScale,
    };
  }

  function ingestTransactionBrokerMessage(message, peer = 'unknown') {
    if (!message || typeof message !== 'object') {
      throw new Error('Broker message must be a JSON object.');
    }

    const protocol = normalizeProtocol(message.protocol);
    if (!protocol) {
      throw new Error(`Unsupported broker protocol: ${String(message.protocol ?? 'missing')}`);
    }

    const direction = normalizeDirection(protocol, message.direction);
    if (!direction) {
      throw new Error(`Unsupported ${protocol.toUpperCase()} broker direction: ${String(message.direction ?? 'missing')}`);
    }

    const clock = normalizeExternalClock(message.clock);
    const address = parseMaybeHexNumber(message.address);
    const data = normalizeBrokerBytes(message);

    emitBusTransaction(
      {
        protocol,
        busId: typeof message.busId === 'string' ? message.busId : null,
        busLabel: typeof message.busLabel === 'string' ? message.busLabel : null,
        peripheralName: typeof message.peripheralName === 'string' ? message.peripheralName : null,
        direction,
        status: typeof message.status === 'string' ? message.status : 'data',
        address,
        data,
        source: typeof message.source === 'string' ? message.source : 'renode',
      },
      clock
    );

    emit({
      type: 'broker',
      status: 'transaction',
      protocol,
      peer,
      busId: typeof message.busId === 'string' ? message.busId : null,
      address,
    });
  }

  function writeBrokerManifest(workspaceDir, port, busManifestEntries) {
    const manifestPath = path.join(workspaceDir, 'local-wokwi-broker.json');
    const manifest = {
      schemaVersion: RUNTIME_TIMELINE_SCHEMA_VERSION,
      host: '127.0.0.1',
      port,
      transport: 'tcp-jsonl',
      protocols: ['gpio', 'uart', 'i2c', 'spi'],
      buses: busManifestEntries,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return manifestPath;
  }

  function stopTransactionBrokerServer() {
    if (state.transactionBrokerServer) {
      try {
        state.transactionBrokerServer.close();
      } catch {
        // ignore shutdown failures
      }
      state.transactionBrokerServer = null;
    }

    state.transactionBrokerSockets.forEach((socket) => {
      try {
        socket.destroy();
      } catch {
        // ignore socket cleanup failures
      }
    });
    state.transactionBrokerSockets.clear();
    state.transactionBrokerBuffers.clear();
    state.transactionBrokerPort = null;
  }

  async function startTransactionBrokerServer(port) {
    stopTransactionBrokerServer();

    const server = net.createServer((socket) => {
      const peer = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`;
      state.transactionBrokerSockets.add(socket);
      state.transactionBrokerBuffers.set(socket, '');
      emit({ type: 'broker', status: 'connected', peer, port: state.transactionBrokerPort });

      socket.on('data', (chunk) => {
        let buffer = `${state.transactionBrokerBuffers.get(socket) ?? ''}${chunk.toString('utf8')}`;
        if (buffer.length > MAX_BROKER_LINE_BYTES) {
          log(`Transaction broker message from ${peer} exceeded ${MAX_BROKER_LINE_BYTES} bytes; closing client.`, 'warn');
          socket.destroy();
          return;
        }

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) {
            try {
              ingestTransactionBrokerMessage(JSON.parse(line), peer);
            } catch (error) {
              log(`Transaction broker rejected message from ${peer}: ${String(error)}`, 'warn');
              emit({ type: 'broker', status: 'error', peer, message: String(error) });
            }
          }
          newlineIndex = buffer.indexOf('\n');
        }
        state.transactionBrokerBuffers.set(socket, buffer);
      });

      socket.on('error', (error) => {
        log(`Transaction broker socket error from ${peer}: ${String(error)}`, 'warn');
      });

      socket.on('close', () => {
        state.transactionBrokerSockets.delete(socket);
        state.transactionBrokerBuffers.delete(socket);
        emit({ type: 'broker', status: 'disconnected', peer, port: state.transactionBrokerPort });
      });
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    state.transactionBrokerServer = server;
    state.transactionBrokerPort = port;
    log(`Transaction Broker Bridge listening on 127.0.0.1:${port}.`);
    emit({ type: 'broker', status: 'listening', port });
    return port;
  }

  function createTimelineId(protocol, kind, clock, identity) {
    return `timeline:${clock.sequence}:${protocol}:${kind}:${identity}`;
  }

  function createBusManifestMap(busManifest) {
    if (!Array.isArray(busManifest)) {
      return new Map();
    }

    const entries = [];
    busManifest
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.protocol === 'string')
      .forEach((entry) => {
        entries.push([entry.id, entry]);
        if (entry.renodePeripheralName) {
          entries.push([`${entry.protocol}:${String(entry.renodePeripheralName).toLowerCase()}`, entry]);
        }
      });

    return new Map(entries);
  }

  function getSsd1306Devices() {
    return state.busManifestEntries.flatMap((entry) =>
      Array.isArray(entry.devices)
        ? entry.devices
            .filter((device) => device.model === 'ssd1306')
            .map((device) => ({
              ...device,
              busId: entry.id,
              busLabel: entry.label,
            }))
        : []
    );
  }

  function resolveBusManifestEntry(protocol, peripheralName) {
    const fallbackId = `${protocol}:${String(peripheralName || 'default').toLowerCase()}`;
    return state.busManifest.get(fallbackId) ?? state.busManifest.get(`${protocol}:${String(peripheralName || '').toLowerCase()}`) ?? null;
  }

  function encodePayload(data) {
    const bytes = Array.isArray(data) ? data.map((value) => Number(value) & 0xff) : Array.from(Buffer.from(String(data ?? ''), 'utf8'));
    const truncated = bytes.length > MAX_BUS_PAYLOAD_BYTES;
    return {
      bytes: bytes.slice(0, MAX_BUS_PAYLOAD_BYTES),
      text: typeof data === 'string' ? data.slice(0, MAX_BUS_PAYLOAD_BYTES) : null,
      bitLength: bytes.length * 8,
      truncated,
    };
  }

  function emitTimelineEvent(event) {
    emit({
      type: 'timeline',
      event,
    });
  }

  function emitBusTransaction(transaction, clock = snapshotSimulationClock()) {
    const manifestEntry = transaction.busId ? state.busManifest.get(transaction.busId) : resolveBusManifestEntry(transaction.protocol, transaction.peripheralName);
    const busId = transaction.busId ?? manifestEntry?.id ?? `${transaction.protocol}:${String(transaction.peripheralName || 'default').toLowerCase()}`;
    const busLabel = transaction.busLabel ?? manifestEntry?.label ?? String(transaction.peripheralName || transaction.protocol).toUpperCase();
    const payload = encodePayload(transaction.data ?? '');
    const event = {
      schemaVersion: RUNTIME_TIMELINE_SCHEMA_VERSION,
      id: createTimelineId(transaction.protocol, 'bus', clock, `${busId}:${transaction.direction}`),
      protocol: transaction.protocol,
      kind: 'bus-transaction',
      source: transaction.source ?? transaction.protocol,
      clock,
      summary: `${busLabel} ${transaction.direction} ${payload.bytes.length} byte(s)`,
      busId,
      busLabel,
      renodePeripheralName: transaction.peripheralName ?? manifestEntry?.renodePeripheralName ?? null,
      direction: transaction.direction,
      status: transaction.status ?? 'data',
      address: transaction.address ?? null,
      payload,
    };

    emit({
      type: 'bus',
      event,
    });
    emitTimelineEvent(event);
  }

  function emitUart(data, stream = 'rx', status = 'data') {
    if (!state.uartCapture.enabled || !data) {
      return;
    }

    const clock = snapshotSimulationClock();
    emit({
      type: 'uart',
      stream,
      status,
      peripheralName: state.uartCapture.peripheralName,
      port: state.uartCapture.port,
      data,
      clock,
      timestamp: new Date().toISOString(),
    });

    emitBusTransaction(
      {
        protocol: 'uart',
        peripheralName: state.uartCapture.peripheralName,
        direction: stream === 'tx' || stream === 'rx' ? stream : 'system',
        status,
        data,
        source: stream === 'tx' ? 'ui' : stream === 'rx' ? 'renode' : 'system',
      },
      clock
    );
  }

  function clearUartLineFlushTimer() {
    if (state.uartCapture.lineFlushTimer) {
      clearTimeout(state.uartCapture.lineFlushTimer);
      state.uartCapture.lineFlushTimer = null;
    }
  }

  function flushUartLineBuffer() {
    clearUartLineFlushTimer();
    const pending = state.uartCapture.lineBuffer || '';
    if (!pending) {
      return;
    }
    state.uartCapture.lineBuffer = '';
    emitUart(pending, 'rx', 'data');
  }

  function scheduleUartLineFlush() {
    clearUartLineFlushTimer();
    state.uartCapture.lineFlushTimer = setTimeout(() => {
      state.uartCapture.lineFlushTimer = null;
      flushUartLineBuffer();
    }, 120);
  }

  function emitUartLineBuffered(data) {
    if (!state.uartCapture.enabled || !data) {
      return;
    }

    clearUartLineFlushTimer();
    let buffer = `${state.uartCapture.lineBuffer || ''}${data}`;
    let newlineIndex = buffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex + 1);
      emitUart(line, 'rx', 'data');
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
    }

    state.uartCapture.lineBuffer = buffer;
    if (buffer) {
      scheduleUartLineFlush();
    }
  }

  function emitUartStatus(status, data = '') {
    if (!state.uartCapture.enabled) {
      return;
    }

    const clock = snapshotSimulationClock();
    emit({
      type: 'uart',
      stream: 'system',
      status,
      peripheralName: state.uartCapture.peripheralName,
      port: state.uartCapture.port,
      data,
      clock,
      timestamp: new Date().toISOString(),
    });

    if (data) {
      emitBusTransaction(
        {
          protocol: 'uart',
          peripheralName: state.uartCapture.peripheralName,
          direction: 'system',
          status,
          data,
          source: 'system',
        },
        clock
      );
    }
  }

  function emitSignal(entry, value, source) {
    const signalBinding = state.signalManifest.get(entry.id) ?? null;
    const numericValue = value ? 1 : 0;
    const signalId = signalBinding?.id ?? `signal:${entry.id}`;
    const cacheKey = `${signalId}:${source}`;
    const previousValue = state.signalStateCache.get(cacheKey);
    state.signalStateCache.set(cacheKey, numericValue);
    const clock = snapshotSimulationClock();

    const signalPayload = {
      type: 'signal',
      schemaVersion: signalBinding?.schemaVersion ?? 2,
      id: signalId,
      peripheralId: entry.id,
      peripheralKind: entry.kind,
      label: signalBinding?.label ?? entry.label,
      direction: signalBinding?.direction ?? (entry.kind === 'button' ? 'input' : 'output'),
      value: numericValue,
      source,
      changed: previousValue !== numericValue,
      netId: signalBinding?.netId ?? null,
      componentId: signalBinding?.componentId ?? null,
      pinId: signalBinding?.pinId ?? null,
      endpointId: signalBinding?.endpointId ?? null,
      padId: signalBinding?.padId ?? null,
      gpioPortName: entry.gpioPortName,
      gpioNumber: entry.gpioNumber,
      mcuPinId: signalBinding?.mcuPinId ?? entry.mcuPinId,
      color: signalBinding?.color ?? null,
      timestampMs: clock.wallTimeMs,
      virtualTimeNs: clock.virtualTimeNs,
      sequence: clock.sequence,
      clock,
      timestamp: new Date().toISOString(),
    };

    emit(signalPayload);
    emitTimelineEvent({
      schemaVersion: RUNTIME_TIMELINE_SCHEMA_VERSION,
      id: createTimelineId('gpio', 'sample', clock, signalId),
      protocol: 'gpio',
      kind: 'gpio-sample',
      source,
      clock,
      summary: `${signalPayload.label} ${numericValue ? 'HIGH' : 'LOW'} (${source})`,
      signalId,
      peripheralId: entry.id,
      label: signalPayload.label,
      direction: signalPayload.direction,
      value: numericValue,
      changed: signalPayload.changed,
      netId: signalPayload.netId,
      componentId: signalPayload.componentId,
      pinId: signalPayload.pinId,
      padId: signalPayload.padId,
      mcuPinId: signalPayload.mcuPinId,
    });
  }

  function createSignalManifestMap(signalManifest) {
    if (!Array.isArray(signalManifest)) {
      return new Map();
    }

    return new Map(
      signalManifest
        .filter((entry) => entry && typeof entry.peripheralId === 'string' && typeof entry.id === 'string')
        .map((entry) => [entry.peripheralId, entry])
    );
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
    state.signalStateCache = new Map();
    state.signalManifest = new Map();
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
          emitSignal(entry, nextState, 'renode');
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

  async function connectBridge(port, machineName, peripheralManifest, signalManifest) {
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
      state.signalStateCache = new Map();
      state.signalManifest = createSignalManifestMap(signalManifest);

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

  function closeUartTerminal() {
    flushUartLineBuffer();

    if (state.uartSocket) {
      try {
        state.uartSocket.destroy();
      } catch {
        // ignore shutdown failures
      }
      state.uartSocket = null;
    }

    if (state.uartCapture.enabled && state.uartCapture.connected) {
      emitUartStatus('disconnected', 'UART terminal disconnected.\n');
    }

    state.uartCapture = {
      enabled: false,
      connected: false,
      peripheralName: null,
      port: null,
      buffer: '',
      lineBuffer: '',
      lineFlushTimer: null,
    };
  }

  function connectSocketOnce(port) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const handleError = (error) => {
        socket.destroy();
        reject(error);
      };

      socket.once('error', handleError);
      socket.once('connect', () => {
        socket.off('error', handleError);
        resolve(socket);
      });
    });
  }

  function normalizeMonitorPath(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return /^[a-zA-Z0-9_.]+$/.test(normalized) ? normalized : null;
  }

  function normalizeSensorNumber(value, min, max) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }
    return Math.min(max, Math.max(min, numericValue));
  }

  function normalizeMonitorPropertyName(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalized) ? normalized : null;
  }

  function normalizeNativeSensorChannels(request) {
    const channels = [];
    if (Array.isArray(request?.channels)) {
      request.channels.forEach((channel) => {
        const id = typeof channel?.id === 'string' && channel.id.trim() ? channel.id.trim() : null;
        const renodeProperty = normalizeMonitorPropertyName(channel?.renodeProperty);
        const minimum = Number.isFinite(Number(channel?.minimum)) ? Number(channel.minimum) : -1000000;
        const maximum = Number.isFinite(Number(channel?.maximum)) ? Number(channel.maximum) : 1000000;
        const value = normalizeSensorNumber(channel?.value, minimum, maximum);
        if (!id || !renodeProperty || value === null) {
          return;
        }
        channels.push({
          id,
          renodeProperty,
          value,
        });
      });
    }

    if (request && Object.prototype.hasOwnProperty.call(request, 'temperatureC')) {
      const value = normalizeSensorNumber(request.temperatureC, -40, 85);
      if (value !== null && !channels.some((channel) => channel.id === 'temperature')) {
        channels.push({ id: 'temperature', renodeProperty: 'Temperature', value });
      }
    }

    if (request && Object.prototype.hasOwnProperty.call(request, 'humidityPercent')) {
      const value = normalizeSensorNumber(request.humidityPercent, 0, 100);
      if (value !== null && !channels.some((channel) => channel.id === 'humidity')) {
        channels.push({ id: 'humidity', renodeProperty: 'Humidity', value });
      }
    }

    return channels;
  }

  function cleanMonitorOutput(output, command) {
    const printable = String(output ?? '').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
    return printable
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line !== command && !line.startsWith('(machine') && !line.startsWith('Renode, version'))
      .join('\n');
  }

  function parseMonitorNumber(output) {
    const lines = String(output ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const value = Number(lines[index]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  }

  function runMonitorCommand(command, timeoutMs = 700) {
    return new Promise((resolve, reject) => {
      if (!state.monitorPort) {
        reject(new Error('Renode monitor port is not available.'));
        return;
      }

      let output = '';
      let settled = false;
      const socket = net.createConnection({ host: '127.0.0.1', port: state.monitorPort });
      const finish = (error = null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          socket.destroy();
        } catch {
          // ignore monitor socket cleanup failures
        }
        if (error) {
          reject(error);
          return;
        }
        resolve(cleanMonitorOutput(output, command));
      };

      const timer = setTimeout(() => finish(), timeoutMs);
      socket.on('connect', () => {
        setTimeout(() => {
          try {
            socket.write(`${command}\n`);
          } catch (error) {
            finish(error);
          }
        }, 60);
      });
      socket.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });
      socket.on('error', (error) => finish(error));
    });
  }

  function enqueueMonitorCommand(task) {
    const queued = state.monitorCommandQueue.then(task, task);
    state.monitorCommandQueue = queued.catch(() => {});
    return queued;
  }

  async function connectUartTerminal(port, peripheralName) {
    if (!port || !peripheralName) {
      return false;
    }

    state.uartCapture = {
      enabled: true,
      connected: false,
      peripheralName,
      port,
      buffer: '',
      lineBuffer: '',
      lineFlushTimer: null,
    };
    emitUartStatus('connecting', `Waiting for UART terminal ${peripheralName} on port ${port}...\n`);

    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const socket = await connectSocketOnce(port);
        state.uartSocket = socket;
        state.uartCapture.connected = true;

        socket.on('data', (chunk) => {
          emitUartLineBuffered(chunk.toString('utf8'));
        });
        socket.on('error', (error) => {
          log(`UART terminal socket error: ${String(error)}`, 'warn');
          emitUartStatus('error', `UART socket error: ${String(error)}\n`);
        });
        socket.on('close', () => {
          if (state.uartSocket === socket) {
            flushUartLineBuffer();
            state.uartSocket = null;
            state.uartCapture.connected = false;
            emitUartStatus('disconnected', 'UART terminal socket closed.\n');
          }
        });

        emitUartStatus('connected', `UART terminal connected to ${peripheralName} on port ${port}.\n`);
        log(`UART terminal connected to ${peripheralName} on port ${port}.`);
        return true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    emitUartStatus('error', `UART terminal ${peripheralName} did not open on port ${port}.\n`);
    log(`UART terminal ${peripheralName} did not open on port ${port}.`, 'warn');
    return false;
  }

  function attachRenodeProcessHandlers(child) {
    child.stdout.on('data', (chunk) => {
      const rawMessage = chunk.toString();
      captureUartAnalyzerOutput(rawMessage, 'stdout');
      const message = rawMessage.trimEnd();
      if (message) {
        log(message);
      }
    });

    child.stderr.on('data', (chunk) => {
      const rawMessage = chunk.toString();
      captureUartAnalyzerOutput(rawMessage, 'stderr');
      const message = rawMessage.trimEnd();
      if (message) {
        log(message, 'error');
      }
    });

    child.on('close', (code) => {
      clearClockSync();
      clearI2cDemoFeed();
      stopTransactionBrokerServer();
      closeBridgeSession();
      stopDebuggingInternal();
      closeUartTerminal();
      state.busManifest = new Map();
      state.busManifestEntries = [];
      state.monitorPort = null;
      state.renodeProcess = null;
      state.simulationClock.paused = true;
      emitClock('stopped');
      emit({
        type: 'simulation',
        status: 'stopped',
        exitCode: code,
      });
      log(`Renode exited with code ${code ?? 'unknown'}.`, code === 0 ? 'info' : 'warn');
    });
  }

  function stopSimulationInternal() {
    clearClockSync();
    clearI2cDemoFeed();
    stopTransactionBrokerServer();
    closeBridgeSession();
    stopDebuggingInternal();
    closeUartTerminal();
    state.busManifest = new Map();
    state.busManifestEntries = [];
    state.monitorPort = null;

    if (state.renodeProcess) {
      try {
        state.renodeProcess.kill();
      } catch {
        // ignore already-exited child
      }
      state.renodeProcess = null;
    }
  }

  function captureUartAnalyzerOutput(rawMessage, stream) {
    if (!state.uartCapture.enabled || !state.uartCapture.peripheralName) {
      return;
    }

    state.uartCapture.buffer += rawMessage;
    let newlineIndex = state.uartCapture.buffer.indexOf('\n');
    const peripheralName = String(state.uartCapture.peripheralName).toLowerCase();

    while (newlineIndex >= 0) {
      const line = state.uartCapture.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      state.uartCapture.buffer = state.uartCapture.buffer.slice(newlineIndex + 1);
      const normalizedLine = line.toLowerCase();

      if (
        normalizedLine.includes(peripheralName) &&
        (normalizedLine.includes('uart') ||
          normalizedLine.includes('usart') ||
          normalizedLine.includes('analyzer') ||
          normalizedLine.includes('char'))
      ) {
        emitUart(`${line}\n`, stream);
      }

      newlineIndex = state.uartCapture.buffer.indexOf('\n');
    }
  }

  /**
   * Writes generated/manual C sources to a temporary workspace and invokes GCC.
   *
   * This is where the project gets its real MCU firmware artifact. Renode later
   * loads the resulting firmware.elf, so generated demo code and future
   * user-authored code both converge on this step.
   */
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

  /**
   * Imports a user-provided ELF into the active workspace.
   *
   * User Firmware Mode still lets the visual netlist generate board.repl,
   * manifests, UART/GPIO/I2C mappings, and run.resc. The only thing it skips is
   * GCC compilation: Renode later loads this copied ELF through the same
   * startSimulation() path used by generated demo firmware.
   */
  async function importUserFirmware(request = {}) {
    const sourcePath = typeof request.filePath === 'string' ? request.filePath : null;
    if (!sourcePath) {
      return {
        success: false,
        message: 'No ELF file was selected.',
      };
    }

    if (!fileExists(sourcePath)) {
      return {
        success: false,
        message: `Selected firmware does not exist: ${sourcePath}`,
      };
    }

    const sourceExtension = path.extname(sourcePath).toLowerCase();
    if (sourceExtension !== '.elf') {
      return {
        success: false,
        message: 'User Firmware Mode MVP currently supports .elf files only.',
      };
    }

    const workspaceDir = request.workspaceDir || createWorkspaceDir();
    const firmwareDir = path.join(workspaceDir, 'user-firmware');
    ensureDirectory(firmwareDir);

    const fileName = sanitizeFileName(path.basename(sourcePath));
    const targetPath = path.join(firmwareDir, fileName);
    await fs.promises.copyFile(sourcePath, targetPath);
    const stat = await fs.promises.stat(targetPath);
    state.activeWorkspaceDir = workspaceDir;

    return {
      success: true,
      message: `User ELF imported: ${targetPath}`,
      workspaceDir,
      elfPath: targetPath,
      sourcePath,
      fileName,
      sizeBytes: stat.size,
      importedAt: new Date().toISOString(),
    };
  }

  /**
   * Starts Renode with the generated board.repl, run.resc, and compiled ELF.
   *
   * The method also creates the local bridge endpoints used by the UI: external
   * control for GPIO, UART socket terminal, GDB server, and transaction broker.
   */
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
        message: 'ELF file was not found. Compile generated firmware or import a user ELF first.',
      };
    }

    const workspaceDir = request.workspaceDir || state.activeWorkspaceDir || createWorkspaceDir();
    ensureDirectory(workspaceDir);

    const replPath = path.join(workspaceDir, 'board.repl');
    const rescPath = path.join(workspaceDir, 'run.resc');
    const bridgePort = request.bridgePort || DEFAULT_BRIDGE_PORT;
    const gdbPort = request.gdbPort || DEFAULT_GDB_PORT;
    const requestedTransactionBrokerPort = request.transactionBrokerPort || DEFAULT_TRANSACTION_BROKER_PORT;
    const monitorPort = await getFreePort();
    const machineName = request.machineName || 'NUCLEO-H753ZI GPIO Workbench';
    const uartPeripheralName =
      typeof request.uartPeripheralName === 'string' && request.uartPeripheralName.trim().length > 0
        ? request.uartPeripheralName.trim()
        : null;
    const uartPort = uartPeripheralName ? await getFreePort() : null;
    const relativeElfPath = path
      .relative(workspaceDir, request.elfPath)
      .replace(/\\/g, '/');

    fs.writeFileSync(replPath, request.boardRepl, 'utf8');
    resetSimulationClock('host-estimated');
    state.busManifestEntries = Array.isArray(request.busManifest) ? request.busManifest : [];
    state.busManifest = createBusManifestMap(state.busManifestEntries);
    let transactionBrokerPort = requestedTransactionBrokerPort;
    try {
      transactionBrokerPort = await startTransactionBrokerServer(requestedTransactionBrokerPort);
    } catch (error) {
      if (request.transactionBrokerPort) {
        return {
          success: false,
          message: `Transaction Broker Bridge could not listen on port ${requestedTransactionBrokerPort}: ${String(error)}`,
        };
      }
      transactionBrokerPort = await startTransactionBrokerServer(await getFreePort());
      log(`Transaction Broker Bridge port ${requestedTransactionBrokerPort} was unavailable, using ${transactionBrokerPort}.`, 'warn');
    }
    const transactionBrokerManifestPath = writeBrokerManifest(workspaceDir, transactionBrokerPort, state.busManifestEntries);

    const rescContent = [
      `$name?="${machineName}"`,
      'mach create $name',
      '',
      'machine LoadPlatformDescription @board.repl',
      'using sysbus',
      `sysbus LoadELF @${relativeElfPath}`,
      `emulation CreateExternalControlServer "local-control" ${bridgePort}`,
      `machine StartGdbServer ${gdbPort}`,
      ...(uartPeripheralName && uartPort
        ? [
            `emulation CreateServerSocketTerminal ${uartPort} "local-uart" false`,
            `connector Connect ${uartPeripheralName} local-uart`,
            '',
          ]
        : []),
      'start',
      '',
    ].join('\n');

    fs.writeFileSync(rescPath, rescContent, 'utf8');

    log('Launching Renode locally...');
    emitClock('started');

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
      state.monitorPort = monitorPort;
      attachRenodeProcessHandlers(child);
      startClockSync();

      const uartReady = uartPeripheralName && uartPort ? await connectUartTerminal(uartPort, uartPeripheralName) : false;
      const bridgeReady = await connectBridge(bridgePort, machineName, request.peripheralManifest, request.signalManifest);
      if (request.enableI2cDemoFeed !== false) {
        startI2cDemoFeed();
      }
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
        uartPeripheralName,
        uartPort,
        transactionBrokerPort,
        transactionBrokerManifestPath,
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
        uartPeripheralName,
        uartPort,
        transactionBrokerPort,
        transactionBrokerManifestPath,
        uartReady,
        bridgeReady,
      };
    } catch (error) {
      state.renodeProcess = null;
      state.monitorPort = null;
      clearClockSync();
      clearI2cDemoFeed();
      stopTransactionBrokerServer();
      closeBridgeSession();
      closeUartTerminal();
      return {
        success: false,
        message: `Failed to launch Renode: ${String(error)}`,
      };
    }
  }

  /**
   * Sends a user interaction, such as pressing a visual button, into Renode.
   *
   * The UI identifies the visual peripheral; the manifest resolves that to the
   * MCU pad or signal exposed by Renode's external control bridge.
   */
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
      emitSignal(entry, request.state === 1, 'bridge');
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

  async function sendUartData(request) {
    const data = typeof request?.data === 'string' ? request.data : '';
    if (!data) {
      return {
        success: false,
        message: 'UART payload is empty.',
      };
    }

    if (!state.uartSocket || !state.uartCapture.connected) {
      return {
        success: false,
        message: 'UART terminal is not connected. Start the simulation first.',
      };
    }

    try {
      state.uartSocket.write(Buffer.from(data, 'utf8'));
      emitUart(data, 'tx', 'data');
      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to write UART data: ${String(error)}`,
      };
    }
  }

  /**
   * Updates a Renode-native sensor peripheral through the monitor interface.
   *
   * This keeps sensor data inside the Renode model while letting the UI expose
   * friendly sliders/inputs for values such as temperature and humidity.
   */
  async function setNativeSensor(request) {
    if (!state.renodeProcess || !state.monitorPort) {
      return {
        success: false,
        message: 'Start the simulation before controlling a native Renode sensor.',
      };
    }

    const sensorPath = normalizeMonitorPath(request?.path);
    if (!sensorPath) {
      return {
        success: false,
        message: 'Native sensor path is missing or unsafe.',
      };
    }

    const channels = normalizeNativeSensorChannels(request);
    if (channels.length === 0) {
      return {
        success: false,
        message: 'Provide at least one native sensor channel value to update.',
      };
    }

    try {
      const values = await enqueueMonitorCommand(async () => {
        for (const channel of channels) {
          await runMonitorCommand(`${sensorPath} ${channel.renodeProperty} ${channel.value.toFixed(3)}`);
        }

        const nextValues = {};
        for (const channel of channels) {
          const output = await runMonitorCommand(`${sensorPath} ${channel.renodeProperty}`);
          nextValues[channel.id] = parseMonitorNumber(output);
        }

        if (Object.prototype.hasOwnProperty.call(nextValues, 'temperature')) {
          nextValues.temperatureC = nextValues.temperature;
        }
        if (Object.prototype.hasOwnProperty.call(nextValues, 'humidity')) {
          nextValues.humidityPercent = nextValues.humidity;
        }
        return nextValues;
      });

      const clock = snapshotSimulationClock();
      emit({
        type: 'sensor',
        status: 'updated',
        path: sensorPath,
        sensorPackage: typeof request?.sensorPackage === 'string' ? request.sensorPackage : undefined,
        values,
        temperatureC: values.temperatureC,
        humidityPercent: values.humidityPercent,
        clock,
        timestamp: new Date().toISOString(),
      });
      log(`Native sensor ${sensorPath} updated: ${channels.map((channel) => `${channel.id}=${values[channel.id] ?? channel.value}`).join(', ')}.`);

      return {
        success: true,
        values,
      };
    } catch (error) {
      const message = `Failed to update native Renode sensor: ${String(error)}`;
      emit({
        type: 'sensor',
        status: 'error',
        path: sensorPath,
        message,
        timestamp: new Date().toISOString(),
      });
      return {
        success: false,
        message,
      };
    }
  }

  /**
   * Emits a normalized bus transaction into the runtime event stream.
   *
   * The current transaction broker is intentionally lightweight: it visualizes
   * and decodes bus activity for panels, while native Renode peripherals still
   * perform the actual MCU-facing device behavior.
   */
  async function sendBusTransaction(request) {
    const protocol = normalizeProtocol(request?.protocol);
    if (!protocol) {
      return {
        success: false,
        message: `Unsupported bus protocol: ${String(request?.protocol ?? 'missing')}`,
      };
    }

    const direction = normalizeDirection(protocol, request?.direction);
    if (!direction) {
      return {
        success: false,
        message: `Unsupported ${protocol.toUpperCase()} bus direction: ${String(request?.direction ?? 'missing')}`,
      };
    }

    if (!state.renodeProcess && state.busManifestEntries.length === 0) {
      return {
        success: false,
        message: 'Start the simulation before sending bus transactions.',
      };
    }

    const address = parseMaybeHexNumber(request?.address);
    emitBusTransaction({
      protocol,
      busId: typeof request?.busId === 'string' ? request.busId : null,
      busLabel: typeof request?.busLabel === 'string' ? request.busLabel : null,
      peripheralName: typeof request?.peripheralName === 'string' ? request.peripheralName : null,
      direction,
      status: typeof request?.status === 'string' ? request.status : 'data',
      address,
      data: normalizeBrokerBytes(request),
      source: typeof request?.source === 'string' ? request.source : 'ui',
    });

    return {
      success: true,
    };
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
    DEFAULT_TRANSACTION_BROKER_PORT,
    createWorkspaceDir,
    on: (...args) => emitter.on(...args),
    off: (...args) => emitter.off(...args),
    getTooling,
    compileFirmware,
    importUserFirmware,
    startSimulation,
    stopSimulation,
    sendPeripheralEvent,
    sendUartData,
    setNativeSensor,
    sendBusTransaction,
    startDebugging,
    stopDebugging,
    debugAction,
  };
}

module.exports = {
  createRuntimeService,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_GDB_PORT,
  DEFAULT_TRANSACTION_BROKER_PORT,
  createWorkspaceDir,
};
