import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
const BASE = import.meta.env.BASE_URL;

interface Detection {
  species: string;
  score: number;
  timestamp?: number;
  location?: string;
}

interface AudioWorkletNodeWithOnmessage extends AudioWorkletNode {
  onmessage: ((e: MessageEvent) => void) | null;
}

function WaveformCanvas({ data }: { data: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const len = data.length;
    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * w;
      const y = h / 2 + data[i] * (h / 2) * 0.9;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [data]);

  return <canvas ref={canvasRef} width={120} height={32} class="w-[120px] h-8" aria-hidden="true" />;
}

function DetectionCard({ detection, index }: { detection: Detection; index: number }) {
  const species = detection.species || 'Unknown';
  const underscoreIdx = species.indexOf('_');
  const common = underscoreIdx >= 0 ? species.slice(0, underscoreIdx).replace(/_/g, ' ') : species;
  const time = detection.timestamp != null ? new Date(detection.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

  return (
    <div
      class={`animate-fade-in-up bg-stone-900/80 backdrop-blur-sm border border-stone-700/50 rounded-2xl px-5 py-4 flex items-center gap-4 transition-all hover:border-amber-500/30 hover:bg-stone-800/60`}
      style={{ animationDelay: `${index * 80}ms`, opacity: 0 }}
    >
      <div class="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
        <span class="text-amber-400 text-lg font-bold">{index + 1}</span>
      </div>

      <div class="flex-1 min-w-0">
        <p class="text-stone-100 font-medium truncate">
          <a href={`/species/${detection.species}`} class="hover:text-amber-400 hover:underline">{common}</a>
        </p>
        {detection.location && (
          <p class="text-stone-400 text-xs truncate">{detection.location}</p>
        )}
      </div>

      <div class="flex-shrink-0 flex items-center gap-3">
        <div class="w-24 h-2 bg-stone-800 rounded-full overflow-hidden" aria-hidden="true">
          <div
            class="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(detection.score * 100, 100)}%` }}
          />
        </div>
        <span class="text-amber-400 font-mono text-sm font-semibold w-12 text-right">
          {Math.round(detection.score * 100)}%
        </span>
      </div>
      <span class="text-stone-500 text-xs">{time}</span>
    </div>
  );
}
function friendlyError(msg: string): string {
  if (msg.includes('NotAllowedError') || msg.includes('PermissionDeniedError')) return 'Microphone access denied. Please allow microphone permission and try again.';
  if (msg.includes('No WebGPU adapter')) return 'WebGPU is not available on this device. Try Chrome or Edge on desktop.';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'Could not download the model. Check your connection and reload.';
  if (msg.includes('No device')) return 'No suitable GPU device found.';
  if (msg.includes('not readable') || msg.includes('TrackEndedError')) return 'Microphone device was disconnected.';
  return 'Something went wrong. Please reload the page.';
}


export default function App() {
  const [listening, setListening] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNodeWithOnmessage | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const startListening = useCallback(async () => {
    setError(null);
    setDetections([]);
    setModelLoading(true);
    setStatus('Loading model…');
    if (!('gpu' in navigator)) {
      setError(friendlyError('No WebGPU adapter'));
      setStatus('Error');
      setModelLoading(false);
      return;
    }

    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data;
        if (type === 'PROGRESS') {
          setLoadProgress(payload.progress);
          setStatus(payload.stage === 'downloading' ? 'Downloading model…' : 'Compiling model…');
        }
        if (type === 'READY') {
          setModelLoading(false);
          setLoadProgress(null);
          setStatus('Listening');
        }
        if (type === 'DETECTIONS') {
          const now = Date.now();
          const newDetections = (payload as Detection[]).map((d) => ({
            ...d,
            timestamp: now,
          }));
          setDetections(newDetections);
        }
      };

      worker.onerror = (err) => {
        const msg = friendlyError(err.message);
        setError(msg);
        setStatus('Error');
        setModelLoading(false);
      };

      const ctx = new AudioContext({ sampleRate: 48000 });
      audioCtxRef.current = ctx;
      await ctx.resume();

      await ctx.audioWorklet.addModule(`${BASE}audio-processor.js`);

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
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      analyserRef.current = analyser;

      const workletNode = new AudioWorkletNode(ctx, 'birdnet-audio-processor') as AudioWorkletNodeWithOnmessage;
      workletNode.onmessage = (e: MessageEvent) => {
        if (workerRef.current) {
          workerRef.current.postMessage({ type: 'INFER', payload: e.data });
        }
      };
      workletNodeRef.current = workletNode;

      source.connect(analyser);
      source.connect(workletNode);

      if ('wakeLock' in navigator) {
        try {
          const lock = await (navigator as Navigator & { wakeLock: { request(): unknown } }).wakeLock.request('screen');
          setWakeLock(lock as WakeLockSentinel);
        } catch {
          // wake lock not granted — non-fatal
        }
      }

      setListening(true);
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)));
      setStatus('Error');
      setModelLoading(false);
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
    setStatus('Ready');
    setDetections([]);
    setModelLoading(false);
    setLoadProgress(null);
  }, [wakeLock]);

  useEffect(() => {
    return () => {
      if (listening) stopListening();
    };
  }, [listening, stopListening]);

  useEffect(() => {
    if (!listening) {
      setWaveform([]);
      return;
    }
    let rafId: number;
    const dataArray = new Uint8Array(analyserRef.current?.frequencyBinCount ?? 128);
    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        analyser.getByteTimeDomainData(dataArray);
        const normalized = Array.from(dataArray).map((v) => (v - 128) / 128);
        setWaveform(normalized);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [listening]);

  return (
    <div class="min-h-screen bg-stone-950 text-stone-100 font-sans flex flex-col">
      {/* Ambient background */}
      <div class="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div class="absolute -top-40 -right-40 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        <div class="absolute -bottom-40 -left-40 w-96 h-96 bg-amber-600/5 rounded-full blur-3xl" />
      </div>

      <div class="relative z-10 flex flex-col items-center px-4 py-8 flex-1 max-w-2xl mx-auto w-full">
        {/* Header */}
        <header class="text-center mb-10">
          <div class="inline-flex items-center gap-3 mb-3">
            <svg class="w-10 h-10 text-amber-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M21.5 6.5c-.5-1.5-2-2.5-3.5-2.5-.5 0-1 .1-1.5.3C15.5 3 14 2 12.5 2 10.5 2 9 3.5 9 5.5c0 .5.1 1 .3 1.5C7.5 7.5 6.5 9 6.5 10.5c0 2 1.5 3.5 3.5 3.5.5 0 1-.1 1.5-.3.5 1.3 2 2.3 3.5 2.3 2 0 3.5-1.5 3.5-3.5 0-.5-.1-1-.3-1.5 1.3-.5 2.3-2 2.3-3.5 0-.5-.1-1-.3-1.5h.5c1 0 2 .5 2.5 1.5.5.5 1.5.5 2 0 .5-.5.5-1.5 0-2-1.5-1.5-3.5-2.5-5.5-2.5h-.5z"/>
              <circle cx="8" cy="14" r="1.5" fill="currentColor"/>
            </svg>
            <h1 class="text-4xl font-bold tracking-tight">
              bird<span class="text-amber-400">TML</span>
            </h1>
          </div>
          <p class="text-stone-400 text-sm">On-device bird sound classification</p>
          <p class="text-stone-500 text-xs mt-1">Powered by BirdNET · 6,522 species</p>
        </header>

        {/* Main control */}
        <div class="flex flex-col items-center gap-6 mb-10">
          {/* Listen button */}
          <div class="relative">
            {listening && (
              <>
                <div class="absolute inset-0 rounded-full bg-amber-500/20 animate-pulse-ring" />
                <div class="absolute inset-0 rounded-full bg-amber-500/10 animate-pulse-ring delay-200" />
              </>
            )}
            <button
              onClick={listening ? stopListening : startListening}
              disabled={modelLoading}
              aria-label={listening ? 'Stop listening' : 'Start listening'}
              aria-pressed={listening}
              aria-busy={modelLoading}
              class={`relative z-10 w-36 h-36 rounded-full text-lg font-semibold transition-all duration-300 flex flex-col items-center justify-center gap-2 ${
                listening
                  ? 'bg-red-500/20 border-2 border-red-500/50 text-red-400 hover:bg-red-500/30'
                  : modelLoading
                  ? 'bg-stone-800 border-2 border-stone-700 text-stone-500 cursor-wait'
                  : 'bg-amber-500/10 border-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50 hover:scale-105 active:scale-95'
              }`}
            >
              {modelLoading ? (
                <>
                  <svg class="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" class="opacity-20" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <span class="text-xs">{loadProgress !== null ? `${Math.round(loadProgress * 100)}%` : 'Loading…'}</span>
                </>
              ) : listening ? (
                <>
                  <svg class="w-8 h-8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                  <span class="text-xs">Stop</span>
                </>
              ) : (
                <>
                  <svg class="w-8 h-8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                  <span class="text-xs">Listen</span>
                </>
              )}
            </button>
          </div>

          {/* Status */}
          <div class="flex items-center gap-3">
            {listening && <WaveformCanvas data={waveform} />}
            <p class={`text-sm ${listening ? 'text-amber-400' : 'text-stone-400'}`} role="status">
              {status}
            </p>
          </div>

          {error && (
            <div class="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm max-w-sm text-center" role="alert">
              <div class="mt-2">
                <button onClick={startListening} class="text-xs underline text-red-300 hover:text-red-200">Retry</button>
              </div>
            </div>
          )}
        </div>

        {/* Detections */}
        <section class="w-full space-y-3" aria-label="Bird detections" aria-live="polite" aria-atomic="false">
          {detections.length > 0 && (
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-sm font-semibold text-stone-400 uppercase tracking-wider">
                Detections
              </h2>
              <span class="text-xs text-stone-500">
                Top {detections.length} result{detections.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {detections.length === 0 && listening && status === 'Listening' && (
            <div class="text-center py-12">
              <div class="inline-flex items-center gap-2 text-stone-400">
                <svg class="w-5 h-5 animate-pulse" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
                <span class="text-sm">Listening for birds…</span>
              </div>
              <p class="text-stone-500 text-xs mt-2">Make sure your microphone is near the sound source</p>
            </div>
          )}

          {detections.length === 0 && !listening && (
            <div class="text-center py-12">
              <div class="inline-flex items-center gap-2 text-amber-400/60">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
                <span class="text-sm text-amber-400/60">Tap Listen to start detecting birds</span>
              </div>
              <p class="text-stone-400 text-xs mt-2">Uses BirdNET, runs entirely on-device</p>
            </div>
          )}

          {detections.map((d, i) => (
            <DetectionCard key={`${d.species}-${d.timestamp}-${i}`} detection={d} index={i} />
          ))}
        </section>

        {/* Footer */}
        <footer class="mt-auto pt-16 pb-6 text-center">
          <p class="text-stone-500 text-xs">
            100% on-device · No audio leaves your browser
          </p>
        </footer>
      </div>
    </div>
  );
}
