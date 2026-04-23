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
const { ELECTRICAL_RULE_SCHEMA_VERSION, evaluateElectricalRules } = require('../src/lib/electrical-rules.ts');
const { normalizeLoadedProjectDocument } = require('../src/lib/project.ts');
const {
  compileNetlistToRenodeArtifacts,
  createNetlistFromWiring,
  createWiringFromNetlist,
  summarizeNetlist,
  validateNetlist,
} = require('../src/lib/netlist.ts');
const {
  SIGNAL_BROKER_SCHEMA_VERSION,
  createSignalBrokerState,
  createSignalDefinitionsFromNetlist,
  createRuntimeSignalManifest,
  getSignalEdgeCount,
  recordSignalSample,
  summarizeSignalBroker,
} = require('../src/lib/signal-broker.ts');
const {
  RUNTIME_TIMELINE_SCHEMA_VERSION,
  createRuntimeBusManifest,
  createRuntimeTimelineState,
  recordRuntimeTimelineEvent,
  summarizeRuntimeTimeline,
} = require('../src/lib/runtime-timeline.ts');
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
  const electricalReport = evaluateElectricalRules(roundTrip, board);
  const electricalErrors = electricalReport.issues.filter((issue) => issue.severity === 'error');
  assert(ELECTRICAL_RULE_SCHEMA_VERSION === 1, `${example.id} should compile against Electrical Rule schema v1.`);
  assert(electricalReport.schemaVersion === 1, `${example.id} electrical report should use schema v1.`);
  assert(project.pinMux?.schemaVersion === 1, `${example.id} should save Pin Function Mux schema v1.`);
  assert(electricalErrors.length === 0, `${example.id} failed electrical rule validation: ${electricalErrors[0]?.message}`);
  assert(
    electricalReport.pinMux.selections.length === roundTrip.peripherals.filter((peripheral) => peripheral.padId).length,
    `${example.id} pin mux selection count should match routed endpoints.`
  );

  const artifacts = compileNetlistToRenodeArtifacts({ netlist: project.netlist, board });
  assert(artifacts.mainSource.includes('Renode Wokwi UART ready'), `${example.id} main.c missing UART boot text.`);
  assert(
    artifacts.boardRepl.includes(`using "${board.runtime.renodePlatformPath}"`),
    `${example.id} board.repl does not use ${board.runtime.renodePlatformPath}.`
  );
  assert(
    artifacts.peripheralManifest.length === project.wiring.peripherals.filter((peripheral) => peripheral.padId && peripheral.kind !== 'i2c').length,
    `${example.id} manifest size does not match connected peripheral endpoints.`
  );

  const summary = summarizeNetlist(project.netlist);
  assert(summary.netCount > 0, `${example.id} should contain at least one GPIO net.`);

  const signalDefinitions = createSignalDefinitionsFromNetlist(project.netlist);
  const signalManifest = createRuntimeSignalManifest(signalDefinitions);
  const signalState = createSignalBrokerState(signalDefinitions, 1000);
  const signalSummary = summarizeSignalBroker(signalState);
  const busManifest = createRuntimeBusManifest(board, project.netlist);
  const timelineState = createRuntimeTimelineState(1000);
  assert(signalState.schemaVersion === 2, `${example.id} signal broker state should use schema v2.`);
  assert(SIGNAL_BROKER_SCHEMA_VERSION === 2, `${example.id} should compile against Signal Broker schema v2.`);
  assert(RUNTIME_TIMELINE_SCHEMA_VERSION === 1, `${example.id} should compile against runtime timeline schema v1.`);
  assert(signalManifest.length === signalDefinitions.length, `${example.id} runtime signal manifest size mismatch.`);
  assert(busManifest.some((entry) => entry.protocol === 'uart'), `${example.id} should expose a UART bus manifest entry.`);
  assert(busManifest.some((entry) => entry.protocol === 'i2c' || entry.protocol === 'spi'), `${example.id} should expose planned I2C/SPI bus capability entries.`);
  signalManifest.forEach((entry) => {
    assert(entry.schemaVersion === 2, `${example.id} runtime signal manifest entry ${entry.id} should use schema v2.`);
    assert(entry.netId && entry.componentId && entry.pinId, `${example.id} runtime signal manifest entry ${entry.id} is incomplete.`);
  });
  const gpioNetCount = project.netlist.nets.filter((net) => net.kind === 'gpio').length;
  assert(signalSummary.signalCount === gpioNetCount, `${example.id} signal count should match GPIO net count.`);
  if (gpioNetCount > 0) {
    assert(signalSummary.inputCount > 0, `${example.id} should expose at least one input signal.`);
    assert(signalSummary.outputCount > 0, `${example.id} should expose at least one output signal.`);
  }
  if (project.netlist.components.some((component) => component.kind === 'ssd1306-oled')) {
    assert(
      busManifest.some((entry) => entry.protocol === 'i2c' && Array.isArray(entry.devices) && entry.devices.some((device) => device.model === 'ssd1306')),
      `${example.id} should expose an SSD1306 device in the I2C bus manifest.`
    );
  }

  const firstSignal = signalDefinitions[0];
  const timelineClock = {
    schemaVersion: 1,
    sequence: 1,
    wallTimeMs: 1010,
    virtualTimeNs: 10000000,
    virtualTimeMs: 10,
    elapsedWallMs: 10,
    syncMode: 'host-estimated',
    timeScale: 1,
    paused: false,
  };
  const timelineWithGpio = firstSignal
    ? (() => {
        const sampledState = recordSignalSample(signalState, {
          peripheralId: firstSignal.peripheralId,
          value: 1,
          source: 'ui',
          timestampMs: 1010,
        });
        assert(sampledState.values[firstSignal.id].value === 1, `${example.id} signal broker did not update sampled value.`);
        assert(sampledState.values[firstSignal.id].lastChangedAtMs === 1010, `${example.id} signal broker did not track change timestamp.`);
        assert(getSignalEdgeCount(sampledState, firstSignal.id) === 1, `${example.id} signal broker did not count the edge.`);
        assert(sampledState.samples.length === signalState.samples.length + 1, `${example.id} signal broker did not append edge sample.`);

        return recordRuntimeTimelineEvent(timelineState, {
          schemaVersion: 1,
          id: `${example.id}:gpio-event`,
          protocol: 'gpio',
          kind: 'gpio-sample',
          source: 'bridge',
          clock: timelineClock,
          summary: 'validation gpio sample',
          signalId: firstSignal.id,
          peripheralId: firstSignal.peripheralId,
          label: firstSignal.label,
          direction: firstSignal.direction,
          value: 1,
          changed: true,
          netId: firstSignal.netId,
          componentId: firstSignal.componentId,
          pinId: firstSignal.pinId,
          padId: firstSignal.padId,
          mcuPinId: firstSignal.mcuPinId,
        });
      })()
    : timelineState;
  const timelineWithBus = recordRuntimeTimelineEvent(timelineWithGpio, {
    schemaVersion: 1,
    id: `${example.id}:uart-event`,
    protocol: 'uart',
    kind: 'bus-transaction',
    source: 'renode',
    clock: { ...timelineClock, sequence: 2, virtualTimeNs: 20000000, virtualTimeMs: 20 },
    summary: 'validation uart tx',
    busId: busManifest.find((entry) => entry.protocol === 'uart').id,
    busLabel: busManifest.find((entry) => entry.protocol === 'uart').label,
    renodePeripheralName: busManifest.find((entry) => entry.protocol === 'uart').renodePeripheralName,
    direction: 'tx',
    status: 'data',
    address: null,
    payload: {
      bytes: [0x4f, 0x4b],
      text: 'OK',
      bitLength: 16,
      truncated: false,
    },
  });
  const timelineSummary = summarizeRuntimeTimeline(timelineWithBus);
  assert(timelineSummary.gpioEventCount === (firstSignal ? 1 : 0), `${example.id} runtime timeline did not count GPIO events.`);
  assert(timelineSummary.busTransactionCount === 1, `${example.id} runtime timeline did not count bus transactions.`);
  assert(timelineSummary.lastSequence === 2, `${example.id} runtime timeline did not keep the newest clock.`);

  console.log(
    `[netlist] ${example.id}: ${summary.packageComponentCount} component(s), ${summary.netCount} net(s), ${signalSummary.signalCount} signal(s), ${busManifest.length} bus manifest entrie(s), ${artifacts.peripheralManifest.length} Renode endpoint(s)`
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
