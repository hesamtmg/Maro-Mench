import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SnakesLaddersBoard from '../SnakesLaddersBoard.vue';
import type { RoomPlayer } from '../../types';

function makePlayer(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    userId: 'user-1',
    displayName: 'Alice',
    seatIndex: 0,
    color: '#ff0000',
    status: 'joined',
    isAdmin: false,
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

const SNAKES = { 16: 6, 47: 26 };
const LADDERS = { 4: 14, 9: 31 };

describe('SnakesLaddersBoard', () => {
  it('renders exactly 100 squares', () => {
    const wrapper = mount(SnakesLaddersBoard, {
      props: {
        boardState: { positions: {}, snakes: {}, ladders: {} },
        players: [],
      },
    });
    expect(wrapper.findAll('.sl-square')).toHaveLength(100);
  });

  it('renders squares 1 through 100 exactly once each', () => {
    const wrapper = mount(SnakesLaddersBoard, {
      props: {
        boardState: { positions: {}, snakes: {}, ladders: {} },
        players: [],
      },
    });
    const indices = wrapper
      .findAll('.square-index')
      .map((el) => Number(el.text()));
    const sorted = [...indices].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('marks a snake head square distinctly', () => {
    const wrapper = mount(SnakesLaddersBoard, {
      props: {
        boardState: { positions: {}, snakes: SNAKES, ladders: {} },
        players: [],
      },
    });
    const squares = wrapper.findAll('.sl-square');
    const square16 = squares.find(
      (s) => s.find('.square-index').text() === '16',
    );
    expect(square16?.classes()).toContain('sl-snake-head');
  });

  it('marks a ladder bottom square distinctly', () => {
    const wrapper = mount(SnakesLaddersBoard, {
      props: {
        boardState: { positions: {}, snakes: {}, ladders: LADDERS },
        players: [],
      },
    });
    const squares = wrapper.findAll('.sl-square');
    const square4 = squares.find(
      (s) => s.find('.square-index').text() === '4',
    );
    expect(square4?.classes()).toContain('sl-ladder-bottom');
  });

  it("renders a token dot on a player's current square", () => {
    const wrapper = mount(SnakesLaddersBoard, {
      props: {
        boardState: { positions: { 0: 42 }, snakes: {}, ladders: {} },
        players: [makePlayer({ seatIndex: 0 })],
      },
    });
    const squares = wrapper.findAll('.sl-square');
    const square42 = squares.find(
      (s) => s.find('.square-index').text() === '42',
    );
    expect(square42?.findAll('.token-dot')).toHaveLength(1);
  });

  it('treats a missing position as square 0 (not yet placed on the board)', () => {
    const wrapper = mount(SnakesLaddersBoard, {
      props: {
        boardState: { positions: {}, snakes: {}, ladders: {} },
        players: [makePlayer({ seatIndex: 0 })],
      },
    });
    expect(wrapper.findAll('.sl-square .token-dot')).toHaveLength(0);
  });

  it('highlights the active player row based on currentTurnSeat', () => {
    const wrapper = mount(SnakesLaddersBoard, {
      props: {
        boardState: { positions: {}, snakes: {}, ladders: {} },
        players: [
          makePlayer({ userId: 'u1', seatIndex: 0 }),
          makePlayer({ userId: 'u2', seatIndex: 1 }),
        ],
        currentTurnSeat: 1,
      },
    });
    const rows = wrapper.findAll('.player-row');
    expect(rows[0].classes()).not.toContain('player-row-active');
    expect(rows[1].classes()).toContain('player-row-active');
  });

  it('shows both players on the same square if tied', () => {
    const wrapper = mount(SnakesLaddersBoard, {
      props: {
        boardState: { positions: { 0: 20, 1: 20 }, snakes: {}, ladders: {} },
        players: [
          makePlayer({ userId: 'u1', seatIndex: 0 }),
          makePlayer({ userId: 'u2', seatIndex: 1 }),
        ],
      },
    });
    const squares = wrapper.findAll('.sl-square');
    const square20 = squares.find(
      (s) => s.find('.square-index').text() === '20',
    );
    expect(square20?.findAll('.token-dot')).toHaveLength(2);
  });

  describe('SVG overlay (snake bodies and ladder rails)', () => {
    it('draws one snake body path per entry in boardState.snakes', () => {
      const wrapper = mount(SnakesLaddersBoard, {
        props: {
          boardState: { positions: {}, snakes: SNAKES, ladders: {} },
          players: [],
        },
      });
      expect(wrapper.findAll('.snake-body')).toHaveLength(
        Object.keys(SNAKES).length,
      );
    });

    it('draws a head marker dot for each snake', () => {
      const wrapper = mount(SnakesLaddersBoard, {
        props: {
          boardState: { positions: {}, snakes: SNAKES, ladders: {} },
          players: [],
        },
      });
      expect(wrapper.findAll('.snake-head-dot')).toHaveLength(
        Object.keys(SNAKES).length,
      );
    });

    it('draws two rails per ladder', () => {
      const wrapper = mount(SnakesLaddersBoard, {
        props: {
          boardState: { positions: {}, snakes: {}, ladders: LADDERS },
          players: [],
        },
      });
      expect(wrapper.findAll('.ladder-rail')).toHaveLength(
        Object.keys(LADDERS).length * 2,
      );
    });

    it('draws multiple rungs per ladder', () => {
      const wrapper = mount(SnakesLaddersBoard, {
        props: {
          boardState: { positions: {}, snakes: {}, ladders: { 4: 14 } },
          players: [],
        },
      });
      // ladderGeometry defaults to 5 rungs + 1 = 6 rung lines per ladder.
      expect(wrapper.findAll('.ladder-rung').length).toBeGreaterThan(1);
    });

    it('draws nothing when there are no snakes or ladders', () => {
      const wrapper = mount(SnakesLaddersBoard, {
        props: {
          boardState: { positions: {}, snakes: {}, ladders: {} },
          players: [],
        },
      });
      expect(wrapper.findAll('.snake-body')).toHaveLength(0);
      expect(wrapper.findAll('.ladder-rail')).toHaveLength(0);
    });

    it('renders the overlay as an SVG with a 0-100 viewBox', () => {
      const wrapper = mount(SnakesLaddersBoard, {
        props: {
          boardState: { positions: {}, snakes: {}, ladders: {} },
          players: [],
        },
      });
      const svg = wrapper.find('.sl-overlay');
      expect(svg.exists()).toBe(true);
      expect(svg.attributes('viewBox')).toBe('0 0 100 100');
    });
  });
});
