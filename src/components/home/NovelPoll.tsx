'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { getCoverUrl } from '@/lib/format';

export interface PollOptionResult {
  option_id: number;
  title: string;
  description: string | null;
  cover_url: string | null;
  external_link: string | null;
  votes: number;
  pct: number;
}

interface Props {
  pollId: number;
  pollTitle: string;
  pollDescription: string | null;
  options: PollOptionResult[];
  myVoteOptionId: number | null;
  isAuthed: boolean;
}

export default function NovelPoll({
  pollId,
  pollTitle,
  pollDescription,
  options,
  myVoteOptionId,
  isAuthed,
}: Props) {
  const router = useRouter();
  const [voting, setVoting] = useState<number | null>(null);
  const [myVote, setMyVote] = useState<number | null>(myVoteOptionId);
  const [error, setError] = useState<string | null>(null);

  const totalVotes = options.reduce((s, o) => s + Number(o.votes), 0);

  const vote = async (optionId: number) => {
    if (!isAuthed) {
      router.push('/login');
      return;
    }
    setError(null);
    setVoting(optionId);
    const supabase = createClient();
    const { error } = await supabase.rpc('cast_poll_vote', {
      p_poll: pollId,
      p_option: optionId,
    });
    setVoting(null);
    if (error) {
      setError(error.message);
      return;
    }
    setMyVote(optionId);
    router.refresh();
  };

  return (
    <section className="container section">
      <div className="section-head">
        <h2>Что переводить следующим?</h2>
        <span className="more" style={{ cursor: 'default' }}>
          {totalVotes} {pluralRu(totalVotes, 'голос', 'голоса', 'голосов')}
        </span>
      </div>

      <div className="poll-card">
        <div className="poll-title">{pollTitle}</div>
        {pollDescription && (
          <p className="poll-description">{pollDescription}</p>
        )}

        <div className="poll-options">
          {options.map((opt) => {
            const isChosen = myVote === opt.option_id;
            const cover = getCoverUrl(opt.cover_url);
            return (
              <button
                key={opt.option_id}
                type="button"
                className={`poll-option${isChosen ? ' chosen' : ''}`}
                onClick={() => vote(opt.option_id)}
                disabled={voting !== null}
              >
                <div
                  className="poll-option-fill"
                  style={{ width: `${opt.pct}%` }}
                />
                <div className="poll-option-row">
                  <div className="poll-option-cover">
                    {cover ? (
                      <img src={cover} alt="" />
                    ) : (
                      <div className="placeholder p1" style={{ fontSize: 9 }}>
                        {opt.title.slice(0, 10)}
                      </div>
                    )}
                  </div>
                  <div className="poll-option-body">
                    <div className="poll-option-title">
                      {opt.title}
                      {isChosen && <span className="poll-option-check"> ✓ твой голос</span>}
                    </div>
                    {opt.description && (
                      <div className="poll-option-desc">{opt.description}</div>
                    )}
                    {opt.external_link && (
                      <a
                        href={opt.external_link}
                        target="_blank"
                        rel="noreferrer"
                        className="poll-option-ext"
                        onClick={(e) => e.stopPropagation()}
                      >
                        источник →
                      </a>
                    )}
                  </div>
                  <div className="poll-option-stats">
                    <div className="poll-option-pct">
                      {opt.pct.toFixed(0)}%
                    </div>
                    <div className="poll-option-votes">
                      {opt.votes}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div style={{ color: 'var(--rose)', fontSize: 13, marginTop: 10 }}>
            {error}
          </div>
        )}
        {!isAuthed && (
          <p className="form-hint" style={{ marginTop: 10 }}>
            Чтобы проголосовать — <a href="/login" className="more">войди</a>.
          </p>
        )}
      </div>
    </section>
  );
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
