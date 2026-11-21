import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footerActions?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

interface ModalStackEntry {
  id: symbol;
  depth: number;
  seq: number;
  onCloseRef: React.MutableRefObject<() => void>;
}

const ModalDepthContext = createContext(0);
const modalStack: ModalStackEntry[] = [];
const stackListeners = new Set<() => void>();
let nextSeq = 1;

function notifyStackChange() {
  modalStack.sort((a, b) => a.depth - b.depth || a.seq - b.seq);
  stackListeners.forEach((listener) => listener());
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footerActions,
  size = 'md',
}) => {
  const depth = useContext(ModalDepthContext);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const modalIdRef = useRef<symbol | null>(null);
  if (!modalIdRef.current) {
    modalIdRef.current = Symbol('modal');
  }

  const [, setStackVersion] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

    const modalId = modalIdRef.current!;
    const triggerUpdate = () => setStackVersion((v) => v + 1);
    stackListeners.add(triggerUpdate);

    const existingIndex = modalStack.findIndex((entry) => entry.id === modalId);
    if (existingIndex === -1) {
      modalStack.push({ id: modalId, depth, seq: nextSeq++, onCloseRef });
    } else {
      modalStack[existingIndex].depth = depth;
      modalStack[existingIndex].onCloseRef = onCloseRef;
    }
    notifyStackChange();

    document.body.style.overflow = 'hidden';

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const topModal = modalStack[modalStack.length - 1];
      if (topModal && topModal.id === modalId) {
        topModal.onCloseRef.current();
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('keydown', handleEscape);
      stackListeners.delete(triggerUpdate);
      const idx = modalStack.findIndex((entry) => entry.id === modalId);
      if (idx !== -1) {
        modalStack.splice(idx, 1);
      }
      notifyStackChange();
      if (modalStack.length === 0) {
        document.body.style.overflow = '';
      }
    };
  }, [isOpen, depth]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-[400px]',
    md: 'max-w-[540px]',
    lg: 'max-w-[720px]',
    xl: 'max-w-[960px]',
  };

  const currentIdx = modalStack.findIndex((entry) => entry.id === modalIdRef.current);
  const effectiveIndex = currentIdx >= 0 ? currentIdx : depth;
  const zIndex = 60 + effectiveIndex * 2;

  const modalContent = (
    <ModalDepthContext.Provider value={depth + 1}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ zIndex }}
        className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/35 backdrop-blur-[2px] animate-backdrop-in"
      >
        <div className="absolute inset-0" onClick={onClose} />
        <div
          className={`w-full max-h-[92dvh] sm:max-h-[90vh] bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col relative z-10 animate-slide-up sm:animate-scale-up overflow-hidden pb-safe sm:pb-0 ${sizes[size]}`}
        >
          {/* Mobile sheet grabber */}
          <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0" aria-hidden="true">
            <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
          </div>

          {/* Header */}
          <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
              {title}
            </h3>
            <Button
              variant="ghost"
              onClick={onClose}
              aria-label="Tutup dialog"
              className="!p-1.5 !h-auto rounded-lg text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {children}
          </div>

          {/* Footer */}
          {footerActions ? (
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-50/80 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-end gap-2.5 shrink-0">
              {footerActions}
            </div>
          ) : null}
        </div>
      </div>
    </ModalDepthContext.Provider>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
