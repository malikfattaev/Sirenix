import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/** Tab icon: the Sirenix mark on the same near-black the app uses. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#08080a',
          color: '#e8e8ec',
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.05em',
          borderRadius: 7,
        }}
      >
        S
      </div>
    ),
    size,
  );
}
