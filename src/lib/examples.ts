import { BoardSchema, BOARD_SCHEMAS } from './boards';
import { DemoPeripheral, DemoWiring, generateDemoMainSource } from './firmware';
import { ProjectDocument, ProjectPeripheralPosition, createProjectDocument } from './project';

export type ExampleProject = {
  id: string;
  boardId: string;
  title: string;
  summary: string;
  difficulty: 'starter' | 'intermediate';
  project: ProjectDocument;
};

type BoardExamplePins = {
  buttonLed: {
    button: string;
    led: string;
  };
  buttonBuzzer: {
    button: string;
    buzzer: string;
  };
  rgb: {
    buttons: [string, string, string];
    colors: [string, string, string];
  };
  oled: {
    scl: string;
    sda: string;
  };
};

const BOARD_EXAMPLE_PINS: Record<string, BoardExamplePins> = {
  'nucleo-h753zi': {
    buttonLed: {
      button: 'CN10-3',
      led: 'CN7-10',
    },
    buttonBuzzer: {
      button: 'CN10-3',
      buzzer: 'CN10-7',
    },
    rgb: {
      buttons: ['CN10-3', 'CN7-14', 'CN7-9'],
      colors: ['CN9-1', 'CN9-3', 'CN9-5'],
    },
    oled: {
      scl: 'CN9-6',
      sda: 'CN9-5',
    },
  },
  'stm32f4-discovery': {
    buttonLed: {
      button: 'F4A-2',
      led: 'F4D-1',
    },
    buttonBuzzer: {
      button: 'F4A-3',
      buzzer: 'F4D-2',
    },
    rgb: {
      buttons: ['F4A-2', 'F4A-3', 'F4A-4'],
      colors: ['F4A-5', 'F4A-6', 'F4A-7'],
    },
    oled: {
      scl: 'F4D-3',
      sda: 'F4D-4',
    },
  },
  'stm32f103-gpio-lab': {
    buttonLed: {
      button: 'F1A-1',
      led: 'F1B-1',
    },
    buttonBuzzer: {
      button: 'F1A-2',
      buzzer: 'F1B-2',
    },
    rgb: {
      buttons: ['F1A-1', 'F1A-2', 'F1A-3'],
      colors: ['F1B-1', 'F1B-2', 'F1B-4'],
    },
    oled: {
      scl: 'F1B-4',
      sda: 'F1B-5',
    },
  },
};

function createButton(id: string, label: string, padId: string): DemoPeripheral {
  return {
    id,
    kind: 'button',
    label,
    padId,
    sourcePeripheralId: null,
    templateKind: 'button',
    groupId: null,
    groupLabel: null,
    endpointId: 'signal',
    endpointLabel: 'SIG',
    accentColor: '#d946ef',
  };
}

function createOutput(options: {
  id: string;
  label: string;
  padId: string;
  sourcePeripheralId: string;
  templateKind: 'led' | 'buzzer' | 'rgb-led';
  endpointId: string;
  endpointLabel: string;
  accentColor: string;
  groupId?: string | null;
  groupLabel?: string | null;
}): DemoPeripheral {
  return {
    id: options.id,
    kind: 'led',
    label: options.label,
    padId: options.padId,
    sourcePeripheralId: options.sourcePeripheralId,
    templateKind: options.templateKind,
    groupId: options.groupId ?? null,
    groupLabel: options.groupLabel ?? null,
    endpointId: options.endpointId,
    endpointLabel: options.endpointLabel,
    accentColor: options.accentColor,
  };
}

function createI2cEndpoint(options: {
  id: string;
  label: string;
  padId: string;
  endpointId: 'scl' | 'sda';
  endpointLabel: 'SCL' | 'SDA';
  accentColor: string;
  groupId: string;
  groupLabel: string;
}): DemoPeripheral {
  return {
    id: options.id,
    kind: 'i2c',
    label: options.label,
    padId: options.padId,
    sourcePeripheralId: null,
    templateKind: 'ssd1306-oled',
    groupId: options.groupId,
    groupLabel: options.groupLabel,
    endpointId: options.endpointId,
    endpointLabel: options.endpointLabel,
    accentColor: options.accentColor,
  };
}

function buildExampleProject(options: {
  board: BoardSchema;
  wiring: DemoWiring;
  peripheralPositions: Record<string, ProjectPeripheralPosition>;
  showFullPinout?: boolean;
}): ProjectDocument {
  const boardPads = options.board.connectors.all.flatMap((connector) => connector.pins);
  return {
    ...createProjectDocument({
      board: options.board,
      wiring: options.wiring,
      showFullPinout: options.showFullPinout ?? false,
      peripheralPositions: options.peripheralPositions,
      codeMode: 'generated',
      mainSource: generateDemoMainSource(options.wiring, options.board.runtime, boardPads),
    }),
    savedAt: '2026-04-21T00:00:00.000Z',
  };
}

function buildBoardExamples(board: BoardSchema): ExampleProject[] {
  const pins = BOARD_EXAMPLE_PINS[board.id];
  if (!pins) {
    return [];
  }

  const buttonLedWiring: DemoWiring = {
    peripherals: [
      createButton('button-1', 'Button 1', pins.buttonLed.button),
      createOutput({
        id: 'led-1',
        label: 'LED 1',
        padId: pins.buttonLed.led,
        sourcePeripheralId: 'button-1',
        templateKind: 'led',
        endpointId: 'signal',
        endpointLabel: 'SIG',
        accentColor: '#f59e0b',
      }),
    ],
  };

  const buttonBuzzerWiring: DemoWiring = {
    peripherals: [
      createButton('button-1', 'Button 1', pins.buttonBuzzer.button),
      createOutput({
        id: 'buzzer-1',
        label: 'Buzzer 1',
        padId: pins.buttonBuzzer.buzzer,
        sourcePeripheralId: 'button-1',
        templateKind: 'buzzer',
        endpointId: 'signal',
        endpointLabel: 'OUT',
        accentColor: '#14b8a6',
      }),
    ],
  };

  const rgbWiring: DemoWiring = {
    peripherals: [
      createButton('button-1', 'Red Button', pins.rgb.buttons[0]),
      createButton('button-2', 'Green Button', pins.rgb.buttons[1]),
      createButton('button-3', 'Blue Button', pins.rgb.buttons[2]),
      createOutput({
        id: 'rgb-led-1-red',
        label: 'RGB LED 1',
        padId: pins.rgb.colors[0],
        sourcePeripheralId: 'button-1',
        templateKind: 'rgb-led',
        endpointId: 'red',
        endpointLabel: 'RED',
        accentColor: '#ef4444',
        groupId: 'rgb-led-1',
        groupLabel: 'RGB LED 1',
      }),
      createOutput({
        id: 'rgb-led-1-green',
        label: 'RGB LED 1',
        padId: pins.rgb.colors[1],
        sourcePeripheralId: 'button-2',
        templateKind: 'rgb-led',
        endpointId: 'green',
        endpointLabel: 'GREEN',
        accentColor: '#22c55e',
        groupId: 'rgb-led-1',
        groupLabel: 'RGB LED 1',
      }),
      createOutput({
        id: 'rgb-led-1-blue',
        label: 'RGB LED 1',
        padId: pins.rgb.colors[2],
        sourcePeripheralId: 'button-3',
        templateKind: 'rgb-led',
        endpointId: 'blue',
        endpointLabel: 'BLUE',
        accentColor: '#3b82f6',
        groupId: 'rgb-led-1',
        groupLabel: 'RGB LED 1',
      }),
    ],
  };

  const oledWiring: DemoWiring = {
    peripherals: [
      createI2cEndpoint({
        id: 'ssd1306-oled-1-scl',
        label: 'OLED 1',
        padId: pins.oled.scl,
        endpointId: 'scl',
        endpointLabel: 'SCL',
        accentColor: '#38bdf8',
        groupId: 'ssd1306-oled-1',
        groupLabel: 'OLED 1',
      }),
      createI2cEndpoint({
        id: 'ssd1306-oled-1-sda',
        label: 'OLED 1',
        padId: pins.oled.sda,
        endpointId: 'sda',
        endpointLabel: 'SDA',
        accentColor: '#0ea5e9',
        groupId: 'ssd1306-oled-1',
        groupLabel: 'OLED 1',
      }),
    ],
  };

  return [
    {
      id: `${board.id}-button-led`,
      boardId: board.id,
      title: `${board.name}: Button drives LED`,
      summary: 'The smallest end-to-end GPIO loop for the selected board.',
      difficulty: 'starter',
      project: buildExampleProject({
        board,
        wiring: buttonLedWiring,
        peripheralPositions: {
          'button-1': { x: 96, y: 364 },
          'led-1': { x: 252, y: 364 },
        },
      }),
    },
    {
      id: `${board.id}-button-buzzer`,
      boardId: board.id,
      title: `${board.name}: Button drives Buzzer`,
      summary: 'A one-button output example using the current board pin map and runtime.',
      difficulty: 'starter',
      project: buildExampleProject({
        board,
        wiring: buttonBuzzerWiring,
        peripheralPositions: {
          'button-1': { x: 96, y: 364 },
          'buzzer-1': { x: 252, y: 364 },
        },
      }),
    },
    {
      id: `${board.id}-multi-button-rgb`,
      boardId: board.id,
      title: `${board.name}: Three buttons mix RGB`,
      summary: 'Three independent inputs drive the red, green, and blue endpoints on the selected board.',
      difficulty: 'intermediate',
      project: buildExampleProject({
        board,
        wiring: rgbWiring,
        peripheralPositions: {
          'button-1': { x: 96, y: 364 },
          'button-2': { x: 252, y: 364 },
          'button-3': { x: 408, y: 364 },
          'rgb-led-1': { x: 564, y: 364 },
        },
      }),
    },
    {
      id: `${board.id}-ssd1306-oled`,
      boardId: board.id,
      title: `${board.name}: SSD1306 OLED over I2C`,
      summary: 'A complex-bus demo that wires SCL/SDA and decodes brokered I2C transactions into an OLED framebuffer.',
      difficulty: 'intermediate',
      project: buildExampleProject({
        board,
        wiring: oledWiring,
        peripheralPositions: {
          'ssd1306-oled-1': { x: 96, y: 364 },
        },
      }),
    },
  ];
}

export const EXAMPLE_PROJECTS: readonly ExampleProject[] = BOARD_SCHEMAS.flatMap((board) => buildBoardExamples(board));

export function getExamplesForBoard(boardId: string): ExampleProject[] {
  return EXAMPLE_PROJECTS.filter((example) => example.boardId === boardId);
}

export function getExampleProject(exampleId: string, boardId?: string): ExampleProject | null {
  return EXAMPLE_PROJECTS.find((example) => example.id === exampleId && (!boardId || example.boardId === boardId)) ?? null;
}
