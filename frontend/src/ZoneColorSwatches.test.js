import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ZoneColorSwatches from './ZoneColorSwatches';

const options = [
  { name: 'Pink', value: '#D9468C' },
  { name: 'Blue', value: '#2563EB' },
  { name: 'Purple', value: '#7C3AED' },
];

function ControlledPicker() {
  const [value, setValue] = useState(options[0].value);
  return <ZoneColorSwatches value={value} onChange={setValue} options={options} />;
}

test('renders colour-only accessible swatches and changes selection with arrow keys', () => {
  const { container } = render(<ControlledPicker />);
  const group = screen.getByRole('radiogroup', { name: 'Colour' });
  const pink = screen.getByRole('radio', { name: 'Pink' });
  const blue = screen.getByRole('radio', { name: 'Blue' });

  expect(group).toBeInTheDocument();
  expect(pink).toHaveAttribute('aria-checked', 'true');
  expect(pink).toHaveTextContent('');
  expect(pink.querySelector('.zone-color-swatch-chip')).toHaveStyle({ backgroundColor: '#D9468C' });
  expect(container).not.toHaveTextContent('Pink');
  expect(container).not.toHaveTextContent('Blue');

  pink.focus();
  fireEvent.keyDown(pink, { key: 'ArrowRight' });

  expect(blue).toHaveFocus();
  expect(blue).toHaveAttribute('aria-checked', 'true');
  expect(pink).toHaveAttribute('aria-checked', 'false');
});

test('clicking a swatch reports its colour through the controlled callback', () => {
  const onChange = jest.fn();
  render(<ZoneColorSwatches value={options[0].value} onChange={onChange} options={options} />);

  fireEvent.click(screen.getByRole('radio', { name: 'Purple' }));

  expect(onChange).toHaveBeenCalledWith('#7C3AED');
});
