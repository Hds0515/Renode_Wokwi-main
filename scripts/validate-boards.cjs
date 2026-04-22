const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ts = require('typescript');
const { createRuntimeService } = require('../electron/runtime.cjs');

const APP_ROOT = path.resolve(__dirname, '..');
const LOCAL_RENODE_ROOT = path.join(APP_ROOT, 'renode', 'renode');

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

const { BOARD_SCHEMAS } = require('../src/lib/boards.ts');
const {
  DEFAULT_STARTUP_SOURCE,
  synchronizeWiringWires,
  validateWiringRules,
} = require('../src/lib/firmware.ts');
const {
  compileNetlistToRenodeArtifacts,
  createNetlistFromWiring,
  validateNetlist,
} = require('../src/lib/netlist.ts');
const { getExamplesForBoard } = require('../src/lib/examples.ts');

function resolveSystemRenodePath() {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, ['renode'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean) ?? null;
}

function getRenodeRootCandidates() {
  const systemRenodePath = resolveSystemRenodePath();
  const systemRenodeDir = systemRenodePath ? path.dirname(systemRenodePath) : null;
  return [
    process.env.RENODE_ROOT,
    LOCAL_RENODE_ROOT,
    systemRenodeDir,
    systemRenodeDir ? path.join(systemRenodeDir, 'renode') : null,
  ].filter(Boolean);
}

function resolveRenodeRootForPlatform(platformPath) {
  return getRenodeRootCandidates().find((candidate) => {
    return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, platformPath));
  }) ?? null;
}

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

function boardPads(board) {
  return board.connectors.all.flatMap((connector) => connector.pins);
}

function assertPlatformPath(board) {
  const renodeRoot = resolveRenodeRootForPlatform(board.runtime.renodePlatformPath);
  if (!renodeRoot) {
    throw new Error(
      `Could not locate ${board.runtime.renodePlatformPath}. Install Renode on PATH or set RENODE_ROOT to the Renode installation directory.`
    );
  }

  const platformPath = path.join(renodeRoot, board.runtime.renodePlatformPath);
  if (!fs.existsSync(platformPath)) {
    throw new Error(`${board.name} references missing Renode platform: ${board.runtime.renodePlatformPath} under ${renodeRoot}`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildChangedInterfaceWiring(board, baseWiring) {
  const wiring = clone(baseWiring);
  const button = wiring.peripherals.find((peripheral) => peripheral.kind === 'button');
  const output = wiring.peripherals.find((peripheral) => peripheral.kind === 'led' && peripheral.templateKind !== 'rgb-led');
  if (!button || !output) {
    throw new Error(`${board.name} button-led example does not contain a single button and output endpoint.`);
  }

  const selectable = board.connectors.selectablePads.filter((pad) => pad.selectable && pad.mcuPinId);
  const buttonPad = selectable.find((pad) => pad.id !== button.padId);
  if (!buttonPad) {
    throw new Error(`${board.name} has no alternate button pad for remap validation.`);
  }

  const outputPad =
    selectable.find((pad) => pad.id !== output.padId && pad.id !== buttonPad.id && pad.connectorId !== buttonPad.connectorId) ??
    selectable.find((pad) => pad.id !== output.padId && pad.id !== buttonPad.id);
  if (!outputPad) {
    throw new Error(`${board.name} has no alternate output pad for remap validation.`);
  }

  button.padId = buttonPad.id;
  output.padId = outputPad.id;

  return {
    wiring: synchronizeWiringWires(wiring),
    remap: {
      buttonId: button.id,
      buttonPad: buttonPad.id,
      outputId: output.id,
      outputPad: outputPad.id,
    },
  };
}

async function validateBoard(board, index) {
  assertPlatformPath(board);

  const examples = getExamplesForBoard(board.id);
  const baseExample = examples.find((example) => example.id.endsWith('button-led')) ?? examples[0];
  if (!baseExample) {
    throw new Error(`${board.name} does not have a bundled example.`);
  }

  const { wiring, remap } = buildChangedInterfaceWiring(board, baseExample.project.wiring);
  const pads = boardPads(board);
  const netlist = createNetlistFromWiring(wiring, board);
  const netlistErrors = validateNetlist(netlist, board).filter((issue) => issue.severity === 'error');
  const artifacts = compileNetlistToRenodeArtifacts({ netlist, board });
  const ruleErrors = validateWiringRules(wiring, pads).filter((issue) => issue.severity === 'error');
  if (ruleErrors.length > 0) {
    throw new Error(`${board.name} remapped wiring failed rule validation: ${ruleErrors[0].message}`);
  }
  if (netlistErrors.length > 0) {
    throw new Error(`${board.name} remapped netlist failed validation: ${netlistErrors[0].message}`);
  }

  if (!artifacts.boardRepl.includes(`using "${board.runtime.renodePlatformPath}"`)) {
    throw new Error(`${board.name} generated board.repl does not reference ${board.runtime.renodePlatformPath}.`);
  }
  if (
    !artifacts.peripheralManifest.some((entry) => entry.id === remap.buttonId) ||
    !artifacts.peripheralManifest.some((entry) => entry.id === remap.outputId)
  ) {
    throw new Error(`${board.name} manifest does not include remapped peripherals.`);
  }

  const runtime = createRuntimeService();
  const observed = {
    bridgeReady: false,
    ledOn: false,
    ledOffAfterOn: false,
    signalLedOn: false,
    signalLedOffAfterOn: false,
  };

  runtime.on('event', (payload) => {
    if (payload.type === 'log') {
      console.log(`[${board.id}] [${payload.level}] ${payload.message}`);
    }
    if (payload.type === 'bridge' && (payload.status === 'connected' || payload.status === 'ready')) {
      observed.bridgeReady = true;
    }
    if (payload.type === 'led' && payload.id === remap.outputId && payload.state === 1) {
      observed.ledOn = true;
    }
    if (payload.type === 'led' && payload.id === remap.outputId && payload.state === 0 && observed.ledOn) {
      observed.ledOffAfterOn = true;
    }
    if (payload.type === 'signal' && payload.peripheralId === remap.outputId && payload.value === 1) {
      observed.signalLedOn = true;
      observed.ledOn = true;
    }
    if (payload.type === 'signal' && payload.peripheralId === remap.outputId && payload.value === 0 && observed.signalLedOn) {
      observed.signalLedOffAfterOn = true;
      observed.ledOffAfterOn = true;
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
    throw new Error(`${board.name} compilation failed.`);
  }

  const bridgePort = 9101 + index;
  const gdbPort = 3401 + index;
  let started = false;
  try {
    const startResult = await runtime.startSimulation({
      workspaceDir: compileResult.workspaceDir,
      elfPath: compileResult.elfPath,
      boardRepl: artifacts.boardRepl,
      peripheralManifest: artifacts.peripheralManifest,
      bridgePort,
      gdbPort,
      machineName: board.machineName,
      uartPeripheralName: board.runtime.uart?.peripheralName ?? null,
    });

    if (!startResult.success) {
      console.error(startResult);
      throw new Error(`${board.name} simulation failed to start.`);
    }
    started = true;

    await waitUntil(`${board.name} bridge`, () => observed.bridgeReady, 10000);
    await wait(250);
    await runtime.sendPeripheralEvent({ type: 'button', id: remap.buttonId, state: 1 });
    await waitUntil(`${board.name} remapped LED on`, () => observed.ledOn, 8000);
    await runtime.sendPeripheralEvent({ type: 'button', id: remap.buttonId, state: 0 });
    await waitUntil(`${board.name} remapped LED off`, () => observed.ledOffAfterOn, 8000);

    console.log(
      `[${board.id}] ok: ${remap.buttonId} -> ${remap.buttonPad}, ${remap.outputId} -> ${remap.outputPad}, platform ${board.runtime.renodePlatformPath}`
    );
  } finally {
    if (started) {
      await runtime.stopSimulation();
      await wait(1000);
    }
  }
}

async function main() {
  for (const [index, board] of BOARD_SCHEMAS.entries()) {
    await validateBoard(board, index);
  }
  console.log('Board validation completed successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
