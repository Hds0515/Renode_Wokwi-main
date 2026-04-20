const {
  createRuntimeService,
} = require('../electron/runtime.cjs');
const {
  DEFAULT_MAIN_SOURCE,
  DEFAULT_STARTUP_SOURCE,
  DEFAULT_LINKER_FILENAME,
  DEFAULT_LINKER_SCRIPT,
  DEFAULT_GCC_ARGS,
  DEFAULT_DEMO_WIRING,
  generateBoardRepl,
  buildPeripheralManifest,
} = require('../electron/firmware.cjs');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const runtime = createRuntimeService();
  const observed = {
    ledOn: false,
    ledOff: false,
    bridgeReady: false,
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

    if (payload.type === 'debug') {
      console.log(`[debug] ${JSON.stringify(payload)}`);
    }
  });

  const tooling = await runtime.getTooling();
  console.log(JSON.stringify(tooling, null, 2));

  const compileResult = await runtime.compileFirmware({
    mainSource: DEFAULT_MAIN_SOURCE,
    startupSource: DEFAULT_STARTUP_SOURCE,
    linkerScript: DEFAULT_LINKER_SCRIPT,
    linkerFileName: DEFAULT_LINKER_FILENAME,
    gccArgs: DEFAULT_GCC_ARGS,
  });

  if (!compileResult.success) {
    console.error(compileResult);
    process.exitCode = 1;
    return;
  }

  const startResult = await runtime.startSimulation({
    workspaceDir: compileResult.workspaceDir,
    elfPath: compileResult.elfPath,
    boardRepl: generateBoardRepl(DEFAULT_DEMO_WIRING),
    peripheralManifest: buildPeripheralManifest(DEFAULT_DEMO_WIRING),
  });

  if (!startResult.success) {
    console.error(startResult);
    process.exitCode = 1;
    return;
  }

  await wait(3000);

  if (!observed.bridgeReady) {
    console.error('Bridge never connected.');
    await runtime.stopSimulation();
    process.exitCode = 1;
    return;
  }

  await runtime.sendPeripheralEvent({ type: 'button', id: 'button-1', state: 1 });
  await wait(1500);
  await runtime.sendPeripheralEvent({ type: 'button', id: 'button-1', state: 0 });
  await wait(1500);

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

  if (!observed.ledOn || !observed.ledOff) {
    console.error({
      ledOn: observed.ledOn,
      ledOff: observed.ledOff,
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
