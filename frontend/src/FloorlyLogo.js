import React from 'react';

function FloorlyLogo({ size = 'md', color = '#000', className = '' }) {
  const sizeMap = {
    sm: 20,
    md: 34,
    lg: 52,
    xl: 78,
  };

  const fontSize = sizeMap[size] || sizeMap.md;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.28em',
        color,
        fontFamily: 'Inter, sans-serif',
        fontWeight: 900,
        letterSpacing: '-0.045em',
        lineHeight: 0.9,
        fontSize,
        userSelect: 'none',
      }}
      aria-label="Floorly logo"
    >
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          flex: '0 0 auto',
          width: '1.18em',
          height: '1.18em',
          overflow: 'hidden',
        }}
      >
        <img
          src="/floorly-logo-revised.png"
          alt=""
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '180%',
            height: '180%',
            maxWidth: 'none',
            objectFit: 'contain',
            transform: 'translate(-50%, -50%)',
          }}
        />
      </span>
      <span>Floorly.</span>
    </span>
  );
}

export default FloorlyLogo;
