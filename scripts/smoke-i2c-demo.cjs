const fs = require('fs');
const ts = require('typescript');
const { createRuntimeService } = require('../electron/runtime.cjs');

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
const { DEFAULT_STARTUP_SOURCE } = require('../src/lib/firmware.ts');
const {
  compileNetlistToRenodeArtifacts,
  validateNetlist,
} = require('../src/lib/netlist.ts');
const {
  createRuntimeSignalManifest,
  createSignalDefinitionsFromNetlist,
} = require('../src/lib/signal-broker.ts');
const { createRuntimeBusManifest } = require('../src/lib/runtime-timeline.ts');
const { getExampleProject } = require('../src/lib/examples.ts');
const {
  applySsd1306Transaction,
  createSsd1306State,
  getSsd1306Pixel,
} = require('../src/lib/ssd1306.ts');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(label, predicate, timeoutMs = 12000) {
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
  const example = getExampleProject(`${board.id}-ssd1306-oled`, board.id);
  if (!example) {
    throw new Error(`Missing SSD1306 example for ${board.id}.`);
  }

  const runtime = createRuntimeService();
  const netlist = example.project.netlist;
  const errors = validateNetlist(netlist, board).filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors[0].message);
  }

  const artifacts = compileNetlistToRenodeArtifacts({ netlist, board });
  const signalManifest = createRuntimeSignalManifest(createSignalDefinitionsFromNetlist(netlist));
  const busManifest = createRuntimeBusManifest(board, netlist);
  const oledBus = busManifest.find((entry) => entry.protocol === 'i2c' && entry.devices?.some((device) => device.model === 'ssd1306'));
  if (!oledBus) {
    throw new Error('SSD1306 device was not exported into the runtime I2C bus manifest.');
  }

  let oledState = createSsd1306State();
  let observedI2c = false;
  runtime.on('event', (payload) => {
    if (payload.type === 'log') {
      console.log(`[${payload.level}] ${payload.message}`);
    }
    if (payload.type === 'timeline' && payload.event.protocol === 'i2c') {
      observedI2c = true;
      oledState = applySsd1306Transaction(oledState, payload.event);
      console.log(`[i2c] ${payload.event.summary}`);
    }
  });

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

  let started = false;
  try {
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
    started = true;

    await waitUntil('SSD1306 I2C transaction', () => observedI2c, 12000);
    await waitUntil('SSD1306 framebuffer update', () => oledState.displayOn && oledState.transactionCount > 0, 4000);
    if (!getSsd1306Pixel(oledState, 1, 1)) {
      throw new Error('SSD1306 framebuffer did not render the expected border pixel.');
    }

    console.log('I2C SSD1306 demo smoke test completed successfully.');
  } finally {
    if (started) {
      await runtime.stopSimulation();
      await wait(1000);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
