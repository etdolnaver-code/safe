'use client';
import { useEffect, useRef, useState } from 'react';
import { Play, Info, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { api, send } from '@/lib/client';

type Player = { getDuration(): number; destroy(): void };
type PlayerEvent = { data: number; target: Player };
type YouTubeApi = { Player: new (element: HTMLIFrameElement, options: {
  events: { onStateChange(event: PlayerEvent): void; onError(): void };
}) => Player };
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let youtubeApiPromise: Promise<YouTubeApi> | null = null;
function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeApiPromise) youtubeApiPromise = new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => {
      if (window.YT) resolve(window.YT);
      else reject(new Error('영상 플레이어를 불러오지 못했습니다.'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('영상 플레이어를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

export function VideoPlayer({ id, youtubeId, title }: { id: string; youtubeId: string; title: string }) {
  const [eventId, setEventId] = useState('');
  const [opening, setOpening] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [origin, setOrigin] = useState('');
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const openRequested = useRef('');
  async function recordOpen(): Promise<string> {
    await api('bootstrap');
    const event = await api<{ eventId: string }>('video-events', send({ videoId: id }));
    setEventId(event.eventId);
    return event.eventId;
  }
  useEffect(() => {
    if (openRequested.current === id) return;
    openRequested.current = id;
    setOpening(true);
    setPlaying(false);
    setEventId('');
    setCompleted(false);
    void recordOpen()
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setOpening(false));
  }, [id]);
  useEffect(() => {
    if (!playing || !eventId || !frame.current) return;
    let active = true;
    let player: Player | undefined;
    loadYouTubeApi().then((yt) => {
      if (!active || !frame.current) return;
      player = new yt.Player(frame.current, {
        events: {
          onStateChange: (event) => {
            if (event.data !== 0 || !active) return;
            const durationSeconds = event.target.getDuration();
            if (!Number.isFinite(durationSeconds) || durationSeconds < 1) {
              setError('영상 길이를 확인할 수 없습니다. 다시 재생해 주세요.');
              return;
            }
            void api<{ completedVideoIds: string[] }>('video-events/complete', send({ eventId, durationSeconds }))
              .then(() => { if (active) { setCompleted(true); setError(''); } })
              .catch((reason) => { if (active) setError((reason as Error).message); });
          },
          onError: () => setError('영상을 재생할 수 없습니다. 현장 담당자에게 문의해 주세요.'),
        },
      });
    }).catch((reason) => { if (active) setError((reason as Error).message); });
    return () => { active = false; player?.destroy(); };
  }, [eventId, playing]);

  async function play() {
    setBusy(true);
    setError('');
    try {
      const currentEventId = eventId || await recordOpen();
      await api('video-events/start', send({ eventId: currentEventId }));
      setOrigin(window.location.origin);
      setPlaying(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function returnToRegistration() {
    window.close();
    window.setTimeout(() => window.location.assign('/'), 150);
  }
  return (
    <main className="education-page">
      <button type="button" className="education-return-button" onClick={returnToRegistration}>
        <ArrowLeft size={22} aria-hidden="true" /> 출입등록으로 돌아가기
      </button>
      <div className="eyebrow mt-8">SAFETY TRAINING</div>
      <h1>{title}</h1>
      <div className="video-stage">
        {playing ? (
          <iframe ref={frame} title={title}
            src={'https://www.youtube-nocookie.com/embed/' + youtubeId + '?autoplay=1&enablejsapi=1&origin=' + encodeURIComponent(origin)}
            allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        ) : (
          <button type="button" onClick={play} disabled={busy || opening}>
            <Play size={48} /><span>{busy || opening ? '영상 준비 중…' : '영상 시청 시작'}</span>
          </button>
        )}
      </div>
      {completed && <p className="notice"><CheckCircle2 size={20} /> 이 영상의 시청 완료가 기록되었습니다.</p>}
      {completed && (
        <button type="button" className="education-return-button education-return-bottom" onClick={returnToRegistration}>
          <ArrowLeft size={22} aria-hidden="true" /> 출입등록으로 돌아가기
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="notice"><Info size={22} />
        <span>페이지 열람은 ‘열어봄’으로 기록됩니다. 영상 종료 기록과 실제 안전교육 이수 확인은 별도로 구분됩니다.</span>
      </div>
      <p className="field-help">재생을 시작하면 YouTube 외부 서비스가 연결됩니다. 이 창을 닫아도 원래 등록 창의 입력 내용은 유지됩니다.</p>
    </main>
  );
}
