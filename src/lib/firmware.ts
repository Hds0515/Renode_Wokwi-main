export const DEFAULT_BRIDGE_PORT = 9001;
export const DEFAULT_GDB_PORT = 3333;

const PORT_BASE_ADDRESS = 0x58020000;
const PORT_STRIDE = 0x400;
const GPIO_PORT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;
const NUCLEO_REPL_PATH = 'platforms/boards/nucleo_h753zi.repl';
const MACHINE_NAME = 'NUCLEO-H753ZI GPIO Workbench';

const RESERVED_MCU_PINS = new Map<string, string>([
  ['PB0', 'Reserved by on-board LD1 (green LED).'],
  ['PE1', 'Reserved by on-board LD2 (yellow LED).'],
  ['PB14', 'Reserved by on-board LD3 (red LED).'],
  ['PC13', 'Reserved by on-board B1 USER button.'],
  ['PA13', 'Reserved by the ST-LINK SWDIO header.'],
  ['PA14', 'Reserved by the ST-LINK SWCLK header.'],
]);

type ConnectorPlacement = 'morpho-left' | 'left' | 'right' | 'morpho-right';
type ConnectorLayout = 'single' | 'dual';
type PadRole = 'gpio' | 'power' | 'ground' | 'control' | 'reserved';
type PadColumn = 'single' | 'odd' | 'even';

export type GpioPortLetter = (typeof GPIO_PORT_LETTERS)[number];

export type DemoBoardPad = {
  id: string;
  connectorId: string;
  connectorTitle: string;
  connectorPlacement: ConnectorPlacement;
  connectorLayout: ConnectorLayout;
  pinNumber: number;
  pinLabel: string;
  mcuPinId: string | null;
  signalName: string;
  note: string | null;
  role: PadRole;
  column: PadColumn;
  selectable: boolean;
  blockedReason: string | null;
};

export type DemoBoardConnector = {
  id: string;
  title: string;
  subtitle: string;
  placement: ConnectorPlacement;
  layout: ConnectorLayout;
  pins: DemoBoardPad[];
};

export type DemoBoardPin = {
  id: string;
  portLetter: GpioPortLetter;
  portIndex: number;
  number: number;
  baseAddress: number;
};

export type DemoPeripheralKind = 'button' | 'led';
export type DemoPeripheralTemplateKind = 'button' | 'led' | 'buzzer' | 'rgb-led';

export type DemoPeripheral = {
  id: string;
  kind: DemoPeripheralKind;
  label: string;
  padId: string | null;
  sourcePeripheralId: string | null;
  templateKind?: DemoPeripheralTemplateKind;
  groupId?: string | null;
  groupLabel?: string | null;
  endpointId?: string | null;
  endpointLabel?: string | null;
  accentColor?: string | null;
};

export type DemoPeripheralManifestEntry = {
  id: string;
  kind: DemoPeripheralKind;
  label: string;
  renodeName: string;
  gpioPortName: string;
  gpioNumber: number;
  mcuPinId: string;
};

export type DemoWiring = {
  peripherals: DemoPeripheral[];
};

type SingleConnectorPinDefinition = {
  pinNumber: number;
  pinLabel: string;
  mcuPinId?: string | null;
  signalName?: string;
  note?: string;
};

type SingleConnectorDefinition = {
  id: string;
  title: string;
  subtitle: string;
  placement: ConnectorPlacement;
  pins: SingleConnectorPinDefinition[];
};

type DualConnectorPinDefinition = {
  pinNumber: number;
  pinLabel: string;
  signalName?: string;
  note?: string;
};

type DualConnectorDefinition = {
  id: string;
  title: string;
  subtitle: string;
  placement: ConnectorPlacement;
  oddPins: DualConnectorPinDefinition[];
  evenPins: DualConnectorPinDefinition[];
};

function normalizeMcuPinId(candidate?: string | null): string | null {
  if (!candidate) {
    return null;
  }

  const normalized = candidate.trim().toUpperCase();
  if (!/^P[A-K](?:1[0-5]|[0-9])$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function detectRole(pinLabel: string, mcuPinId: string | null): PadRole {
  const normalizedLabel = pinLabel.trim().toUpperCase();
  if (mcuPinId) {
    return RESERVED_MCU_PINS.has(mcuPinId) ? 'reserved' : 'gpio';
  }
  if (normalizedLabel.includes('GND')) {
    return 'ground';
  }
  if (
    normalizedLabel.includes('3V3') ||
    normalizedLabel.includes('5V') ||
    normalizedLabel.includes('VDD') ||
    normalizedLabel.includes('VIN') ||
    normalizedLabel.includes('VBAT') ||
    normalizedLabel.includes('VREF') ||
    normalizedLabel.includes('VDDA') ||
    normalizedLabel.includes('IOREF')
  ) {
    return 'power';
  }

  return 'control';
}

function createPad(
  connector: Pick<DemoBoardConnector, 'id' | 'title' | 'placement'> & { layout: ConnectorLayout },
  definition: SingleConnectorPinDefinition,
  column: PadColumn
): DemoBoardPad {
  const mcuPinId = normalizeMcuPinId(definition.mcuPinId ?? definition.pinLabel);
  const blockedReason = mcuPinId ? RESERVED_MCU_PINS.get(mcuPinId) ?? null : null;
  const role = detectRole(definition.pinLabel, mcuPinId);

  return {
    id: `${connector.id}-${definition.pinNumber}`,
    connectorId: connector.id,
    connectorTitle: connector.title,
    connectorPlacement: connector.placement,
    connectorLayout: connector.layout,
    pinNumber: definition.pinNumber,
    pinLabel: definition.pinLabel,
    mcuPinId,
    signalName: definition.signalName ?? definition.pinLabel,
    note: definition.note ?? null,
    role,
    column,
    selectable: Boolean(mcuPinId && !blockedReason),
    blockedReason,
  };
}

function buildSingleConnector(definition: SingleConnectorDefinition): DemoBoardConnector {
  return {
    id: definition.id,
    title: definition.title,
    subtitle: definition.subtitle,
    placement: definition.placement,
    layout: 'single',
    pins: definition.pins.map((pin) =>
      createPad(
        {
          id: definition.id,
          title: definition.title,
          placement: definition.placement,
          layout: 'single',
        },
        pin,
        'single'
      )
    ),
  };
}

function buildDualConnector(definition: DualConnectorDefinition): DemoBoardConnector {
  const oddPins = definition.oddPins.map((pin) =>
    createPad(
      {
        id: definition.id,
        title: definition.title,
        placement: definition.placement,
        layout: 'dual',
      },
      pin,
      'odd'
    )
  );
  const evenPins = definition.evenPins.map((pin) =>
    createPad(
      {
        id: definition.id,
        title: definition.title,
        placement: definition.placement,
        layout: 'dual',
      },
      pin,
      'even'
    )
  );

  return {
    id: definition.id,
    title: definition.title,
    subtitle: definition.subtitle,
    placement: definition.placement,
    layout: 'dual',
    pins: [...oddPins, ...evenPins].sort((left, right) => left.pinNumber - right.pinNumber),
  };
}

const NUCLEO_ZIO_CONNECTORS: DemoBoardConnector[] = [
  buildSingleConnector({
    id: 'CN7',
    title: 'CN7',
    subtitle: 'Zio digital / SPI / USART header',
    placement: 'left',
    pins: [
      { pinNumber: 1, pinLabel: 'IOREF', signalName: 'Shield IO reference' },
      { pinNumber: 2, pinLabel: 'NRST', signalName: 'MCU reset' },
      { pinNumber: 3, pinLabel: '3V3', signalName: '3.3V rail' },
      { pinNumber: 4, pinLabel: '5V', signalName: '5V rail' },
      { pinNumber: 5, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 6, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 7, pinLabel: 'VIN', signalName: 'VIN' },
      { pinNumber: 8, pinLabel: 'D15/RX3', mcuPinId: 'PD9', signalName: 'USART3 RX / D15' },
      { pinNumber: 9, pinLabel: 'D14/TX3', mcuPinId: 'PD8', signalName: 'USART3 TX / D14' },
      { pinNumber: 10, pinLabel: 'D13/SCK', mcuPinId: 'PA5', signalName: 'SPI1 SCK / TIM2_CH1' },
      { pinNumber: 11, pinLabel: 'D12/MISO', mcuPinId: 'PA6', signalName: 'SPI1 MISO / TIM3_CH1' },
      {
        pinNumber: 12,
        pinLabel: 'D11/MOSI',
        mcuPinId: 'PA7',
        signalName: 'SPI1 MOSI / TIM1_CH1N',
        note: 'Shared with RMII_CRS_DV on Ethernet-capable shields.',
      },
      { pinNumber: 13, pinLabel: 'D10/CS', mcuPinId: 'PD14', signalName: 'SPI chip select / TIM4_CH3' },
      { pinNumber: 14, pinLabel: 'D9/PWM', mcuPinId: 'PF15', signalName: 'TIM1_CH1 / D9' },
      { pinNumber: 15, pinLabel: 'D8', mcuPinId: 'PF14', signalName: 'GPIO / D8' },
      { pinNumber: 16, pinLabel: 'D7', mcuPinId: 'PF13', signalName: 'GPIO / D7' },
      { pinNumber: 17, pinLabel: 'D6/PWM', mcuPinId: 'PG14', signalName: 'TIM1_CH2 / D6' },
      { pinNumber: 18, pinLabel: 'D5/PWM', mcuPinId: 'PE11', signalName: 'TIM1_CH2N / D5' },
      { pinNumber: 19, pinLabel: 'D4/PWM', mcuPinId: 'PE9', signalName: 'TIM1_CH1 / D4' },
      { pinNumber: 20, pinLabel: 'D3/PWM', mcuPinId: 'PF3', signalName: 'TIM2_CH3 / D3' },
    ],
  }),
  buildSingleConnector({
    id: 'CN8',
    title: 'CN8',
    subtitle: 'Zio high-number digital header',
    placement: 'left',
    pins: [
      { pinNumber: 1, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 2, pinLabel: 'D43', mcuPinId: 'PC8', signalName: 'GPIO / D43' },
      { pinNumber: 3, pinLabel: 'IOREF', signalName: 'Shield IO reference' },
      { pinNumber: 4, pinLabel: 'D44', mcuPinId: 'PC9', signalName: 'GPIO / D44' },
      { pinNumber: 5, pinLabel: 'NRST', signalName: 'MCU reset' },
      { pinNumber: 6, pinLabel: 'D45', mcuPinId: 'PC10', signalName: 'USART3 TX / D45' },
      { pinNumber: 7, pinLabel: '3V3', signalName: '3.3V rail' },
      { pinNumber: 8, pinLabel: 'D46', mcuPinId: 'PC11', signalName: 'USART3 RX / D46' },
      { pinNumber: 9, pinLabel: '5V', signalName: '5V rail' },
      { pinNumber: 10, pinLabel: 'D47', mcuPinId: 'PC12', signalName: 'GPIO / D47' },
      { pinNumber: 11, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 12, pinLabel: 'D48', mcuPinId: 'PD2', signalName: 'GPIO / D48' },
      { pinNumber: 13, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 14, pinLabel: 'D49', mcuPinId: 'PG2', signalName: 'GPIO / D49' },
      { pinNumber: 15, pinLabel: 'VIN', signalName: 'VIN' },
      { pinNumber: 16, pinLabel: 'D50', mcuPinId: 'PG3', signalName: 'GPIO / D50' },
    ],
  }),
  buildSingleConnector({
    id: 'CN9',
    title: 'CN9',
    subtitle: 'Zio analog / extended digital header',
    placement: 'right',
    pins: [
      { pinNumber: 1, pinLabel: 'A0', mcuPinId: 'PA3', signalName: 'ADC1 INP15 / USART2 RX' },
      { pinNumber: 2, pinLabel: 'A1', mcuPinId: 'PC0', signalName: 'ADC123 INP10' },
      { pinNumber: 3, pinLabel: 'A2', mcuPinId: 'PC3', signalName: 'ADC12 INP13' },
      { pinNumber: 4, pinLabel: 'A3', mcuPinId: 'PB1', signalName: 'ADC12 INP5 / TIM8 CH3N' },
      {
        pinNumber: 5,
        pinLabel: 'A4',
        mcuPinId: 'PB9',
        signalName: 'I2C1 SDA / A4',
        note: 'ADC alternative PC2 is available only with solder-bridge changes.',
      },
      {
        pinNumber: 6,
        pinLabel: 'A5',
        mcuPinId: 'PB8',
        signalName: 'I2C1 SCL / A5',
        note: 'ADC alternative PF10 is available only with solder-bridge changes.',
      },
      { pinNumber: 7, pinLabel: 'A6', mcuPinId: 'PF4', signalName: 'ADC3 INP14 / A6' },
      { pinNumber: 8, pinLabel: 'A7', mcuPinId: 'PF5', signalName: 'ADC3 INP15 / A7' },
      { pinNumber: 9, pinLabel: 'A8', mcuPinId: 'PF10', signalName: 'GPIO / A8' },
      { pinNumber: 10, pinLabel: 'D38', mcuPinId: 'PE15', signalName: 'TIM1 BKIN / D38' },
      { pinNumber: 11, pinLabel: 'D39', mcuPinId: 'PF11', signalName: 'GPIO / D39' },
      { pinNumber: 12, pinLabel: 'D40', mcuPinId: 'PF12', signalName: 'GPIO / D40' },
      { pinNumber: 13, pinLabel: 'D41', mcuPinId: 'PD15', signalName: 'TIM4 CH4 / D41' },
      { pinNumber: 14, pinLabel: 'D42', mcuPinId: 'PE13', signalName: 'TIM1 CH3N / D42' },
      { pinNumber: 15, pinLabel: 'D2', mcuPinId: 'PF15', signalName: 'GPIO / D2' },
      { pinNumber: 16, pinLabel: 'D1/TX', mcuPinId: 'PA9', signalName: 'USART1 TX / D1' },
      { pinNumber: 17, pinLabel: 'D0/RX', mcuPinId: 'PA10', signalName: 'USART1 RX / D0' },
      { pinNumber: 18, pinLabel: 'D15', mcuPinId: 'PG13', signalName: 'GPIO / D15' },
      { pinNumber: 19, pinLabel: 'D14', mcuPinId: 'PB13', signalName: 'SPI2 SCK / D14' },
      { pinNumber: 20, pinLabel: 'D13', mcuPinId: 'PB12', signalName: 'GPIO / D13' },
      { pinNumber: 21, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 22, pinLabel: 'AREF', signalName: 'Analog reference' },
      { pinNumber: 23, pinLabel: 'D16', mcuPinId: 'PD6', signalName: 'USART2 RX / D16' },
      { pinNumber: 24, pinLabel: 'D17', mcuPinId: 'PD5', signalName: 'USART2 TX / D17' },
      { pinNumber: 25, pinLabel: 'D18', mcuPinId: 'PD4', signalName: 'GPIO / D18' },
      { pinNumber: 26, pinLabel: 'D19', mcuPinId: 'PD7', signalName: 'GPIO / D19' },
      { pinNumber: 27, pinLabel: 'D20', mcuPinId: 'PB3', signalName: 'SPI1 SCK / D20' },
      { pinNumber: 28, pinLabel: 'D21', mcuPinId: 'PB5', signalName: 'SPI1 MOSI / D21' },
      { pinNumber: 29, pinLabel: 'D22', mcuPinId: 'PB4', signalName: 'SPI1 MISO / D22' },
      { pinNumber: 30, pinLabel: 'D23', mcuPinId: 'PB10', signalName: 'GPIO / D23' },
    ],
  }),
  buildSingleConnector({
    id: 'CN10',
    title: 'CN10',
    subtitle: 'Zio power / PWM / SPI header',
    placement: 'right',
    pins: [
      { pinNumber: 1, pinLabel: 'AVDD', signalName: 'Analog 3.3V rail' },
      { pinNumber: 2, pinLabel: 'AGND', signalName: 'Analog ground' },
      { pinNumber: 3, pinLabel: 'D7', mcuPinId: 'PG12', signalName: 'GPIO / D7' },
      { pinNumber: 4, pinLabel: 'D8', mcuPinId: 'PG10', signalName: 'GPIO / D8' },
      { pinNumber: 5, pinLabel: 'D9/PWM', mcuPinId: 'PA3', signalName: 'TIM15 CH1 / D9' },
      { pinNumber: 6, pinLabel: 'D10/PWM', mcuPinId: 'PB6', signalName: 'TIM16 CH1N / D10' },
      { pinNumber: 7, pinLabel: 'D11/MOSI', mcuPinId: 'PA7', signalName: 'SPI1 MOSI / D11' },
      { pinNumber: 8, pinLabel: 'D12/MISO', mcuPinId: 'PA6', signalName: 'SPI1 MISO / D12' },
      { pinNumber: 9, pinLabel: 'D13/SCK', mcuPinId: 'PA5', signalName: 'SPI1 SCK / D13' },
      { pinNumber: 10, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 11, pinLabel: 'D14', mcuPinId: 'PB9', signalName: 'GPIO / D14' },
      { pinNumber: 12, pinLabel: 'D15', mcuPinId: 'PB8', signalName: 'GPIO / D15' },
      { pinNumber: 13, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 14, pinLabel: 'D16', mcuPinId: 'PC6', signalName: 'GPIO / D16' },
      { pinNumber: 15, pinLabel: 'D17', mcuPinId: 'PA15', signalName: 'GPIO / D17' },
      { pinNumber: 16, pinLabel: 'D18', mcuPinId: 'PC7', signalName: 'GPIO / D18' },
      { pinNumber: 17, pinLabel: 'D19', mcuPinId: 'PB5', signalName: 'GPIO / D19' },
      { pinNumber: 18, pinLabel: 'D20', mcuPinId: 'PB4', signalName: 'GPIO / D20' },
      { pinNumber: 19, pinLabel: 'D21', mcuPinId: 'PB10', signalName: 'GPIO / D21' },
      { pinNumber: 20, pinLabel: 'D22', mcuPinId: 'PA8', signalName: 'MCO / D22' },
      { pinNumber: 21, pinLabel: 'D23', mcuPinId: 'PA9', signalName: 'USART1 TX / D23' },
      { pinNumber: 22, pinLabel: 'D24', mcuPinId: 'PC7', signalName: 'GPIO / D24' },
      { pinNumber: 23, pinLabel: 'D25', mcuPinId: 'PB2', signalName: 'GPIO / D25' },
      { pinNumber: 24, pinLabel: 'D26', mcuPinId: 'PB1', signalName: 'ADC12 INP5 / D26' },
      { pinNumber: 25, pinLabel: 'D27', mcuPinId: 'PE8', signalName: 'GPIO / D27' },
      { pinNumber: 26, pinLabel: 'D28', mcuPinId: 'PE10', signalName: 'GPIO / D28' },
      { pinNumber: 27, pinLabel: 'D29', mcuPinId: 'PE12', signalName: 'GPIO / D29' },
      { pinNumber: 28, pinLabel: 'D30', mcuPinId: 'PE14', signalName: 'GPIO / D30' },
      { pinNumber: 29, pinLabel: 'D31', mcuPinId: 'PE15', signalName: 'GPIO / D31' },
      { pinNumber: 30, pinLabel: 'D32', mcuPinId: 'PE7', signalName: 'GPIO / D32' },
      { pinNumber: 31, pinLabel: 'D33', mcuPinId: 'PE9', signalName: 'GPIO / D33' },
      { pinNumber: 32, pinLabel: 'D34', mcuPinId: 'PG14', signalName: 'GPIO / D34' },
      { pinNumber: 33, pinLabel: 'D35', mcuPinId: 'PG9', signalName: 'GPIO / D35' },
      { pinNumber: 34, pinLabel: 'D36', mcuPinId: 'PG13', signalName: 'GPIO / D36' },
    ],
  }),
];

const NUCLEO_MORPHO_CONNECTORS: DemoBoardConnector[] = [
  buildDualConnector({
    id: 'CN11',
    title: 'CN11',
    subtitle: 'ST Morpho left header',
    placement: 'morpho-left',
    oddPins: [
      { pinNumber: 1, pinLabel: 'PC10', signalName: 'USART3 TX / SPI3 SCK' },
      { pinNumber: 3, pinLabel: 'PC12', signalName: 'UART5 TX / SPI3 MOSI' },
      { pinNumber: 5, pinLabel: '3V3', signalName: '3.3V rail' },
      { pinNumber: 7, pinLabel: 'BOOT0', signalName: 'BOOT0' },
      { pinNumber: 9, pinLabel: 'PF6', signalName: 'ADC3 INP4 / TIM16 CH1' },
      { pinNumber: 11, pinLabel: 'PF7', signalName: 'ADC3 INP3 / TIM17 CH1' },
      { pinNumber: 13, pinLabel: 'PA13', signalName: 'SWDIO' },
      { pinNumber: 15, pinLabel: 'PA14', signalName: 'SWCLK' },
      { pinNumber: 17, pinLabel: 'PH0', signalName: 'OSC IN' },
      { pinNumber: 19, pinLabel: 'PC2', signalName: 'ADC123 INP12' },
      { pinNumber: 21, pinLabel: 'PC3', signalName: 'ADC12 INP13' },
      { pinNumber: 23, pinLabel: 'PC13', signalName: 'B1 USER button' },
      { pinNumber: 25, pinLabel: 'PF10', signalName: 'ADC3 INP8' },
      { pinNumber: 27, pinLabel: 'PE9', signalName: 'TIM1 CH1' },
      { pinNumber: 29, pinLabel: 'PF3', signalName: 'ADC3 INP9 / TIM2 CH3' },
      { pinNumber: 31, pinLabel: 'PE13', signalName: 'TIM1 CH3N' },
      { pinNumber: 33, pinLabel: 'FDCAN_RX', signalName: 'Shared FDCAN RX net' },
      { pinNumber: 35, pinLabel: 'FDCAN_TX', signalName: 'Shared FDCAN TX net' },
      { pinNumber: 37, pinLabel: 'PB13', signalName: 'SPI2 SCK' },
      { pinNumber: 39, pinLabel: 'PB14', signalName: 'On-board LD3 red LED' },
      { pinNumber: 41, pinLabel: 'PB15', signalName: 'SPI2 MOSI / TIM1 CH3N' },
      { pinNumber: 43, pinLabel: 'PA8', signalName: 'MCO / TIM1 CH1' },
      { pinNumber: 45, pinLabel: 'PA9', signalName: 'USART1 TX / TIM1 CH2' },
      { pinNumber: 47, pinLabel: 'PA10', signalName: 'USART1 RX / TIM1 CH3' },
      { pinNumber: 49, pinLabel: 'PA11', signalName: 'USB DM / USART1 CTS' },
      { pinNumber: 51, pinLabel: 'PB12', signalName: 'SPI2 NSS' },
      { pinNumber: 53, pinLabel: 'PB1', signalName: 'ADC12 INP5 / TIM8 CH3N' },
      { pinNumber: 55, pinLabel: 'PB2', signalName: 'GPIO' },
      { pinNumber: 57, pinLabel: 'PE7', signalName: 'TIM1 ETR' },
      { pinNumber: 59, pinLabel: 'PE8', signalName: 'TIM1 CH1N' },
      { pinNumber: 61, pinLabel: 'PE10', signalName: 'TIM1 CH2N' },
      { pinNumber: 63, pinLabel: 'PE12', signalName: 'SPI4 SCK / TIM1 CH3N' },
      { pinNumber: 65, pinLabel: 'PE14', signalName: 'TIM1 CH4' },
      { pinNumber: 67, pinLabel: 'PB10', signalName: 'I2C2 SCL / TIM2 CH3' },
      { pinNumber: 69, pinLabel: 'PD9', signalName: 'USART3 RX / D15' },
    ],
    evenPins: [
      { pinNumber: 2, pinLabel: 'PC11', signalName: 'USART3 RX / SPI3 MISO' },
      { pinNumber: 4, pinLabel: 'PD2', signalName: 'UART5 RX / SDMMC CMD' },
      { pinNumber: 6, pinLabel: '5V', signalName: '5V rail' },
      { pinNumber: 8, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 10, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 12, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 14, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 16, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 18, pinLabel: 'PH1', signalName: 'OSC OUT' },
      { pinNumber: 20, pinLabel: 'PC1', signalName: 'ADC123 INP11' },
      { pinNumber: 22, pinLabel: 'PC0', signalName: 'ADC123 INP10' },
      { pinNumber: 24, pinLabel: 'VBAT', signalName: 'Backup battery input' },
      { pinNumber: 26, pinLabel: 'PF5', signalName: 'ADC3 INP15' },
      { pinNumber: 28, pinLabel: 'PF4', signalName: 'ADC3 INP14' },
      { pinNumber: 30, pinLabel: 'PF1', signalName: 'ADC3 INP7' },
      { pinNumber: 32, pinLabel: 'PF2', signalName: 'ADC3 INP10' },
      { pinNumber: 34, pinLabel: 'VREF+', signalName: 'Analog reference' },
      { pinNumber: 36, pinLabel: 'PC4', signalName: 'ADC12 INP4' },
      { pinNumber: 38, pinLabel: 'PB0', signalName: 'On-board LD1 green LED' },
      { pinNumber: 40, pinLabel: 'PE1', signalName: 'On-board LD2 yellow LED' },
      { pinNumber: 42, pinLabel: 'PE0', signalName: 'TIM4 ETR' },
      { pinNumber: 44, pinLabel: 'PB9', signalName: 'I2C1 SDA / TIM17 CH1' },
      { pinNumber: 46, pinLabel: 'VDD', signalName: '3.3V rail' },
      { pinNumber: 48, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 50, pinLabel: 'PB8', signalName: 'I2C1 SCL / TIM16 CH1' },
      { pinNumber: 52, pinLabel: 'PB5', signalName: 'SPI1 MOSI / GPIO' },
      { pinNumber: 54, pinLabel: 'PB4', signalName: 'SPI1 MISO / GPIO' },
      { pinNumber: 56, pinLabel: 'PB3', signalName: 'SPI1 SCK / SWO' },
      { pinNumber: 58, pinLabel: 'PD7', signalName: 'USART2 CK / GPIO' },
      { pinNumber: 60, pinLabel: 'PD6', signalName: 'USART2 RX / GPIO' },
      { pinNumber: 62, pinLabel: 'PD5', signalName: 'USART2 TX / GPIO' },
      { pinNumber: 64, pinLabel: 'PD4', signalName: 'GPIO' },
      { pinNumber: 66, pinLabel: 'PD3', signalName: 'USART2 CTS / GPIO' },
      { pinNumber: 68, pinLabel: 'PG15', signalName: 'USART6 CTS / GPIO' },
      { pinNumber: 70, pinLabel: 'PG11', signalName: 'ETH RMII_TX_EN / GPIO' },
    ],
  }),
  buildDualConnector({
    id: 'CN12',
    title: 'CN12',
    subtitle: 'ST Morpho right header',
    placement: 'morpho-right',
    oddPins: [
      { pinNumber: 1, pinLabel: 'PC9', signalName: 'GPIO / D44' },
      { pinNumber: 3, pinLabel: 'PB8', signalName: 'I2C1 SCL / D15' },
      { pinNumber: 5, pinLabel: 'PB6', signalName: 'USART1 TX / TIM16 CH1N' },
      { pinNumber: 7, pinLabel: 'PB7', signalName: 'USART1 RX / TIM17 CH1N' },
      { pinNumber: 9, pinLabel: 'BOOT1', signalName: 'BOOT1' },
      { pinNumber: 11, pinLabel: 'AGND', signalName: 'Analog ground' },
      { pinNumber: 13, pinLabel: 'GND', signalName: 'Ground' },
      { pinNumber: 15, pinLabel: 'PG13', signalName: 'GPIO / D15 / ETH TXD0' },
      { pinNumber: 17, pinLabel: 'PD10', signalName: 'USART3 CK / GPIO' },
      { pinNumber: 19, pinLabel: 'PG12', signalName: 'GPIO / D7 / ETH TXD1' },
      { pinNumber: 21, pinLabel: 'PG10', signalName: 'GPIO / D8 / ETH RXD2' },
      { pinNumber: 23, pinLabel: 'PA4', signalName: 'ADC12 INP18 / SPI1 NSS' },
      { pinNumber: 25, pinLabel: 'PA7', signalName: 'SPI1 MOSI / D11' },
      { pinNumber: 27, pinLabel: 'PA6', signalName: 'SPI1 MISO / D12' },
      { pinNumber: 29, pinLabel: 'PA5', signalName: 'SPI1 SCK / D13' },
      { pinNumber: 31, pinLabel: 'PG14', signalName: 'GPIO / D6 / USART6 TX' },
      { pinNumber: 33, pinLabel: 'PB12', signalName: 'SPI2 NSS / GPIO' },
      { pinNumber: 35, pinLabel: 'PA2', signalName: 'USART2 TX / GPIO' },
      { pinNumber: 37, pinLabel: 'PA3', signalName: 'USART2 RX / GPIO / A0' },
      { pinNumber: 39, pinLabel: 'PA0', signalName: 'ADC12 INP16 / WKUP' },
      { pinNumber: 41, pinLabel: 'PA1', signalName: 'ADC12 INP17 / ETH REFCLK' },
      { pinNumber: 43, pinLabel: 'PA12', signalName: 'USB DP / GPIO' },
      { pinNumber: 45, pinLabel: 'PA15', signalName: 'JTDI / SPI1 NSS / D17' },
      { pinNumber: 47, pinLabel: 'PC7', signalName: 'GPIO / D18 / USART6 RX' },
      { pinNumber: 49, pinLabel: 'PG2', signalName: 'GPIO / D49' },
      { pinNumber: 51, pinLabel: 'PG3', signalName: 'GPIO / D50' },
      { pinNumber: 53, pinLabel: 'PD14', signalName: 'TIM4 CH3 / D10' },
      { pinNumber: 55, pinLabel: 'PE15', signalName: 'TIM1 BKIN / D38' },
      { pinNumber: 57, pinLabel: 'PE9', signalName: 'TIM1 CH1 / D4' },
      { pinNumber: 59, pinLabel: 'PE11', signalName: 'TIM1 CH2N / D5' },
      { pinNumber: 61, pinLabel: 'PF13', signalName: 'GPIO / D7' },
      { pinNumber: 63, pinLabel: 'PF14', signalName: 'GPIO / D8' },
      { pinNumber: 65, pinLabel: 'PF15', signalName: 'TIM1 CH1 / D9' },
      { pinNumber: 67, pinLabel: 'PE13', signalName: 'TIM1 CH3N / D42' },
      { pinNumber: 69, pinLabel: 'PG4', signalName: 'USART6 RTS / GPIO' },
    ],
    evenPins: [
      { pinNumber: 2, pinLabel: 'PC8', signalName: 'GPIO / D43' },
      { pinNumber: 4, pinLabel: 'PC6', signalName: 'GPIO / D16 / USART6 TX' },
      { pinNumber: 6, pinLabel: 'PC5', signalName: 'ADC12 INP8 / ETH RXD1' },
      { pinNumber: 8, pinLabel: 'U5V', signalName: 'USB 5V input' },
      { pinNumber: 10, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 12, pinLabel: 'AVDD', signalName: 'Analog 3.3V rail' },
      { pinNumber: 14, pinLabel: 'RST', signalName: 'MCU reset' },
      { pinNumber: 16, pinLabel: 'PH13', signalName: 'GPIO' },
      { pinNumber: 18, pinLabel: 'PH14', signalName: 'GPIO' },
      { pinNumber: 20, pinLabel: 'PH15', signalName: 'GPIO' },
      { pinNumber: 22, pinLabel: 'PC2', signalName: 'ADC123 INP12' },
      { pinNumber: 24, pinLabel: 'PC3', signalName: 'ADC12 INP13' },
      { pinNumber: 26, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 28, pinLabel: 'PD13', signalName: 'TIM4 CH2 / GPIO' },
      { pinNumber: 30, pinLabel: 'PD12', signalName: 'TIM4 CH1 / GPIO' },
      { pinNumber: 32, pinLabel: 'PD11', signalName: 'USART3 CTS / GPIO' },
      { pinNumber: 34, pinLabel: 'PG5', signalName: 'GPIO / USART6 TX' },
      { pinNumber: 36, pinLabel: 'PG8', signalName: 'ETH PTP PPS / GPIO' },
      { pinNumber: 38, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 40, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 42, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 44, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 46, pinLabel: 'NC', signalName: 'No connect' },
      { pinNumber: 48, pinLabel: 'PF12', signalName: 'GPIO / D40' },
      { pinNumber: 50, pinLabel: 'PE6', signalName: 'GPIO' },
      { pinNumber: 52, pinLabel: 'PE5', signalName: 'GPIO' },
      { pinNumber: 54, pinLabel: 'PE4', signalName: 'GPIO / TIM15 CH1N' },
      { pinNumber: 56, pinLabel: 'PE3', signalName: 'GPIO' },
      { pinNumber: 58, pinLabel: 'PE2', signalName: 'GPIO' },
      { pinNumber: 60, pinLabel: 'PF11', signalName: 'GPIO / D39' },
      { pinNumber: 62, pinLabel: 'PF2', signalName: 'ADC3 INP10' },
      { pinNumber: 64, pinLabel: 'PF1', signalName: 'ADC3 INP7' },
      { pinNumber: 66, pinLabel: 'PF0', signalName: 'ADC3 INP6 / RTC_TAMP1' },
      { pinNumber: 68, pinLabel: 'PC2', signalName: 'ADC123 INP12 / A4 alt' },
      { pinNumber: 70, pinLabel: 'PG6', signalName: 'GPIO / USART6 CTS' },
    ],
  }),
];

export const DEMO_CONNECTORS: DemoBoardConnector[] = [...NUCLEO_MORPHO_CONNECTORS, ...NUCLEO_ZIO_CONNECTORS];
export const DEMO_LEFT_CONNECTORS = DEMO_CONNECTORS.filter((connector) => connector.placement === 'left');
export const DEMO_RIGHT_CONNECTORS = DEMO_CONNECTORS.filter((connector) => connector.placement === 'right');
export const DEMO_LEFT_MORPHO_CONNECTOR =
  DEMO_CONNECTORS.find((connector) => connector.placement === 'morpho-left') ?? null;
export const DEMO_RIGHT_MORPHO_CONNECTOR =
  DEMO_CONNECTORS.find((connector) => connector.placement === 'morpho-right') ?? null;
export const DEMO_BOARD_PADS = DEMO_CONNECTORS.flatMap((connector) => connector.pins);
export const DEMO_SELECTABLE_PADS = DEMO_BOARD_PADS.filter((pad) => pad.selectable);

export const DEFAULT_DEMO_WIRING: DemoWiring = {
  peripherals: [
    {
      id: 'button-1',
      kind: 'button',
      label: 'Button 1',
      padId: 'CN10-3',
      sourcePeripheralId: null,
      templateKind: 'button',
      groupId: null,
      groupLabel: null,
      endpointId: 'signal',
      endpointLabel: 'SIG',
      accentColor: '#d946ef',
    },
    {
      id: 'led-1',
      kind: 'led',
      label: 'LED 1',
      padId: 'CN7-10',
      sourcePeripheralId: 'button-1',
      templateKind: 'led',
      groupId: null,
      groupLabel: null,
      endpointId: 'signal',
      endpointLabel: 'SIG',
      accentColor: '#f59e0b',
    },
  ],
};

export const MAX_PERIPHERALS = 12;

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-z0-9_]+/gi, '_');
}

export function getPeripheralTemplateKind(peripheral: DemoPeripheral): DemoPeripheralTemplateKind {
  if (peripheral.templateKind) {
    return peripheral.templateKind;
  }
  return peripheral.kind === 'button' ? 'button' : 'led';
}

function buildSinglePeripheral(
  templateKind: DemoPeripheralTemplateKind,
  ordinal: number,
  options?: Partial<DemoPeripheral>
): DemoPeripheral {
  const kind = templateKind === 'button' ? 'button' : 'led';
  const defaultLabel =
    templateKind === 'button'
      ? `Button ${ordinal}`
      : templateKind === 'buzzer'
        ? `Buzzer ${ordinal}`
        : `LED ${ordinal}`;
  const defaultEndpointLabel = templateKind === 'button' ? 'SIG' : templateKind === 'buzzer' ? 'OUT' : 'SIG';
  const defaultAccent =
    templateKind === 'button' ? '#d946ef' : templateKind === 'buzzer' ? '#14b8a6' : '#f59e0b';

  return {
    id: `${templateKind}-${ordinal}`,
    kind,
    label: options?.label ?? defaultLabel,
    padId: null,
    sourcePeripheralId: kind === 'led' ? options?.sourcePeripheralId ?? null : null,
    templateKind,
    groupId: null,
    groupLabel: null,
    endpointId: options?.endpointId ?? 'signal',
    endpointLabel: options?.endpointLabel ?? defaultEndpointLabel,
    accentColor: options?.accentColor ?? defaultAccent,
    ...options,
  };
}

export function createPeripheralTemplate(templateKind: DemoPeripheralTemplateKind, ordinal: number): DemoPeripheral[] {
  if (templateKind === 'rgb-led') {
    const groupId = `rgb-led-${ordinal}`;
    const groupLabel = `RGB LED ${ordinal}`;
    return [
      {
        ...buildSinglePeripheral('led', ordinal, {
          id: `${groupId}-r`,
          label: groupLabel,
          templateKind: 'rgb-led',
          groupId,
          groupLabel,
          endpointId: 'red',
          endpointLabel: 'RED',
          accentColor: '#ef4444',
        }),
      },
      {
        ...buildSinglePeripheral('led', ordinal, {
          id: `${groupId}-g`,
          label: groupLabel,
          templateKind: 'rgb-led',
          groupId,
          groupLabel,
          endpointId: 'green',
          endpointLabel: 'GREEN',
          accentColor: '#22c55e',
        }),
      },
      {
        ...buildSinglePeripheral('led', ordinal, {
          id: `${groupId}-b`,
          label: groupLabel,
          templateKind: 'rgb-led',
          groupId,
          groupLabel,
          endpointId: 'blue',
          endpointLabel: 'BLUE',
          accentColor: '#3b82f6',
        }),
      },
    ];
  }

  return [buildSinglePeripheral(templateKind, ordinal)];
}

export function createPeripheral(kind: DemoPeripheralKind, ordinal: number): DemoPeripheral {
  return createPeripheralTemplate(kind, ordinal)[0];
}

export function getPeripheralsByKind(wiring: DemoWiring, kind: DemoPeripheralKind): DemoPeripheral[] {
  return wiring.peripherals.filter((peripheral) => peripheral.kind === kind);
}

export function getConnectedPeripherals(wiring: DemoWiring, kind?: DemoPeripheralKind): DemoPeripheral[] {
  return wiring.peripherals.filter(
    (peripheral) => peripheral.padId && (kind ? peripheral.kind === kind : true)
  );
}

export function resolvePeripheral(peripheralId: string, wiring: DemoWiring): DemoPeripheral {
  const match = wiring.peripherals.find((peripheral) => peripheral.id === peripheralId);
  if (!match) {
    throw new Error(`Unknown peripheral id: ${peripheralId}`);
  }
  return match;
}

export function resolveConnectedPeripheralPad(peripheral: DemoPeripheral): DemoBoardPad {
  if (!peripheral.padId) {
    throw new Error(`Peripheral ${peripheral.id} is not connected to a board pad.`);
  }
  return resolveSelectablePad(peripheral.padId);
}

function resolvePeripheralPin(peripheral: DemoPeripheral): DemoBoardPin {
  const pad = resolveConnectedPeripheralPad(peripheral);
  return resolveMcuPin(pad.mcuPinId!);
}

export function buildPeripheralManifest(wiring: DemoWiring): DemoPeripheralManifestEntry[] {
  return getConnectedPeripherals(wiring).map((peripheral) => {
    const pin = resolvePeripheralPin(peripheral);
    const templateKind = getPeripheralTemplateKind(peripheral);
    const manifestLabel =
      templateKind === 'rgb-led' && peripheral.endpointLabel ? `${peripheral.label} ${peripheral.endpointLabel}` : peripheral.label;
    const renodeType = peripheral.kind === 'button' ? 'Button' : templateKind === 'buzzer' ? 'Buzzer' : 'Led';
    return {
      id: peripheral.id,
      kind: peripheral.kind,
      label: manifestLabel,
      renodeName: `external${renodeType}__${sanitizeIdentifier(peripheral.id)}`,
      gpioPortName: `gpioPort${pin.portLetter}`,
      gpioNumber: pin.number,
      mcuPinId: pin.id,
    };
  });
}

function formatHex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function resolveMcuPin(mcuPinId: string): DemoBoardPin {
  const normalized = normalizeMcuPinId(mcuPinId);
  if (!normalized) {
    throw new Error(`Unsupported MCU GPIO pin id: ${mcuPinId}`);
  }

  const portLetter = normalized[1] as GpioPortLetter;
  const number = Number(normalized.slice(2));
  const portIndex = GPIO_PORT_LETTERS.indexOf(portLetter);
  if (portIndex < 0) {
    throw new Error(`Unsupported MCU GPIO port: ${mcuPinId}`);
  }

  return {
    id: normalized,
    portLetter,
    portIndex,
    number,
    baseAddress: PORT_BASE_ADDRESS + portIndex * PORT_STRIDE,
  };
}

export function resolveBoardPad(padId: string): DemoBoardPad {
  const match = DEMO_BOARD_PADS.find((pad) => pad.id === padId);
  if (!match) {
    throw new Error(`Unknown board pad id: ${padId}`);
  }

  return match;
}

export function resolveSelectablePad(padId: string): DemoBoardPad {
  const pad = resolveBoardPad(padId);
  if (!pad.selectable || !pad.mcuPinId) {
    throw new Error(`Board pad ${padId} is not available for external GPIO wiring.`);
  }
  return pad;
}

export function describePad(pad: DemoBoardPad): string {
  const mcuPinSuffix = pad.mcuPinId ? ` / ${pad.mcuPinId}` : '';
  return `${pad.connectorTitle} pin ${pad.pinNumber} (${pad.pinLabel}${mcuPinSuffix})`;
}

export function describePeripheral(peripheral: DemoPeripheral): string {
  const padSummary = peripheral.padId ? describePad(resolveSelectablePad(peripheral.padId)) : 'not connected';
  const endpointSummary = peripheral.endpointLabel ? ` ${peripheral.endpointLabel}` : '';
  return `${peripheral.label}${endpointSummary} (${padSummary})`;
}

function buildPortEnableMaskExpression(pins: DemoBoardPin[]): string {
  const uniquePortIndexes = [...new Set(pins.map((pin) => pin.portIndex))];
  if (uniquePortIndexes.length === 0) {
    return '0u';
  }

  return uniquePortIndexes.map((portIndex) => `(1u << ${portIndex}u)`).join(' | ');
}

function resolveLedDriver(led: DemoPeripheral, wiring: DemoWiring): DemoPeripheral | null {
  const connectedButtons = getConnectedPeripherals(wiring, 'button');
  if (connectedButtons.length === 0) {
    return null;
  }

  const preferredButton = led.sourcePeripheralId
    ? connectedButtons.find((button) => button.id === led.sourcePeripheralId) ?? null
    : null;
  return preferredButton ?? connectedButtons[0];
}

export const DEFAULT_MAIN_SOURCE = generateDemoMainSource(DEFAULT_DEMO_WIRING);

export const DEFAULT_STARTUP_SOURCE = `typedef unsigned int uint32_t;

extern int main(void);

extern uint32_t _estack;
extern uint32_t _sidata;
extern uint32_t _sdata;
extern uint32_t _edata;
extern uint32_t _sbss;
extern uint32_t _ebss;

void Reset_Handler(void);
void Default_Handler(void);

void NMI_Handler(void) __attribute__((weak, alias("Default_Handler")));
void HardFault_Handler(void) __attribute__((weak, alias("Default_Handler")));
void MemManage_Handler(void) __attribute__((weak, alias("Default_Handler")));
void BusFault_Handler(void) __attribute__((weak, alias("Default_Handler")));
void UsageFault_Handler(void) __attribute__((weak, alias("Default_Handler")));
void SVC_Handler(void) __attribute__((weak, alias("Default_Handler")));
void DebugMon_Handler(void) __attribute__((weak, alias("Default_Handler")));
void PendSV_Handler(void) __attribute__((weak, alias("Default_Handler")));
void SysTick_Handler(void) __attribute__((weak, alias("Default_Handler")));

__attribute__((section(".isr_vector")))
void (*const vector_table[])(void) = {
    (void (*)(void))(&_estack),
    Reset_Handler,
    NMI_Handler,
    HardFault_Handler,
    MemManage_Handler,
    BusFault_Handler,
    UsageFault_Handler,
    0,
    0,
    0,
    0,
    SVC_Handler,
    DebugMon_Handler,
    0,
    PendSV_Handler,
    SysTick_Handler,
};

void Reset_Handler(void) {
    uint32_t *src = &_sidata;
    uint32_t *dst = &_sdata;

    while(dst < &_edata) {
        *dst++ = *src++;
    }

    dst = &_sbss;
    while(dst < &_ebss) {
        *dst++ = 0;
    }

    (void)main();

    while(1) {
    }
}

void Default_Handler(void) {
    while(1) {
    }
}
`;

export const DEFAULT_LINKER_FILENAME = 'stm32h753zi.ld';
export const DEFAULT_GCC_ARGS = ['-mcpu=cortex-m7', '-mthumb'];

export const DEFAULT_LINKER_SCRIPT = `ENTRY(Reset_Handler)

MEMORY
{
    FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 2048K
    RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 128K
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

export function generateDemoMainSource(wiring: DemoWiring): string {
  const connectedButtons = getConnectedPeripherals(wiring, 'button');
  const connectedLeds = getConnectedPeripherals(wiring, 'led');
  const buttonPins = connectedButtons.map((button) => resolvePeripheralPin(button));
  const ledPins = connectedLeds.map((led) => resolvePeripheralPin(led));
  const portEnableExpression = buildPortEnableMaskExpression([...buttonPins, ...ledPins]);

  const buttonConstants = connectedButtons
    .map((button, index) => {
      const pin = buttonPins[index];
      const pad = resolveConnectedPeripheralPad(button);
      return [
        `// ${button.label}: ${describePad(pad)}`,
        `#define BUTTON_${index}_GPIO_BASE ${formatHex(pin.baseAddress)}u`,
        `#define BUTTON_${index}_PIN ${pin.number}u`,
      ].join('\n');
    })
    .join('\n\n');

  const ledConstants = connectedLeds
    .map((led, index) => {
      const pin = ledPins[index];
      const pad = resolveConnectedPeripheralPad(led);
      const driver = resolveLedDriver(led, wiring);
      const driverSummary = driver ? driver.label : 'no assigned button';
      return [
        `// ${led.label}: ${describePad(pad)} (driven by ${driverSummary})`,
        `#define LED_${index}_GPIO_BASE ${formatHex(pin.baseAddress)}u`,
        `#define LED_${index}_PIN ${pin.number}u`,
      ].join('\n');
    })
    .join('\n\n');

  const configureLeds = connectedLeds
    .map((_led, index) => `    configure_output(LED_${index}_GPIO_BASE, LED_${index}_PIN);`)
    .join('\n');

  const configureButtons = connectedButtons
    .map((_button, index) => `    configure_input(BUTTON_${index}_GPIO_BASE, BUTTON_${index}_PIN);`)
    .join('\n');

  const buttonReads = connectedButtons
    .map((_button, index) => `        const int button_state_${index} = read_input(BUTTON_${index}_GPIO_BASE, BUTTON_${index}_PIN);`)
    .join('\n');

  const ledWrites = connectedLeds
    .map((led, index) => {
      const driver = resolveLedDriver(led, wiring);
      if (!driver) {
        return `        write_output(LED_${index}_GPIO_BASE, LED_${index}_PIN, 0);`;
      }
      const driverIndex = connectedButtons.findIndex((button) => button.id === driver.id);
      return `        write_output(LED_${index}_GPIO_BASE, LED_${index}_PIN, button_state_${driverIndex});`;
    })
    .join('\n');

  const wiringSummary = [
    ...connectedButtons.map((button) => `// Input  ${button.label}: ${describePeripheral(button)}`),
    ...connectedLeds.map((led) => {
      const driver = resolveLedDriver(led, wiring);
      return `// Output ${led.label}: ${describePeripheral(led)}${driver ? ` <= ${driver.label}` : ''}`;
    }),
  ].join('\n');

  const noButtonsNotice =
    connectedButtons.length === 0 ? '// No external buttons are connected. LEDs will stay low.\n' : '';
  const noLedsNotice =
    connectedLeds.length === 0 ? '// No external LEDs are connected. The loop still samples buttons.\n' : '';

  return `// Auto-generated demo firmware for the Renode NUCLEO-H753ZI workbench.
${wiringSummary || '// No peripherals are connected yet.'}

typedef unsigned int uint32_t;

#define RCC_BASE            0x58024400u
#define RCC_AHB4ENR         (*(volatile uint32_t *)(RCC_BASE + 0xE0u))

#define PERIPHERAL_PORT_ENABLE_MASK ${portEnableExpression}

${buttonConstants || '// No external button constants generated.'}

${ledConstants || '// No external LED constants generated.'}

#define GPIO_MODER(base)    (*(volatile uint32_t *)((base) + 0x00u))
#define GPIO_PUPDR(base)    (*(volatile uint32_t *)((base) + 0x0Cu))
#define GPIO_IDR(base)      (*(volatile uint32_t *)((base) + 0x10u))
#define GPIO_BSRR(base)     (*(volatile uint32_t *)((base) + 0x18u))

static void enable_gpio_clocks(void) {
    RCC_AHB4ENR |= PERIPHERAL_PORT_ENABLE_MASK;
}

static void configure_output(uint32_t base, uint32_t pin) {
    GPIO_MODER(base) &= ~(3u << (pin * 2u));
    GPIO_MODER(base) |=  (1u << (pin * 2u));
}

static void configure_input(uint32_t base, uint32_t pin) {
    GPIO_MODER(base) &= ~(3u << (pin * 2u));
    GPIO_PUPDR(base) &= ~(3u << (pin * 2u));
    GPIO_PUPDR(base) |=  (2u << (pin * 2u));
}

static int read_input(uint32_t base, uint32_t pin) {
    return (GPIO_IDR(base) & (1u << pin)) != 0;
}

static void write_output(uint32_t base, uint32_t pin, int on) {
    if(on) {
        GPIO_BSRR(base) = (1u << pin);
    } else {
        GPIO_BSRR(base) = (1u << (pin + 16u));
    }
}

int main(void) {
    enable_gpio_clocks();
${configureLeds || '    // No LED outputs connected.'}
${configureButtons || '    // No button inputs connected.'}

    while(1) {
${noButtonsNotice}${noLedsNotice}
${buttonReads || '        // No button states to sample.'}
${ledWrites || '        // No LED states to update.'}
    }
}
`;
}

export function generateBoardRepl(wiring: DemoWiring): string {
  const connectedButtons = getConnectedPeripherals(wiring, 'button');
  const connectedLeds = getConnectedPeripherals(wiring, 'led');

  const buttonBlocks = connectedButtons.map((button) => {
    const pin = resolvePeripheralPin(button);
    const pad = resolveConnectedPeripheralPad(button);
    const renodeName = `externalButton__${sanitizeIdentifier(button.id)}`;

    return [
      `// ${button.label}: ${describePad(pad)}`,
      `${renodeName}: Miscellaneous.Button @ gpioPort${pin.portLetter}`,
      `    -> gpioPort${pin.portLetter}@${pin.number}`,
      '',
    ].join('\n');
  });

  const ledMappings = new Map<GpioPortLetter, string[]>();
  const ledBlocks = connectedLeds.map((led) => {
    const pin = resolvePeripheralPin(led);
    const pad = resolveConnectedPeripheralPad(led);
    const renodeName = `externalLed__${sanitizeIdentifier(led.id)}`;
    const currentMappings = ledMappings.get(pin.portLetter) ?? [];
    currentMappings.push(`    ${pin.number} -> ${renodeName}@0`);
    ledMappings.set(pin.portLetter, currentMappings);

    return [`// ${led.label}: ${describePad(pad)}`, `${renodeName}: Miscellaneous.LED @ gpioPort${pin.portLetter}`, ''].join('\n');
  });

  const gpioBlocks = [...ledMappings.entries()].map(
    ([portLetter, mappings]) => [`gpioPort${portLetter}:`, ...mappings, ''].join('\n')
  );

  return [
    `using "${NUCLEO_REPL_PATH}"`,
    '',
    '// External lab peripherals attached from the visual board editor.',
    '',
    ...(buttonBlocks.length > 0 ? buttonBlocks : ['// No external buttons are connected.', '']),
    ...(ledBlocks.length > 0 ? ledBlocks : ['// No external LEDs are connected.', '']),
    ...gpioBlocks,
  ].join('\n');
}

export function generateRescPreview(options: {
  elfPath: string | null;
  gdbPort: number;
  bridgePort: number;
}): string {
  const elfPath = options.elfPath ?? '${workspace}/build/firmware.elf';

  return [
    `$name?="${MACHINE_NAME}"`,
    'mach create $name',
    '',
    'machine LoadPlatformDescription @${workspace}/board.repl',
    'using sysbus',
    `sysbus LoadELF @${elfPath}`,
    `emulation CreateExternalControlServer "local-control" ${options.bridgePort}`,
    `machine StartGdbServer ${options.gdbPort}`,
    'start',
    '',
  ].join('\n');
}

export const DEMO_BOARD_NAME = 'NUCLEO-H753ZI';
export const DEMO_BOARD_TAGLINE = 'Real connector map bound to Renode board support and live external peripherals.';
export const DEMO_MACHINE_NAME = MACHINE_NAME;
