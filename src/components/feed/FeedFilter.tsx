'use client';

import Link from 'next/link';

interface Props {
  mineOnly: boolean;
  hotOnly: boolean;
  hasShelf: boolean;
}

export default function FeedFilter({ mineOnly, hotOnly, hasShelf }: Props) {
  const buildHref = (opts: Partial<Props>) => {
    const usp = new URLSearchParams();
    const mine = opts.mineOnly ?? mineOnly;
    const hot = opts.hotOnly ?? hotOnly;
    if (mine) usp.set('mine', '1');
    if (hot) usp.set('hot', '1');
    const qs = usp.toString();
    return qs ? `/feed?${qs}` : '/feed';
  };

  return (
    <div className="feed-filter-row">
      <Link
        href={buildHref({ mineOnly: false, hotOnly: false })}
        className={`filter-pill${!mineOnly && !hotOnly ? ' active' : ''}`}
      >
        Всё
      </Link>
      <Link
        href={buildHref({ mineOnly: !mineOnly })}
        className={`filter-pill${mineOnly ? ' active' : ''}`}
        title={hasShelf ? 'Только из твоих закладок' : 'Добавь новеллы в закладки'}
      >
        {mineOnly ? '★ ' : ''}Только моя полка
      </Link>
      <Link
        href={buildHref({ hotOnly: !hotOnly })}
        className={`filter-pill${hotOnly ? ' active' : ''}`}
      >
        🔥 Только горячее
      </Link>
    </div>
  );
}
