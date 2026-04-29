/**
 * Static validation for the Netlist/IR, package schemas, examples, and runtime
 * sensor helpers. Run this after changing board schemas, component packages,
 * sensor packages, or the visual wiring compiler.
 */
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
const {
  COMPONENT_PACKAGES,
  COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
  COMPONENT_PACKAGE_SDK_CATALOG_VERSION,
  COMPONENT_PACKAGE_SDKS,
  getComponentPackageSdk,
} = require('../src/lib/component-packs.ts');
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
  BUS_SENSOR_RUNTIME_SCHEMA_VERSION,
  applyBusSensorRuntimeEvent,
  createBusSensorReadTransactions,
  createBusSensorRuntimeState,
  getBusSensorRuntimeDevices,
  updateBusSensorChannelConfiguration,
} = require('../src/lib/bus-sensor-runtime.ts');
const {
  createSi70xxMeasurementTransactions,
  createSi70xxState,
  applySi70xxTransaction,
} = require('../src/lib/si70xx.ts');
const {
  SENSOR_PACKAGE_SCHEMA_VERSION,
  SENSOR_PACKAGE_CATALOG_VERSION,
  SENSOR_PACKAGE_SDK_SCHEMA_VERSION,
  SENSOR_PACKAGE_SDK_CATALOG_VERSION,
  SENSOR_PACKAGE_SDKS,
  SENSOR_PACKAGES,
  getSensorPackage,
  getSensorPackageSdk,
} = require('../src/lib/sensor-packages.ts');
const {
  DEVICE_PACKAGE_SCHEMA_VERSION,
  DEVICE_PACKAGE_CATALOG_VERSION,
  DEVICE_PACKAGE_COMPILER_VERSION,
  DEVICE_PACKAGE_CATALOG,
  DEVICE_PACKAGE_SOURCES,
  DEVICE_PACKAGES,
  DEVICE_PACKAGE_LIBRARY_ITEMS,
  getDevicePackage,
  getDevicePackageForTemplate,
  getSensorDevicePackage,
} = require('../src/lib/device-packages.ts');
const {
  DEVICE_RUNTIME_REGISTRY_SCHEMA_VERSION,
  buildDeviceRuntimeRegistryManifest,
  getEventParsersForPackage,
  getRuntimePanelsForPackage,
} = require('../src/lib/device-runtime-registry.ts');
const {
  validateDevicePackageCatalogConformance,
} = require('../src/lib/device-package-conformance.ts');
const {
  findSensorProtocolCodec,
} = require('../src/lib/sensor-protocol-codecs.ts');
const {
  PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION,
  createProtocolRuntimeRegistry,
  getProtocolRuntimeDevicesByModel,
  getProtocolRuntimeSensorDevices,
} = require('../src/lib/protocol-runtime-registry.ts');
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
  assert(COMPONENT_PACKAGE_SDK_SCHEMA_VERSION === 2, 'Expected Component Package SDK schema v2.');
  assert(COMPONENT_PACKAGE_SDK_CATALOG_VERSION === 1, 'Expected Component Package SDK catalog v1.');
  assert(COMPONENT_PACKAGE_SDKS.length === COMPONENT_PACKAGES.length, 'Component Package SDK should mirror the v1 package catalog.');
  COMPONENT_PACKAGES.forEach((componentPackage) => {
    assert(componentPackage.schemaVersion === 1, `${componentPackage.kind} has an unsupported package schema.`);
    assert(componentPackage.pins.length > 0, `${componentPackage.kind} must expose at least one pin.`);
    componentPackage.pins.forEach((pin) => {
      assert(pin.requiredPadCapabilities.includes('gpio'), `${componentPackage.kind}.${pin.id} must require GPIO capability.`);
    });

    const sdk = getComponentPackageSdk(componentPackage.kind);
    assert(sdk.schemaVersion === 2, `${componentPackage.kind} SDK should use schema v2.`);
    assert(sdk.compatibility.componentPackageSchemaVersion === 1, `${componentPackage.kind} SDK should declare v1 compatibility.`);
    assert(sdk.pins.length === componentPackage.pins.length, `${componentPackage.kind} SDK endpoint count should mirror v1 pins.`);
    assert(sdk.visual.terminalLayout === 'explicit-endpoints', `${componentPackage.kind} SDK should expose explicit endpoint terminals.`);
    const handleIds = new Set();
    sdk.pins.forEach((pin) => {
      assert(pin.schemaVersion === 2, `${componentPackage.kind}.${pin.id} SDK pin should use schema v2.`);
      assert(pin.terminal.connectable === true, `${componentPackage.kind}.${pin.id} SDK pin should be connectable.`);
      assert(pin.terminal.dragGesture === 'terminal-to-board-pad', `${componentPackage.kind}.${pin.id} should declare the canvas drag gesture.`);
      assert(!handleIds.has(pin.terminal.handleId), `${componentPackage.kind}.${pin.id} SDK handle id is duplicated.`);
      handleIds.add(pin.terminal.handleId);
      if (pin.role === 'i2c-scl' || pin.role === 'i2c-sda') {
        assert(pin.netKind === 'i2c' && pin.protocols.includes('i2c'), `${componentPackage.kind}.${pin.id} should be an I2C endpoint.`);
      } else {
        assert(pin.netKind === 'gpio' && pin.protocols.includes('gpio'), `${componentPackage.kind}.${pin.id} should be a GPIO endpoint.`);
      }
    });
  });
}

function validateSensorPackages() {
  assert(SENSOR_PACKAGE_SCHEMA_VERSION === 1, 'Expected Sensor Package schema v1.');
  assert(SENSOR_PACKAGE_CATALOG_VERSION === 1, 'Expected Sensor Package catalog v1.');
  assert(SENSOR_PACKAGE_SDK_SCHEMA_VERSION === 2, 'Expected Sensor Package SDK schema v2.');
  assert(SENSOR_PACKAGE_SDK_CATALOG_VERSION === 1, 'Expected Sensor Package SDK catalog v1.');
  assert(SENSOR_PACKAGE_SDKS.length === SENSOR_PACKAGES.length, 'Sensor Package SDK should mirror the v1 package catalog.');
  assert(SENSOR_PACKAGES.length >= 1, 'Expected at least one reusable sensor package.');
  const si7021 = getSensorPackage('si7021-sensor');
  const si7021Sdk = getSensorPackageSdk('si7021-sensor');
  assert(si7021.native.renodeType === 'Sensors.SI70xx', 'SI7021 package should map to Renode Sensors.SI70xx.');
  assert(si7021.native.defaultAddress === 0x40, 'SI7021 package should use I2C address 0x40.');
  assert(si7021Sdk.schemaVersion === 2, 'SI7021 SDK should use schema v2.');
  assert(si7021Sdk.protocol.bus === 'i2c', 'SI7021 SDK should expose I2C as its bus protocol.');
  assert(si7021Sdk.protocol.transactionModel === 'mcu-initiated-reads', 'SI7021 SDK should document MCU-initiated reads.');
  assert(si7021Sdk.runtime.controlPlane === 'native-sensor-control', 'SI7021 SDK should expose native sensor control.');
  assert(si7021Sdk.channels.length === si7021.native.control.channels.length, 'SI7021 SDK should mirror sensor channels.');
  assert(
    si7021.native.control.channels.some((channel) => channel.renodeProperty === 'Temperature') &&
      si7021.native.control.channels.some((channel) => channel.renodeProperty === 'Humidity'),
    'SI7021 package should expose Renode native Temperature and Humidity controls.'
  );
}

function validateDevicePackages() {
  assert(DEVICE_PACKAGE_SCHEMA_VERSION === 3, 'Expected unified Device Package schema v3.');
  assert(DEVICE_PACKAGE_CATALOG_VERSION === 1, 'Expected unified Device Package catalog v1.');
  assert(DEVICE_PACKAGE_COMPILER_VERSION === 1, 'Expected Device Package Compiler v1.');
  assert(DEVICE_PACKAGE_CATALOG.compilerVersion === DEVICE_PACKAGE_COMPILER_VERSION, 'Device Package catalog should be compiled by compiler v1.');
  assert(DEVICE_PACKAGE_SOURCES.length === 3, 'Expected SI7021, SSD1306, and UART Terminal independent device package sources.');
  assert(DEVICE_PACKAGES.length >= COMPONENT_PACKAGE_SDKS.length + 1, 'Device Package catalog should include component SDKs plus virtual instruments.');
  assert(DEVICE_PACKAGE_LIBRARY_ITEMS.length === COMPONENT_PACKAGE_SDKS.length, 'Visible library should be driven by component-backed Device Packages.');

  const requiredFixtures = new Set(['i2c-sensor', 'i2c-display', 'uart-instrument']);
  DEVICE_PACKAGES.forEach((devicePackage) => {
    assert(devicePackage.schemaVersion === DEVICE_PACKAGE_SCHEMA_VERSION, `${devicePackage.kind} should use Device Package schema v3.`);
    assert(devicePackage.visual && devicePackage.pins && devicePackage.electricalRules, `${devicePackage.kind} should expose visual, pins, and electrical rules.`);
    assert(devicePackage.protocol && devicePackage.renodeBackend && devicePackage.runtimePanel, `${devicePackage.kind} should expose protocol, Renode backend, and runtime panel metadata.`);
    assert(devicePackage.exampleFirmware && devicePackage.validationFixture, `${devicePackage.kind} should expose example firmware and validation fixture metadata.`);
    assert(devicePackage.compiler.version === DEVICE_PACKAGE_COMPILER_VERSION, `${devicePackage.kind} should declare Device Package Compiler v1 metadata.`);
    assert(getRuntimePanelsForPackage(devicePackage.kind).length > 0, `${devicePackage.kind} should generate runtime panel descriptors.`);
    assert(getEventParsersForPackage(devicePackage.kind).length > 0, `${devicePackage.kind} should generate event parser descriptors.`);
    requiredFixtures.delete(devicePackage.validationFixture.representative);
  });

  const si7021 = getSensorDevicePackage('si7021-sensor');
  assert(si7021.kind === 'si7021-sensor', 'SI7021 should be represented by a unified Device Package.');
  assert(si7021.compiler.source === 'independent-package', 'SI7021 should be compiled from an independent device package.');
  assert(si7021.compiler.packagePath === 'packages/devices/si7021', 'SI7021 package path should point to packages/devices/si7021.');
  assert(si7021.renodeBackend.type === 'renode-native-sensor', 'SI7021 Device Package should use Renode native sensor backend.');
  assert(si7021.runtimePanel.eventParsers.includes('i2c-si70xx-measurement'), 'SI7021 Device Package should register SI70xx event parser.');

  const oled = getDevicePackage('ssd1306-oled');
  assert(oled.compiler.source === 'independent-package', 'SSD1306 should be compiled from an independent device package.');
  assert(oled.compiler.packagePath === 'packages/devices/ssd1306', 'SSD1306 package path should point to packages/devices/ssd1306.');
  assert(oled.renodeBackend.model === 'ssd1306', 'SSD1306 Device Package should preserve the SSD1306 model.');
  assert(oled.runtimePanel.eventParsers.includes('i2c-ssd1306-framebuffer'), 'SSD1306 Device Package should register framebuffer parser.');

  const uart = getDevicePackage('uart-terminal');
  assert(uart.compiler.source === 'independent-package', 'UART Terminal should be compiled from an independent device package.');
  assert(uart.compiler.packagePath === 'packages/devices/uart-terminal', 'UART Terminal package path should point to packages/devices/uart-terminal.');
  assert(uart.renodeBackend.type === 'virtual-uart-terminal', 'UART Terminal should be registered as a virtual instrument package.');
  assert(uart.runtimePanel.eventParsers.includes('uart-line-buffer'), 'UART Terminal should register UART line parser.');

  const button = getDevicePackage('button');
  assert(button.compiler.source === 'component-adapter', 'Legacy GPIO button should still be adapted by the Device Package Compiler.');

  COMPONENT_PACKAGE_SDKS.forEach((componentPackage) => {
    const devicePackage = getDevicePackageForTemplate(componentPackage.kind);
    assert(devicePackage.legacy.componentPackageKind === componentPackage.kind, `${componentPackage.kind} should be reachable through Device Package template lookup.`);
  });

  assert(requiredFixtures.size === 0, `Missing representative device package fixture(s): ${Array.from(requiredFixtures).join(', ')}`);

  const conformance = validateDevicePackageCatalogConformance({
    catalog: DEVICE_PACKAGE_CATALOG,
    componentPackages: COMPONENT_PACKAGE_SDKS,
  });
  assert(conformance.errorCount === 0, `Device Package conformance failed: ${conformance.issues.find((issue) => issue.severity === 'error')?.message}`);
  SENSOR_PACKAGE_SDKS.forEach((sensorPackage) => {
    assert(
      findSensorProtocolCodec(sensorPackage.busRuntime.transactionCodec),
      `${sensorPackage.kind} should resolve a reusable sensor protocol codec.`
    );
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
  assert(project.sensorPackages?.schemaVersion === 1, `${example.id} should save Sensor Package schema v1.`);
  assert(project.componentPackageSdk?.schemaVersion === 2, `${example.id} should save Component Package SDK schema v2.`);
  assert(project.sensorPackageSdk?.schemaVersion === 2, `${example.id} should save Sensor Package SDK schema v2.`);
  assert(project.devicePackages?.schemaVersion === DEVICE_PACKAGE_SCHEMA_VERSION, `${example.id} should save unified Device Package schema v3.`);
  assert(project.netlist.devicePackages?.schemaVersion === DEVICE_PACKAGE_SCHEMA_VERSION, `${example.id} netlist should carry Device Package schema v3 metadata.`);

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
  const deviceRuntimeRegistry = buildDeviceRuntimeRegistryManifest({ board, netlist: project.netlist, busManifest });
  const protocolRuntimeRegistry = createProtocolRuntimeRegistry({ board, busManifest, signalDefinitions });
  const timelineState = createRuntimeTimelineState(1000);
  const busSensorDevices = getBusSensorRuntimeDevices(busManifest);
  const busSensorState = createBusSensorRuntimeState(busSensorDevices);
  assert(deviceRuntimeRegistry.schemaVersion === DEVICE_RUNTIME_REGISTRY_SCHEMA_VERSION, `${example.id} Device Runtime Registry should use schema v1.`);
  assert(deviceRuntimeRegistry.entries.some((entry) => entry.packageKind === 'uart-terminal'), `${example.id} should include the board UART terminal virtual instrument package.`);
  assert(protocolRuntimeRegistry.schemaVersion === PROTOCOL_RUNTIME_REGISTRY_SCHEMA_VERSION, `${example.id} Protocol Runtime Registry should use schema v1.`);
  assert(protocolRuntimeRegistry.summary.busCount === busManifest.length, `${example.id} Protocol Runtime Registry bus count should match the bus manifest.`);
  assert(
    protocolRuntimeRegistry.devices.some((device) => device.protocol === 'uart' && device.role === 'instrument'),
    `${example.id} Protocol Runtime Registry should expose the UART terminal instrument.`
  );
  project.netlist.components
    .filter((component) => component.kind !== 'board')
    .forEach((component) => {
      assert(
        deviceRuntimeRegistry.entries.some((entry) => entry.componentId === component.id),
        `${example.id} component ${component.id} should generate a Device Runtime Registry entry.`
      );
    });
  assert(signalState.schemaVersion === 2, `${example.id} signal broker state should use schema v2.`);
  assert(busSensorState.schemaVersion === BUS_SENSOR_RUNTIME_SCHEMA_VERSION, `${example.id} bus sensor runtime should use schema v1.`);
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
    assert(
      protocolRuntimeRegistry.summary.gpioSignalCount === gpioNetCount,
      `${example.id} Protocol Runtime Registry GPIO signal count should match GPIO net count.`
    );
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
      getProtocolRuntimeDevicesByModel(protocolRuntimeRegistry, 'ssd1306', 'i2c').length > 0,
      `${example.id} Protocol Runtime Registry should expose SSD1306 as an I2C display device.`
    );
    assert(
      busManifest.some((entry) => entry.protocol === 'i2c' && Array.isArray(entry.devices) && entry.devices.some((device) => device.model === 'ssd1306')),
      `${example.id} should expose an SSD1306 device in the I2C bus manifest.`
    );
  }
  if (project.netlist.components.some((component) => component.kind === 'si7021-sensor')) {
    assert(
      getProtocolRuntimeSensorDevices(protocolRuntimeRegistry).some((device) => device.model === 'si7021'),
      `${example.id} Protocol Runtime Registry should expose SI7021 as an I2C sensor device.`
    );
    const sensorBus = busManifest.find((entry) => entry.protocol === 'i2c' && Array.isArray(entry.devices) && entry.devices.some((device) => device.model === 'si7021'));
    assert(sensorBus, `${example.id} should expose an SI7021 device in the I2C bus manifest.`);
    assert(artifacts.boardRepl.includes('Sensors.SI70xx'), `${example.id} should attach the SI7021 as a native Renode sensor.`);
    assert(artifacts.mainSource.includes('si7021_read_raw'), `${example.id} should generate native firmware I2C sensor reads.`);

    const sensor = sensorBus.devices.find((device) => device.model === 'si7021');
    assert(sensor, `${example.id} SI7021 runtime device metadata is missing.`);
    assert(sensor.sensorPackage === 'si7021-sensor', `${example.id} SI7021 should reference Sensor Package v1 metadata.`);
    assert(sensor.sensorPackageSdkSchemaVersion === 2, `${example.id} SI7021 should expose Sensor Package SDK v2 metadata.`);
    assert(Array.isArray(sensor.controlChannels) && sensor.controlChannels.length >= 2, `${example.id} SI7021 should expose reusable control channels.`);
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

    const runtimeSensorDevice = busSensorDevices.find((device) => device.componentId === sensor.componentId);
    assert(runtimeSensorDevice, `${example.id} SI7021 should be discoverable by Bus Sensor Runtime.`);
    assert(runtimeSensorDevice.channels.some((channel) => channel.id === 'temperature'), `${example.id} Bus Sensor Runtime should expose temperature channel.`);
    const configuredSensorState = updateBusSensorChannelConfiguration(
      busSensorState,
      runtimeSensorDevice.id,
      'temperature',
      23.5
    );
    const runtimeTransactions = createBusSensorReadTransactions(
      runtimeSensorDevice,
      configuredSensorState.devices[runtimeSensorDevice.id],
      'temperature'
    );
    assert(runtimeTransactions.length === 2, `${example.id} Bus Sensor Runtime should create SI70xx read/write transactions.`);
    const runtimeDecoded = runtimeTransactions.reduce(
      (state, transaction, index) =>
        applyBusSensorRuntimeEvent(
          state,
          {
            schemaVersion: 1,
            id: `${example.id}:runtime-si7021:${index}`,
            protocol: 'i2c',
            kind: 'bus-transaction',
            source: 'ui',
            clock: { ...timelineClock, sequence: 20 + index, virtualTimeNs: 20000000 + index * 1000000, virtualTimeMs: 20 + index },
            summary: 'validation generic bus sensor transaction',
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
          },
          busSensorDevices
        ),
      configuredSensorState
    );
    assert(
      Math.abs(runtimeDecoded.devices[runtimeSensorDevice.id].channels.temperature.lastReadValue - 23.5) < 0.05,
      `${example.id} Bus Sensor Runtime did not decode the SI7021 temperature transaction.`
    );
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
  validateDevicePackages();
  BOARD_SCHEMAS.forEach((board) => {
    const examples = getExamplesForBoard(board.id);
    assert(examples.length > 0, `${board.name} has no bundled examples.`);
  });
  EXAMPLE_PROJECTS.forEach((example) => validateProjectExample(example));
  console.log('Netlist, component package, sensor package, and device package validation completed successfully.');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
