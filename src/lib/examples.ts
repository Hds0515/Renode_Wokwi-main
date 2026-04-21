import { DemoWiring, generateDemoMainSource } from './firmware';
import { ProjectDocument, ProjectPeripheralPosition, createProjectDocument } from './project';

export type ExampleProject = {
  id: string;
  title: string;
  summary: string;
  difficulty: 'starter' | 'intermediate';
  project: ProjectDocument;
};

function buildExampleProject(options: {
  wiring: DemoWiring;
  peripheralPositions: Record<string, ProjectPeripheralPosition>;
  showFullPinout?: boolean;
}): ProjectDocument {
  return {
    ...createProjectDocument({
      wiring: options.wiring,
      showFullPinout: options.showFullPinout ?? false,
      peripheralPositions: options.peripheralPositions,
      codeMode: 'generated',
      mainSource: generateDemoMainSource(options.wiring),
    }),
    savedAt: '2026-04-21T00:00:00.000Z',
  };
}

const BUTTON_LED_WIRING: DemoWiring = {
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

const BUTTON_BUZZER_WIRING: DemoWiring = {
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
      id: 'buzzer-1',
      kind: 'led',
      label: 'Buzzer 1',
      padId: 'CN10-7',
      sourcePeripheralId: 'button-1',
      templateKind: 'buzzer',
      groupId: null,
      groupLabel: null,
      endpointId: 'signal',
      endpointLabel: 'OUT',
      accentColor: '#14b8a6',
    },
  ],
};

const MULTI_BUTTON_RGB_WIRING: DemoWiring = {
  peripherals: [
    {
      id: 'button-1',
      kind: 'button',
      label: 'Red Button',
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
      id: 'button-2',
      kind: 'button',
      label: 'Green Button',
      padId: 'CN7-14',
      sourcePeripheralId: null,
      templateKind: 'button',
      groupId: null,
      groupLabel: null,
      endpointId: 'signal',
      endpointLabel: 'SIG',
      accentColor: '#d946ef',
    },
    {
      id: 'button-3',
      kind: 'button',
      label: 'Blue Button',
      padId: 'CN7-9',
      sourcePeripheralId: null,
      templateKind: 'button',
      groupId: null,
      groupLabel: null,
      endpointId: 'signal',
      endpointLabel: 'SIG',
      accentColor: '#d946ef',
    },
    {
      id: 'rgb-led-1-red',
      kind: 'led',
      label: 'RGB LED 1',
      padId: 'CN9-1',
      sourcePeripheralId: 'button-1',
      templateKind: 'rgb-led',
      groupId: 'rgb-led-1',
      groupLabel: 'RGB LED 1',
      endpointId: 'red',
      endpointLabel: 'RED',
      accentColor: '#ef4444',
    },
    {
      id: 'rgb-led-1-green',
      kind: 'led',
      label: 'RGB LED 1',
      padId: 'CN9-3',
      sourcePeripheralId: 'button-2',
      templateKind: 'rgb-led',
      groupId: 'rgb-led-1',
      groupLabel: 'RGB LED 1',
      endpointId: 'green',
      endpointLabel: 'GREEN',
      accentColor: '#22c55e',
    },
    {
      id: 'rgb-led-1-blue',
      kind: 'led',
      label: 'RGB LED 1',
      padId: 'CN9-5',
      sourcePeripheralId: 'button-3',
      templateKind: 'rgb-led',
      groupId: 'rgb-led-1',
      groupLabel: 'RGB LED 1',
      endpointId: 'blue',
      endpointLabel: 'BLUE',
      accentColor: '#3b82f6',
    },
  ],
};

export const EXAMPLE_PROJECTS: readonly ExampleProject[] = [
  {
    id: 'button-led',
    title: 'Button drives LED',
    summary: 'The smallest end-to-end GPIO loop: press one button and watch one LED react through Renode.',
    difficulty: 'starter',
    project: buildExampleProject({
      wiring: BUTTON_LED_WIRING,
      peripheralPositions: {
        'button-1': { x: 96, y: 364 },
        'led-1': { x: 252, y: 364 },
      },
    }),
  },
  {
    id: 'button-buzzer',
    title: 'Button drives Buzzer',
    summary: 'A one-button output example that exercises the buzzer template and generated GPIO output path.',
    difficulty: 'starter',
    project: buildExampleProject({
      wiring: BUTTON_BUZZER_WIRING,
      peripheralPositions: {
        'button-1': { x: 96, y: 364 },
        'buzzer-1': { x: 252, y: 364 },
      },
    }),
  },
  {
    id: 'multi-button-rgb',
    title: 'Three buttons mix RGB',
    summary: 'Three independent buttons drive the red, green, and blue endpoints of one grouped RGB LED.',
    difficulty: 'intermediate',
    project: buildExampleProject({
      wiring: MULTI_BUTTON_RGB_WIRING,
      peripheralPositions: {
        'button-1': { x: 96, y: 364 },
        'button-2': { x: 252, y: 364 },
        'button-3': { x: 408, y: 364 },
        'rgb-led-1': { x: 564, y: 364 },
      },
    }),
  },
];

export function getExampleProject(exampleId: string): ExampleProject | null {
  return EXAMPLE_PROJECTS.find((example) => example.id === exampleId) ?? null;
}
