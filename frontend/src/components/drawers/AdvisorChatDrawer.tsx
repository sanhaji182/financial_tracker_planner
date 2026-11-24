import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Send, Loader2, ChevronDown, MessageSquare, CheckCircle2, Sparkles, X, Radio } from 'lucide-react';
import { aiSettingsService, type AISettings, type AgenticAction, type AIChatTurn } from '../../services/aiSettings';
import { isAudioRecordingSupported, VoiceNoteRecorder } from '../../utils/voiceRecorder';
import { transactionsService, type CreateTransactionRequest } from '../../services/transactions';
import { transfersService, type TransferRequest } from '../../services/transfers';
import { budgetsService } from '../../services/budgets';
import goalsService, { type CreateGoalPayload } from '../../services/goals';
import { invalidateFinancialData } from '../../hooks/invalidateFinancialQueries';
import { toast } from '../../stores/useToastStore';
import { useAuthStore } from '../../stores/authStore';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  reason?: string;
  proposed_actions?: AgenticAction[];
}

const QUICK_QUESTIONS = [
  'Bagaimana kondisi keuangan saya bulan ini?',
  'Catat kopi 28rb',
  'Cek anomali pengeluaran',
  'Simulasi cicil 3jt/bulan aman?',
  'Bagaimana cara melunasi utang lebih cepat?',
];

const CHAT_HISTORY_KEY = 'kb_advisor_chat_history_v1';

function loadSavedChatHistory(): ChatMessage[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]).slice(-20) : [];
  } catch {
    return [];
  }
}

export const AdvisorChatDrawer: React.FC = () => {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadSavedChatHistory());
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [advisorEnabled, setAdvisorEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [actionStates, setActionStates] = useState<
    Record<string, 'idle' | 'running' | 'done' | 'dismissed'>
  >({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voiceRecorderRef = useRef<VoiceNoteRecorder | null>(null);
  const voiceSupported = isAudioRecordingSupported();

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const clean = messages.filter((m) => m.text.trim().length > 0).slice(-20);
        window.localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(clean));
      }
    } catch {
      // Ignore storage quota
    }
  }, [messages]);

  useEffect(() => {
    if (!isRecordingVoice) {
      setVoiceSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setVoiceSeconds((prev) => Math.min(25, prev + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecordingVoice]);

  useEffect(() => {
    return () => voiceRecorderRef.current?.cancel();
  }, []);

  const handleCancelVoiceChat = () => {
    voiceRecorderRef.current?.cancel();
    setIsRecordingVoice(false);
    setVoiceSeconds(0);
  };

  const checkAdvisorEnabled = useCallback(async () => {
    if (!isAuthenticated || (user?.role !== 'owner' && user?.role !== 'spouse_co_owner')) {
      setAdvisorEnabled(false);
      setSettingsLoaded(true);
      return;
    }
    try {
      const settings: AISettings = await aiSettingsService.getSettings();
      setAdvisorEnabled(
        Boolean(settings.advisor_enabled && (settings.ai_enabled || settings.ai_provider === 'local'))
      );
    } catch {
      setAdvisorEnabled(false);
    } finally {
      setSettingsLoaded(true);
    }
  }, [isAuthenticated, user?.role]);

  useEffect(() => {
    void checkAdvisorEnabled();
    const onSettingsUpdate = () => void checkAdvisorEnabled();
    window.addEventListener('kb:ai-settings-updated', onSettingsUpdate);
    return () => window.removeEventListener('kb:ai-settings-updated', onSettingsUpdate);
  }, [checkAdvisorEnabled]);

  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSendMessage = async (text?: string) => {
    const messageText = text || inputText.trim();
    if (!messageText || isLoading) return;

    const historyTurns: AIChatTurn[] = messages
      .filter((m) => m.text.trim().length > 0)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.text }));

    const userMessage: ChatMessage = { role: 'user', text: messageText };
    const assistantIndex = messages.length + 1;
    setMessages((prev) => [
      ...prev,
      userMessage,
      { role: 'assistant', text: '' },
    ]);
    setInputText('');
    setIsLoading(true);

    try {
      if (typeof aiSettingsService.chatStream === 'function') {
        await aiSettingsService.chatStream(messageText, historyTurns, {
          onMeta: (meta) => {
            setMessages((prev) => {
              const next = [...prev];
              if (next[assistantIndex]) {
                next[assistantIndex] = {
                  ...next[assistantIndex],
                  reason: meta.reason,
                  proposed_actions: meta.proposed_actions,
                };
              }
              return next;
            });
          },
          onDelta: (chunk) => {
            setMessages((prev) => {
              const next = [...prev];
              if (next[assistantIndex]) {
                next[assistantIndex] = {
                  ...next[assistantIndex],
                  text: next[assistantIndex].text + chunk,
                };
              }
              return next;
            });
          },
          onDone: (finalRes) => {
            setMessages((prev) => {
              const next = [...prev];
              if (next[assistantIndex]) {
                next[assistantIndex] = {
                  role: 'assistant',
                  text: next[assistantIndex].text || finalRes.response,
                  reason: finalRes.reason ?? next[assistantIndex].reason,
                  proposed_actions:
                    finalRes.proposed_actions ?? next[assistantIndex].proposed_actions,
                };
              }
              return next;
            });
          },
        });
      } else {
        const result = await aiSettingsService.chat(messageText, historyTurns);
        setMessages((prev) => {
          const next = [...prev];
          next[assistantIndex] = {
            role: 'assistant',
            text: result.response,
            reason: result.reason,
            proposed_actions: result.proposed_actions,
          };
          return next;
        });
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        next[assistantIndex] = {
          role: 'assistant',
          text: 'Gagal mendapatkan respons dari asisten AI. Silakan coba lagi.',
        };
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleVoiceChat = async () => {
    if (isRecordingVoice) {
      setIsRecordingVoice(false);
      setIsTranscribingVoice(true);
      setIsLoading(true);
      try {
        const audioFile = await voiceRecorderRef.current?.stop();
        if (audioFile) {
          const res = await aiSettingsService.transcribeVoiceNote(audioFile);
          if (res.transcript) {
            setIsLoading(false);
            setIsTranscribingVoice(false);
            await handleSendMessage(res.transcript);
            return;
          }
          toast.info('Aktifkan OpenAI/Gemini Key agar voice note ditranskripsi otomatis.');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal membaca voice note');
      } finally {
        setIsLoading(false);
        setIsTranscribingVoice(false);
      }
      return;
    }

    try {
      const rec = new VoiceNoteRecorder();
      voiceRecorderRef.current = rec;
      setIsRecordingVoice(true);
      await rec.start(25_000, async (file) => {
        setIsRecordingVoice(false);
        setIsTranscribingVoice(true);
        try {
          const res = await aiSettingsService.transcribeVoiceNote(file);
          if (res.transcript) {
            setIsTranscribingVoice(false);
            await handleSendMessage(res.transcript);
          }
        } finally {
          setIsTranscribingVoice(false);
        }
      });
    } catch (err) {
      setIsRecordingVoice(false);
      toast.error(err instanceof Error ? err.message : 'Mikrofon tidak tersedia');
    }
  };

  const handleExecuteAction = async (action: AgenticAction) => {
    setActionStates((prev) => ({ ...prev, [action.id]: 'running' }));
    try {
      if (action.type === 'create_transaction') {
        await transactionsService.createTransaction(
          action.payload as unknown as CreateTransactionRequest
        );
      } else if (action.type === 'create_transfer') {
        await transfersService.createTransfer(action.payload as unknown as TransferRequest);
      } else if (action.type === 'set_budget') {
        const p = action.payload as { category_id: string; month: string; amount: number };
        await budgetsService.setBudget(p.category_id, p.month, p.amount);
      } else if (action.type === 'create_goal') {
        await goalsService.createGoal(action.payload as unknown as CreateGoalPayload);
      }
      invalidateFinancialData(queryClient);
      setActionStates((prev) => ({ ...prev, [action.id]: 'done' }));
      toast.success('Aksi AI berhasil dijalankan', action.title);
    } catch {
      setActionStates((prev) => ({ ...prev, [action.id]: 'idle' }));
      toast.error('Gagal menjalankan aksi AI');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    try {
      window.localStorage.removeItem(CHAT_HISTORY_KEY);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  if (!settingsLoaded || !advisorEnabled) return null;

  const drawerContent = (
    <>
      {!isOpen && (
        <button
          id="advisor-chat-toggle"
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 lg:bottom-6 lg:right-6 z-40 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-full shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
          title="Tanya AI Advisor"
        >
          <Bot className="w-5 h-5" />
          <span className="text-sm font-semibold">AI Advisor</span>
        </button>
      )}

      {isOpen && (
        <>
          <div
            className="sm:hidden fixed inset-0 bg-slate-900/35 backdrop-blur-[2px] z-40 animate-backdrop-in"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-50 w-full sm:w-[400px] h-[85dvh] sm:h-auto sm:max-h-[600px] flex flex-col shadow-2xl rounded-t-2xl sm:rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 pb-safe sm:pb-0 animate-slide-up sm:animate-scale-up">
          <div className="flex items-center justify-between px-4 py-3.5 bg-indigo-600 text-white shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold leading-none">AI Financial Advisor</h3>
                <p className="text-[11px] text-indigo-100 mt-0.5">Asisten Analisis Keuangan Keluarga</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearChat}
                  className="text-indigo-100 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10 transition-colors text-xs font-medium"
                >
                  Hapus
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                title="Tutup"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/30 shrink-0">
            <p className="text-[11px] text-amber-800 dark:text-amber-300 font-medium text-center">
              Saran AI bersifat edukatif, bukan nasihat keuangan profesional.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-4 h-full justify-center items-center text-center py-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center">
                  <MessageSquare className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    Tanya Asisten Keuangan
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                    Advisor memahami ringkasan kas, utang, anggaran, dan dana darurat Anda.
                  </p>
                </div>
                <div className="w-full space-y-2 mt-1">
                  <p className="text-[11px] text-slate-400 uppercase font-semibold tracking-wider">
                    Pertanyaan Populer
                  </p>
                  {QUICK_QUESTIONS.map((q, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => void handleSendMessage(q)}
                      disabled={isLoading}
                      className="w-full text-left text-xs bg-slate-50 hover:bg-indigo-50 dark:bg-slate-800/60 dark:hover:bg-indigo-950/30 text-slate-700 dark:text-slate-200 hover:text-indigo-700 dark:hover:text-indigo-300 px-3 py-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800 hover:border-indigo-200 transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-2xl rounded-tl-sm'
                      } px-3.5 py-2.5 space-y-1`}
                    >
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      {msg.role === 'assistant' &&
                        Array.isArray(msg.proposed_actions) &&
                        msg.proposed_actions.length > 0 && (
                          <div className="pt-2 space-y-2">
                            {msg.proposed_actions.map((act) => {
                              const status = actionStates[act.id] || 'idle';
                              if (status === 'dismissed') return null;
                              return (
                                <div
                                  key={act.id}
                                  className="rounded-xl border border-indigo-200 dark:border-indigo-800/70 bg-white dark:bg-slate-900 p-2.5 space-y-2 shadow-sm"
                                >
                                  <div className="flex items-start gap-2">
                                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                                        {act.title}
                                      </p>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        {act.summary}
                                      </p>
                                    </div>
                                  </div>
                                  {status === 'done' ? (
                                    <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      Berhasil dijalankan
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={status === 'running'}
                                        onClick={() => void handleExecuteAction(act)}
                                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                                      >
                                        {status === 'running' ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <CheckCircle2 className="w-3 h-3" />
                                        )}
                                        Konfirmasi &amp; Jalankan
                                      </button>
                                      <button
                                        type="button"
                                        disabled={status === 'running'}
                                        onClick={() =>
                                          setActionStates((prev) => ({
                                            ...prev,
                                            [act.id]: 'dismissed',
                                          }))
                                        }
                                        className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                        aria-label="Batalkan saran aksi"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      {msg.role === 'assistant' && msg.reason && (
                        <div className="pt-1.5 border-t border-slate-200 dark:border-slate-700 mt-1.5">
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            <strong>Alasan:</strong> {msg.reason}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex gap-2 justify-start">
                    <div className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex gap-1.5 items-center">
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce"
                          style={{ animationDelay: '0ms' }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 shrink-0 bg-white dark:bg-slate-900 space-y-2">
            {(isRecordingVoice || isTranscribingVoice) && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
                <span className="font-medium">
                  {isTranscribingVoice
                    ? 'Mentranskripsi suara...'
                    : `Merekam 00:${String(voiceSeconds).padStart(2, '0')} / 00:25`}
                </span>
                {isRecordingVoice && (
                  <button
                    type="button"
                    aria-label="Batalkan rekaman voice note chat"
                    onClick={handleCancelVoiceChat}
                    className="font-semibold text-rose-600 dark:text-rose-400 hover:underline shrink-0"
                  >
                    Batal
                  </button>
                )}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tulis pertanyaan Anda..."
                disabled={isLoading}
                rows={2}
                className="flex-1 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 resize-none text-slate-900 dark:text-white placeholder:text-slate-400 disabled:opacity-60"
              />
              {voiceSupported && (
                <button
                  type="button"
                  onClick={() => void handleToggleVoiceChat()}
                  disabled={isLoading}
                  aria-label="Rekam voice note chat"
                  title={isRecordingVoice ? 'Hentikan rekaman & kirim' : 'Rekam voice note ke AI'}
                  className={`p-2.5 rounded-xl border transition-colors shrink-0 mb-0.5 ${
                    isRecordingVoice
                      ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-amber-600 dark:text-amber-400 hover:bg-amber-50'
                  }`}
                >
                  <Radio className="w-5 h-5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSendMessage()}
                disabled={!inputText.trim() || isLoading}
                className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 mb-0.5"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
          </div>
        </>
      )}
    </>
  );

  return typeof document !== 'undefined' ? createPortal(drawerContent, document.body) : drawerContent;
};

export default AdvisorChatDrawer;
