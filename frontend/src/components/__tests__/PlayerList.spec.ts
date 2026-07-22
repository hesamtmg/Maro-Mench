import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayerList from '../PlayerList.vue';
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

describe('PlayerList', () => {
  it('renders a row for each player', () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [
          makePlayer({ userId: 'u1', displayName: 'Alice' }),
          makePlayer({ userId: 'u2', displayName: 'Bob' }),
        ],
        myUserId: 'u1',
        canKick: false,
      },
    });
    expect(wrapper.text()).toContain('Alice');
    expect(wrapper.text()).toContain('Bob');
  });

  it('marks the current user with "(you)"', () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [makePlayer({ userId: 'u1', displayName: 'Alice' })],
        myUserId: 'u1',
        canKick: false,
      },
    });
    expect(wrapper.text()).toContain('(you)');
  });

  it('does not mark other players with "(you)"', () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [makePlayer({ userId: 'u2', displayName: 'Bob' })],
        myUserId: 'u1',
        canKick: false,
      },
    });
    expect(wrapper.text()).not.toContain('(you)');
  });

  it('shows an Admin badge only for the admin player', () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [
          makePlayer({ userId: 'u1', isAdmin: true }),
          makePlayer({ userId: 'u2', isAdmin: false }),
        ],
        myUserId: 'u1',
        canKick: false,
      },
    });
    expect(wrapper.text()).toContain('Admin');
    expect(
      wrapper.findAll('.badge').filter((b) => b.text() === 'Admin'),
    ).toHaveLength(1);
  });

  it('translates status codes to friendly labels', () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [
          makePlayer({ userId: 'u1', status: 'joined' }),
          makePlayer({ userId: 'u2', status: 'ready' }),
          makePlayer({ userId: 'u3', status: 'disconnected' }),
        ],
        myUserId: 'u1',
        canKick: false,
      },
    });
    expect(wrapper.text()).toContain('Waiting');
    expect(wrapper.text()).toContain('Ready');
    expect(wrapper.text()).toContain('Disconnected');
  });

  it('shows a kick button for other players when canKick is true', () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [
          makePlayer({ userId: 'u1' }),
          makePlayer({ userId: 'u2', displayName: 'Bob' }),
        ],
        myUserId: 'u1',
        canKick: true,
      },
    });
    const kickButtons = wrapper.findAll('button');
    expect(kickButtons).toHaveLength(1); // only for the other player, not self
  });

  it('never shows a kick button on your own row, even if you can kick', () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [makePlayer({ userId: 'u1' })],
        myUserId: 'u1',
        canKick: true,
      },
    });
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('hides all kick buttons when canKick is false', () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [makePlayer({ userId: 'u1' }), makePlayer({ userId: 'u2' })],
        myUserId: 'u1',
        canKick: false,
      },
    });
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('emits "kick" with the correct userId when the kick button is clicked', async () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [
          makePlayer({ userId: 'u1' }),
          makePlayer({ userId: 'u2', displayName: 'Bob' }),
        ],
        myUserId: 'u1',
        canKick: true,
      },
    });

    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('kick')).toBeTruthy();
    expect(wrapper.emitted('kick')?.[0]).toEqual(['u2']);
  });

  it('falls back to "Player" when displayName is missing', () => {
    const wrapper = mount(PlayerList, {
      props: {
        players: [makePlayer({ displayName: undefined })],
        myUserId: 'u1',
        canKick: false,
      },
    });
    expect(wrapper.text()).toContain('Player');
  });
});
