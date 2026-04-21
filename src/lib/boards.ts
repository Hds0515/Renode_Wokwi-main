import {
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
  compiler: {
    gccArgs: readonly string[];
  };
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

export const NUCLEO_H753ZI_BOARD_SCHEMA: BoardSchema = {
  id: 'nucleo-h753zi',
  name: DEMO_BOARD_NAME,
  tagline: DEMO_BOARD_TAGLINE,
  machineName: DEMO_MACHINE_NAME,
  renodePlatformPath: 'platforms/boards/nucleo_h753zi.repl',
  compiler: {
    gccArgs: DEFAULT_GCC_ARGS,
  },
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

export const ACTIVE_BOARD_SCHEMA = NUCLEO_H753ZI_BOARD_SCHEMA;
