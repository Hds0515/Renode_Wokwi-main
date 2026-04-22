import type { RuntimeBusTimelineEvent } from './runtime-timeline';

export const SSD1306_WIDTH = 128;
export const SSD1306_HEIGHT = 64;
export const SSD1306_PAGE_COUNT = SSD1306_HEIGHT / 8;
export const SSD1306_DEFAULT_ADDRESS = 0x3c;

export type Ssd1306State = {
  width: typeof SSD1306_WIDTH;
  height: typeof SSD1306_HEIGHT;
  address: number;
  displayOn: boolean;
  column: number;
  page: number;
  columnStart: number;
  columnEnd: number;
  pageStart: number;
  pageEnd: number;
  awaiting: 'none' | 'column-start' | 'column-end' | 'page-start' | 'page-end';
  framebuffer: number[];
  updatedAtVirtualTimeNs: number | null;
  transactionCount: number;
};

export function createSsd1306State(address = SSD1306_DEFAULT_ADDRESS): Ssd1306State {
  return {
    width: SSD1306_WIDTH,
    height: SSD1306_HEIGHT,
    address,
    displayOn: false,
    column: 0,
    page: 0,
    columnStart: 0,
    columnEnd: SSD1306_WIDTH - 1,
    pageStart: 0,
    pageEnd: SSD1306_PAGE_COUNT - 1,
    awaiting: 'none',
    framebuffer: Array(SSD1306_WIDTH * SSD1306_PAGE_COUNT).fill(0),
    updatedAtVirtualTimeNs: null,
    transactionCount: 0,
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(0xff, value & 0xff));
}

function writeDataByte(state: Ssd1306State, value: number): Ssd1306State {
  const page = Math.max(0, Math.min(SSD1306_PAGE_COUNT - 1, state.page));
  const column = Math.max(0, Math.min(SSD1306_WIDTH - 1, state.column));
  const index = page * SSD1306_WIDTH + column;
  const framebuffer = [...state.framebuffer];
  framebuffer[index] = clampByte(value);

  let nextColumn = state.column + 1;
  let nextPage = state.page;
  if (nextColumn > state.columnEnd || nextColumn >= SSD1306_WIDTH) {
    nextColumn = state.columnStart;
    nextPage = nextPage + 1;
    if (nextPage > state.pageEnd || nextPage >= SSD1306_PAGE_COUNT) {
      nextPage = state.pageStart;
    }
  }

  return {
    ...state,
    framebuffer,
    column: nextColumn,
    page: nextPage,
  };
}

function applyCommandByte(state: Ssd1306State, command: number): Ssd1306State {
  if (state.awaiting === 'column-start') {
    return {
      ...state,
      columnStart: Math.min(command, SSD1306_WIDTH - 1),
      column: Math.min(command, SSD1306_WIDTH - 1),
      awaiting: 'column-end',
    };
  }
  if (state.awaiting === 'column-end') {
    return {
      ...state,
      columnEnd: Math.min(command, SSD1306_WIDTH - 1),
      awaiting: 'none',
    };
  }
  if (state.awaiting === 'page-start') {
    return {
      ...state,
      pageStart: Math.min(command, SSD1306_PAGE_COUNT - 1),
      page: Math.min(command, SSD1306_PAGE_COUNT - 1),
      awaiting: 'page-end',
    };
  }
  if (state.awaiting === 'page-end') {
    return {
      ...state,
      pageEnd: Math.min(command, SSD1306_PAGE_COUNT - 1),
      awaiting: 'none',
    };
  }

  if (command === 0xaf) {
    return { ...state, displayOn: true };
  }
  if (command === 0xae) {
    return { ...state, displayOn: false };
  }
  if (command === 0x21) {
    return { ...state, awaiting: 'column-start' };
  }
  if (command === 0x22) {
    return { ...state, awaiting: 'page-start' };
  }
  if (command >= 0xb0 && command <= 0xb7) {
    return { ...state, page: command - 0xb0 };
  }
  if (command >= 0x00 && command <= 0x0f) {
    return { ...state, column: (state.column & 0xf0) | command };
  }
  if (command >= 0x10 && command <= 0x1f) {
    return { ...state, column: ((command & 0x0f) << 4) | (state.column & 0x0f) };
  }

  return state;
}

export function applySsd1306Transaction(state: Ssd1306State, event: RuntimeBusTimelineEvent): Ssd1306State {
  if (event.protocol !== 'i2c' || event.direction !== 'write' || event.address !== state.address) {
    return state;
  }

  const bytes = event.payload.bytes;
  if (bytes.length === 0) {
    return state;
  }

  let nextState = state;
  let mode: 'command' | 'data' = bytes[0] === 0x40 ? 'data' : 'command';
  let index = bytes[0] === 0x00 || bytes[0] === 0x40 ? 1 : 0;

  while (index < bytes.length) {
    const value = bytes[index];
    if (mode === 'command' && nextState.awaiting === 'none' && value === 0x40) {
      mode = 'data';
      index += 1;
      continue;
    }

    nextState = mode === 'data' ? writeDataByte(nextState, value) : applyCommandByte(nextState, value);
    index += 1;
  }

  return {
    ...nextState,
    updatedAtVirtualTimeNs: event.clock.virtualTimeNs,
    transactionCount: nextState.transactionCount + 1,
  };
}

export function getSsd1306Pixel(state: Ssd1306State, x: number, y: number): boolean {
  if (!state.displayOn || x < 0 || y < 0 || x >= state.width || y >= state.height) {
    return false;
  }
  const page = Math.floor(y / 8);
  const bit = y % 8;
  return (state.framebuffer[page * state.width + x] & (1 << bit)) !== 0;
}

export function createSsd1306SplashPayload(): number[] {
  const bytes: number[] = [
    0x00,
    0xae,
    0x21,
    0x00,
    0x7f,
    0x22,
    0x00,
    0x07,
    0xaf,
    0x40,
  ];

  for (let page = 0; page < SSD1306_PAGE_COUNT; page += 1) {
    for (let column = 0; column < SSD1306_WIDTH; column += 1) {
      const inFrame = column < 3 || column > 124 || page === 0 || page === 7;
      const stripe = (column + page * 9) % 18 < 9;
      const center = column > 22 && column < 106 && page > 1 && page < 6;
      bytes.push(inFrame ? 0xff : center ? (stripe ? 0x7e : 0x18) : 0x00);
    }
  }

  return bytes;
}
