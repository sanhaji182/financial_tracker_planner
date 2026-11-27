import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import {
  Bot,
  Send,
  Loader2,
  ChevronDown,
  MessageSquare,
  CheckCircle2,
  Sparkles,
  X,
  Radio,
  Pencil,
  ImagePlus,
  AlertTriangle,
} from 'lucide-react';
import {
  aiSettingsService,
  type AISettings,
  type AgenticAction,
  type AIChatAttachment,
  type AIChatTurn,
} from '../../services/aiSettings';
import { isAudioRecordingSupported, VoiceNoteRecorder } from '../../utils/voiceRecorder';
import { transactionsService, type CreateTransactionRequest } from '../../services/transactions';
import { transfersService, type TransferRequest } from '../../services/transfers';
import { budgetsService } from '../../services/budgets';
import goalsService, { type CreateGoalPayload } from '../../services/goals';
import { billService, type PayBillRequest } from '../../services/bills';
import { debtsService, type RecordPaymentRequest } from '../../services/debts';
import { learnFromConfirmedAction, loadAdvisorMemory } from '../../utils/advisorMemory';
import { runProactiveWatchdog, type WatchdogFinding } from '../../offline/proactiveWatchdog';
import { loadLocalDB } from '../../offline/storage';
import { getAppMode } from '../../utils/appMode';
import { invalidateFinancialData } from '../../hooks/invalidateFinancialQueries';
import { toast } from '../../stores/useToastStore';
import { useAuthStore } from '../../stores/authStore';

interface ChatMessage {
  clientId?: string;
  role: 'user' | 'assistant';
  text: string;
  reason?: string;
  proposed_actions?: AgenticAction[];
  suggested_replies?: string[];
  attachment_name?: string;
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700/80 text-[12px] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

const AdvisorFormattedText: React.FC<{ text: string; isUser: boolean }> = ({ text, isUser }) => {
  if (isUser) {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>;
  }
  const lines = text.split('\n');
  return (
    <div className="text-sm leading-relaxed space-y-1">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1" />;
        }
        const bulletMatch = trimmed.match(/^(?:[-•*]|\d+\.)\s+(.*)$/);
        if (bulletMatch) {
          const prefix = trimmed.slice(0, trimmed.length - bulletMatch[1].length).trim();
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-0.5">
              <span className="text-indigo-500 dark:text-indigo-400 font-semibold shrink-0">
                {prefix}
              </span>
              <span className="min-w-0">{renderInlineMarkdown(bulletMatch[1])}</span>
            </div>
          );
        }
        return <p key={idx}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
};

const QUICK_QUESTIONS = [
  'Bagaimana kondisi keuangan saya bulan ini?',
  'Beli kopi 10rb, susu 6rb dan warteg 5rb',
  'Tagihan bulan ini apa saja?',
  'Strategi melunasi utang lebih cepat?',
  'Cek anomali & pengeluaran terbesar',
  'Simulasi cicil 3jt/bulan aman?',
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
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('openAdvisor') === '1') {
      setIsOpen(true);
    }
  }, [location.search]);
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
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editAmountText, setEditAmountText] = useState('');
  const [editDescText, setEditDescText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<AIChatAttachment | null>(null);
  const [proactiveAlerts, setProactiveAlerts] = useState<WatchdogFinding[]>([]);
  const [alertsDismissed, setAlertsDismissed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleStartEditAction = (act: AgenticAction) => {
    const p = act.payload as { amount?: number; target_amount?: number; description?: string; name?: string };
    const amt = act.type === 'create_goal' ? p.target_amount : p.amount;
    setEditingActionId(act.id);
    setEditAmountText(amt ? String(Math.round(Number(amt))) : '');
    setEditDescText(String(p.description || p.name || ''));
  };

  const handleSaveEditAction = (msgIndex: number, actionId: string) => {
    const parsedAmt = Math.round(Number(editAmountText.replace(/[^\d]/g, '')));
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      toast.error('Nominal harus lebih dari 0');
      return;
    }
    const cleanDesc = editDescText.trim();
    setMessages((prev) =>
      prev.map((m, idx) => {
        if (idx !== msgIndex || !m.proposed_actions) return m;
        return {
          ...m,
          proposed_actions: m.proposed_actions.map((act) => {
            if (act.id !== actionId) return act;
            const nextPayload = { ...act.payload };
            let nextTitle = act.title;
            if (act.type === 'create_goal') {
              nextPayload.target_amount = parsedAmt;
              if (cleanDesc) {
                nextPayload.name = cleanDesc;
                nextTitle = `Buat Target: ${cleanDesc}`;
              }
            } else {
              nextPayload.amount = parsedAmt;
              if (act.type === 'create_transaction' && cleanDesc) {
                nextPayload.description = cleanDesc;
                const prefix = nextPayload.type === 'income' ? 'Catat Pemasukan' : 'Catat Pengeluaran';
                nextTitle = `${prefix}: ${cleanDesc}`;
              }
            }
            const formatted = `Rp ${parsedAmt.toLocaleString('id-ID')}`;
            const restSummary = act.summary.includes('•')
              ? ` • ${act.summary.split('•').slice(1).join('•').trim()}`
              : '';
            return {
              ...act,
              title: nextTitle,
              summary: `${formatted}${restSummary}`,
              payload: nextPayload,
            };
          }),
        };
      })
    );
    setEditingActionId(null);
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voiceRecorderRef = useRef<VoiceNoteRecorder | null>(null);
  const voiceSupported = isAudioRecordingSupported();

  const handleSelectImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Lampiran chat hanya mendukung file gambar/struk');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Ukuran gambar maksimal 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const b64 = result.includes(',') ? result.split(',', 2)[1] : result;
      if (b64) {
        setPendingAttachment({
          name: file.name || 'struk.jpg',
          mime_type: file.type || 'image/jpeg',
          data_base64: b64,
        });
      }
    };
    reader.readAsDataURL(file);
  };

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
    if (typeof window === 'undefined') return;
    const checkOpenTrigger = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('openAdvisor') === '1') {
        setIsOpen(true);
      }
    };
    checkOpenTrigger();
    const onOpenEvent = () => setIsOpen(true);
    window.addEventListener('kb:open-advisor', onOpenEvent);
    return () => window.removeEventListener('kb:open-advisor', onOpenEvent);
  }, []);

  useEffect(() => {
    if (!isOpen || !isAuthenticated) return;
    let cancelled = false;
    void aiSettingsService
      .getHistory()
      .then((res) => {
        if (cancelled) return;
        if (Array.isArray(res?.messages) && res.messages.length > 0 && messages.length === 0) {
          const hydrated: ChatMessage[] = res.messages.map((m) => ({
            clientId: m.client_message_id || m.id,
            role: m.role === 'user' ? 'user' : 'assistant',
            text: m.content,
            proposed_actions: m.actions,
            suggested_replies: m.suggested_replies,
          }));
          setMessages(hydrated.slice(-20));
        }
        if (res?.memory && (res.memory.learned_rules?.length || res.memory.custom_notes?.length)) {
          void import('../../utils/advisorMemory').then(({ mergeSyncedMemoryState }) => {
            if (typeof mergeSyncedMemoryState === 'function') {
              mergeSyncedMemoryState(res.memory);
            }
          });
        }
      })
      .catch(() => {
        // Offline / local fallback already handled by localStorage
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, isAuthenticated, messages.length]);

  useEffect(() => {
    if (!isOpen || getAppMode() !== 'local' || alertsDismissed) return;
    try {
      const res = runProactiveWatchdog(loadLocalDB());
      setProactiveAlerts(res.findings.slice(0, 2));
    } catch {
      setProactiveAlerts([]);
    }
  }, [isOpen, alertsDismissed, messages.length]);

  useEffect(() => {
    if (!isOpen) return;
    const scrollToLatest = () => {
      const endEl = messagesEndRef.current;
      if (!endEl) return;
      const parent = endEl.parentElement;
      if (parent && parent.scrollHeight > parent.clientHeight) {
        parent.scrollTop = parent.scrollHeight;
      } else if (typeof endEl.scrollIntoView === 'function') {
        endEl.scrollIntoView({ block: 'end' });
      }
    };
    const rafId =
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(scrollToLatest)
        : (scrollToLatest(), 0);
    const tId = setTimeout(scrollToLatest, 180);
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    vv?.addEventListener?.('resize', scrollToLatest);
    return () => {
      if (rafId && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
      }
      clearTimeout(tId);
      vv?.removeEventListener?.('resize', scrollToLatest);
    };
  }, [messages, isLoading, isOpen]);

  useEffect(() => {
    // Only auto-focus on desktop (>=640px) so mobile soft keyboards do not cover popular prompts/input
    const isDesktop = typeof window === 'undefined' || window.innerWidth >= 640;
    if (isOpen && isDesktop && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSendMessage = async (text?: string) => {
    const attachmentToSend = !text ? pendingAttachment : null;
    const messageText = text || inputText.trim();
    if ((!messageText && !attachmentToSend) || isLoading) return;

    const effectivePrompt = messageText || `Analisa struk gambar ${attachmentToSend?.name || 'terlampir'}`;
    const historyTurns: AIChatTurn[] = messages
      .filter((m) => m.text.trim().length > 0)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.text }));

    const assistantId = `ast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userMessage: ChatMessage = {
      clientId: `usr-${Date.now()}`,
      role: 'user',
      text: effectivePrompt,
      ...(attachmentToSend ? { attachment_name: attachmentToSend.name } : {}),
    };
    const updateAssistantTurn = (updater: (prevMsg: ChatMessage) => ChatMessage) => {
      setMessages((prev) =>
        prev.map((m) => (m.clientId === assistantId ? updater(m) : m))
      );
    };
    setMessages((prev) => [
      ...prev,
      userMessage,
      { clientId: assistantId, role: 'assistant', text: '' },
    ]);
    if (!text) {
      setInputText('');
      setPendingAttachment(null);
    }
    setIsLoading(true);

    const extraOpts = {
      ...(attachmentToSend ? { attachments: [attachmentToSend] } : {}),
      preferences: loadAdvisorMemory() as unknown as Record<string, unknown>,
    };

    try {
      if (typeof aiSettingsService.chatStream === 'function') {
        await aiSettingsService.chatStream(
          effectivePrompt,
          historyTurns,
          {
            onMeta: (meta) => {
              updateAssistantTurn((prevMsg) => ({
                ...prevMsg,
                reason: meta.reason ?? prevMsg.reason,
                proposed_actions: meta.proposed_actions ?? prevMsg.proposed_actions,
                suggested_replies: meta.suggested_replies ?? prevMsg.suggested_replies,
              }));
            },
            onDelta: (chunk) => {
              updateAssistantTurn((prevMsg) => ({
                ...prevMsg,
                text: prevMsg.text + chunk,
              }));
            },
            onDone: (finalRes) => {
              updateAssistantTurn((prevMsg) => ({
                clientId: assistantId,
                role: 'assistant',
                text: prevMsg.text || finalRes.response,
                reason: finalRes.reason || prevMsg.reason,
                proposed_actions: finalRes.proposed_actions ?? prevMsg.proposed_actions,
                suggested_replies: finalRes.suggested_replies ?? prevMsg.suggested_replies,
              }));
            },
          },
          extraOpts
        );
      } else {
        const result = await aiSettingsService.chat(effectivePrompt, historyTurns, extraOpts);
        updateAssistantTurn(() => ({
          clientId: assistantId,
          role: 'assistant',
          text: result.response,
          reason: result.reason,
          proposed_actions: result.proposed_actions,
          suggested_replies: result.suggested_replies,
        }));
      }
    } catch {
      updateAssistantTurn(() => ({
        clientId: assistantId,
        role: 'assistant',
        text: 'Gagal mendapatkan respons dari asisten AI. Silakan coba lagi.',
      }));
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

  const handleExecuteAction = async (
    action: AgenticAction,
    opts?: { silentToast?: boolean }
  ): Promise<boolean> => {
    setActionStates((prev) => ({ ...prev, [action.id]: 'running' }));
    try {
      if (action.type === 'create_transaction') {
        const txReq = action.payload as unknown as CreateTransactionRequest;
        await transactionsService.createTransaction(txReq);
        try {
          const localDb = getAppMode() === 'local' ? loadLocalDB() : null;
          learnFromConfirmedAction(
            String(txReq.description || action.title || ''),
            {
              account_id: txReq.account_id,
              category_id: txReq.category_id,
              type: txReq.type,
            },
            localDb?.accounts || [],
            localDb?.categories || []
          );
        } catch {
          // Non-fatal learning failure
        }
      } else if (action.type === 'create_transfer') {
        await transfersService.createTransfer(action.payload as unknown as TransferRequest);
      } else if (action.type === 'set_budget') {
        const p = action.payload as { category_id: string; month: string; amount: number };
        await budgetsService.setBudget(p.category_id, p.month, p.amount);
      } else if (action.type === 'create_goal') {
        await goalsService.createGoal(action.payload as unknown as CreateGoalPayload);
      } else if (action.type === 'pay_bill') {
        const p = action.payload as {
          bill_id: string;
          amount: number;
          payment_date: string;
          account_id: string;
          notes?: string;
        };
        await billService.payBill(p.bill_id, {
          amount: p.amount,
          payment_date: p.payment_date,
          account_id: p.account_id,
          notes: p.notes ?? null,
        } satisfies PayBillRequest);
      } else if (action.type === 'pay_debt') {
        const p = action.payload as {
          debt_id: string;
          amount: number;
          payment_date: string;
          account_id: string;
          is_extra_payment?: boolean;
          notes?: string;
        };
        await debtsService.recordPayment(p.debt_id, {
          amount: p.amount,
          payment_date: p.payment_date,
          account_id: p.account_id,
          is_extra_payment: Boolean(p.is_extra_payment),
          notes: p.notes,
        } satisfies RecordPaymentRequest);
      } else if (action.type === 'contribute_goal') {
        const p = action.payload as {
          goal_id: string;
          source_account_id: string;
          amount: number;
          date: string;
          notes?: string;
        };
        await goalsService.contributeToGoal(p.goal_id, {
          source_account_id: p.source_account_id,
          amount: p.amount,
          date: p.date,
          notes: p.notes,
        });
      } else if (action.type === 'delete_transaction') {
        const p = action.payload as { transaction_id: string };
        await transactionsService.deleteTransaction(p.transaction_id);
      }
      invalidateFinancialData(queryClient);
      setActionStates((prev) => ({ ...prev, [action.id]: 'done' }));
      if (!opts?.silentToast) {
        toast.success('Aksi AI berhasil dijalankan', action.title);
      }
      return true;
    } catch {
      setActionStates((prev) => ({ ...prev, [action.id]: 'idle' }));
      toast.error('Gagal menjalankan aksi AI');
      return false;
    }
  };

  const handleConfirmAllActions = async (actions: AgenticAction[]) => {
    const pending = actions.filter((act) => (actionStates[act.id] || 'idle') === 'idle');
    let okCount = 0;
    const useSilent = pending.length > 1;
    for (const act of pending) {
      const ok = await handleExecuteAction(act, { silentToast: useSilent });
      if (ok) okCount += 1;
    }
    if (okCount > 1) {
      toast.success(`${okCount} transaksi/aksi berhasil dicatat sekaligus`);
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
    void aiSettingsService.clearHistory().catch(() => {
      // Best-effort clear on server/local DB
    });
  };

  const handleShowBriefing = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const briefing = await aiSettingsService.getDailyBriefing();
      const bulletText =
        briefing.highlights && briefing.highlights.length > 0
          ? `\n\n• ${briefing.highlights.join('\n• ')}`
          : '';
      const msgId = `brf-${Date.now()}`;
      const fullText = `**${briefing.title}**\n\n${briefing.summary}${bulletText}`;
      const replies = [
        'Simulasikan dana pensiun saya',
        'Hitung estimasi PPh 21 tahunan',
        'Cek kuota jajan harian bulan ini',
      ];
      const briefingMsg: ChatMessage = {
        clientId: msgId,
        role: 'assistant',
        text: fullText,
        suggested_replies: replies,
      };
      setMessages((prev) => [...prev, briefingMsg]);
      if (getAppMode() === 'local') {
        const { loadLocalDB: getDb, saveLocalDB: putDb } = await import('../../offline/storage');
        const db = getDb();
        db.advisor_chat_history = [
          ...(db.advisor_chat_history || []),
          {
            id: msgId,
            sender: 'ai' as const,
            text: fullText,
            suggestedReplies: replies,
            timestamp: new Date().toISOString(),
          },
        ].slice(-60);
        putDb(db);
      }
    } catch {
      toast.error('Gagal memuat briefing harian');
    } finally {
      setIsLoading(false);
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
          <div className="flex items-center justify-between gap-2 px-3.5 py-3 bg-indigo-600 text-white shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-sm font-bold leading-tight truncate">AI Financial Advisor</h3>
                <p className="text-[11px] text-indigo-100 mt-0.5 truncate">Asisten Keuangan Keluarga</p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={isLoading}
                onClick={() => void handleShowBriefing()}
                aria-label="Briefing Harian"
                className="whitespace-nowrap bg-white/15 hover:bg-white/25 text-white px-2.5 py-1 rounded-lg transition-colors text-[11px] font-semibold"
                title="Tampilkan briefing keuangan hari ini"
              >
                <span className="sm:hidden">Briefing</span>
                <span className="hidden sm:inline">Briefing Harian</span>
              </button>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearChat}
                  className="whitespace-nowrap text-indigo-100 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10 transition-colors text-xs font-medium"
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

          {!alertsDismissed && proactiveAlerts.length > 0 && (
            <div className="px-3.5 py-2 bg-rose-50/90 dark:bg-rose-950/30 border-b border-rose-200/70 dark:border-rose-900/40 shrink-0 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                <p className="text-[11px] font-medium text-rose-800 dark:text-rose-200 truncate">
                  {proactiveAlerts[0].title}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleSendMessage(`Beri solusi cepat untuk: ${proactiveAlerts[0].title}`)}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-600 text-white hover:bg-rose-700"
                >
                  Tinjau Solusi
                </button>
                <button
                  type="button"
                  onClick={() => setAlertsDismissed(true)}
                  aria-label="Tutup peringatan proaktif AI"
                  className="p-0.5 text-rose-500 hover:text-rose-700"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

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
                    Advisor memahami kas, aset, tagihan, utang, langganan &amp; foto struk Anda.
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
                      {msg.attachment_name && (
                        <div className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-[10px] font-medium mb-1">
                          <ImagePlus className="w-3 h-3" />
                          <span>{msg.attachment_name}</span>
                        </div>
                      )}
                      {msg.role === 'assistant' && !msg.text && isLoading ? (
                        <p className="text-xs italic text-slate-500 dark:text-slate-400">
                          Menganalisis data keuangan Anda...
                        </p>
                      ) : (
                        <AdvisorFormattedText text={msg.text} isUser={msg.role === 'user'} />
                      )}
                      {msg.role === 'assistant' &&
                        Array.isArray(msg.proposed_actions) &&
                        msg.proposed_actions.length > 0 && (() => {
                          const pendingActions = msg.proposed_actions.filter(
                            (a) => (actionStates[a.id] || 'idle') === 'idle'
                          );
                          const isAnyRunning = msg.proposed_actions.some(
                            (a) => actionStates[a.id] === 'running'
                          );
                          const pendingTotal = pendingActions.reduce(
                            (sum, a) => sum + Number((a.payload as { amount?: number })?.amount || 0),
                            0
                          );
                          return (
                            <div className="pt-2 space-y-2">
                               {msg.proposed_actions.map((act) => {
                                const status = actionStates[act.id] || 'idle';
                                if (status === 'dismissed') return null;
                                const isEditing = editingActionId === act.id;
                                return (
                                  <div
                                    key={act.id}
                                    className="rounded-xl border border-indigo-200 dark:border-indigo-800/70 bg-white dark:bg-slate-900 p-2.5 space-y-2 shadow-sm"
                                  >
                                    <div className="flex items-start gap-2">
                                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold text-slate-900 dark:text-white">
                                          {act.title}
                                        </p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                          {act.summary}
                                        </p>
                                      </div>
                                    </div>
                                    {isEditing ? (
                                      <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                                        {(act.type === 'create_transaction' || act.type === 'create_goal') && (
                                          <input
                                            type="text"
                                            aria-label="Deskripsi aksi AI"
                                            value={editDescText}
                                            onChange={(e) => setEditDescText(e.target.value)}
                                            placeholder="Deskripsi"
                                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-white"
                                          />
                                        )}
                                        <input
                                          type="number"
                                          min="1"
                                          aria-label="Nominal aksi AI"
                                          value={editAmountText}
                                          onChange={(e) => setEditAmountText(e.target.value)}
                                          placeholder="Nominal (Rp)"
                                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-white"
                                        />
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => handleSaveEditAction(idx, act.id)}
                                            className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-[11px] font-semibold"
                                          >
                                            Simpan Perubahan
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setEditingActionId(null)}
                                            className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] text-slate-600 dark:text-slate-300"
                                          >
                                            Batal
                                          </button>
                                        </div>
                                      </div>
                                    ) : status === 'done' ? (
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
                                          onClick={() => handleStartEditAction(act)}
                                          className="rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                          aria-label="Edit aksi AI"
                                          title="Edit nominal/deskripsi"
                                        >
                                          <Pencil className="w-3 h-3" />
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
                              {pendingActions.length > 1 && (
                                <button
                                  type="button"
                                  disabled={isAnyRunning}
                                  onClick={() =>
                                    void handleConfirmAllActions(msg.proposed_actions || [])
                                  }
                                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-xs font-semibold shadow-sm disabled:opacity-50"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {`Konfirmasi Semua (${pendingActions.length} Aksi${
                                    pendingTotal > 0
                                      ? ` · Rp ${pendingTotal.toLocaleString('id-ID')}`
                                      : ''
                                  })`}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      {msg.role === 'assistant' && msg.reason && (
                        <div className="pt-1.5 border-t border-slate-200 dark:border-slate-700 mt-1.5">
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            <strong>Alasan:</strong>{' '}
                              {(
                              {
                                'agentic-nlp-on-device': 'Diproses otomatis dari perintah transaksi Anda di perangkat.',
                                'agentic-nlp-on-device-multi': 'Memisahkan beberapa item transaksi sekaligus berdasarkan akun dan kategori Anda.',
                                'agentic-transfer-on-device': 'Diproses otomatis sebagai transfer antar rekening Anda.',
                                'agentic-pay-bill-on-device': 'Mencocokkan tagihan aktif beserta rekening pembayarannya.',
                                'agentic-pay-debt-on-device': 'Mencocokkan kewajiban/cicilan aktif beserta rekening pembayarannya.',
                                'agentic-contribute-goal-on-device': 'Menyiapkan setoran ke target tabungan yang sesuai.',
                                'agentic-delete-transaction-on-device': 'Mencocokkan transaksi terakhir yang ingin dibatalkan.',
                                'agentic-budget-on-device': 'Menyiapkan batas anggaran kategori bulan ini.',
                                'agentic-goal-on-device': 'Menyiapkan target tabungan baru.',
                                'local-what-if-simulation': 'Simulasi dampak komitmen cicilan baru terhadap surplus kas & DTI Anda.',
                                'local-daily-quota-runway': 'Dihitung dari sisa safe-to-spend dibagi sisa hari pada bulan berjalan.',
                                'local-mom-comparison': 'Membandingkan total pengeluaran bulan ini terhadap bulan sebelumnya.',
                                'local-503020-planner': 'Dihitung memakai alokasi sehat 50% kebutuhan, 30% keinginan, dan 20% tabungan.',
                                'local-bills-analysis': 'Disarikan dari tagihan rutin aktif terdekat dan saldo rekening.',
                                'local-debt-analysis': 'Disusun dari daftar utang aktif beserta rasio cicilan Anda.',
                                'local-debt-avalanche-snowball': 'Disimulasikan dengan strategi Avalanche/Snowball beserta percepatan cicilan.',
                                'local-wealth-overview': 'Menggabungkan saldo kas likuid, portofolio aset, dan total kewajiban aktif.',
                                'local-subscriptions-audit': 'Dihitung dari daftar langganan berulang aktif saat ini.',
                                'local-transaction-search': 'Dihitung dari riwayat transaksi yang cocok pada data perangkat Anda.',
                                'local-accounts-snapshot': 'Merangkum saldo seluruh rekening aktif yang tersimpan.',
                                'local-goals-progress': 'Merangkum progres seluruh target tabungan aktif Anda.',
                                'local-pph21-calculator': 'Dihitung memakai lapisan tarif progresif UU HPP dan PTKP resmi.',
                                'local-zakat-calculator': 'Mengacu pada ketentuan nishab 85 gram emas dan tarif zakat 2,5%.',
                                'local-education-calculator': 'Memperhitungkan inflasi biaya pendidikan ~10%/tahun dan compounding bulanan.',
                                'local-retirement-calculator': 'Dihitung dari estimasi pengeluaran pensiun, aset saat ini, dan imbal hasil.',
                                'local-watchdog-analysis': 'Dihitung dari analisis pengeluaran bulan berjalan & sistem pemantau proaktif.',
                                'local-offline-analysis': 'Dihitung langsung dari kas likuid, utang, dan cakupan dana darurat Anda.',
                                'local-on-device-receipt-ocr': 'Dibaca langsung di perangkat memakai ML Kit OCR tanpa mengirim foto ke server.',
                                'local-attachment-notice': 'Lampiran dideteksi di perangkat; foto tidak terbaca otomatis atau butuh Vision AI.',
                                'local-advisor-memory': 'Preferensi disimpan aman ke memori AI Advisor.',
                              } as Record<string, string>
                            )[msg.reason] || msg.reason}
                          </p>
                        </div>
                      )}
                      {msg.role === 'assistant' &&
                        idx === messages.length - 1 &&
                        !isLoading &&
                        Array.isArray(msg.suggested_replies) &&
                        msg.suggested_replies.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1.5">
                            {msg.suggested_replies.slice(0, 3).map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                onClick={() => void handleSendMessage(chip)}
                                className="text-[11px] px-2.5 py-1 rounded-full bg-white/90 dark:bg-slate-900 border border-indigo-200/80 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                              >
                                {chip}
                              </button>
                            ))}
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
            {pendingAttachment && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-900/50 px-3 py-1.5 text-[11px] text-indigo-800 dark:text-indigo-200">
                <span className="font-medium truncate">
                  Lampiran struk: {pendingAttachment.name}
                </span>
                <button
                  type="button"
                  aria-label="Hapus lampiran gambar chat"
                  onClick={() => setPendingAttachment(null)}
                  className="font-semibold text-rose-600 dark:text-rose-400 hover:underline shrink-0"
                >
                  Hapus
                </button>
              </div>
            )}
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
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="Pilih gambar struk AI"
              onChange={handleSelectImage}
              className="hidden"
            />
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tulis pertanyaan Anda atau lampirkan struk..."
                disabled={isLoading}
                rows={2}
                className="flex-1 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 resize-none text-slate-900 dark:text-white placeholder:text-slate-400 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                aria-label="Lampirkan gambar atau struk ke chat"
                title="Lampirkan foto struk / mutasi"
                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 transition-colors shrink-0 mb-0.5"
              >
                <ImagePlus className="w-5 h-5" />
              </button>
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
                disabled={(!inputText.trim() && !pendingAttachment) || isLoading}
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
