# UI/UX Audit — birdTML

Comprehensive audit of the birdTML application covering accessibility, responsive design, performance UX, error handling, information architecture, visual design, and PWA quality.

---

## 1. Accessibility (WCAG 2.1 AA) — Critical

The app has **zero accessibility annotations**. Screen reader users get no meaningful experience.

| Issue | Severity | Location |
|-------|----------|----------|
| No `aria-label` on the Listen/Stop button — reads as generic "button" | 🔴 High | `app.tsx:215` |
| No `aria-pressed` or `aria-busy` to communicate toggle/loading state | 🔴 High | `app.tsx:215` |
| No `aria-live="polite"` region for incoming detections | 🔴 High | `app.tsx:277-316` |
| Decorative SVGs (waveform bars, icons) lack `aria-hidden="true"` | 🟡 Medium | `app.tsx:14-24,193-196` |
| Informative SVGs lack `<title>` or `aria-label` | 🟡 Medium | `app.tsx:236-249` |
| No `:focus-visible` styles — keyboard users see no focus indicator | 🔴 High | `app.css`, `index.css` |
| No skip-link or landmark regions (`<main>`, `<nav>`) | 🟡 Medium | `app.tsx:182` |
| `prefers-reduced-motion` ignored — pulse-ring, wave, and fade-in-up animations always run | 🔴 High | `app.css:29-66` |
| Color contrast failures: `text-stone-600` (#57534e) on `bg-stone-950` (#0c0a09) = ~3.4:1 (fails AA 4.5:1) | 🔴 High | `app.tsx:202,283,298,321` |
| `text-stone-700` (#44403c) on `bg-stone-900` (#1c1917) ≈ 3.0:1 — fails AA | 🔴 High | `app.tsx:43,298` |
| Status changes not announced — `role="status"` missing | 🟡 Medium | `app.tsx:264` |

### Recommended fixes

```tsx
// Button with full state communication
<button
  aria-label={listening ? "Stop listening" : "Start listening"}
  aria-pressed={listening}
  aria-busy={modelLoading}
  disabled={modelLoading}
>

// Live region for detections
<section aria-label="Bird detections" aria-live="polite" aria-atomic="false">

// Reduced motion guard
@media (prefers-reduced-motion: reduce) {
  .animate-pulse-ring,
  .animate-wave,
  .animate-fade-in-up {
    animation: none;
  }
}
```

---

## 2. Responsive / Mobile UX

| Issue | Severity | Location |
|-------|----------|----------|
| Conflicting container widths — `index.css` sets `#app { width: 1126px }` but app uses Tailwind `max-w-2xl` (~672px). The fixed width wins on large screens, wasting space | 🟡 Medium | `index.css:58` vs `app.tsx:189` |
| No safe-area-inset padding — content underlaps notch/home indicator on notched iPhones | 🟡 Medium | `app.tsx:182` |
| Touch target is 144×144px (w-36 h-36) — exceeds 44px minimum ✅ | ✅ OK | `app.tsx:218` |
| Viewport meta correct ✅ | ✅ OK | `index.html:6` |
| No landscape layout optimization — tall header wastes space in landscape | 🟢 Low | `app.tsx:191-203` |

### Recommended fix

```css
/* Add to app.css */
.min-h-screen {
  min-height: 100dvh;
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
}
```

---

## 3. Performance & Loading UX

| Issue | Severity | Location |
|-------|----------|----------|
| No download progress — model is ~30MB (FP16 BirdNET), user sees only spinner | 🔴 High | `app.tsx:79,226-233` |
| No skeleton/placeholder content during load | 🟡 Medium | `app.tsx:226-233` |
| No detection history — results overwrite each other with no temporal context | 🟡 Medium | `app.tsx:64,93-95` |
| Waveform bars are decorative (CSS animation), not actual audio visualization — misleading | 🟡 Medium | `app.tsx:255-262` |
| No confidence threshold control — hardcoded at 0.5 | 🟢 Low | `worker.ts:56` |
| No FPS/throughput indicator for power users | 🟢 Low | — |

### Recommended fix

```tsx
// Progress tracking for model download
const [loadProgress, setLoadProgress] = useState(0);
// Use fetch with ReadableStream + Content-Length to track bytes
// Show: "Downloading model… 12.4 / 30.1 MB"
```

---

## 4. Error Handling & Recovery

| Issue | Severity | Location |
|-------|----------|----------|
| Raw `Error.message` shown to users — can expose internal paths, browser quirks | 🔴 High | `app.tsx:146-147` |
| No retry mechanism — model load failure requires full page reload | 🔴 High | `app.tsx:145-150` |
| No microphone permission guidance — `NotAllowedError` shows generic message | 🟡 Medium | `app.tsx:112-120` |
| No WebGPU availability check before init — cryptic failure if unsupported | 🟡 Medium | `worker.ts:12-14` |
| No network error distinction — model fetch failure vs inference failure look identical | 🟡 Medium | `app.tsx:145-150` |
| `worker.onerror` fires but doesn't attempt recovery | 🟡 Medium | `app.tsx:98-102` |

### Recommended fix

```tsx
// Map errors to user-friendly messages
const friendlyMsg = (err: string) => {
  if (err.includes('NotAllowedError')) return 'Microphone access denied. Please allow microphone permission and try again.';
  if (err.includes('No WebGPU adapter')) return 'WebGPU is not available on this device. Try Chrome or Edge on desktop.';
  if (err.includes('Failed to fetch')) return 'Could not download the model. Check your connection and reload.';
  return 'Something went wrong. Please reload the page.';
};
```

---

## 5. Information Architecture & Features

| Issue | Severity | Location |
|-------|----------|----------|
| No species detail — tapping a detection does nothing, no link to info | 🟡 Medium | `app.tsx:314-316` |
| No detection timestamp — can't tell when a bird was heard | 🟡 Medium | `app.tsx:64` |
| No location metadata — BirdNET accuracy improves with lat/lon | 🟢 Low | — |
| No share/export — can't save or share a detection | 🟢 Low | — |
| No settings panel — threshold, model, language all hardcoded | 🟢 Low | — |
| Species name parsing fragile — assumes `_` separator, no fallback for malformed labels | 🟡 Medium | `app.tsx:27-29` |

---

## 6. Visual Design & Theming

| Issue | Severity | Location |
|-------|----------|----------|
| Dark mode only — `index.css` defines full light/dark theme variables but app uses Tailwind dark-only classes (`bg-stone-950`, `text-stone-100`) | 🟡 Medium | `app.tsx:182` |
| `index.css` is mostly dead code — light theme vars, social icon styles, counter styles unused | 🟡 Medium | `index.css:1-111` |
| No empty state illustration — just text in low-contrast gray | 🟢 Low | `app.tsx:289-311` |
| Privacy trust signal ("100% on-device") is good ✅ | ✅ OK | `app.tsx:322` |
| Ambient background blobs are subtle and effective ✅ | ✅ OK | `app.tsx:184-187` |

### Recommended fix

Remove unused `index.css` rules or migrate to Tailwind `@theme` variables for light/dark support. The `index.css` file defines `--text`, `--bg`, `--accent` etc. that are never referenced by the Tailwind-driven UI.

---

## 7. PWA / Install Quality

| Issue | Severity | Location |
|-------|----------|----------|
| **Missing icon files** — manifest references `/icon-192.png` and `/icon-512.png` but neither exists in `public/` | 🔴 High | `manifest.json:11-19` |
| No maskable icon — Android adaptive icon will look wrong | 🟡 Medium | `manifest.json` |
| `apple-mobile-web-app-status-bar-style: black` — should be `black-translucent` or `default` to avoid black bar | 🟡 Medium | `index.html:12` |
| Service worker is pass-through only — no caching, no offline fallback | 🟡 Medium | `sw.js:4-6` |
| No offline page — app is unusable without network (model must download) | 🟡 Medium | — |
| `theme-color: #0a0a0a` matches ✅ | ✅ OK | `index.html:10` |

### Recommended fix

Generate PWA icons (192, 512, maskable) and add to `public/`. Add a caching strategy to `sw.js` for the model and WASM files. Add an offline fallback page explaining the app needs network for first load.

---

## 8. Security & Privacy

| Issue | Severity | Location |
|-------|----------|----------|
| CDN dependency — `coi-serviceworker.min.js` loaded from jsdelivr | 🟡 Medium | `index.html:8` |
| No Content-Security-Policy headers visible | 🟡 Medium | — |
| Audio constraints correctly disable processing ✅ (`noiseSuppression: false`, etc.) | ✅ OK | `app.tsx:114-118` |
| No audio leaves device — privacy claim is accurate ✅ | ✅ OK | — |

### Recommended fix

Vendor `coi-serviceworker.min.js` locally instead of CDN. Add CSP headers via `<meta>` or server config.

---

## 9. Code Quality

| Issue | Severity | Location |
|-------|----------|----------|
| Duplicate audio processor — `src/audio-processor.ts` (source) and `public/audio-processor.js` (compiled) both tracked | 🟡 Medium | `src/audio-processor.ts`, `public/audio-processor.js` |
| `index.css` imported in `main.tsx` but mostly unused | 🟢 Low | `main.tsx:2` |
| No `prefers-color-scheme` light mode despite CSS variables being defined | 🟢 Low | `index.css:33-51` |

---

## Priority Summary

| Priority | Count | Themes |
|----------|-------|--------|
| 🔴 High | 8 | Accessibility (5), Missing PWA icons (1), No download progress (1), Raw error display (1) |
| 🟡 Medium | 14 | Reduced motion, contrast, safe area, error recovery, dead code, SW caching |
| 🟢 Low | 6 | Landscape layout, settings, share, location, illustration, light theme |

## Quick Wins (high impact, low effort)

1. Add `aria-label`, `aria-pressed`, `aria-busy` to the Listen button
2. Add `aria-live="polite"` to the detections section
3. Add `prefers-reduced-motion` media query to disable animations
4. Generate and add PWA icon files (192px, 512px, maskable)
5. Map raw errors to user-friendly messages
6. Add `aria-hidden` to decorative SVGs
7. Add `:focus-visible` outline styles
8. Remove or reconcile conflicting `index.css` vs Tailwind styling
