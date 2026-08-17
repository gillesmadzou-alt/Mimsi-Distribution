import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title?: string;
  message: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  defaultValue?: string;
  danger?: boolean;
  multiline?: boolean;
  required?: boolean;
}

interface ConfirmContextValue {
  confirmDialog: (opts: ConfirmOptions) => Promise<boolean>;
  promptDialog: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

interface DialogState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface PromptState extends PromptOptions {
  resolve: (value: string | null) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const confirmDialog = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialog({ ...opts, resolve });
    });
  }, []);

  const promptDialog = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPrompt({ ...opts, resolve });
      setPromptValue(opts.defaultValue ?? '');
    });
  }, []);

  const closeDialog = useCallback((result: boolean) => {
    dialog?.resolve(result);
    setDialog(null);
  }, [dialog]);

  const closePrompt = useCallback((result: string | null) => {
    prompt?.resolve(result);
    setPrompt(null);
    setPromptValue('');
  }, [prompt]);

  useEffect(() => {
    if (prompt && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [prompt]);

  const headerGradient = (isDanger: boolean) =>
    isDanger !== false
      ? 'bg-gradient-to-r from-red-500 to-red-600'
      : 'bg-gradient-to-r from-amber-500 to-orange-500';

  const confirmBtn = (isDanger: boolean) =>
    isDanger !== false
      ? 'bg-red-600 hover:bg-red-700 shadow-md shadow-red-600/30'
      : 'bg-amber-500 hover:bg-amber-600 shadow-md shadow-amber-500/30';

  return (
    <ConfirmContext.Provider value={{ confirmDialog, promptDialog }}>
      {children}

      {/* Confirmation dialog */}
      {dialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
            onClick={() => closeDialog(false)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden animate-[scaleIn_180ms_ease-out]">
            <div className={`px-5 py-4 flex items-center gap-3 ${headerGradient(dialog.danger)}`}>
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-base leading-tight tracking-wide">Mimsi Distribution</p>
                <p className="text-white/80 text-xs font-medium">{dialog.title ?? 'Confirmation requise'}</p>
              </div>
              <button
                onClick={() => closeDialog(false)}
                className="shrink-0 p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-5">
              <p className="text-gray-700 text-sm leading-relaxed">{dialog.message}</p>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => closeDialog(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors active:scale-[0.97]"
              >
                {dialog.cancelLabel ?? 'Annuler'}
              </button>
              <button
                onClick={() => closeDialog(true)}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.97] ${confirmBtn(dialog.danger)}`}
              >
                {dialog.confirmLabel ?? 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt dialog */}
      {prompt && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
            onClick={() => closePrompt(null)}
          />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-[scaleIn_180ms_ease-out]">
            <div className={`px-5 py-4 flex items-center gap-3 ${headerGradient(prompt.danger)}`}>
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-base leading-tight tracking-wide">Mimsi Distribution</p>
                <p className="text-white/80 text-xs font-medium">{prompt.title ?? 'Saisie requise'}</p>
              </div>
              <button
                onClick={() => closePrompt(null)}
                className="shrink-0 p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-5 space-y-3">
              <p className="text-gray-700 text-sm leading-relaxed">{prompt.message}</p>
              {prompt.multiline ? (
                <textarea
                  ref={textareaRef}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  rows={3}
                  placeholder={prompt.placeholder ?? ''}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) {
                      if (!prompt.required || promptValue.trim()) closePrompt(promptValue.trim() || '');
                    }
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none resize-none text-sm text-gray-800 placeholder:text-gray-400 transition-all"
                />
              ) : (
                <input
                  ref={textareaRef as React.RefObject<HTMLInputElement>}
                  type="text"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  placeholder={prompt.placeholder ?? ''}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (!prompt.required || promptValue.trim()) closePrompt(promptValue.trim() || '');
                    }
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none text-sm text-gray-800 placeholder:text-gray-400 transition-all"
                />
              )}
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => closePrompt(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors active:scale-[0.97]"
              >
                {prompt.cancelLabel ?? 'Annuler'}
              </button>
              <button
                onClick={() => closePrompt(promptValue.trim() || '')}
                disabled={prompt.required && !promptValue.trim()}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${confirmBtn(prompt.danger)}`}
              >
                {prompt.confirmLabel ?? 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
