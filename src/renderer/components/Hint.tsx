import { Tooltip } from '@heroui/react';
import type { ReactElement, ReactNode } from 'react';
import { useI18n } from '../i18n';

type Placement = 'top' | 'bottom' | 'left' | 'right';

/**
 * The app's tooltip.
 *
 * Everything hover-explained used to ride on the native `title` attribute,
 * which the OS draws itself: a white box with a system font and a system
 * border, sitting on top of a themed dark sidebar. It also arrives after a
 * ~1s delay the app cannot shorten, wraps wherever the OS decides, and cannot
 * be styled at all — so a long base URL rendered as a pale strip across the
 * sync card.
 *
 * This wraps HeroUI's Tooltip so a hint is drawn by the app, in the app's
 * tokens, in both themes — and so the delay, width cap and wrapping are set
 * once rather than argued about per call site.
 *
 * Placement is mirrored for RTL: HeroUI takes physical sides, and a sidebar
 * hint pointing `right` in English has to point `left` in Arabic or it opens
 * over the rail it belongs to.
 */
export function Hint({
  content,
  children,
  placement = 'right',
  isDisabled,
}: {
  content: ReactNode;
  children: ReactElement;
  placement?: Placement;
  isDisabled?: boolean;
}) {
  const { dir } = useI18n();

  // An empty hint should not leave a tooltip that opens onto nothing.
  if (content == null || content === '') return children;

  const mirrored: Placement =
    dir === 'rtl' && placement === 'right'
      ? 'left'
      : dir === 'rtl' && placement === 'left'
        ? 'right'
        : placement;

  return (
    <Tooltip
      content={content}
      placement={mirrored}
      isDisabled={isDisabled}
      // Long enough not to fire while the pointer crosses the sidebar on its
      // way somewhere else, short enough to feel like an answer.
      delay={400}
      closeDelay={80}
      offset={8}
      radius='md'
      // HeroUI's default tooltip motion animates the `transform` shorthand as
      // a string ('scale(0.85)' -> 'scale(1)') on a spring. Hovering in and
      // out quickly interrupts that spring, and Motion 12 reads the
      // interrupted value back as 'scale(NaN)' — which is not animatable, so
      // the close is skipped and the console fills with warnings. Animating
      // the numeric `scale` on a tween keeps the same shape without the
      // string round-trip.
      motionProps={{
        variants: {
          enter: {
            opacity: 1,
            scale: 1,
            transition: { duration: 0.16, ease: 'easeOut' },
          },
          exit: {
            opacity: 0,
            scale: 0.9,
            transition: { duration: 0.12, ease: 'easeIn' },
          },
        },
      }}
      classNames={{
        content: [
          'max-w-64 px-2.5 py-1.5',
          'bg-content1 text-foreground border border-default-200 shadow-md',
          'text-[11px] leading-snug',
          // Hints carry URLs and branch names, which have no spaces to break at.
          'break-words',
        ].join(' '),
      }}
    >
      {children}
    </Tooltip>
  );
}
