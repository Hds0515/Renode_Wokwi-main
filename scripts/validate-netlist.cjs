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

const { BOARD_SCHEMAS } = require('../src/lib/boards.ts');
const { COMPONENT_PACKAGES } = require('../src/lib/component-packs.ts');
const { EXAMPLE_PROJECTS, getExamplesForBoard } = require('../src/lib/examples.ts');
const { normalizeLoadedProjectDocument } = require('../src/lib/project.ts');
const {
  compileNetlistToRenodeArtifacts,
  createNetlistFromWiring,
  createWiringFromNetlist,
  summarizeNetlist,
  validateNetlist,
} = require('../src/lib/netlist.ts');
const {
  createSignalBrokerState,
  createSignalDefinitionsFromNetlist,
  recordSignalSample,
  summarizeSignalBroker,
} = require('../src/lib/signal-broker.ts');
const { validateWiringRules } = require('../src/lib/firmware.ts');

function connectedPairs(wiring) {
  return wiring.peripherals
    .filter((peripheral) => peripheral.padId)
    .map((peripheral) => `${peripheral.id}:${peripheral.endpointId ?? 'signal'}->${peripheral.padId}`)
    .sort();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateComponentPackages() {
  assert(COMPONENT_PACKAGES.length >= 4, 'Expected the component package catalog to expose the current demo devices.');
  COMPONENT_PACKAGES.forEach((componentPackage) => {
    assert(componentPackage.schemaVersion === 1, `${componentPackage.kind} has an unsupported package schema.`);
    assert(componentPackage.pins.length > 0, `${componentPackage.kind} must expose at least one pin.`);
    componentPackage.pins.forEach((pin) => {
      assert(pin.requiredPadCapabilities.includes('gpio'), `${componentPackage.kind}.${pin.id} must require GPIO capability.`);
    });
  });
}

function validateProjectExample(example) {
  const board = BOARD_SCHEMAS.find((candidate) => candidate.id === example.boardId);
  assert(board, `${example.id} references unknown board ${example.boardId}.`);

  const loadResult = normalizeLoadedProjectDocument(example.project);
  assert(loadResult, `${example.id} could not be normalized as a project document.`);

  const project = loadResult.project;
  assert(project.schemaVersion === 2, `${example.id} did not normalize to project schema v2.`);
  assert(project.netlist, `${example.id} does not contain a netlist.`);

  const regeneratedNetlist = createNetlistFromWiring(project.wiring, board);
  const netlistIssues = validateNetlist(project.netlist, board);
  const regeneratedIssues = validateNetlist(regeneratedNetlist, board);
  const netlistErrors = [...netlistIssues, ...regeneratedIssues].filter((issue) => issue.severity === 'error');
  assert(netlistErrors.length === 0, `${example.id} failed netlist validation: ${netlistErrors[0]?.message}`);

  const roundTrip = createWiringFromNetlist(project.netlist);
  assert(
    connectedPairs(roundTrip).join('|') === connectedPairs(project.wiring).join('|'),
    `${example.id} netlist -> wiring round trip changed connected pins.`
  );

  const boardPads = board.connectors.all.flatMap((connector) => connector.pins);
  const wiringErrors = validateWiringRules(roundTrip, boardPads).filter((issue) => issue.severity === 'error');
  assert(wiringErrors.length === 0, `${example.id} failed wiring validation after round trip: ${wiringErrors[0]?.message}`);

  const artifacts = compileNetlistToRenodeArtifacts({ netlist: project.netlist, board });
  assert(artifacts.mainSource.includes('Renode Wokwi UART ready'), `${example.id} main.c missing UART boot text.`);
  assert(
    artifacts.boardRepl.includes(`using "${board.runtime.renodePlatformPath}"`),
    `${example.id} board.repl does not use ${board.runtime.renodePlatformPath}.`
  );
  assert(
    artifacts.peripheralManifest.length === project.wiring.peripherals.filter((peripheral) => peripheral.padId).length,
    `${example.id} manifest size does not match connected peripheral endpoints.`
  );

  const summary = summarizeNetlist(project.netlist);
  assert(summary.netCount > 0, `${example.id} should contain at least one GPIO net.`);

  const signalDefinitions = createSignalDefinitionsFromNetlist(project.netlist);
  const signalState = createSignalBrokerState(signalDefinitions, 1000);
  const signalSummary = summarizeSignalBroker(signalState);
  assert(signalSummary.signalCount === summary.netCount, `${example.id} signal count should match GPIO net count.`);
  assert(signalSummary.inputCount > 0, `${example.id} should expose at least one input signal.`);
  assert(signalSummary.outputCount > 0, `${example.id} should expose at least one output signal.`);

  const firstSignal = signalDefinitions[0];
  const sampledState = recordSignalSample(signalState, {
    peripheralId: firstSignal.peripheralId,
    value: 1,
    source: 'ui',
    timestampMs: 1010,
  });
  assert(sampledState.values[firstSignal.id].value === 1, `${example.id} signal broker did not update sampled value.`);
  assert(sampledState.samples.length === signalState.samples.length + 1, `${example.id} signal broker did not append edge sample.`);

  console.log(
    `[netlist] ${example.id}: ${summary.packageComponentCount} component(s), ${summary.netCount} net(s), ${signalSummary.signalCount} signal(s), ${artifacts.peripheralManifest.length} Renode endpoint(s)`
  );
}

function main() {
  validateComponentPackages();
  BOARD_SCHEMAS.forEach((board) => {
    const examples = getExamplesForBoard(board.id);
    assert(examples.length > 0, `${board.name} has no bundled examples.`);
  });
  EXAMPLE_PROJECTS.forEach((example) => validateProjectExample(example));
  console.log('Netlist and component package validation completed successfully.');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
