/**
 * User Firmware Validation System v2.
 *
 * User Firmware Mode bypasses generated demo C code, so the app needs a
 * structured contract that tells users how their CubeMX/CubeIDE project should
 * match the current visual wiring. v2 keeps the original F1/F4 onboarding
 * hints and adds package-driven native I2C sensor validation so SI7021, BMP180,
 * and catalog-generated Renode native sensors share one path.
 */
import type { BoardSchema } from './boards';
import {
  DemoBoardPad,
  DemoPeripheral,
  DemoPeripheralTemplateKind,
  DemoWiring,
  buildWorkbenchDevices,
  describePad,
  getConnectedPeripherals,
  getPeripheralTemplateKind,
} from './firmware';
import { findDevicePackage, getDevicePackageForTemplate } from './device-packages';
import type { DevicePackage, DevicePackageKind } from './device-packages';
import { findSensorProtocolCodec } from './sensor-protocol-codecs';
import { getSensorPackageSdk, isSensorPackageKind } from './sensor-packages';

export const USER_FIRMWARE_VALIDATION_SCHEMA_VERSION = 2;

export type CubeMxScenarioId = 'button-led' | 'uart-output' | 'si7021-i2c' | 'native-sensor-i2c';

export type CubeMxScenarioStatus = {
  id: CubeMxScenarioId;
  title: string;
  ready: boolean;
  summary: string;
};

export type CubeMxPinHint = {
  id: string;
  role: 'gpio-input' | 'gpio-output' | 'uart-tx' | 'uart-rx' | 'i2c-scl' | 'i2c-sda';
  label: string;
  peripheralLabel: string;
  padLabel: string;
  mcuPinId: string;
  cubeMxMode: string;
  cubeMxPull: string;
  cubeMxOutputType: string;
  cubeMxSpeed: string;
  recommendedUserLabel: string;
  halSymbol: string;
  notes: string[];
};

export type CubeMxNativeSensorContract = {
  schemaVersion: typeof USER_FIRMWARE_VALIDATION_SCHEMA_VERSION;
  id: string;
  deviceId: string;
  label: string;
  devicePackageKind: DevicePackageKind;
  devicePackageTitle: string;
  nativeCatalogId: string | null;
  renodeBackendType: DevicePackage['renodeBackend']['type'];
  nativeRenodeType: string | null;
  address: number;
  busName: string;
  halHandle: string;
  scl: CubeMxPinHint | null;
  sda: CubeMxPinHint | null;
  ready: boolean;
  canApplyNativeControls: boolean;
  canDecodeTransactions: boolean;
  transactionCodec: string | null;
  expectedRuntimePanels: string[];
  expectedResult: string;
  notes: string[];
};

export type CubeMxCodeSnippet = {
  id: string;
  title: string;
  language: 'c';
  source: string;
};

export type CubeMxValidationPack = {
  schemaVersion: typeof USER_FIRMWARE_VALIDATION_SCHEMA_VERSION;
  boardId: string;
  boardName: string;
  family: BoardSchema['family'];
  cubeMxTarget: string;
  cubeMxProjectTarget: string;
  toolchain: 'STM32CubeIDE';
  supported: boolean;
  pinHints: CubeMxPinHint[];
  scenarios: CubeMxScenarioStatus[];
  nativeSensorContracts: CubeMxNativeSensorContract[];
  snippets: CubeMxCodeSnippet[];
  warnings: string[];
};

const BOARD_TARGETS: Record<string, { cubeMxTarget: string; cubeMxProjectTarget: string }> = {
  'stm32f4-discovery': {
    cubeMxTarget: 'STM32F407VGTx',
    cubeMxProjectTarget: 'STM32F407VGTx / STM32F4 Discovery',
  },
  'stm32f103-gpio-lab': {
    cubeMxTarget: 'STM32F103RBTx',
    cubeMxProjectTarget: 'STM32F103RBTx preferred; STM32F103C8Tx is usable for small GPIO demos if memory fits.',
  },
};

function getBoardPads(board: BoardSchema): DemoBoardPad[] {
  return board.connectors.all.flatMap((connector) => connector.pins);
}

function findPad(board: BoardSchema, padId: string | null | undefined): DemoBoardPad | null {
  if (!padId) {
    return null;
  }
  return getBoardPads(board).find((pad) => pad.id === padId) ?? null;
}

function getPinNumber(mcuPinId: string): string {
  return mcuPinId.replace(/^P[A-K]/, '');
}

function userLabel(prefix: string, index: number): string {
  return index === 0 ? prefix : `${prefix}_${index + 1}`;
}

function getHalUartHandle(peripheralName: string): string {
  const index = peripheralName.match(/\d+$/)?.[0] ?? '';
  return `huart${index || '2'}`;
}

function getHalI2cHandle(peripheralName: string): string {
  const index = peripheralName.match(/\d+$/)?.[0] ?? '';
  return `hi2c${index || '1'}`;
}

function formatAddressMacroName(label: string): string {
  return `${label.replace(/[^A-Z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase()}_ADDR`;
}

function createGpioHint(options: {
  peripheral: DemoPeripheral;
  pad: DemoBoardPad;
  index: number;
}): CubeMxPinHint {
  const templateKind = getPeripheralTemplateKind(options.peripheral);
  const isInput = options.peripheral.kind === 'button';
  const prefix = isInput ? 'BTN' : templateKind === 'buzzer' ? 'BUZZER' : templateKind === 'rgb-led' ? `LED_${options.peripheral.endpointLabel ?? 'CH'}` : 'LED';
  const label = userLabel(prefix.replace(/[^A-Z0-9_]/gi, '_').toUpperCase(), options.index);
  const pinNumber = getPinNumber(options.pad.mcuPinId ?? '');
  return {
    id: `${options.peripheral.id}:${options.pad.id}`,
    role: isInput ? 'gpio-input' : 'gpio-output',
    label: isInput ? 'External button input' : 'External output',
    peripheralLabel: options.peripheral.endpointLabel
      ? `${options.peripheral.label} ${options.peripheral.endpointLabel}`
      : options.peripheral.label,
    padLabel: describePad(options.pad),
    mcuPinId: options.pad.mcuPinId ?? '',
    cubeMxMode: isInput ? 'GPIO_Input' : 'GPIO_Output',
    cubeMxPull: isInput ? 'Pull-down' : 'No pull',
    cubeMxOutputType: isInput ? 'n/a' : 'Push Pull',
    cubeMxSpeed: 'Low',
    recommendedUserLabel: label,
    halSymbol: isInput
      ? `HAL_GPIO_ReadPin(${label}_GPIO_Port, ${label}_Pin)`
      : `HAL_GPIO_WritePin(${label}_GPIO_Port, ${label}_Pin, GPIO_PIN_SET/RESET)`,
    notes: [
      isInput
        ? 'Renode external buttons drive logic high when pressed; Pull-down keeps the idle state low.'
        : 'Keep this endpoint in Firmware GPIO behavior when using User Firmware Mode.',
      `CubeMX will also define GPIO_PIN_${pinNumber} for ${options.pad.mcuPinId}.`,
    ],
  };
}

function createUartHints(board: BoardSchema): CubeMxPinHint[] {
  const uart = board.runtime.uart;
  if (!uart?.txPinId || !uart.rxPinId) {
    return [];
  }

  const base = {
    peripheralLabel: uart.displayName,
    cubeMxMode: `${uart.displayName} Asynchronous`,
    cubeMxPull: 'No pull',
    cubeMxOutputType: 'Alternate Function Push Pull',
    cubeMxSpeed: 'Low or Medium',
  };

  return [
    {
      id: `${board.id}:uart-tx`,
      role: 'uart-tx',
      label: 'UART terminal TX',
      padLabel: `${uart.txPinId} board UART TX`,
      mcuPinId: uart.txPinId,
      recommendedUserLabel: `${uart.displayName}_TX`,
      halSymbol: `HAL_UART_Transmit(&${getHalUartHandle(uart.peripheralName)}, ...)`,
      notes: ['Use 115200 8N1 for the examples unless your firmware intentionally chooses another baud rate.'],
      ...base,
    },
    {
      id: `${board.id}:uart-rx`,
      role: 'uart-rx',
      label: 'UART terminal RX',
      padLabel: `${uart.rxPinId} board UART RX`,
      mcuPinId: uart.rxPinId,
      recommendedUserLabel: `${uart.displayName}_RX`,
      halSymbol: `HAL_UART_Receive(&${getHalUartHandle(uart.peripheralName)}, ...)`,
      notes: ['The Electron UART terminal sends text to this RX path when the simulation is running.'],
      ...base,
      cubeMxOutputType: 'Alternate Function / input path',
    },
  ];
}

function findI2cBusForPins(board: BoardSchema, sclPinId: string | null | undefined, sdaPinId: string | null | undefined) {
  return (
    board.runtime.i2c?.find((candidate) => candidate.sclPinId === sclPinId && candidate.sdaPinId === sdaPinId) ??
    board.runtime.i2c?.find((candidate) => candidate.sclPinId === sclPinId || candidate.sdaPinId === sdaPinId) ??
    board.runtime.i2c?.[0] ??
    null
  );
}

function createI2cHint(options: {
  board: BoardSchema;
  peripheral: DemoPeripheral;
  pad: DemoBoardPad;
  role: 'i2c-scl' | 'i2c-sda';
  deviceTitle: string;
  address: number;
  busDisplayName: string;
  busPeripheralName: string;
}): CubeMxPinHint {
  const signal = options.role === 'i2c-scl' ? 'SCL' : 'SDA';
  return {
    id: `${options.peripheral.id}:${options.pad.id}`,
    role: options.role,
    label: `${options.deviceTitle} ${signal}`,
    peripheralLabel: options.peripheral.label,
    padLabel: describePad(options.pad),
    mcuPinId: options.pad.mcuPinId ?? '',
    cubeMxMode: `${options.busDisplayName} ${signal}`,
    cubeMxPull: 'Pull-up or external pull-up',
    cubeMxOutputType: 'Open Drain',
    cubeMxSpeed: 'Standard Mode 100 kHz',
    recommendedUserLabel: `${options.busDisplayName}_${signal}`,
    halSymbol: `HAL_I2C_Master_Transmit/Receive(&h${options.busPeripheralName}, 0x${options.address.toString(16).toUpperCase()} << 1, ...)`,
    notes: [
      `${options.deviceTitle} uses 7-bit I2C address 0x${options.address.toString(16).toUpperCase()}.`,
      'For CubeMX, enable the full I2C peripheral rather than configuring these as plain GPIO.',
    ],
  };
}

function makeButtonLedSnippet(buttonHint: CubeMxPinHint | null, outputHint: CubeMxPinHint | null): string {
  const button = buttonHint?.recommendedUserLabel ?? 'BTN';
  const output = outputHint?.recommendedUserLabel ?? 'LED';
  return [
    '/* USER CODE BEGIN WHILE */',
    'while (1)',
    '{',
    `  GPIO_PinState pressed = HAL_GPIO_ReadPin(${button}_GPIO_Port, ${button}_Pin);`,
    `  HAL_GPIO_WritePin(${output}_GPIO_Port, ${output}_Pin, pressed == GPIO_PIN_SET ? GPIO_PIN_SET : GPIO_PIN_RESET);`,
    '',
    '  /* Keep GPIO polling fast; throttle UART/I2C work with HAL_GetTick(). */',
    '  /* USER CODE END WHILE */',
    '  /* USER CODE BEGIN 3 */',
    '}',
    '/* USER CODE END 3 */',
  ].join('\n');
}

function makeUartSnippet(board: BoardSchema): string {
  const uart = getHalUartHandle(board.runtime.uart?.peripheralName ?? 'usart2');
  return [
    'static uint32_t last_uart_ms = 0;',
    'if (HAL_GetTick() - last_uart_ms >= 1000u) {',
    '  last_uart_ms = HAL_GetTick();',
    '  static const uint8_t msg[] = "User firmware UART alive\\r\\n";',
    `  (void)HAL_UART_Transmit(&${uart}, (uint8_t *)msg, sizeof(msg) - 1, 10);`,
    '}',
  ].join('\n');
}

function makeNativeSensorSnippet(contract: CubeMxNativeSensorContract | null): string {
  const handle = contract?.halHandle ?? 'hi2c1';
  const macro = contract ? formatAddressMacroName(contract.label) : 'SENSOR_ADDR';
  const address = contract?.address ?? 0x40;
  const command = contract?.devicePackageKind === 'bmp180-sensor' ? 0xf4 : 0xf3;
  const label = contract?.label ?? 'Native sensor';
  return [
    `/* ${label}: non-blocking-rate I2C polling skeleton. */`,
    `#define ${macro}        (0x${address.toString(16).toUpperCase()} << 1)`,
    `#define SENSOR_CMD_READ  0x${command.toString(16).toUpperCase()}`,
    '',
    'static uint32_t last_sensor_ms = 0;',
    'if (HAL_GetTick() - last_sensor_ms >= 1000u) {',
    '  last_sensor_ms = HAL_GetTick();',
    '  uint8_t command = SENSOR_CMD_READ;',
    '  uint8_t raw[3] = {0};',
    `  if (HAL_I2C_Master_Transmit(&${handle}, ${macro}, &command, 1, 10) == HAL_OK) {`,
    `    (void)HAL_I2C_Master_Receive(&${handle}, ${macro}, raw, sizeof(raw), 10);`,
    '  }',
    '}',
  ].join('\n');
}

function getDevicePackageForTemplateKind(templateKind: DemoPeripheralTemplateKind): DevicePackage | null {
  try {
    return findDevicePackage(templateKind as DevicePackageKind) ?? getDevicePackageForTemplate(templateKind);
  } catch {
    return null;
  }
}

function isNativeSensorPackage(devicePackage: DevicePackage | null): devicePackage is DevicePackage {
  if (!devicePackage || devicePackage.category !== 'sensor') {
    return false;
  }
  return devicePackage.renodeBackend.type === 'renode-native-sensor' || devicePackage.renodeBackend.type === 'renode-native-peripheral';
}

function createNativeSensorContracts(board: BoardSchema, wiring: DemoWiring): CubeMxNativeSensorContract[] {
  return buildWorkbenchDevices(wiring).flatMap((device) => {
    const devicePackage = getDevicePackageForTemplateKind(device.templateKind);
    if (!isNativeSensorPackage(devicePackage)) {
      return [];
    }

    const sclPeripheral = device.members.find((member) => member.endpointId === 'scl') ?? null;
    const sdaPeripheral = device.members.find((member) => member.endpointId === 'sda') ?? null;
    const sclPad = findPad(board, sclPeripheral?.padId);
    const sdaPad = findPad(board, sdaPeripheral?.padId);
    const bus = findI2cBusForPins(board, sclPad?.mcuPinId, sdaPad?.mcuPinId);
    const address = devicePackage.renodeBackend.address ?? devicePackage.protocol.defaultAddress ?? 0;
    const sensorPackage = isSensorPackageKind(devicePackage.legacy.sensorPackageKind)
      ? getSensorPackageSdk(devicePackage.legacy.sensorPackageKind)
      : null;
    const transactionCodec = sensorPackage?.busRuntime.transactionCodec ?? null;
    const canDecodeTransactions = Boolean(transactionCodec && findSensorProtocolCodec(transactionCodec));
    const busDisplayName = bus?.displayName ?? 'I2C1';
    const busPeripheralName = bus?.peripheralName ?? 'i2c1';
    const scl = sclPeripheral && sclPad?.mcuPinId
      ? createI2cHint({
          board,
          peripheral: sclPeripheral,
          pad: sclPad,
          role: 'i2c-scl',
          deviceTitle: devicePackage.title,
          address,
          busDisplayName,
          busPeripheralName,
        })
      : null;
    const sda = sdaPeripheral && sdaPad?.mcuPinId
      ? createI2cHint({
          board,
          peripheral: sdaPeripheral,
          pad: sdaPad,
          role: 'i2c-sda',
          deviceTitle: devicePackage.title,
          address,
          busDisplayName,
          busPeripheralName,
        })
      : null;
    const ready = Boolean(scl && sda && bus);

    return [
      {
        schemaVersion: USER_FIRMWARE_VALIDATION_SCHEMA_VERSION,
        id: `${device.id}:${devicePackage.kind}`,
        deviceId: device.id,
        label: device.label,
        devicePackageKind: devicePackage.kind,
        devicePackageTitle: devicePackage.title,
        nativeCatalogId: devicePackage.renodeBackend.nativeCatalogId ?? null,
        renodeBackendType: devicePackage.renodeBackend.type,
        nativeRenodeType: devicePackage.renodeBackend.nativeRenodeType ?? null,
        address,
        busName: busDisplayName,
        halHandle: `h${busPeripheralName}`,
        scl,
        sda,
        ready,
        canApplyNativeControls: Boolean(devicePackage.renodeBackend.nativeControlTransport),
        canDecodeTransactions,
        transactionCodec,
        expectedRuntimePanels: [...devicePackage.runtimePanel.controls, ...devicePackage.runtimePanel.visualizers],
        expectedResult: canDecodeTransactions
          ? 'Native Renode sensor values can be applied, firmware can read over I2C, and UI can decode matching bus transactions.'
          : 'Native Renode sensor values can be applied; firmware validation should rely on UART/application output until a protocol codec is added.',
        notes: [
          `${devicePackage.title} is emitted as ${devicePackage.renodeBackend.nativeRenodeType ?? devicePackage.renodeBackend.model} in board.repl.`,
          ready ? `CubeMX must enable ${busDisplayName} on ${scl?.mcuPinId}/${sda?.mcuPinId}.` : 'Wire both SCL and SDA to the same I2C-capable board bus.',
          'Use finite HAL timeouts and rate-limit sensor reads so GPIO polling remains responsive.',
        ],
      },
    ];
  });
}

export function createCubeMxValidationPack(board: BoardSchema, wiring: DemoWiring): CubeMxValidationPack {
  const target = BOARD_TARGETS[board.id] ?? {
    cubeMxTarget: board.name,
    cubeMxProjectTarget: `${board.name} custom CubeMX target`,
  };
  const supported = board.family === 'stm32f1' || board.family === 'stm32f4';
  const warnings: string[] = [];
  if (!supported) {
    warnings.push('User Firmware Validation v2 is focused on STM32F1/F4 onboarding. Other boards still show best-effort hints.');
  }

  const connectedButtons = getConnectedPeripherals(wiring, 'button');
  const connectedOutputs = getConnectedPeripherals(wiring, 'led');
  const gpioHints = [...connectedButtons, ...connectedOutputs]
    .map((peripheral, index) => {
      const pad = findPad(board, peripheral.padId);
      return pad?.mcuPinId ? createGpioHint({ peripheral, pad, index }) : null;
    })
    .filter((hint): hint is CubeMxPinHint => Boolean(hint));

  const uartHints = createUartHints(board);
  const nativeSensorContracts = createNativeSensorContracts(board, wiring);
  const i2cHints = nativeSensorContracts.flatMap((contract) => [contract.scl, contract.sda]).filter((hint): hint is CubeMxPinHint => Boolean(hint));
  const buttonHint = gpioHints.find((hint) => hint.role === 'gpio-input') ?? null;
  const outputHint = gpioHints.find((hint) => hint.role === 'gpio-output') ?? null;
  const hasButtonLed = Boolean(buttonHint && outputHint);
  const hasSi7021 = nativeSensorContracts.some((contract) => contract.devicePackageKind === 'si7021-sensor' && contract.ready);
  const readyNativeSensors = nativeSensorContracts.filter((contract) => contract.ready);

  const scenarios: CubeMxScenarioStatus[] = [
    {
      id: 'button-led',
      title: 'Button controls LED/output',
      ready: hasButtonLed,
      summary: hasButtonLed
        ? `${buttonHint?.mcuPinId} can drive ${outputHint?.mcuPinId} through HAL GPIO code.`
        : 'Wire at least one Button and one LED/Buzzer/RGB endpoint to generate exact GPIO code hints.',
    },
    {
      id: 'uart-output',
      title: 'UART terminal output',
      ready: uartHints.length >= 2,
      summary: uartHints.length >= 2
        ? `Enable ${board.runtime.uart?.displayName ?? 'board UART'} on ${uartHints.map((hint) => hint.mcuPinId).join('/')} to print into the UI terminal.`
        : 'This board profile has no UART runtime metadata yet.',
    },
    {
      id: 'si7021-i2c',
      title: 'SI7021 native I2C read',
      ready: hasSi7021,
      summary: hasSi7021
        ? 'SI7021 is wired to a board I2C bus; firmware can read Renode Sensors.SI70xx at 0x40.'
        : 'Wire SI7021 SCL/SDA to a board I2C-capable pair to get exact HAL I2C hints.',
    },
    {
      id: 'native-sensor-i2c',
      title: 'Native Renode sensor read',
      ready: readyNativeSensors.length > 0,
      summary: readyNativeSensors.length > 0
        ? `${readyNativeSensors.length} native sensor(s) have a CubeMX I2C contract and runtime visualization path.`
        : 'Wire any native sensor package SCL/SDA to an I2C-capable board pair to validate user-firmware reads.',
    },
  ];

  return {
    schemaVersion: USER_FIRMWARE_VALIDATION_SCHEMA_VERSION,
    boardId: board.id,
    boardName: board.name,
    family: board.family,
    cubeMxTarget: target.cubeMxTarget,
    cubeMxProjectTarget: target.cubeMxProjectTarget,
    toolchain: 'STM32CubeIDE',
    supported,
    pinHints: [...gpioHints, ...uartHints, ...i2cHints],
    scenarios,
    nativeSensorContracts,
    snippets: [
      {
        id: 'button-led',
        title: 'Fast GPIO polling loop',
        language: 'c',
        source: makeButtonLedSnippet(buttonHint, outputHint),
      },
      {
        id: 'uart-output',
        title: 'Rate-limited UART terminal print',
        language: 'c',
        source: makeUartSnippet(board),
      },
      {
        id: 'native-sensor-i2c',
        title: 'Rate-limited native sensor I2C read skeleton',
        language: 'c',
        source: makeNativeSensorSnippet(nativeSensorContracts.find((contract) => contract.ready) ?? nativeSensorContracts[0] ?? null),
      },
    ],
    warnings,
  };
}
