// Free voices. Sources are listed so you can check each license before commercial use.
export interface PiperVoice {
  id: string;
  label: string;
  lang: string;
  quality: 'low' | 'medium' | 'high';
  sizeMB: number;
  /** Hugging Face path (without extension) in rhasspy/piper-voices. */
  hf?: string;
  /** GitHub release asset (tar.gz) in rhasspy/piper and the model file inside it. */
  gh?: { asset: string; file: string };
}

export const PIPER_VERSION = '2023.11.14-2';
export const PIPER_REPO = 'https://github.com/rhasspy/piper';
export const HF_VOICES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
export const VOICES_REPO = 'https://huggingface.co/rhasspy/piper-voices';

export const PIPER_VOICES: PiperVoice[] = [
  { id: 'es_ES-davefx-medium', label: 'Davefx · España · natural', lang: 'es-ES', quality: 'medium', sizeMB: 63, hf: 'es/es_ES/davefx/medium/es_ES-davefx-medium' },
  { id: 'es_MX-ald-medium', label: 'Ald · México · natural', lang: 'es-MX', quality: 'medium', sizeMB: 63, hf: 'es/es_MX/ald/medium/es_MX-ald-medium' },
  { id: 'es_MX-claude-high', label: 'Claude · México · alta calidad', lang: 'es-MX', quality: 'high', sizeMB: 110, hf: 'es/es_MX/claude/high/es_MX-claude-high' },
  { id: 'es-mls_9972-low', label: 'MLS 9972 · España · básica (descarga desde GitHub)', lang: 'es-ES', quality: 'low', sizeMB: 58, gh: { asset: 'v0.0.2/voice-es-mls_9972-low.tar.gz', file: 'es-mls_9972-low.onnx' } },
  { id: 'es-mls_10246-low', label: 'MLS 10246 · España · básica (descarga desde GitHub)', lang: 'es-ES', quality: 'low', sizeMB: 58, gh: { asset: 'v0.0.2/voice-es-mls_10246-low.tar.gz', file: 'es-mls_10246-low.onnx' } },
];

export const SAMPLE_TEXT = 'Hola, bienvenidos a ContentHub Pro. Esta es una muestra de mi voz para tu próximo video.';
