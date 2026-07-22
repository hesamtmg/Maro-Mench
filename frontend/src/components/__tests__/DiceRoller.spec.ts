import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DiceRoller from '../DiceRoller.vue';

describe('DiceRoller', () => {
  it('renders 1 pip when value is 1', () => {
    const wrapper = mount(DiceRoller, {
      props: { value: 1, isRolling: false },
    });
    const activePips = wrapper.findAll('.pip-active');
    expect(activePips).toHaveLength(1);
  });

  it('renders 6 pips when value is 6', () => {
    const wrapper = mount(DiceRoller, {
      props: { value: 6, isRolling: false },
    });
    const activePips = wrapper.findAll('.pip-active');
    expect(activePips).toHaveLength(6);
  });

  it('defaults to showing 1 pip when value is null', () => {
    const wrapper = mount(DiceRoller, {
      props: { value: null, isRolling: false },
    });
    expect(wrapper.findAll('.pip-active')).toHaveLength(1);
  });

  it('applies the rolling animation class when isRolling is true', () => {
    const wrapper = mount(DiceRoller, {
      props: { value: 3, isRolling: true },
    });
    expect(wrapper.find('.die').classes()).toContain('die-rolling');
  });

  it('does not apply the rolling class when isRolling is false', () => {
    const wrapper = mount(DiceRoller, {
      props: { value: 3, isRolling: false },
    });
    expect(wrapper.find('.die').classes()).not.toContain('die-rolling');
  });

  it.each([1, 2, 3, 4, 5, 6])(
    'renders exactly %i pips for value %i',
    (value) => {
      const wrapper = mount(DiceRoller, {
        props: { value, isRolling: false },
      });
      expect(wrapper.findAll('.pip-active')).toHaveLength(value);
    },
  );
});
