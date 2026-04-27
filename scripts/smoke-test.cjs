const {
  createRuntimeService,
} = require('../electron/runtime.cjs');
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

const { ACTIVE_BOARD_SCHEMA } = require('../src/lib/boards.ts');
const {
  DEFAULT_STARTUP_SOURCE,
  DEFAULT_DEMO_WIRING,
} = require('../src/lib/firmware.ts');
/**
 * General local runtime smoke test.
 *
 * This exercises the generated firmware, Renode launch path, GPIO bridge, and
 * UART/event plumbing without requiring the full Electron renderer.
 */
const {
  compileNetlistToRenodeArtifacts,
  createNetlistFromWiring,
  validateNetlist,
} = require('../src/lib/netlist.ts');
const {
  createRuntimeSignalManifest,
  createSignalDefinitionsFromNetlist,
} = require('../src/lib/signal-broker.ts');
const {
  createRuntimeBusManifest,
} = require('../src/lib/runtime-timeline.ts');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(label, predicate, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function main() {
  const board = ACTIVE_BOARD_SCHEMA;
  const runtime = createRuntimeService();
  const observed = {
    ledOn: false,
    ledOff: false,
    signalButtonHigh: false,
    signalButtonLowAfterHigh: false,
    signalLedOn: false,
    signalLedOffAfterOn: false,
    signalManifestMetadata: false,
    timelineClocked: false,
    timelineGpio: false,
    timelineUart: false,
    busUart: false,
    bridgeReady: false,
    uartAttached: false,
    uartTranscript: '',
  };

  runtime.on('event', (payload) => {
    if (payload.type === 'log') {
      console.log(`[${payload.level}] ${payload.message}`);
    }

    if (payload.type === 'bridge' && (payload.status === 'connected' || payload.status === 'ready')) {
      observed.bridgeReady = true;
    }

    if (payload.type === 'led' && payload.state === 1) {
      observed.ledOn = true;
    }

    if (payload.type === 'led' && payload.state === 0) {
      observed.ledOff = true;
    }

    if (payload.type === 'signal') {
      console.log(`[signal] ${payload.peripheralId}=${payload.value} (${payload.source})`);
      if (payload.clock?.sequence > 0 && payload.clock?.virtualTimeNs >= 0) {
        observed.timelineClocked = true;
      }
      if (payload.schemaVersion === 2 && payload.netId && payload.componentId && payload.pinId && payload.padId) {
        observed.signalManifestMetadata = true;
      }
      if (payload.peripheralId === 'button-1' && payload.value === 1) {
        observed.signalButtonHigh = true;
      }
      if (payload.peripheralId === 'button-1' && payload.value === 0 && observed.signalButtonHigh) {
        observed.signalButtonLowAfterHigh = true;
      }
      if (payload.peripheralId === 'led-1' && payload.value === 1) {
        observed.signalLedOn = true;
      }
      if (payload.peripheralId === 'led-1' && payload.value === 0 && observed.signalLedOn) {
        observed.signalLedOffAfterOn = true;
      }
    }

    if (payload.type === 'timeline') {
      console.log(`[timeline] #${payload.event.clock.sequence} ${payload.event.protocol}: ${payload.event.summary}`);
      if (payload.event.protocol === 'gpio') {
        observed.timelineGpio = true;
      }
      if (payload.event.protocol === 'uart') {
        observed.timelineUart = true;
      }
      if (payload.event.clock.sequence > 0 && payload.event.clock.virtualTimeNs >= 0) {
        observed.timelineClocked = true;
      }
    }

    if (payload.type === 'bus' && payload.event.protocol === 'uart') {
      observed.busUart = true;
    }

    if (payload.type === 'debug') {
      console.log(`[debug] ${JSON.stringify(payload)}`);
    }

    if (payload.type === 'uart') {
      if (payload.status === 'connected') {
        observed.uartAttached = true;
      }
      observed.uartTranscript += payload.data || '';
      console.log(`[uart:${payload.stream ?? 'stdout'}] ${String(payload.data || '').trimEnd()}`);
    }
  });

  const tooling = await runtime.getTooling();
  console.log(JSON.stringify(tooling, null, 2));
  const netlist = createNetlistFromWiring(DEFAULT_DEMO_WIRING, board);
  const netlistErrors = validateNetlist(netlist, board).filter((issue) => issue.severity === 'error');
  if (netlistErrors.length > 0) {
    console.error(netlistErrors);
    process.exitCode = 1;
    return;
  }
  const artifacts = compileNetlistToRenodeArtifacts({ netlist, board });
  const signalManifest = createRuntimeSignalManifest(createSignalDefinitionsFromNetlist(netlist));
  const busManifest = createRuntimeBusManifest(board);

  const compileResult = await runtime.compileFirmware({
    mainSource: artifacts.mainSource,
    startupSource: DEFAULT_STARTUP_SOURCE,
    linkerScript: board.runtime.compiler.linkerScript,
    linkerFileName: board.runtime.compiler.linkerFileName,
    gccArgs: [...board.runtime.compiler.gccArgs],
  });

  if (!compileResult.success) {
    console.error(compileResult);
    process.exitCode = 1;
    return;
  }

  const startResult = await runtime.startSimulation({
    workspaceDir: compileResult.workspaceDir,
    elfPath: compileResult.elfPath,
    boardRepl: artifacts.boardRepl,
    peripheralManifest: artifacts.peripheralManifest,
    signalManifest,
    busManifest,
    uartPeripheralName: board.runtime.uart?.peripheralName ?? null,
    machineName: board.machineName,
  });

  if (!startResult.success) {
    console.error(startResult);
    process.exitCode = 1;
    return;
  }

  await waitUntil('bridge connection', () => observed.bridgeReady, 10000);
  await waitUntil('UART terminal connection', () => observed.uartAttached, 10000);
  await waitUntil('generated UART boot text', () => observed.uartTranscript.includes('Renode Wokwi UART ready'), 10000);

  await runtime.sendPeripheralEvent({ type: 'button', id: 'button-1', state: 1 });
  await wait(1500);
  await runtime.sendPeripheralEvent({ type: 'button', id: 'button-1', state: 0 });
  await wait(1500);
  await runtime.sendUartData({ data: 'Q' });
  await waitUntil('UART echo', () => observed.uartTranscript.includes('UART RX: Q'), 10000);

  const debugResult = await runtime.startDebugging({
    workspaceDir: compileResult.workspaceDir,
    elfPath: compileResult.elfPath,
    gdbPort: startResult.gdbPort,
  });
  console.log(debugResult);
  await wait(2000);
  if (debugResult.success) {
    await runtime.debugAction({ action: 'interrupt' });
    await wait(1000);
    await runtime.debugAction({ action: 'break-main' });
    await wait(500);
    await runtime.stopDebugging();
  }

  await runtime.stopSimulation();

  if (
    !observed.ledOn ||
    !observed.ledOff ||
    !observed.signalButtonHigh ||
    !observed.signalButtonLowAfterHigh ||
    !observed.signalLedOn ||
    !observed.signalLedOffAfterOn ||
    !observed.signalManifestMetadata ||
    !observed.timelineClocked ||
    !observed.timelineGpio ||
    !observed.timelineUart ||
    !observed.busUart
  ) {
    console.error({
      ledOn: observed.ledOn,
      ledOff: observed.ledOff,
      signalButtonHigh: observed.signalButtonHigh,
      signalButtonLowAfterHigh: observed.signalButtonLowAfterHigh,
      signalLedOn: observed.signalLedOn,
      signalLedOffAfterOn: observed.signalLedOffAfterOn,
      signalManifestMetadata: observed.signalManifestMetadata,
      timelineClocked: observed.timelineClocked,
      timelineGpio: observed.timelineGpio,
      timelineUart: observed.timelineUart,
      busUart: observed.busUart,
    });
    process.exitCode = 1;
    return;
  }

  console.log('Smoke test completed successfully.');
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
