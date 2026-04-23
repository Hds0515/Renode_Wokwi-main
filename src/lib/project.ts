import {
  DEMO_PERIPHERAL_TEMPLATES,
  DemoPeripheral,
  DemoPeripheralBehavior,
  DemoPeripheralController,
  DemoPinFunctionMuxState,
  DemoPeripheralPowerBinding,
  DemoPeripheralTemplateKind,
  DemoWiring,
  buildWorkbenchDevices,
  createDefaultPeripheralBehavior,
  createPinFunctionMuxState,
  createDefaultPowerBinding,
  generateDemoMainSource,
  getPeripheralTemplateKind,
  inferPowerVoltage,
  isDemoPeripheralTemplateKind,
  synchronizeWiringWires,
} from './firmware';
import { ACTIVE_BOARD_SCHEMA, BoardSchema, getBoardSchema } from './boards';
import {
  COMPONENT_PACKAGE_CATALOG_VERSION,
  COMPONENT_PACKAGE_SCHEMA_VERSION,
  COMPONENT_PACKAGES,
} from './component-packs';
import {
  CircuitNetlist,
  NETLIST_SCHEMA_VERSION,
  createNetlistFromWiring,
  createWiringFromNetlist,
  validateNetlist,
} from './netlist';

export type ProjectCodeMode = 'generated' | 'manual';

export type ProjectPeripheralPosition = {
  x: number;
  y: number;
};

export type ProjectDocument = {
  app: 'renode-local-visualizer';
  schemaVersion: 2;
  savedAt: string;
  board: {
    id: string;
    name: string;
  };
  templates: {
    catalogVersion: 2;
    kinds: DemoPeripheralTemplateKind[];
  };
  componentPackages: {
    schemaVersion: 1;
    catalogVersion: 2;
    kinds: DemoPeripheralTemplateKind[];
  };
  wiring: DemoWiring;
  pinMux: DemoPinFunctionMuxState;
  netlist: CircuitNetlist;
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
export const PROJECT_SCHEMA_VERSION = 2;
export const PROJECT_TEMPLATE_CATALOG_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normalizePeripheralController(value: unknown): DemoPeripheralController | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === 'firmware') {
    return { type: 'firmware' };
  }
  if (value.type === 'mirror-input') {
    return {
      type: 'mirror-input',
      sourcePeripheralId: normalizeNullableString(value.sourcePeripheralId),
    };
  }
  if (value.type === 'blink') {
    return {
      type: 'blink',
      periodTicks: typeof value.periodTicks === 'number' && value.periodTicks > 0 ? Math.round(value.periodTicks) : 25000,
    };
  }
  return null;
}

function normalizePeripheralBehavior(
  value: unknown,
  templateKind: DemoPeripheralTemplateKind,
  legacySourcePeripheralId: string | null
): DemoPeripheralBehavior {
  const fallback = createDefaultPeripheralBehavior(templateKind);
  if (!isRecord(value)) {
    return legacySourcePeripheralId
      ? {
          ...fallback,
          controller: {
            type: 'mirror-input',
            sourcePeripheralId: legacySourcePeripheralId,
          },
        }
      : fallback;
  }

  return {
    schemaVersion: 2,
    role:
      value.role === 'momentary-input' || value.role === 'gpio-output' || value.role === 'i2c-display'
        ? value.role
        : fallback.role,
    controller: normalizePeripheralController(value.controller) ?? fallback.controller,
    powerRequired: typeof value.powerRequired === 'boolean' ? value.powerRequired : fallback.powerRequired,
  };
}

function normalizePeripheralPower(
  value: unknown,
  board: BoardSchema,
  warnings: string[],
  peripheralId: string
): DemoPeripheralPowerBinding {
  const fallback = createDefaultPowerBinding();
  if (!isRecord(value)) {
    return fallback;
  }

  const padById = new Map(board.connectors.all.flatMap((connector) => connector.pins).map((pad) => [pad.id, pad]));
  const vccPadId = normalizeNullableString(value.vccPadId);
  const gndPadId = normalizeNullableString(value.gndPadId);
  const vccPad = vccPadId ? padById.get(vccPadId) ?? null : null;
  const gndPad = gndPadId ? padById.get(gndPadId) ?? null : null;

  if (vccPadId && !vccPad) {
    warnings.push(`Cleared missing VCC pad "${vccPadId}" from "${peripheralId}".`);
  }
  if (gndPadId && !gndPad) {
    warnings.push(`Cleared missing GND pad "${gndPadId}" from "${peripheralId}".`);
  }

  return {
    schemaVersion: 1,
    vccPadId: vccPad ? vccPad.id : null,
    gndPadId: gndPad ? gndPad.id : null,
    voltage:
      value.voltage === '3v3' || value.voltage === '5v' || value.voltage === 'vin' || value.voltage === 'external'
        ? value.voltage
        : inferPowerVoltage(vccPad),
  };
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
      if (rawKind !== 'button' && rawKind !== 'led' && rawKind !== 'i2c') {
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
          : rawKind === 'i2c'
            ? 'ssd1306-oled'
            : 'led';
      const legacySourcePeripheralId = normalizeNullableString(rawPeripheral.sourcePeripheralId);
      const behavior = normalizePeripheralBehavior(rawPeripheral.behavior, templateKind, legacySourcePeripheralId);

      return {
        id: uniqueId,
        kind: rawKind,
        label: normalizeNullableString(rawPeripheral.label) ?? `${rawKind === 'button' ? 'Button' : rawKind === 'i2c' ? 'I2C' : 'LED'} ${index + 1}`,
        padId: padId && selectablePadIds.has(padId) ? padId : null,
        sourcePeripheralId: behavior.controller?.type === 'mirror-input' ? behavior.controller.sourcePeripheralId : legacySourcePeripheralId,
        behavior,
        power: normalizePeripheralPower(rawPeripheral.power, board, warnings, uniqueId),
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
      let behavior = peripheral.behavior ?? createDefaultPeripheralBehavior(getPeripheralTemplateKind(peripheral));
      if (behavior.controller?.type === 'mirror-input' && behavior.controller.sourcePeripheralId && !peripheralIds.has(behavior.controller.sourcePeripheralId)) {
        warnings.push(`Cleared missing input reference "${behavior.controller.sourcePeripheralId}" from "${peripheral.id}".`);
        behavior = {
          ...behavior,
          controller: {
            ...behavior.controller,
            sourcePeripheralId: null,
          },
        };
      }

      return {
        ...peripheral,
        sourcePeripheralId: behavior.controller?.type === 'mirror-input' ? behavior.controller.sourcePeripheralId : null,
        behavior,
      };
    }),
  });
}

function normalizeProjectNetlist(value: unknown, board: BoardSchema, warnings: string[]): CircuitNetlist | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!Array.isArray(value.components) || !Array.isArray(value.nets) || !isRecord(value.board)) {
    warnings.push('Ignored invalid netlist field and loaded the legacy wiring graph instead.');
    return null;
  }

  const netlist = value as CircuitNetlist;
  if (netlist.schemaVersion !== NETLIST_SCHEMA_VERSION) {
    warnings.push(`Loaded netlist schema v${netlist.schemaVersion}; this build compiles v${NETLIST_SCHEMA_VERSION}.`);
  }

  const blockingIssues = validateNetlist(netlist, board).filter((issue) => issue.severity === 'error');
  if (blockingIssues.length > 0) {
    warnings.push(`Ignored invalid netlist: ${blockingIssues[0].message}`);
    return null;
  }

  return netlist;
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
  const wiring = synchronizeWiringWires(options.wiring);
  const boardPads = board.connectors.all.flatMap((connector) => connector.pins);
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
    componentPackages: {
      schemaVersion: COMPONENT_PACKAGE_SCHEMA_VERSION,
      catalogVersion: COMPONENT_PACKAGE_CATALOG_VERSION,
      kinds: COMPONENT_PACKAGES.map((componentPackage) => componentPackage.kind),
    },
    wiring,
    pinMux: createPinFunctionMuxState(wiring, boardPads),
    netlist: createNetlistFromWiring(wiring, board),
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

  const legacyWiring = normalizeProjectWiring(value.wiring, board, warnings);
  const loadedNetlist = normalizeProjectNetlist(value.netlist, board, warnings);
  const netlistWiring = loadedNetlist
    ? normalizeProjectWiring(createWiringFromNetlist(loadedNetlist), board, warnings)
    : null;
  const wiring = netlistWiring ?? legacyWiring;
  if (!wiring) {
    return null;
  }
  const netlist = createNetlistFromWiring(wiring, board);
  const pinMux = createPinFunctionMuxState(wiring, board.connectors.all.flatMap((connector) => connector.pins));

  const layout = isRecord(value.layout) ? value.layout : {};
  const code = isRecord(value.code) ? value.code : {};
  const codeMode: ProjectCodeMode = code.mode === 'manual' ? 'manual' : 'generated';
  const boardPads = board.connectors.all.flatMap((connector) => connector.pins);
  const mainSource = typeof code.mainSource === 'string' ? code.mainSource : generateDemoMainSource(wiring, board.runtime, boardPads);

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
      componentPackages: {
        schemaVersion: COMPONENT_PACKAGE_SCHEMA_VERSION,
        catalogVersion: COMPONENT_PACKAGE_CATALOG_VERSION,
        kinds: COMPONENT_PACKAGES.map((componentPackage) => componentPackage.kind),
      },
      wiring,
      pinMux,
      netlist,
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
