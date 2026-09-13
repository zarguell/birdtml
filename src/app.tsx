import { useState, useCallback, useRef, useEffect } from 'preact/hooks';

interface Detection {
  species: string;
  score: number;
}

interface AudioWorkletNodeWithOnmessage extends AudioWorkletNode {
  onmessage: ((e: MessageEvent) => void) | null;
}

export default function App() {
  const [listening, setListening] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState<string | null>(null);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNodeWithOnmessage | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startListening = useCallback(async () => {
    setError(null);
    setStatus('Starting…');

    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data;
        if (type === 'READY') {
          setStatus('Listening…');
        }
        if (type === 'DETECTIONS') {
          setDetections(payload as Detection[]);
        }
      };

      worker.onerror = (err) => {
        setError(err.message);
        setStatus('Error');
      };

      worker.postMessage({ type: 'INIT' });

      const ctx = new AudioContext({ sampleRate: 48000 });
      audioCtxRef.current = ctx;

      await ctx.audioWorklet.addModule('/audio-processor.js');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 48000,
          channelCount: 1,
          noiseSuppression: false,
          echoCancellation: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ctx, 'birdnet-audio-processor') as AudioWorkletNodeWithOnmessage;

      workletNode.onmessage = (e: MessageEvent) => {
        if (workerRef.current) {
          workerRef.current.postMessage({ type: 'INFER', payload: e.data });
        }
      };
      workletNodeRef.current = workletNode;

      source.connect(workletNode);

      if ('wakeLock' in navigator) {
        const lock = await (navigator as Navigator & { wakeLock: { request(): unknown } }).wakeLock.request('screen');
        setWakeLock(lock as WakeLockSentinel);
      }

      setListening(true);
      setStatus('Listening…');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('Error');
    }
  }, []);

  const stopListening = useCallback(() => {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    workerRef.current?.terminate();
    workerRef.current = null;

    wakeLock?.release().catch(() => {});
    setWakeLock(null);

    setListening(false);
    setStatus('Idle');
    setDetections([]);
  }, [wakeLock]);

  useEffect(() => {
    return () => {
      if (listening) stopListening();
    };
  }, [listening, stopListening]);

  return (
    <div class="min-h-screen bg-black text-white font-sans flex flex-col items-center p-6">
      <header class="mb-8 text-center">
        <h1 class="text-4xl font-bold tracking-tight">
          bird<span class="text-green-400">TML</span>
        </h1>
        <p class="text-gray-400 text-sm mt-2">On-device BirdNET classification</p>
      </header>

      <div class="w-full max-w-md flex flex-col items-center gap-4">
        <button
          onClick={listening ? stopListening : startListening}
          class={`w-32 h-32 rounded-full text-lg font-semibold transition-all ${
            listening
              ? 'bg-red-600 hover:bg-red-700 animate-pulse'
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {listening ? 'Stop' : 'Start'}
        </button>

        <p class="text-sm text-gray-400">{status}</p>
        {error && <p class="text-sm text-red-400">{error}</p>}
      </div>

      <section class="w-full max-w-md mt-8 space-y-3">
        <h2 class="text-lg font-semibold text-gray-300">Detections</h2>
        {detections.length === 0 && (
          <p class="text-gray-600 text-sm">No detections yet</p>
        )}
        {detections.map((d) => (
          <div
            key={d.species}
            class="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3 border border-gray-800"
          >
            <span class="text-sm font-medium">{d.species}</span>
            <span class="text-sm text-green-400">
              {Math.round(d.score * 100)}%
            </span>
          </div>
        ))}
      </section>

      <footer class="mt-auto pt-12 text-gray-600 text-xs text-center">
        <p>Powered by BirdNET — runs entirely in your browser</p>
      </footer>
    </div>
  );
}