/**
 * Shared Device Package types.
 *
 * Device packages are source-level descriptions of reusable visual/simulated
 * parts. The compiler turns package sources into runtime-ready DevicePackage
 * records while keeping legacy component/sensor metadata available for the
 * current Netlist and Renode generators.
 */
import {
  COMPONENT_PACKAGE_SDK_SCHEMA_VERSION,
  ComponentPackageEndpointNetKind,
  ComponentPackageProtocol,
  ComponentPackageResultPanel,
} from './component-packs';
import type { DemoEndpointDirection, DemoPadCapability, DemoPeripheralTemplateKind } from './firmware';
import { SENSOR_PACKAGE_SDK_SCHEMA_VERSION } from './sensor-packages';
import type { SensorPackageKind } from './sensor-packages';

export const DEVICE_PACKAGE_SCHEMA_VERSION = 3;
export const DEVICE_PACKAGE_CATALOG_VERSION = 1;
export const DEVICE_PACKAGE_COMPILER_VERSION = 1;

export type DevicePackageKind = DemoPeripheralTemplateKind | 'uart-terminal';
export type DevicePackageCategory = 'input' | 'output' | 'grouped-output' | 'display' | 'sensor' | 'instrument';
export type DevicePackageProtocol = ComponentPackageProtocol | 'ground' | 'uart' | 'spi' | 'virtual';
export type DevicePackagePinRole =
  | 'gpio-signal'
  | 'i2c-scl'
  | 'i2c-sda'
  | 'uart-tx'
  | 'uart-rx'
  | 'spi-sck'
  | 'spi-miso'
  | 'spi-mosi'
  | 'spi-cs'
  | 'power-vcc'
  | 'power-gnd'
  | 'virtual-terminal';
export type DevicePackageNetKind = ComponentPackageEndpointNetKind | 'uart' | 'spi' | 'virtual';
export type DeviceRuntimePanelKind =
  | ComponentPackageResultPanel
  | 'uart-terminal'
  | 'gpio-monitor'
  | 'oled-preview'
  | 'sensor-inspector'
  | 'runtime-timeline';
export type DeviceRuntimeEventParser =
  | 'gpio-level'
  | 'i2c-ssd1306-framebuffer'
  | 'i2c-si70xx-measurement'
  | 'uart-line-buffer'
  | 'bus-transaction';

export type DevicePackagePin = {
  id: string;
  label: string;
  role: DevicePackagePinRole;
  direction: DemoEndpointDirection;
  requiredPadCapabilities: readonly DemoPadCapability[];
  netKind: DevicePackageNetKind;
  protocols: readonly DevicePackageProtocol[];
  terminal: {
    side: 'top' | 'right' | 'bottom' | 'left';
    order: number;
    handleId: string;
    connectable: boolean;
    dragGesture: 'terminal-to-board-pad' | 'virtual-board-instrument';
  };
};

export type DevicePackageVisual = {
  icon: 'button' | 'led' | 'buzzer' | 'rgb-led' | 'oled' | 'sensor' | 'terminal';
  accentColor: string;
  defaultWidth: number;
  defaultHeight: number;
  terminalLayout: 'explicit-endpoints' | 'virtual-instrument';
  library: {
    visible: boolean;
    order: number;
    group: 'GPIO' | 'Bus Displays' | 'Sensors' | 'Virtual Instruments';
    draggable: boolean;
    addMode: 'legacy-template' | 'board-instrument';
  };
};

export type DevicePackageElectricalRules = {
  requiresPower: boolean;
  requiresGround: boolean;
  voltageDomains: readonly ('3v3' | '5v' | 'vin' | 'external')[];
  compatibleProtocols: readonly DevicePackageProtocol[];
  busPairing: 'none' | 'i2c-scl-sda' | 'uart-tx-rx' | 'spi-sck-miso-mosi-cs';
  outputContention: 'forbid' | 'not-applicable';
};

export type DevicePackageProtocolModel = {
  primary: DevicePackageProtocol;
  buses: readonly DevicePackageProtocol[];
  addressMode?: 'seven-bit';
  defaultAddress?: number;
  transactionModel:
    | 'gpio-level'
    | 'mcu-initiated-i2c'
    | 'framebuffer-i2c'
    | 'uart-stream'
    | 'virtual-instrument';
};

export type DevicePackageRenodeBackend = {
  type: 'signal-broker' | 'bus-transaction-broker' | 'renode-native-sensor' | 'virtual-uart-terminal';
  manifest: 'runtime-signal-manifest' | 'runtime-bus-manifest' | 'board-runtime';
  model: string;
  address?: number;
  replPeripheral?: string;
  nativeRenodeType?: string;
  nativeControlTransport?: 'renode-monitor-property';
  sensorPackage?: SensorPackageKind;
};

export type DevicePackageRuntimePanel = {
  controls: readonly DeviceRuntimePanelKind[];
  visualizers: readonly DeviceRuntimePanelKind[];
  eventParsers: readonly DeviceRuntimeEventParser[];
};

export type DevicePackageExampleFirmware = {
  mode: 'generated-gpio-demo' | 'generated-i2c-demo' | 'board-uart-terminal' | 'manual-compatible';
  generatedDriver: string | null;
  requiredIncludes: readonly string[];
};

export type DevicePackageValidationFixture = {
  representative: 'gpio-basic' | 'i2c-display' | 'i2c-sensor' | 'uart-instrument';
  expectedManifest: 'runtime-signal-manifest' | 'runtime-bus-manifest' | 'board-runtime';
  expectedPanels: readonly DeviceRuntimePanelKind[];
  smokeExampleId: string | null;
};

export type DevicePackageCompilerMetadata = {
  version: typeof DEVICE_PACKAGE_COMPILER_VERSION;
  source: 'independent-package' | 'component-adapter';
  packagePath: string | null;
};

export type DevicePackageLegacyMetadata = {
  componentPackageKind?: DemoPeripheralTemplateKind;
  componentPackageSdkSchemaVersion?: typeof COMPONENT_PACKAGE_SDK_SCHEMA_VERSION;
  sensorPackageKind?: SensorPackageKind;
  sensorPackageSdkSchemaVersion?: typeof SENSOR_PACKAGE_SDK_SCHEMA_VERSION;
};

export type DevicePackage = {
  schemaVersion: typeof DEVICE_PACKAGE_SCHEMA_VERSION;
  kind: DevicePackageKind;
  title: string;
  subtitle: string;
  description: string;
  version: '1.0.0';
  category: DevicePackageCategory;
  visual: DevicePackageVisual;
  pins: readonly DevicePackagePin[];
  electricalRules: DevicePackageElectricalRules;
  protocol: DevicePackageProtocolModel;
  renodeBackend: DevicePackageRenodeBackend;
  runtimePanel: DevicePackageRuntimePanel;
  exampleFirmware: DevicePackageExampleFirmware;
  validationFixture: DevicePackageValidationFixture;
  compiler: DevicePackageCompilerMetadata;
  legacy: DevicePackageLegacyMetadata;
};

export type DevicePackageCatalog = {
  schemaVersion: typeof DEVICE_PACKAGE_SCHEMA_VERSION;
  catalogVersion: typeof DEVICE_PACKAGE_CATALOG_VERSION;
  compilerVersion: typeof DEVICE_PACKAGE_COMPILER_VERSION;
  packages: readonly DevicePackage[];
};

export type DevicePackageSource = {
  source: {
    packagePath: string;
    componentPackageKind?: DemoPeripheralTemplateKind;
    sensorPackageKind?: SensorPackageKind;
  };
  kind: DevicePackageKind;
  title: string;
  subtitle: string;
  description: string;
  version: '1.0.0';
  category: DevicePackageCategory;
  visual: DevicePackageVisual;
  pins: readonly DevicePackagePin[];
  electricalRules: DevicePackageElectricalRules;
  protocol: DevicePackageProtocolModel;
  renodeBackend: DevicePackageRenodeBackend;
  runtimePanel: DevicePackageRuntimePanel;
  exampleFirmware: DevicePackageExampleFirmware;
  validationFixture: DevicePackageValidationFixture;
};
