import { localOcrBridge } from '../offline/nativeOcr';
import { formatRupiah, uid, type LocalAISettings } from '../offline/storage';
import type { Account } from '../services/accounts';
import type { AgenticAction, VoiceTranscribeResponse } from '../services/aiSettings';
import type { Category } from '../services/categories';
import { getTodayLocalDate } from './date';
import { parseIndonesianFinancialCommand } from './indonesianNlpParser';
import { isNativeMobile } from './mobile';

export function isAudioRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  );
}

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'audio/webm';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'audio/webm';
}

export class VoiceNoteRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mimeType = 'audio/webm';
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  async start(maxDurationMs = 25_000, onAutoStop?: (file: File) => void): Promise<void> {
    if (!isAudioRecordingSupported()) {
      throw new Error('Perekaman audio tidak didukung di perangkat/browser ini.');
    }

    if (isNativeMobile()) {
      const perm = await localOcrBridge.requestAudioPermission();
      if (!perm.granted) {
        throw new Error('Izin mikrofon diperlukan untuk merekam Voice Note.');
      }
    }

    this.chunks = [];
    this.mimeType = pickSupportedAudioMime();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    this.recorder = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        this.chunks.push(ev.data);
      }
    };

    if (maxDurationMs > 0 && onAutoStop) {
      this.maxTimer = setTimeout(() => {
        void this.stop().then(onAutoStop).catch(() => {});
      }, maxDurationMs);
    }

    recorder.start(250);
  }

  async stop(): Promise<File> {
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }

    const rec = this.recorder;
    const stream = this.stream;
    this.recorder = null;
    this.stream = null;

    if (!rec) {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      throw new Error('Perekaman belum dimulai');
    }

    return new Promise<File>((resolve) => {
      rec.onstop = () => {
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        const blob = new Blob(this.chunks, { type: this.mimeType || 'audio/webm' });
        const ext = this.mimeType.includes('mp4')
          ? 'm4a'
          : this.mimeType.includes('ogg')
            ? 'ogg'
            : 'webm';
        const file = new File([blob], `voice-note.${ext}`, {
          type: this.mimeType || 'audio/webm',
        });
        resolve(file);
      };
      if (rec.state !== 'inactive') {
        rec.stop();
      } else {
        const blob = new Blob(this.chunks, { type: this.mimeType || 'audio/webm' });
        resolve(new File([blob], 'voice-note.webm', { type: this.mimeType || 'audio/webm' }));
      }
    });
  }

  cancel(): void {
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    try {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.onstop = null;
        this.recorder.stop();
      }
    } catch {
      // Ignore
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * Allows Offline-mode users with an OpenAI or Gemini API key configured in AI Settings
 * to transcribe voice notes directly without requiring a backend worker hop.
 */
export async function transcribeVoiceNoteDirectHybrid(
  file: File,
  settings: Pick<LocalAISettings, 'ai_enabled' | 'ai_provider' | 'ai_model' | 'api_key'>,
  context?: { accounts?: Account[]; categories?: Category[] }
): Promise<VoiceTranscribeResponse> {
  const provider = (settings.ai_provider || 'local').toLowerCase();
  const apiKey = (settings.api_key || '').trim();
  const fallback: VoiceTranscribeResponse = {
    transcript: '',
    provider,
    needs_manual_transcript: true,
    parsed_amount: 0,
    proposed_actions: [],
  };

  if (!settings.ai_enabled || !apiKey || typeof fetch !== 'function') {
    return fallback;
  }

  let transcript = '';
  try {
    if (provider === 'openai') {
      const form = new FormData();
      form.append('file', file);
      form.append('model', settings.ai_model?.includes('transcribe') ? settings.ai_model : 'whisper-1');
      form.append('language', 'id');

      const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (resp.ok) {
        const json = (await resp.json()) as { text?: string };
        transcript = String(json?.text || '').trim();
      }
    } else if (provider === 'gemini') {
      const model =
        settings.ai_model && settings.ai_model !== 'default' ? settings.ai_model : 'gemini-2.5-flash';
      const audioB64 = arrayBufferToBase64(await file.arrayBuffer());
      const mimeType = (file.type || 'audio/webm').split(';', 1)[0];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Transkripsikan rekaman suara keuangan bahasa Indonesia ini secara akurat dan ringkas tanpa komentar tambahan.',
                },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: audioB64,
                  },
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.1 },
        }),
      });
      if (resp.ok) {
        const json = (await resp.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        transcript = (json?.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || '')
          .join(' ')
          .trim();
      }
    }
  } catch {
    return fallback;
  }

  if (!transcript) {
    return fallback;
  }

  const accounts = context?.accounts || [];
  const categories = context?.categories || [];
  const parsed = parseIndonesianFinancialCommand(transcript, accounts, categories);
  const proposedActions: AgenticAction[] = [];

  if (parsed.intent === 'create_transaction' && parsed.amount && parsed.accountId) {
    proposedActions.push({
      id: uid('act'),
      type: 'create_transaction',
      title: `Catat ${parsed.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}: ${parsed.description}`,
      summary: `${formatRupiah(parsed.amount)} • ${parsed.accountName || 'Rekening'}`,
      payload: {
        date: getTodayLocalDate(),
        amount: parsed.amount,
        type: parsed.type === 'income' ? 'income' : 'expense',
        account_id: parsed.accountId,
        category_id: parsed.categoryId,
        description: parsed.description,
      },
    });
  }

  return {
    transcript,
    provider: `${provider}-hybrid-direct`,
    needs_manual_transcript: false,
    parsed_amount: Number(parsed.amount || 0),
    proposed_actions: proposedActions,
  };
}
