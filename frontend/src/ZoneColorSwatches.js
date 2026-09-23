import React, { useRef } from 'react';
import './ZoneColorSwatches.css';

/** Accessible, controlled colour picker rendered as a palette of swatches. */
export default function ZoneColorSwatches({ value, onChange, options = [] }) {
  const swatchRefs = useRef([]);

  const selectAt = (index) => {
    if (!options.length) return;
    const nextIndex = (index + options.length) % options.length;
    onChange(options[nextIndex].value);
    swatchRefs.current[nextIndex]?.focus();
  };

  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));

  return (
    <div className="zone-color-swatches" role="radiogroup" aria-label="Colour">
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={element => { swatchRefs.current[index] = element; }}
            className={`zone-color-swatch${selected ? ' is-selected' : ''}`}
            type="button"
            role="radio"
            aria-label={option.name}
            aria-checked={selected}
            title={option.name}
            tabIndex={index === selectedIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={event => {
              let nextIndex;
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = index + 1;
              else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index - 1;
              else if (event.key === 'Home') nextIndex = 0;
              else if (event.key === 'End') nextIndex = options.length - 1;
              else return;
              event.preventDefault();
              selectAt(nextIndex);
            }}
          >
            <span className="zone-color-swatch-chip" style={{ backgroundColor: option.value }} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
