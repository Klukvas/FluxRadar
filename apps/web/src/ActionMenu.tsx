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
  const lastIndex = props.items.length - 1;

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
    // Focus goes back first, so an action that moves focus on (the delete
    // confirmation takes it into its own field) has the last word.
    closeAndRefocus();
    item.onSelect();
  };

  const onButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(lastIndex);
    }
  };

  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = {
      ArrowDown: index === lastIndex ? 0 : index + 1,
      ArrowUp: index === 0 ? lastIndex : index - 1,
      Home: 0,
      End: lastIndex,
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
        onClick={() => (isOpen ? setActiveIndex(null) : setActiveIndex(0))}
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
