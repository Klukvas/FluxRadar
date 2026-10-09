// A row's secondary actions folded behind one "⋯" button.
//
// A site row carried four labelled buttons — New scan, Reports, Edit profile,
// Delete — and in Ukrainian they took most of the row, squeezing the site's own
// name into a column a word wide. The primary action stays a button; the rest
// open from here, as a menu button (WAI-ARIA APG pattern): arrow keys move,
// Escape and Tab close, and focus comes back to the button that opened it.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';

import './styles/action-menu.css';

export interface ActionMenuItem {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  /** An irreversible action: drawn in red, below a divider, never beside an everyday one. */
  readonly danger?: boolean;
  /**
   * Held by something else on the screen — offered, but not selectable now.
   *
   * Kept in the menu rather than removed from it: a row whose actions come and
   * go is a row whose menu is a different menu every time it is opened.
   */
  readonly disabled?: boolean;
}

export function ActionMenu(props: {
  /** The button's accessible name — it shows only an icon. */
  label: string;
  items: readonly ActionMenuItem[];
  /** Lets the owner of the menu return focus to its button later. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const menuId = useId();
  const ownButtonRef = useRef<HTMLButtonElement>(null);
  const buttonRef = props.buttonRef ?? ownButtonRef;
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const isOpen = activeIndex !== null;

  useEffect(() => {
    if (activeIndex !== null) itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setActiveIndex(null);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const closeAndRefocus = () => {
    setActiveIndex(null);
    buttonRef.current?.focus();
  };

  const select = (item: ActionMenuItem) => {
    if (item.disabled === true) return;
    // Focus goes back first, so an action that moves focus on (the delete
    // confirmation takes it into its own field) has the last word.
    closeAndRefocus();
    item.onSelect();
  };

  /** The next item in that direction the arrow keys may land on, wrapping round. */
  const step = (from: number, delta: number): number => {
    const count = props.items.length;
    for (let moved = 1; moved <= count; moved += 1) {
      const index = (((from + delta * moved) % count) + count) % count;
      if (props.items[index]?.disabled !== true) return index;
    }
    return from;
  };

  const onButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(step(-1, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(step(0, -1));
    }
  };

  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = {
      ArrowDown: step(index, 1),
      ArrowUp: step(index, -1),
      Home: step(-1, 1),
      End: step(0, -1),
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActiveIndex(next);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRefocus();
    } else if (event.key === 'Tab') {
      setActiveIndex(null);
    }
  };

  const firstDangerIndex = props.items.findIndex((item) => item.danger === true);

  return (
    <div className="action-menu" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className="button button--default action-menu__button"
        aria-label={props.label}
        title={props.label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => setActiveIndex(isOpen ? null : step(-1, 1))}
        onKeyDown={onButtonKeyDown}
      >
        <svg viewBox="0 0 16 4" aria-hidden="true" className="action-menu__icon">
          <circle cx="2" cy="2" r="1.5" />
          <circle cx="8" cy="2" r="1.5" />
          <circle cx="14" cy="2" r="1.5" />
        </svg>
      </button>
      {isOpen ? (
        <ul id={menuId} role="menu" aria-label={props.label} className="action-menu__list">
          {props.items.map((item, index) => (
            <li
              key={item.id}
              role="none"
              className={index === firstDangerIndex && index > 0 ? 'action-menu__divided' : ''}
            >
              <button
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={
                  item.danger === true
                    ? 'action-menu__item action-menu__item--danger'
                    : 'action-menu__item'
                }
                disabled={item.disabled}
                onClick={() => select(item)}
                onKeyDown={(event) => onItemKeyDown(event, index)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
