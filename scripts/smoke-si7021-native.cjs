/**
 * End-to-end SI7021 native Renode sensor smoke test.
 *
 * It compiles generated firmware, launches Renode, updates the native sensor
 * through the runtime bridge, and verifies the MCU can read it via I2C/UART.
 */
const fs = require('fs');
const ts = require('typescript');

require.extensions['.ts'] = function loadTsModule(module, filename) {
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
const { getExamplesForBoard } = require('../src/lib/examples.ts');
const { DEFAULT_STARTUP_SOURCE } = require('../src/lib/firmware.ts');
const { compileNetlistToRenodeArtifacts } = require('../src/lib/netlist.ts');
const { createRuntimeBusManifest } = require('../src/lib/runtime-timeline.ts');
const {
  createBusSensorRuntimeState,
  createNativeSensorControlRequest,
  getBusSensorRuntimeDevices,
  updateBusSensorChannelConfiguration,
} = require('../src/lib/bus-sensor-runtime.ts');
const {
  createRuntimeSignalManifest,
  createSignalDefinitionsFromNetlist,
} = require('../src/lib/signal-broker.ts');
const { createRuntimeService } = require('../electron/runtime.cjs');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const boardIds = ['nucleo-h753zi', 'stm32f4-discovery', 'stm32f103-gpio-lab'];

  for (const [index, boardId] of boardIds.entries()) {
    const board = BOARD_SCHEMAS.find((candidate) => candidate.id === boardId);
    if (!board) {
      throw new Error(`${boardId} board schema is missing.`);
    }

    const example = getExamplesForBoard(board.id).find((candidate) => candidate.id.endsWith('si7021-sensor'));
    if (!example) {
      throw new Error(`${boardId} SI7021 example is missing.`);
    }

    const bridgePort = 9301 + index;
    const gdbPort = 3601 + index;
    const transactionBrokerPort = 9401 + index;
    const artifacts = compileNetlistToRenodeArtifacts({
      netlist: example.project.netlist,
      board,
      bridgePort,
      gdbPort,
    });
    const busManifest = createRuntimeBusManifest(board, example.project.netlist);
    const busSensorDevices = getBusSensorRuntimeDevices(busManifest);
    const sensorBus = busManifest.find(
      (entry) => entry.protocol === 'i2c' && Array.isArray(entry.devices) && entry.devices.some((device) => device.model === 'si7021')
    );
    const sensorDevice = sensorBus?.devices?.find((device) => device.model === 'si7021');
    if (!sensorDevice?.nativeRenodePath) {
      throw new Error(`${boardId} SI7021 bus manifest did not expose a native Renode monitor path.`);
    }
    if (!artifacts.boardRepl.includes('Sensors.SI70xx @ i2c1 0x40')) {
      throw new Error(`${boardId} generated board.repl did not attach SI7021 to Renode I2C1.`);
    }
    if (!artifacts.mainSource.includes('si7021_read_raw')) {
      throw new Error(`${boardId} generated firmware did not include the native SI7021 I2C read path.`);
    }
    const runtimeSensorDevice = busSensorDevices.find((device) => device.componentId === sensorDevice.componentId);
    if (!runtimeSensorDevice) {
      throw new Error(`${boardId} Bus Sensor Runtime did not discover the SI7021 device.`);
    }
    let busSensorState = createBusSensorRuntimeState(busSensorDevices);
    busSensorState = updateBusSensorChannelConfiguration(busSensorState, runtimeSensorDevice.id, 'temperature', 23.5);
    busSensorState = updateBusSensorChannelConfiguration(busSensorState, runtimeSensorDevice.id, 'humidity', 51.5);
    const nativeControlRequest = createNativeSensorControlRequest(
      runtimeSensorDevice,
      busSensorState.devices[runtimeSensorDevice.id]
    );
    if (!nativeControlRequest) {
      throw new Error(`${boardId} Bus Sensor Runtime did not create a native control request.`);
    }

    const runtime = createRuntimeService();
    let uartCapture = '';
    runtime.on('event', (payload) => {
      if (payload.type === 'log') {
        console.log(`[${boardId}] [${payload.level}] ${payload.message}`);
      }
      if (payload.type === 'uart') {
        uartCapture += payload.data || '';
        process.stdout.write(`[${boardId}:uart:${payload.stream}:${payload.status}] ${payload.data || ''}`);
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
        signalManifest: createRuntimeSignalManifest(createSignalDefinitionsFromNetlist(example.project.netlist)),
        busManifest,
        uartPeripheralName: board.runtime.uart?.peripheralName ?? null,
        machineName: board.machineName,
        bridgePort,
        gdbPort,
        transactionBrokerPort,
        enableI2cDemoFeed: false,
      });
      if (!startResult.success) {
        throw new Error(startResult.message);
      }
      started = true;

      const controlResult = await runtime.setNativeSensor(nativeControlRequest);
      if (!controlResult.success) {
        throw new Error(`${boardId} native sensor control failed: ${controlResult.message}`);
      }

      for (let attempt = 0; attempt < 40 && !/SI7021 T=23\.\d+C RH=51\.\d+%/.test(uartCapture); attempt += 1) {
        await wait(500);
      }

      if (!/SI7021 T=23\.\d+C RH=51\.\d+%/.test(uartCapture)) {
        throw new Error(`${boardId} controlled native SI7021 measurement was not observed on UART.\n${uartCapture}`);
      }

      console.log(`\n${boardId} native SI7021 I2C firmware measurement and monitor control observed.`);
    } finally {
      if (started) {
        await runtime.stopSimulation();
        await wait(1000);
      }
    }
  }

  console.log('\nNative SI7021 I2C firmware smoke test completed successfully for all board profiles.');
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
