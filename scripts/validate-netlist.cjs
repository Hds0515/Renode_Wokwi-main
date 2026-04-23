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
const {
  createSi70xxMeasurementTransactions,
  createSi70xxState,
  applySi70xxTransaction,
} = require('../src/lib/si70xx.ts');
const {
  SENSOR_PACKAGE_SCHEMA_VERSION,
  SENSOR_PACKAGE_CATALOG_VERSION,
  SENSOR_PACKAGES,
  getSensorPackage,
} = require('../src/lib/sensor-packages.ts');
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

function validateSensorPackages() {
  assert(SENSOR_PACKAGE_SCHEMA_VERSION === 1, 'Expected Sensor Package schema v1.');
  assert(SENSOR_PACKAGE_CATALOG_VERSION === 1, 'Expected Sensor Package catalog v1.');
  assert(SENSOR_PACKAGES.length >= 1, 'Expected at least one reusable sensor package.');
  const si7021 = getSensorPackage('si7021-sensor');
  assert(si7021.native.renodeType === 'Sensors.SI70xx', 'SI7021 package should map to Renode Sensors.SI70xx.');
  assert(si7021.native.defaultAddress === 0x40, 'SI7021 package should use I2C address 0x40.');
  assert(
    si7021.native.control.channels.some((channel) => channel.renodeProperty === 'Temperature') &&
      si7021.native.control.channels.some((channel) => channel.renodeProperty === 'Humidity'),
    'SI7021 package should expose Renode native Temperature and Humidity controls.'
  );
}

function validateProjectExample(example) {
  const board = BOARD_SCHEMAS.find((candidate) => candidate.id === example.boardId);
  assert(board, `${example.id} references unknown board ${example.boardId}.`);

  const loadResult = normalizeLoadedProjectDocument(example.project);
  assert(loadResult, `${example.id} could not be normalized as a project document.`);

  const project = loadResult.project;
  assert(project.schemaVersion === 2, `${example.id} did not normalize to project schema v2.`);
  assert(project.netlist, `${example.id} does not contain a netlist.`);
  assert(project.sensorPackages?.schemaVersion === 1, `${example.id} should save Sensor Package schema v1.`);

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
  if (project.netlist.components.some((component) => component.kind === 'ssd1306-oled')) {
    assert(
      busManifest.some((entry) => entry.protocol === 'i2c' && Array.isArray(entry.devices) && entry.devices.some((device) => device.model === 'ssd1306')),
      `${example.id} should expose an SSD1306 device in the I2C bus manifest.`
    );
  }
  if (project.netlist.components.some((component) => component.kind === 'si7021-sensor')) {
    const sensorBus = busManifest.find((entry) => entry.protocol === 'i2c' && Array.isArray(entry.devices) && entry.devices.some((device) => device.model === 'si7021'));
    assert(sensorBus, `${example.id} should expose an SI7021 device in the I2C bus manifest.`);
    assert(artifacts.boardRepl.includes('Sensors.SI70xx'), `${example.id} should attach the SI7021 as a native Renode sensor.`);
    assert(artifacts.mainSource.includes('si7021_read_raw'), `${example.id} should generate native firmware I2C sensor reads.`);

    const sensor = sensorBus.devices.find((device) => device.model === 'si7021');
    assert(sensor, `${example.id} SI7021 runtime device metadata is missing.`);
    assert(sensor.sensorPackage === 'si7021-sensor', `${example.id} SI7021 should reference Sensor Package v1 metadata.`);
    assert(sensor.nativeRenodeName && sensor.nativeRenodeName.startsWith('si7021Sensor__'), `${example.id} SI7021 should expose a native Renode peripheral name.`);
    assert(
      sensor.nativeRenodePath && sensor.nativeRenodePath.includes(`.${sensor.nativeRenodeName}`),
      `${example.id} SI7021 should expose a native Renode monitor path.`
    );
    const transactions = createSi70xxMeasurementTransactions({
      busId: sensorBus.id,
      busLabel: sensorBus.label,
      componentId: sensor.componentId,
      address: sensor.address ?? 0x40,
      temperatureC: 23.5,
      humidityPercent: 51.5,
      kind: 'temperature',
    });
    const sensorState = transactions.reduce(
      (state, transaction, index) =>
        applySi70xxTransaction(state, {
          schemaVersion: 1,
          id: `${example.id}:si7021:${index}`,
          protocol: 'i2c',
          kind: 'bus-transaction',
          source: 'ui',
          clock: { ...timelineClock, sequence: 10 + index, virtualTimeNs: 10000000 + index * 1000000, virtualTimeMs: 10 + index },
          summary: 'validation si7021 transaction',
          busId: transaction.busId,
          busLabel: transaction.busLabel,
          renodePeripheralName: transaction.peripheralName,
          direction: transaction.direction,
          status: transaction.status,
          address: transaction.address,
          payload: {
            bytes: transaction.data,
            text: null,
            bitLength: transaction.data.length * 8,
            truncated: false,
          },
        }),
      createSi70xxState(sensor.address ?? 0x40)
    );
    assert(sensorState.lastReadTemperatureC !== null, `${example.id} SI7021 temperature transaction did not decode.`);
    assert(Math.abs(sensorState.lastReadTemperatureC - 23.5) < 0.05, `${example.id} SI7021 temperature decode drifted.`);
  }

  const firstSignal = signalDefinitions[0];
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
  validateSensorPackages();
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
