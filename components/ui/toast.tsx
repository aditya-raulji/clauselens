"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import clsx from "clsx";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";

export type ToastType = "info" | "success" | "error" | "warning";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  type?: ToastType;
}

interface ToastContextType {
  toast: (item: Omit<ToastItem, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, type = "info" }: Omit<ToastItem, "id">) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, title, description, type }]);
      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => {
          const icons = {
            info: <Info className="w-4 h-4 text-[#5267A8] shrink-0" />,
            success: (
              <CheckCircle2 className="w-4 h-4 text-[#3F7D58] shrink-0" />
            ),
            error: (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            ),
            warning: (
              <AlertTriangle className="w-4 h-4 text-[#B7791F] shrink-0" />
            ),
          };

          return (
            <div
              key={t.id}
              className={clsx(
                "pointer-events-auto flex items-start gap-3 p-3.5 bg-[#FCFBF8] border border-[#E7E2D9]",
                "rounded-[12px] shadow-[0_4px_20px_rgba(0,0,0,0.04)] text-sm transition-all animate-in slide-in-from-bottom-2"
              )}
            >
              <div className="mt-0.5">{icons[t.type || "info"]}</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[#171717]">{t.title}</p>
                {t.description && (
                  <p className="text-xs text-[#77736C] mt-0.5 leading-snug">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => removeToast(t.id)}
                className="text-[#77736C] hover:text-[#171717] p-0.5 rounded transition-colors"
                aria-label="Close toast"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
