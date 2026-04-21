import {
  DEFAULT_BOARD_RUNTIME,
  DEFAULT_GCC_ARGS,
  DEMO_BOARD_NAME,
  DEMO_BOARD_TAGLINE,
  DEMO_CONNECTORS,
  DEMO_LEFT_CONNECTORS,
  DEMO_LEFT_MORPHO_CONNECTOR,
  DEMO_MACHINE_NAME,
  DEMO_RIGHT_CONNECTORS,
  DEMO_RIGHT_MORPHO_CONNECTOR,
  DEMO_SELECTABLE_PADS,
  DemoBoardRuntime,
  DemoBoardConnector,
  DemoBoardPad,
} from './firmware';

export type BoardConnectorFrame = {
  x: number;
  y: number;
  width: number;
  layout: 'single' | 'dual';
};

export type BoardFeatureSchema = {
  label: string;
  detail: string;
};

export type BoardSchema = {
  id: string;
  name: string;
  tagline: string;
  machineName: string;
  renodePlatformPath: string;
  status: 'ready' | 'experimental';
  family: 'stm32h7' | 'stm32f4' | 'stm32f1';
  compiler: {
    gccArgs: readonly string[];
  };
  runtime: DemoBoardRuntime;
  connectors: {
    all: readonly DemoBoardConnector[];
    left: readonly DemoBoardConnector[];
    right: readonly DemoBoardConnector[];
    leftMorpho: DemoBoardConnector | null;
    rightMorpho: DemoBoardConnector | null;
    selectablePads: readonly DemoBoardPad[];
  };
  visual: {
    connectorFrames: Record<string, BoardConnectorFrame>;
    onboardFeatures: readonly BoardFeatureSchema[];
    canvas: {
      width: number;
      baseHeight: number;
      boardTopViewHeight: number;
      peripheralCardWidth: number;
      peripheralCardHeight: number;
      peripheralsPerRow: number;
      peripheralRowGap: number;
      padHotspotSize: number;
      padHoverLabelWidth: number;
    };
  };
  teaching: {
    curatedPadIds: readonly string[];
  };
};

type SimpleBoardPin = {
  pinNumber: number;
  pinLabel: string;
  mcuPinId: string;
  signalName?: string;
  note?: string;
  blockedReason?: string | null;
};

function createSimpleConnector(options: {
  id: string;
  title: string;
  subtitle: string;
  placement: 'left' | 'right';
  pins: SimpleBoardPin[];
}): DemoBoardConnector {
  return {
    id: options.id,
    title: options.title,
    subtitle: options.subtitle,
    placement: options.placement,
    layout: 'single',
    pins: options.pins.map((pin) => ({
      id: `${options.id}-${pin.pinNumber}`,
      connectorId: options.id,
      connectorTitle: options.title,
      connectorPlacement: options.placement,
      connectorLayout: 'single',
      pinNumber: pin.pinNumber,
      pinLabel: pin.pinLabel,
      mcuPinId: pin.mcuPinId,
      signalName: pin.signalName ?? pin.pinLabel,
      note: pin.note ?? null,
      role: pin.blockedReason ? 'reserved' : 'gpio',
      column: 'single',
      selectable: !pin.blockedReason,
      blockedReason: pin.blockedReason ?? null,
    })),
  };
}

const STM32_MODERN_LINKER_SCRIPT = (flashLength: string, ramLength: string) => `ENTRY(Reset_Handler)

MEMORY
{
    FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = ${flashLength}
    RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = ${ramLength}
}

_estack = ORIGIN(RAM) + LENGTH(RAM);

SECTIONS
{
    .isr_vector :
    {
        KEEP(*(.isr_vector))
    } > FLASH

    .text :
    {
        *(.text*)
        *(.rodata*)
        . = ALIGN(4);
        _etext = .;
    } > FLASH

    _sidata = LOADADDR(.data);

    .data :
    {
        . = ALIGN(4);
        _sdata = .;
        *(.data*)
        . = ALIGN(4);
        _edata = .;
    } > RAM AT > FLASH

    .bss (NOLOAD) :
    {
        . = ALIGN(4);
        _sbss = .;
        *(.bss*)
        *(COMMON)
        . = ALIGN(4);
        _ebss = .;
    } > RAM
}
`;

const STM32F4_GPIOA_CONNECTOR = createSimpleConnector({
  id: 'F4A',
  title: 'GPIOA',
  subtitle: 'STM32F4 Discovery GPIOA teaching header',
  placement: 'left',
  pins: [
    { pinNumber: 1, pinLabel: 'PA0', mcuPinId: 'PA0', signalName: 'USER button / WKUP', blockedReason: 'Reserved by on-board USER button.' },
    { pinNumber: 2, pinLabel: 'PA1', mcuPinId: 'PA1', signalName: 'GPIO / ADC' },
    { pinNumber: 3, pinLabel: 'PA2', mcuPinId: 'PA2', signalName: 'GPIO / USART2 TX' },
    { pinNumber: 4, pinLabel: 'PA3', mcuPinId: 'PA3', signalName: 'GPIO / USART2 RX' },
    { pinNumber: 5, pinLabel: 'PA5', mcuPinId: 'PA5', signalName: 'GPIO / SPI1 SCK' },
    { pinNumber: 6, pinLabel: 'PA6', mcuPinId: 'PA6', signalName: 'GPIO / SPI1 MISO' },
    { pinNumber: 7, pinLabel: 'PA7', mcuPinId: 'PA7', signalName: 'GPIO / SPI1 MOSI' },
    { pinNumber: 8, pinLabel: 'PA8', mcuPinId: 'PA8', signalName: 'GPIO / MCO1' },
  ],
});

const STM32F4_GPIOD_CONNECTOR = createSimpleConnector({
  id: 'F4D',
  title: 'GPIOD',
  subtitle: 'STM32F4 Discovery GPIOD and expansion GPIO',
  placement: 'right',
  pins: [
    { pinNumber: 1, pinLabel: 'PB0', mcuPinId: 'PB0', signalName: 'GPIO / ADC' },
    { pinNumber: 2, pinLabel: 'PB1', mcuPinId: 'PB1', signalName: 'GPIO / ADC' },
    { pinNumber: 3, pinLabel: 'PC6', mcuPinId: 'PC6', signalName: 'GPIO / TIM8 CH1' },
    { pinNumber: 4, pinLabel: 'PC7', mcuPinId: 'PC7', signalName: 'GPIO / TIM8 CH2' },
    { pinNumber: 5, pinLabel: 'PD12', mcuPinId: 'PD12', signalName: 'On-board green LED', blockedReason: 'Reserved by on-board LED.' },
    { pinNumber: 6, pinLabel: 'PD13', mcuPinId: 'PD13', signalName: 'On-board orange LED', blockedReason: 'Reserved by on-board LED.' },
    { pinNumber: 7, pinLabel: 'PD14', mcuPinId: 'PD14', signalName: 'On-board red LED', blockedReason: 'Reserved by on-board LED.' },
    { pinNumber: 8, pinLabel: 'PD15', mcuPinId: 'PD15', signalName: 'On-board blue LED', blockedReason: 'Reserved by on-board LED.' },
  ],
});

const STM32F103_GPIOA_CONNECTOR = createSimpleConnector({
  id: 'F1A',
  title: 'GPIOA',
  subtitle: 'STM32F103 common GPIOA pins',
  placement: 'left',
  pins: [
    { pinNumber: 1, pinLabel: 'PA0', mcuPinId: 'PA0', signalName: 'GPIO / ADC / TIM2' },
    { pinNumber: 2, pinLabel: 'PA1', mcuPinId: 'PA1', signalName: 'GPIO / ADC / TIM2' },
    { pinNumber: 3, pinLabel: 'PA2', mcuPinId: 'PA2', signalName: 'GPIO / USART2 TX' },
    { pinNumber: 4, pinLabel: 'PA3', mcuPinId: 'PA3', signalName: 'GPIO / USART2 RX' },
    { pinNumber: 5, pinLabel: 'PA4', mcuPinId: 'PA4', signalName: 'GPIO / SPI1 NSS' },
    { pinNumber: 6, pinLabel: 'PA5', mcuPinId: 'PA5', signalName: 'GPIO / SPI1 SCK' },
    { pinNumber: 7, pinLabel: 'PA6', mcuPinId: 'PA6', signalName: 'GPIO / SPI1 MISO' },
    { pinNumber: 8, pinLabel: 'PA7', mcuPinId: 'PA7', signalName: 'GPIO / SPI1 MOSI' },
  ],
});

const STM32F103_GPIOB_CONNECTOR = createSimpleConnector({
  id: 'F1B',
  title: 'GPIOB',
  subtitle: 'STM32F103 common GPIOB pins',
  placement: 'right',
  pins: [
    { pinNumber: 1, pinLabel: 'PB0', mcuPinId: 'PB0', signalName: 'GPIO / ADC / TIM3' },
    { pinNumber: 2, pinLabel: 'PB1', mcuPinId: 'PB1', signalName: 'GPIO / ADC / TIM3' },
    { pinNumber: 3, pinLabel: 'PB5', mcuPinId: 'PB5', signalName: 'GPIO / I2C remap' },
    { pinNumber: 4, pinLabel: 'PB6', mcuPinId: 'PB6', signalName: 'GPIO / I2C1 SCL' },
    { pinNumber: 5, pinLabel: 'PB7', mcuPinId: 'PB7', signalName: 'GPIO / I2C1 SDA' },
    { pinNumber: 6, pinLabel: 'PB8', mcuPinId: 'PB8', signalName: 'GPIO / CAN RX' },
    { pinNumber: 7, pinLabel: 'PB9', mcuPinId: 'PB9', signalName: 'GPIO / CAN TX' },
    { pinNumber: 8, pinLabel: 'PC13', mcuPinId: 'PC13', signalName: 'Blue Pill LED', blockedReason: 'Reserved by common Blue Pill LED.' },
  ],
});

export const NUCLEO_H753ZI_BOARD_SCHEMA: BoardSchema = {
  id: 'nucleo-h753zi',
  name: DEMO_BOARD_NAME,
  tagline: DEMO_BOARD_TAGLINE,
  machineName: DEMO_MACHINE_NAME,
  renodePlatformPath: 'platforms/boards/nucleo_h753zi.repl',
  status: 'ready',
  family: 'stm32h7',
  compiler: {
    gccArgs: DEFAULT_GCC_ARGS,
  },
  runtime: DEFAULT_BOARD_RUNTIME,
  connectors: {
    all: DEMO_CONNECTORS,
    left: DEMO_LEFT_CONNECTORS,
    right: DEMO_RIGHT_CONNECTORS,
    leftMorpho: DEMO_LEFT_MORPHO_CONNECTOR,
    rightMorpho: DEMO_RIGHT_MORPHO_CONNECTOR,
    selectablePads: DEMO_SELECTABLE_PADS,
  },
  visual: {
    connectorFrames: {
      CN11: { x: 0, y: 24, width: 108, layout: 'dual' },
      CN7: { x: 128, y: 50, width: 90, layout: 'single' },
      CN8: { x: 128, y: 228, width: 90, layout: 'single' },
      CN9: { x: 542, y: 50, width: 90, layout: 'single' },
      CN10: { x: 542, y: 228, width: 90, layout: 'single' },
      CN12: { x: 652, y: 24, width: 108, layout: 'dual' },
    },
    onboardFeatures: [
      { label: 'LD1', detail: 'PB0 Green LED' },
      { label: 'LD2', detail: 'PE1 Yellow LED' },
      { label: 'LD3', detail: 'PB14 Red LED' },
      { label: 'B1', detail: 'PC13 User Button' },
    ],
    canvas: {
      width: 760,
      baseHeight: 510,
      boardTopViewHeight: 312,
      peripheralCardWidth: 138,
      peripheralCardHeight: 86,
      peripheralsPerRow: 4,
      peripheralRowGap: 18,
      padHotspotSize: 18,
      padHoverLabelWidth: 140,
    },
  },
  teaching: {
    curatedPadIds: [
      'CN7-8',
      'CN7-9',
      'CN7-10',
      'CN7-11',
      'CN7-12',
      'CN7-13',
      'CN7-14',
      'CN7-15',
      'CN8-1',
      'CN8-2',
      'CN8-3',
      'CN8-4',
      'CN8-5',
      'CN8-6',
      'CN8-7',
      'CN8-8',
      'CN8-9',
      'CN8-10',
      'CN9-1',
      'CN9-3',
      'CN9-5',
      'CN9-7',
      'CN10-3',
      'CN10-5',
      'CN10-7',
      'CN10-9',
    ],
  },
};

const STM32F4_DISCOVERY_CONNECTORS = [STM32F4_GPIOA_CONNECTOR, STM32F4_GPIOD_CONNECTOR] as const;
const STM32F103_CONNECTORS = [STM32F103_GPIOA_CONNECTOR, STM32F103_GPIOB_CONNECTOR] as const;

export const STM32F4_DISCOVERY_BOARD_SCHEMA: BoardSchema = {
  id: 'stm32f4-discovery',
  name: 'STM32F4 Discovery',
  tagline: 'Experimental STM32F4 GPIO workbench backed by Renode STM32F4 Discovery support.',
  machineName: 'STM32F4 Discovery GPIO Workbench',
  renodePlatformPath: 'platforms/boards/stm32f4_discovery.repl',
  status: 'experimental',
  family: 'stm32f4',
  compiler: {
    gccArgs: ['-mcpu=cortex-m4', '-mthumb'],
  },
  runtime: {
    id: 'stm32f4-discovery',
    name: 'STM32F4 Discovery',
    machineName: 'STM32F4 Discovery GPIO Workbench',
    renodePlatformPath: 'platforms/boards/stm32f4_discovery.repl',
    compiler: {
      gccArgs: ['-mcpu=cortex-m4', '-mthumb'],
      linkerFileName: 'stm32f407vg.ld',
      linkerScript: STM32_MODERN_LINKER_SCRIPT('1024K', '128K'),
    },
    gpio: {
      registerModel: 'stm32-modern',
      portBaseAddress: 0x40020000,
      portStride: 0x400,
      portClockBitOffset: 0,
      rccBaseAddress: 0x40023800,
      rccEnableRegisterOffset: 0x30,
      rccEnableRegisterName: 'RCC_AHB1ENR',
    },
  },
  connectors: {
    all: STM32F4_DISCOVERY_CONNECTORS,
    left: [STM32F4_GPIOA_CONNECTOR],
    right: [STM32F4_GPIOD_CONNECTOR],
    leftMorpho: null,
    rightMorpho: null,
    selectablePads: STM32F4_DISCOVERY_CONNECTORS.flatMap((connector) => connector.pins).filter((pad) => pad.selectable),
  },
  visual: {
    connectorFrames: {
      F4A: { x: 128, y: 50, width: 90, layout: 'single' },
      F4D: { x: 542, y: 50, width: 90, layout: 'single' },
    },
    onboardFeatures: [
      { label: 'B1', detail: 'PA0 User Button' },
      { label: 'LD3', detail: 'PD13 Orange LED' },
      { label: 'LD4', detail: 'PD12 Green LED' },
      { label: 'LD5', detail: 'PD14 Red LED' },
      { label: 'LD6', detail: 'PD15 Blue LED' },
    ],
    canvas: NUCLEO_H753ZI_BOARD_SCHEMA.visual.canvas,
  },
  teaching: {
    curatedPadIds: ['F4A-2', 'F4A-3', 'F4A-4', 'F4A-5', 'F4A-6', 'F4A-7', 'F4D-1', 'F4D-2', 'F4D-3', 'F4D-4'],
  },
};

export const STM32F103_GPIO_LAB_BOARD_SCHEMA: BoardSchema = {
  id: 'stm32f103-gpio-lab',
  name: 'STM32F103 GPIO Lab',
  tagline: 'Experimental STM32F1 teaching board using Renode STM32F103 CPU platform and common Blue Pill-style pins.',
  machineName: 'STM32F103 GPIO Workbench',
  renodePlatformPath: 'platforms/cpus/stm32f103.repl',
  status: 'experimental',
  family: 'stm32f1',
  compiler: {
    gccArgs: ['-mcpu=cortex-m3', '-mthumb'],
  },
  runtime: {
    id: 'stm32f103-gpio-lab',
    name: 'STM32F103 GPIO Lab',
    machineName: 'STM32F103 GPIO Workbench',
    renodePlatformPath: 'platforms/cpus/stm32f103.repl',
    compiler: {
      gccArgs: ['-mcpu=cortex-m3', '-mthumb'],
      linkerFileName: 'stm32f103.ld',
      linkerScript: STM32_MODERN_LINKER_SCRIPT('128K', '20K'),
    },
    gpio: {
      registerModel: 'stm32f1',
      portBaseAddress: 0x40010800,
      portStride: 0x400,
      portClockBitOffset: 2,
      rccBaseAddress: 0x40021000,
      rccEnableRegisterOffset: 0x18,
      rccEnableRegisterName: 'RCC_APB2ENR',
    },
  },
  connectors: {
    all: STM32F103_CONNECTORS,
    left: [STM32F103_GPIOA_CONNECTOR],
    right: [STM32F103_GPIOB_CONNECTOR],
    leftMorpho: null,
    rightMorpho: null,
    selectablePads: STM32F103_CONNECTORS.flatMap((connector) => connector.pins).filter((pad) => pad.selectable),
  },
  visual: {
    connectorFrames: {
      F1A: { x: 128, y: 50, width: 90, layout: 'single' },
      F1B: { x: 542, y: 50, width: 90, layout: 'single' },
    },
    onboardFeatures: [
      { label: 'LED', detail: 'PC13 common Blue Pill LED' },
      { label: 'USART1', detail: 'PA9 TX / PA10 RX' },
      { label: 'I2C1', detail: 'PB6 SCL / PB7 SDA' },
      { label: 'SPI1', detail: 'PA5 SCK / PA6 MISO / PA7 MOSI' },
    ],
    canvas: NUCLEO_H753ZI_BOARD_SCHEMA.visual.canvas,
  },
  teaching: {
    curatedPadIds: ['F1A-1', 'F1A-2', 'F1A-3', 'F1A-4', 'F1A-5', 'F1A-6', 'F1A-7', 'F1A-8', 'F1B-1', 'F1B-2', 'F1B-4', 'F1B-5'],
  },
};

export const BOARD_SCHEMAS: readonly BoardSchema[] = [
  NUCLEO_H753ZI_BOARD_SCHEMA,
  STM32F4_DISCOVERY_BOARD_SCHEMA,
  STM32F103_GPIO_LAB_BOARD_SCHEMA,
];

export const ACTIVE_BOARD_SCHEMA = NUCLEO_H753ZI_BOARD_SCHEMA;

export function getBoardSchema(boardId: string | null | undefined): BoardSchema {
  return BOARD_SCHEMAS.find((board) => board.id === boardId) ?? ACTIVE_BOARD_SCHEMA;
}
