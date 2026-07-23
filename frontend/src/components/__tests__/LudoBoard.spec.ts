import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import LudoBoard from '../LudoBoard.vue';
import { RING_CELLS, HOME_LANE_CELLS } from '../ludo/board-geometry';
import type { RoomPlayer } from '../../types';

function makePlayer(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    userId: 'user-1',
    displayName: 'Alice',
    seatIndex: 0,
    color: 'red',
    status: 'joined',
    isAdmin: false,
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

const emptyTokens = { tokens: { 0: [], 1: [] } };

function trackCellAt(wrapper: ReturnType<typeof mount>, row: number, col: number) {
  return wrapper
    .findAll('.track-cell')
    .find(
      (el) =>
        el.attributes('style')?.includes(`grid-row: ${row}`) &&
        el.attributes('style')?.includes(`grid-column: ${col}`),
    );
}

// Tokens on the track live in their own overlay layer (.tokens-layer),
// positioned via their own gridRow/gridColumn inline style, rather than
// being nested inside their .track-cell -- that flat structure is what
// lets <TransitionGroup> animate a token sliding between cells.
function tokensAt(wrapper: ReturnType<typeof mount>, row: number, col: number) {
  return wrapper
    .findAll('.track-token')
    .filter(
      (el) =>
        el.attributes('style')?.includes(`grid-row: ${row}`) &&
        el.attributes('style')?.includes(`grid-column: ${col}`),
    );
}

describe('LudoBoard', () => {
  it('renders exactly 4 yards, one per color', () => {
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: emptyTokens,
        players: [],
        isMyTurn: false,
        awaitingMoveChoice: false,
        myTokens: [],
      },
    });
    expect(wrapper.findAll('.yard')).toHaveLength(4);
  });

  it('renders one track cell for every ring + lane cell (deduplicated)', () => {
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: emptyTokens,
        players: [],
        isMyTurn: false,
        awaitingMoveChoice: false,
        myTokens: [],
      },
    });
    // 52 ring cells + 4*6 lane cells, all distinct (verified in
    // board-geometry.spec.ts), so this should be exactly 76 track cells.
    expect(wrapper.findAll('.track-cell')).toHaveLength(52 + 4 * 6);
  });

  it("renders a token on a token's current ring cell", () => {
    const [row, col] = RING_CELLS[10];
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: { tokens: { 0: [{ tokenId: 0, position: 10 }] } },
        players: [makePlayer({ seatIndex: 0 })],
        isMyTurn: false,
        awaitingMoveChoice: false,
        myTokens: [],
      },
    });
    expect(trackCellAt(wrapper, row, col)).toBeTruthy();
    expect(tokensAt(wrapper, row, col)).toHaveLength(1);
  });

  it('does not render a token that is at home (position -1)', () => {
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: { tokens: { 0: [{ tokenId: 0, position: -1 }] } },
        players: [makePlayer({ seatIndex: 0 })],
        isMyTurn: false,
        awaitingMoveChoice: false,
        myTokens: [],
      },
    });
    expect(wrapper.findAll('.track-token')).toHaveLength(0);
  });

  it('does not render a token that has finished (position 58)', () => {
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: { tokens: { 0: [{ tokenId: 0, position: 58 }] } },
        players: [makePlayer({ seatIndex: 0 })],
        isMyTurn: false,
        awaitingMoveChoice: false,
        myTokens: [],
      },
    });
    expect(wrapper.findAll('.track-token')).toHaveLength(0);
  });

  it("renders a token in a seat's own home lane cell", () => {
    const [row, col] = HOME_LANE_CELLS[0][2]; // engine position 54
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: { tokens: { 0: [{ tokenId: 0, position: 54 }] } },
        players: [makePlayer({ seatIndex: 0 })],
        isMyTurn: false,
        awaitingMoveChoice: false,
        myTokens: [],
      },
    });
    expect(tokensAt(wrapper, row, col)).toHaveLength(1);
  });

  it('shows Home and Finished counts per player', () => {
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: {
          tokens: {
            0: [
              { tokenId: 0, position: -1 },
              { tokenId: 1, position: -1 },
              { tokenId: 2, position: 10 },
              { tokenId: 3, position: 58 },
            ],
          },
        },
        players: [makePlayer({ seatIndex: 0, displayName: 'Alice' })],
        isMyTurn: false,
        awaitingMoveChoice: false,
        myTokens: [],
      },
    });
    expect(wrapper.text()).toContain('Home: 2');
    expect(wrapper.text()).toContain('Finished: 1 / 4');
  });

  it('does not show the move hint when it is not my turn', () => {
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: emptyTokens,
        players: [],
        isMyTurn: false,
        awaitingMoveChoice: true,
        myTokens: [{ tokenId: 0, position: 5 }],
      },
    });
    expect(wrapper.text()).not.toContain('Tap a highlighted token');
  });

  it('does not show the move hint when no choice is awaited', () => {
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: emptyTokens,
        players: [],
        isMyTurn: true,
        awaitingMoveChoice: false,
        myTokens: [{ tokenId: 0, position: 5 }],
      },
    });
    expect(wrapper.text()).not.toContain('Tap a highlighted token');
  });

  it('shows the move hint and marks my movable tokens as selectable', () => {
    const [row, col] = RING_CELLS[5];
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: { tokens: { 0: [{ tokenId: 0, position: 5 }] } },
        players: [makePlayer({ seatIndex: 0 })],
        isMyTurn: true,
        awaitingMoveChoice: true,
        myTokens: [{ tokenId: 0, position: 5 }],
      },
    });
    expect(wrapper.text()).toContain('Tap a highlighted token');
    const [token] = tokensAt(wrapper, row, col);
    expect(token?.classes()).toContain('selectable');
    expect(token?.attributes('disabled')).toBeUndefined();
  });

  it('does not mark a token selectable if it is not in myTokens', () => {
    const [row, col] = RING_CELLS[5];
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: { tokens: { 0: [{ tokenId: 0, position: 5 }] } },
        players: [makePlayer({ seatIndex: 0 })],
        isMyTurn: true,
        awaitingMoveChoice: true,
        myTokens: [], // this token isn't a legal choice
      },
    });
    const [token] = tokensAt(wrapper, row, col);
    expect(token?.classes()).not.toContain('selectable');
    expect(token?.attributes('disabled')).toBeDefined();
  });

  it('emits selectToken with the correct tokenId when a selectable token is clicked', async () => {
    const [row, col] = RING_CELLS[20];
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: { tokens: { 0: [{ tokenId: 3, position: 20 }] } },
        players: [makePlayer({ seatIndex: 0 })],
        isMyTurn: true,
        awaitingMoveChoice: true,
        myTokens: [{ tokenId: 3, position: 20 }],
      },
    });

    const [token] = tokensAt(wrapper, row, col);
    await token?.trigger('click');

    expect(wrapper.emitted('selectToken')).toBeTruthy();
    expect(wrapper.emitted('selectToken')?.[0]).toEqual([3]);
  });

  it('does not emit selectToken when clicking a non-selectable token', async () => {
    const [row, col] = RING_CELLS[20];
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: { tokens: { 0: [{ tokenId: 3, position: 20 }] } },
        players: [makePlayer({ seatIndex: 0 })],
        isMyTurn: true,
        awaitingMoveChoice: true,
        myTokens: [], // not selectable
      },
    });

    const [token] = tokensAt(wrapper, row, col);
    await token?.trigger('click');

    expect(wrapper.emitted('selectToken')).toBeFalsy();
  });

  it('places multiple tokens sharing a ring square in the same cell', () => {
    const [row, col] = RING_CELLS[15];
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: {
          tokens: {
            0: [{ tokenId: 0, position: 15 }],
            1: [{ tokenId: 0, position: 15 }],
          },
        },
        players: [
          makePlayer({ userId: 'u1', seatIndex: 0, color: 'red' }),
          makePlayer({ userId: 'u2', seatIndex: 1, color: 'green' }),
        ],
        isMyTurn: false,
        awaitingMoveChoice: false,
        myTokens: [],
      },
    });
    expect(tokensAt(wrapper, row, col)).toHaveLength(2);
  });

  it('highlights the active player row based on currentTurnSeat', () => {
    const wrapper = mount(LudoBoard, {
      props: {
        boardState: emptyTokens,
        players: [
          makePlayer({ userId: 'u1', seatIndex: 0 }),
          makePlayer({ userId: 'u2', seatIndex: 1 }),
        ],
        isMyTurn: false,
        awaitingMoveChoice: false,
        myTokens: [],
        currentTurnSeat: 1,
      },
    });
    const rows = wrapper.findAll('.player-row');
    expect(rows[0].classes()).not.toContain('player-row-active');
    expect(rows[1].classes()).toContain('player-row-active');
  });
});
