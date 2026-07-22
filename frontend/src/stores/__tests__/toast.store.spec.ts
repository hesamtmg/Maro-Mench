import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useToastStore } from '../toast.store';

describe('toast store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds a toast with the given message and type', () => {
    const store = useToastStore();
    store.show('Hello', 'success');

    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0]).toMatchObject({
      message: 'Hello',
      type: 'success',
    });
  });

  it('defaults to type "info" when none is given', () => {
    const store = useToastStore();
    store.show('Just info');
    expect(store.toasts[0].type).toBe('info');
  });

  it('assigns unique, increasing ids to each toast', () => {
    const store = useToastStore();
    store.show('First');
    store.show('Second');
    expect(store.toasts[0].id).not.toBe(store.toasts[1].id);
    expect(store.toasts[1].id).toBeGreaterThan(store.toasts[0].id);
  });

  it('auto-dismisses after the default duration', () => {
    const store = useToastStore();
    store.show('Will disappear');
    expect(store.toasts).toHaveLength(1);

    vi.advanceTimersByTime(4000);

    expect(store.toasts).toHaveLength(0);
  });

  it('does not auto-dismiss when durationMs is 0', () => {
    const store = useToastStore();
    store.show('Persistent', 'info', 0);

    vi.advanceTimersByTime(10000);

    expect(store.toasts).toHaveLength(1);
  });

  it('can be dismissed manually before the timer fires', () => {
    const store = useToastStore();
    const id = store.show('Dismiss me');
    store.dismiss(id);
    expect(store.toasts).toHaveLength(0);
  });

  it('convenience methods (success/error/info) set the right type', () => {
    const store = useToastStore();
    store.success('yay');
    store.error('uh oh');
    store.info('fyi');

    expect(store.toasts.map((t) => t.type)).toEqual([
      'success',
      'error',
      'info',
    ]);
  });

  it('dismissing one toast does not affect others', () => {
    const store = useToastStore();
    const id1 = store.show('One', 'info', 0);
    store.show('Two', 'info', 0);

    store.dismiss(id1);

    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0].message).toBe('Two');
  });
});
