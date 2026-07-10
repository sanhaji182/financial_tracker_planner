import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, ChevronDown, MessageSquare } from 'lucide-react';
import { aiSettingsService, type AISettings } from '../../services/aiSettings';
import { useAuthStore } from '../../stores/authStore';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  reason?: string;
}

const QUICK_QUESTIONS = [
  'Bagaimana kondisi keuangan saya bulan ini?',
  'Apakah dana darurat saya sudah cukup?',
  'Bagaimana cara melunasi utang lebih cepat?',
  'Di mana saya bisa menghemat pengeluaran?',
  'Apakah saya on-track menuju tujuan finansial?',
];

export const AdvisorChatDrawer: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [advisorEnabled, setAdvisorEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load AI settings to check if advisor is enabled
  useEffect(() => {
    if (!isAuthenticated) {
      setAdvisorEnabled(false);
      setSettingsLoaded(true);
      return;
    }

    const checkAdvisorEnabled = async () => {
      try {
        const settings: AISettings = await aiSettingsService.getSettings();
        setAdvisorEnabled(settings.ai_enabled && settings.advisor_enabled);
      } catch {
        // Silently fail; button won't show if settings can't be loaded
        setAdvisorEnabled(false);
      } finally {
        setSettingsLoaded(true);
      }
    };
    checkAdvisorEnabled();
  }, [isAuthenticated]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSendMessage = async (text?: string) => {
    const messageText = text || inputText.trim();
    if (!messageText || isLoading) return;

    const userMessage: ChatMessage = { role: 'user', text: messageText };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      const result = await aiSettingsService.chat(messageText);
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        text: result.response,
        reason: result.reason,
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        text: '⚠️ Gagal mendapatkan respons dari asisten AI. Silakan coba lagi.',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  // Don't render if settings not loaded or advisor not enabled
  if (!settingsLoaded || !advisorEnabled) return null;

  return (
    <>
      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          id="advisor-chat-toggle"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-full shadow-xl transition-all duration-200 hover:scale-105 active:scale-95"
          title="Tanya AI Advisor"
        >
          <Bot className="w-5 h-5" />
          <span className="text-sm font-semibold">AI Advisor</span>
        </button>
      )}

      {/* Chat Drawer Panel */}
      {isOpen && (
        <div className="fixed bottom-0 right-0 md:bottom-6 md:right-6 z-50 w-full md:w-[400px] max-h-[90vh] md:max-h-[600px] flex flex-col shadow-2xl rounded-t-2xl md:rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-indigo-600 text-white shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold leading-none">AI Financial Advisor</h3>
                <p className="text-[10px] text-indigo-200 mt-0.5">Powered by LLM · Saran bersifat edukatif</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={handleClearChat}
                  className="text-indigo-200 hover:text-white p-1.5 rounded-lg transition-colors text-xs"
                  title="Hapus riwayat chat"
                >
                  Hapus
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                title="Tutup"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Disclaimer Banner */}
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/30 shrink-0">
            <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium text-center">
              🤖 Saran AI — bukan nasihat keuangan profesional. Konsultasikan keputusan penting kepada konsultan keuangan tersetifikasi.
            </p>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-4 h-full justify-center items-center text-center">
                <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center">
                  <MessageSquare className="w-7 h-7 text-indigo-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">Tanya Asisten AI Anda</p>
                  <p className="text-xs text-text-secondary mt-1">
                    Advisor memiliki akses ke ringkasan dasbor, neraca, hutang, anggaran, dan status dana darurat Anda.
                  </p>
                </div>
                {/* Quick Questions */}
                <div className="w-full space-y-2 mt-2">
                  <p className="text-[10px] text-text-secondary uppercase font-semibold tracking-wider">Pertanyaan Populer</p>
                  {QUICK_QUESTIONS.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(q)}
                      disabled={isLoading}
                      className="w-full text-left text-xs bg-slate-50 hover:bg-indigo-50 dark:bg-slate-800/50 dark:hover:bg-indigo-950/30 text-text-secondary hover:text-indigo-600 dark:hover:text-indigo-400 px-3 py-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-900/50 transition-all"
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
                      <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-tl-xl rounded-tr-sm rounded-bl-xl rounded-br-xl'
                          : 'bg-slate-100 dark:bg-slate-800 text-text-primary rounded-tl-sm rounded-tr-xl rounded-bl-xl rounded-br-xl'
                      } px-3.5 py-2.5 space-y-1`}
                    >
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      {msg.role === 'assistant' && msg.reason && (
                        <div className="pt-1.5 border-t border-slate-200 dark:border-slate-700 mt-1.5">
                          <p className="text-[10px] text-text-secondary">
                            <strong>Alasan:</strong> {msg.reason}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex gap-2 justify-start">
                    <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-tl-sm rounded-tr-xl rounded-bl-xl rounded-br-xl px-4 py-3">
                      <div className="flex gap-1.5 items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-700 shrink-0 bg-white dark:bg-slate-900">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tulis pertanyaan Anda... (Enter untuk kirim)"
                disabled={isLoading}
                rows={2}
                className="flex-1 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-text-primary placeholder:text-slate-400 disabled:opacity-60"
              />
              <button
                onClick={() => handleSendMessage()}
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
      )}
    </>
  );
};

export default AdvisorChatDrawer;
