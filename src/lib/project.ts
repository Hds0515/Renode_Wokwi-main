import {
  DEMO_PERIPHERAL_TEMPLATES,
  DemoPeripheral,
  DemoPeripheralTemplateKind,
  DemoWiring,
  buildWorkbenchDevices,
  generateDemoMainSource,
  isDemoPeripheralTemplateKind,
  synchronizeWiringWires,
} from './firmware';
import { ACTIVE_BOARD_SCHEMA, BoardSchema, getBoardSchema } from './boards';

export type ProjectCodeMode = 'generated' | 'manual';

export type ProjectPeripheralPosition = {
  x: number;
  y: number;
};

export type ProjectDocument = {
  app: 'renode-local-visualizer';
  schemaVersion: 1;
  savedAt: string;
  board: {
    id: string;
    name: string;
  };
  templates: {
    catalogVersion: 1;
    kinds: DemoPeripheralTemplateKind[];
  };
  wiring: DemoWiring;
  layout: {
    showFullPinout: boolean;
    peripheralPositions: Record<string, ProjectPeripheralPosition>;
  };
  code: {
    mode: ProjectCodeMode;
    mainSource: string;
  };
};

export type ProjectLoadResult = {
  project: ProjectDocument;
  warnings: string[];
};

export const PROJECT_APP_ID = 'renode-local-visualizer';
export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_TEMPLATE_CATALOG_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normalizeProjectPosition(value: unknown): ProjectPeripheralPosition | null {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    return null;
  }

  return {
    x: value.x,
    y: value.y,
  };
}

function normalizeProjectPositions(value: unknown, wiring: DemoWiring, warnings: string[]) {
  if (!isRecord(value)) {
    return {};
  }

  const deviceIds = new Set(buildWorkbenchDevices(wiring).map((device) => device.id));
  const positions: Record<string, ProjectPeripheralPosition> = {};

  Object.entries(value).forEach(([deviceId, rawPosition]) => {
    if (!deviceIds.has(deviceId)) {
      warnings.push(`Ignored layout position for unknown device "${deviceId}".`);
      return;
    }

    const position = normalizeProjectPosition(rawPosition);
    if (!position) {
      warnings.push(`Ignored invalid layout position for "${deviceId}".`);
      return;
    }

    positions[deviceId] = position;
  });

  return positions;
}

function normalizeProjectWiring(value: unknown, board: BoardSchema, warnings: string[]): DemoWiring | null {
  if (!isRecord(value) || !Array.isArray(value.peripherals)) {
    return null;
  }

  const selectablePadIds = new Set(board.connectors.selectablePads.map((pad) => pad.id));
  const usedIds = new Set<string>();
  const wirePadIds = new Map<string, string>();
  if (Array.isArray(value.wires)) {
    value.wires.forEach((rawWire, index) => {
      if (!isRecord(rawWire)) {
        warnings.push(`Ignored invalid wire at index ${index}.`);
        return;
      }

      const peripheralId = normalizeNullableString(rawWire.peripheralId);
      const padId = normalizeNullableString(rawWire.padId);
      if (!peripheralId || !padId) {
        warnings.push(`Ignored incomplete wire at index ${index}.`);
        return;
      }
      if (!selectablePadIds.has(padId)) {
        warnings.push(`Ignored wire from "${peripheralId}" to unavailable pad "${padId}".`);
        return;
      }

      wirePadIds.set(peripheralId, padId);
    });
  }

  const peripherals = value.peripherals
    .map((rawPeripheral, index): DemoPeripheral | null => {
      if (!isRecord(rawPeripheral)) {
        warnings.push(`Ignored invalid peripheral at index ${index}.`);
        return null;
      }

      const rawKind = rawPeripheral.kind;
      if (rawKind !== 'button' && rawKind !== 'led') {
        warnings.push(`Ignored peripheral with unsupported kind at index ${index}.`);
        return null;
      }

      const fallbackId = `${rawKind}-${index + 1}`;
      const id = normalizeNullableString(rawPeripheral.id) ?? fallbackId;
      const uniqueId = usedIds.has(id) ? `${id}-${index + 1}` : id;
      if (uniqueId !== id) {
        warnings.push(`Renamed duplicate peripheral id "${id}" to "${uniqueId}".`);
      }
      usedIds.add(uniqueId);

      const rawPadId = normalizeNullableString(rawPeripheral.padId);
      const wirePadId = wirePadIds.get(id) ?? wirePadIds.get(uniqueId) ?? null;
      if (rawPadId && !selectablePadIds.has(rawPadId)) {
        warnings.push(`Disconnected "${uniqueId}" from unavailable pad "${rawPadId}".`);
      }
      if (rawPadId && wirePadId && rawPadId !== wirePadId) {
        warnings.push(`Wire for "${uniqueId}" overrides legacy pad "${rawPadId}" with "${wirePadId}".`);
      }
      const padId = wirePadId ?? rawPadId;

      const templateKind = isDemoPeripheralTemplateKind(rawPeripheral.templateKind)
        ? rawPeripheral.templateKind
        : rawKind === 'button'
          ? 'button'
          : 'led';

      return {
        id: uniqueId,
        kind: rawKind,
        label: normalizeNullableString(rawPeripheral.label) ?? `${rawKind === 'button' ? 'Button' : 'LED'} ${index + 1}`,
        padId: padId && selectablePadIds.has(padId) ? padId : null,
        sourcePeripheralId: normalizeNullableString(rawPeripheral.sourcePeripheralId),
        templateKind,
        groupId: normalizeNullableString(rawPeripheral.groupId),
        groupLabel: normalizeNullableString(rawPeripheral.groupLabel),
        endpointId: normalizeNullableString(rawPeripheral.endpointId) ?? 'signal',
        endpointLabel: normalizeNullableString(rawPeripheral.endpointLabel) ?? 'SIG',
        accentColor: normalizeNullableString(rawPeripheral.accentColor),
      };
    })
    .filter((peripheral): peripheral is DemoPeripheral => Boolean(peripheral));

  const peripheralIds = new Set(peripherals.map((peripheral) => peripheral.id));
  return synchronizeWiringWires({
    peripherals: peripherals.map((peripheral) => {
      const sourcePeripheralId =
        peripheral.kind === 'led' && peripheral.sourcePeripheralId && peripheralIds.has(peripheral.sourcePeripheralId)
          ? peripheral.sourcePeripheralId
          : null;
      if (peripheral.kind === 'led' && peripheral.sourcePeripheralId && !sourcePeripheralId) {
        warnings.push(`Cleared missing driver reference "${peripheral.sourcePeripheralId}" from "${peripheral.id}".`);
      }

      return {
        ...peripheral,
        sourcePeripheralId,
      };
    }),
  });
}

export function createProjectDocument(options: {
  board?: BoardSchema;
  wiring: DemoWiring;
  showFullPinout: boolean;
  peripheralPositions: Record<string, ProjectPeripheralPosition>;
  codeMode: ProjectCodeMode;
  mainSource: string;
}): ProjectDocument {
  const board = options.board ?? ACTIVE_BOARD_SCHEMA;
  return {
    app: PROJECT_APP_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    board: {
      id: board.id,
      name: board.name,
    },
    templates: {
      catalogVersion: PROJECT_TEMPLATE_CATALOG_VERSION,
      kinds: DEMO_PERIPHERAL_TEMPLATES.map((template) => template.kind),
    },
    wiring: synchronizeWiringWires(options.wiring),
    layout: {
      showFullPinout: options.showFullPinout,
      peripheralPositions: options.peripheralPositions,
    },
    code: {
      mode: options.codeMode,
      mainSource: options.mainSource,
    },
  };
}

export function normalizeLoadedProjectDocument(value: unknown): ProjectLoadResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const warnings: string[] = [];
  if (value.app !== PROJECT_APP_ID) {
    warnings.push('Loaded a compatible project without the current app id.');
  }
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > PROJECT_SCHEMA_VERSION) {
    warnings.push(`Project schema v${value.schemaVersion} is newer than this app supports; loading compatible fields only.`);
  }

  const rawBoard = isRecord(value.board) ? value.board : {};
  const boardId = typeof rawBoard.id === 'string' ? rawBoard.id : ACTIVE_BOARD_SCHEMA.id;
  const board = getBoardSchema(boardId);
  if (board.id !== boardId) {
    warnings.push(`Unknown board "${boardId}"; loaded with ${board.name} instead.`);
  }

  const wiring = normalizeProjectWiring(value.wiring, board, warnings);
  if (!wiring) {
    return null;
  }

  const layout = isRecord(value.layout) ? value.layout : {};
  const code = isRecord(value.code) ? value.code : {};
  const codeMode: ProjectCodeMode = code.mode === 'manual' ? 'manual' : 'generated';
  const mainSource = typeof code.mainSource === 'string' ? code.mainSource : generateDemoMainSource(wiring, board.runtime);

  return {
    project: {
      app: PROJECT_APP_ID,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date().toISOString(),
      board: {
        id: board.id,
        name: board.name,
      },
      templates: {
        catalogVersion: PROJECT_TEMPLATE_CATALOG_VERSION,
        kinds: DEMO_PERIPHERAL_TEMPLATES.map((template) => template.kind),
      },
      wiring,
      layout: {
        showFullPinout: layout.showFullPinout === true,
        peripheralPositions: normalizeProjectPositions(layout.peripheralPositions, wiring, warnings),
      },
      code: {
        mode: codeMode,
        mainSource,
      },
    },
    warnings,
  };
}
