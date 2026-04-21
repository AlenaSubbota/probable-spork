import { describeAvatar } from '@/lib/avatar';

interface Props {
  avatarUrl: string | null | undefined;
  name: string | null | undefined;
  size?: number;        // в пикселях, default 40
  className?: string;
}

// Универсальный рендер аватара: image / preset-gradient / initial-letter.
// Работает и в server components, и в client.
export default function UserAvatar({ avatarUrl, name, size = 40, className }: Props) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const a = describeAvatar(avatarUrl);
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    fontFamily: 'var(--font-serif)',
    fontWeight: 700,
    color: '#fff',
    fontSize: Math.max(12, Math.round(size * 0.42)),
  };

  if (a.kind === 'image') {
    return (
      <div className={`user-avatar${className ? ` ${className}` : ''}`} style={style}>
        <img
          src={a.src}
          alt={name ?? ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  const bg =
    a.kind === 'preset'
      ? a.css
      : 'linear-gradient(135deg, var(--accent), var(--rose))';

  return (
    <div
      className={`user-avatar${className ? ` ${className}` : ''}`}
      style={{ ...style, background: bg }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
