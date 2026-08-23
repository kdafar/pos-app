import { describe, expect, it } from 'vitest';
import { deliveryEnabledFrom, ENABLE_DELIVERY_KEY } from './settings';

describe('the delivery setting key', () => {
  it('is namespaced, because the bare name has never existed', () => {
    // The backend ships every setting as `category.name`. Reading
    // `enable_delivery` finds nothing and falls back to the caller's default —
    // which for delivery is "on", i.e. exactly the state a shop that switched
    // delivery off did not want. A wrong key here produces a gate that looks
    // like it works, which is worse than no gate.
    expect(ENABLE_DELIVERY_KEY).toBe('general.enable_delivery');
  });
});

describe('deliveryEnabledFrom', () => {
  it('fails OPEN when the key is absent', () => {
    // The till has not synced settings yet, so we cannot know. Hiding delivery
    // from a shop that does deliver blocks real sales; showing one extra button
    // for a shop that does not is a cosmetic problem.
    expect(deliveryEnabledFrom(undefined)).toBe(true);
    expect(deliveryEnabledFrom(null)).toBe(true);
  });

  it('treats an empty value as OFF, not as absent', () => {
    // The row exists and the operator cleared it. This is the one case where
    // empty and missing must not agree, and it is the whole reason this is not
    // a settings:getBool call.
    expect(deliveryEnabledFrom('')).toBe(false);
    expect(deliveryEnabledFrom('   ')).toBe(false);
  });

  it('reads every off value the settings table can hold', () => {
    for (const raw of ['0', 'false', 'no', 'off', 'FALSE', ' No ', 'OFF']) {
      expect(deliveryEnabledFrom(raw), JSON.stringify(raw)).toBe(false);
    }
  });

  it('reads every on value the settings table can hold', () => {
    for (const raw of ['1', 'true', 'yes', 'on', 'TRUE', ' Yes ', 'enabled']) {
      expect(deliveryEnabledFrom(raw), JSON.stringify(raw)).toBe(true);
    }
  });
});
