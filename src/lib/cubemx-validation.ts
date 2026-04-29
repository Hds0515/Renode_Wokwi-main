/**
 * CubeMX / CubeIDE user-firmware guidance.
 *
 * User Firmware Mode deliberately bypasses generated demo C code, so the app
 * needs a compact contract that tells users how their CubeMX project should be
 * configured for the current visual wiring. This module is UI-independent so
 * the renderer and static validation scripts can share the same guidance.
 */
import type { BoardSchema } from './boards';
import {
  DemoBoardPad,
  DemoPeripheral,
  DemoWiring,
  describePad,
  getConnectedPeripherals,
  getPeripheralTemplateKind,
} from './firmware';

export type CubeMxScenarioId = 'button-led' | 'uart-output' | 'si7021-i2c';

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

export type CubeMxCodeSnippet = {
  id: CubeMxScenarioId;
  title: string;
  language: 'c';
  source: string;
};

export type CubeMxValidationPack = {
  schemaVersion: 1;
  boardId: string;
  boardName: string;
  family: BoardSchema['family'];
  cubeMxTarget: string;
  cubeMxProjectTarget: string;
  toolchain: 'STM32CubeIDE';
  supported: boolean;
  pinHints: CubeMxPinHint[];
  scenarios: CubeMxScenarioStatus[];
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

function createGpioHint(options: {
  board: BoardSchema;
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

function findSi7021Endpoint(wiring: DemoWiring, endpointId: 'scl' | 'sda'): DemoPeripheral | null {
  return (
    wiring.peripherals.find(
      (peripheral) =>
        getPeripheralTemplateKind(peripheral) === 'si7021-sensor' &&
        peripheral.endpointId === endpointId &&
        Boolean(peripheral.padId)
    ) ?? null
  );
}

function createI2cHint(options: {
  board: BoardSchema;
  peripheral: DemoPeripheral;
  pad: DemoBoardPad;
  role: 'i2c-scl' | 'i2c-sda';
}): CubeMxPinHint {
  const bus = options.board.runtime.i2c?.find((candidate) =>
    options.role === 'i2c-scl' ? candidate.sclPinId === options.pad.mcuPinId : candidate.sdaPinId === options.pad.mcuPinId
  );
  const busName = bus?.displayName ?? options.board.runtime.i2c?.[0]?.displayName ?? 'I2C1';
  const signal = options.role === 'i2c-scl' ? 'SCL' : 'SDA';
  return {
    id: `${options.peripheral.id}:${options.pad.id}`,
    role: options.role,
    label: `SI7021 ${signal}`,
    peripheralLabel: options.peripheral.label,
    padLabel: describePad(options.pad),
    mcuPinId: options.pad.mcuPinId ?? '',
    cubeMxMode: `${busName} ${signal}`,
    cubeMxPull: 'Pull-up or external pull-up',
    cubeMxOutputType: 'Open Drain',
    cubeMxSpeed: 'Standard Mode 100 kHz',
    recommendedUserLabel: `${busName}_${signal}`,
    halSymbol: `HAL_I2C_Master_Transmit/Receive(&h${bus?.peripheralName ?? 'i2c1'}, 0x40 << 1, ...)`,
    notes: [
      'SI7021 uses 7-bit I2C address 0x40.',
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
    '  /* USER CODE END WHILE */',
    '  /* USER CODE BEGIN 3 */',
    '}',
    '/* USER CODE END 3 */',
  ].join('\n');
}

function makeUartSnippet(board: BoardSchema): string {
  const uart = getHalUartHandle(board.runtime.uart?.peripheralName ?? 'usart2');
  return [
    'static const uint8_t msg[] = "User firmware UART alive\\r\\n";',
    `HAL_UART_Transmit(&${uart}, (uint8_t *)msg, sizeof(msg) - 1, HAL_MAX_DELAY);`,
  ].join('\n');
}

function makeSi7021Snippet(board: BoardSchema): string {
  const i2c = board.runtime.i2c?.[0]?.peripheralName ?? 'i2c1';
  return [
    '#define SI7021_ADDR        (0x40 << 1)',
    '#define SI7021_TEMP_NOHOLD 0xF3',
    '',
    'uint8_t command = SI7021_TEMP_NOHOLD;',
    'uint8_t raw[2] = {0};',
    `HAL_I2C_Master_Transmit(&h${i2c}, SI7021_ADDR, &command, 1, HAL_MAX_DELAY);`,
    `HAL_I2C_Master_Receive(&h${i2c}, SI7021_ADDR, raw, 2, HAL_MAX_DELAY);`,
  ].join('\n');
}

export function createCubeMxValidationPack(board: BoardSchema, wiring: DemoWiring): CubeMxValidationPack {
  const target = BOARD_TARGETS[board.id] ?? {
    cubeMxTarget: board.name,
    cubeMxProjectTarget: `${board.name} custom CubeMX target`,
  };
  const supported = board.family === 'stm32f1' || board.family === 'stm32f4';
  const warnings: string[] = [];
  if (!supported) {
    warnings.push('CubeMX validation pack v1 is focused on STM32F1/F4 user-firmware onboarding.');
  }

  const connectedButtons = getConnectedPeripherals(wiring, 'button');
  const connectedOutputs = getConnectedPeripherals(wiring, 'led');
  const gpioHints = [...connectedButtons, ...connectedOutputs]
    .map((peripheral, index) => {
      const pad = findPad(board, peripheral.padId);
      return pad?.mcuPinId ? createGpioHint({ board, peripheral, pad, index }) : null;
    })
    .filter((hint): hint is CubeMxPinHint => Boolean(hint));

  const sclPeripheral = findSi7021Endpoint(wiring, 'scl');
  const sdaPeripheral = findSi7021Endpoint(wiring, 'sda');
  const sclPad = findPad(board, sclPeripheral?.padId);
  const sdaPad = findPad(board, sdaPeripheral?.padId);
  const i2cHints = [
    sclPeripheral && sclPad?.mcuPinId ? createI2cHint({ board, peripheral: sclPeripheral, pad: sclPad, role: 'i2c-scl' }) : null,
    sdaPeripheral && sdaPad?.mcuPinId ? createI2cHint({ board, peripheral: sdaPeripheral, pad: sdaPad, role: 'i2c-sda' }) : null,
  ].filter((hint): hint is CubeMxPinHint => Boolean(hint));

  const uartHints = createUartHints(board);
  const buttonHint = gpioHints.find((hint) => hint.role === 'gpio-input') ?? null;
  const outputHint = gpioHints.find((hint) => hint.role === 'gpio-output') ?? null;
  const hasButtonLed = Boolean(buttonHint && outputHint);
  const hasSi7021 = i2cHints.some((hint) => hint.role === 'i2c-scl') && i2cHints.some((hint) => hint.role === 'i2c-sda');

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
        ? `Enable ${board.runtime.i2c?.[0]?.displayName ?? 'I2C1'} and read SI7021 at 0x40 through HAL I2C.`
        : 'Wire SI7021 SCL/SDA to the board I2C-capable pins to get exact HAL I2C hints.',
    },
  ];

  return {
    schemaVersion: 1,
    boardId: board.id,
    boardName: board.name,
    family: board.family,
    cubeMxTarget: target.cubeMxTarget,
    cubeMxProjectTarget: target.cubeMxProjectTarget,
    toolchain: 'STM32CubeIDE',
    supported,
    pinHints: [...gpioHints, ...uartHints, ...i2cHints],
    scenarios,
    snippets: [
      {
        id: 'button-led',
        title: 'Polling Button -> LED loop',
        language: 'c',
        source: makeButtonLedSnippet(buttonHint, outputHint),
      },
      {
        id: 'uart-output',
        title: 'UART terminal print',
        language: 'c',
        source: makeUartSnippet(board),
      },
      {
        id: 'si7021-i2c',
        title: 'SI7021 temperature read skeleton',
        language: 'c',
        source: makeSi7021Snippet(board),
      },
    ],
    warnings,
  };
}
