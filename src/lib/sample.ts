import { useEffect, useRef, useState } from "react";
import { voiceSample } from "../data";

/** Plays one voice sample at a time. Returns the voice playing and a play/stop toggle. */
export function useVoiceSample(): [string | null, (id: string) => void] {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = (id: string) => {
    const a = audio.current ?? (audio.current = new Audio());
    if (playing === id) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = voiceSample(id);
    a.onended = () => setPlaying(null);
    a.onerror = () => setPlaying(null);
    setPlaying(id);
    a.play().catch(() => setPlaying(null));
  };

  return [playing, toggle];
}
