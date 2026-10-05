import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Check,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import type { BadgeTone } from "./design";
import { formatDateUTC } from "./dateTime";

const modalStack: HTMLElement[] = [];
let modalBackground: { shell: HTMLElement | null; inert: boolean; overflow: string } | null = null;
function registerModal(backdrop: HTMLElement) {
  if (!modalStack.length) {
    const shell = document.querySelector<HTMLElement>(".app-shell");
    modalBackground = { shell, inert: shell?.inert ?? false, overflow: document.body.style.overflow };
    if (shell) shell.inert = true;
    document.body.style.overflow = "hidden";
  }
  modalStack.push(backdrop);
  for (const item of modalStack) item.inert = item !== backdrop;
  return () => {
    const index = modalStack.indexOf(backdrop);
    if (index !== -1) modalStack.splice(index, 1);
    for (const item of modalStack) item.inert = item !== modalStack.at(-1);
    if (!modalStack.length && modalBackground) {
      document.body.style.overflow = modalBackground.overflow;
      if (modalBackground.shell) modalBackground.shell.inert = modalBackground.inert;
      modalBackground = null;
    }
  };
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 4 26 8v8c0 6-10 12-10 12S6 22 6 16V8L16 4Z" />
          <path d="m11 14 5 7 6-11" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-name">
          XLab <strong>Vigil</strong>
          <small>KURUMSAL GÜVENLİK</small>
        </span>
      )}
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${small ? "small" : ""}`} aria-hidden="true">
      {name
        .split(" ")
        .slice(0, 2)
        .map((x) => x[0])
        .join("")
        .toLocaleUpperCase("tr")}
    </span>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Search size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PageNavigation({
  page,
  count,
  caption,
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
}: {
  page: number;
  count: number;
  caption: string;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className="table-pagination" aria-label="Sayfalama">
      <span>
        {count} kayıt · Sayfa {page}
        <small>{caption}</small>
      </span>
      <div className="inline-actions">
        <button
          className="btn secondary"
          type="button"
          disabled={previousDisabled}
          onClick={onPrevious}
        >
          Önceki
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={nextDisabled}
          onClick={onNext}
        >
          Sonraki <ArrowRight size={14} />
        </button>
      </div>
    </nav>
  );
}
export function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="form-error" role="alert">
      {children}
    </div>
  );
}
export function Loading({ label = "Veriler yükleniyor…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> {label}
    </div>
  );
}
export function LoadError({
  title = "Bu bölüm yüklenemedi",
  message,
  onRetry,
  retryLabel = "Yeniden dene",
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="error-panel" role="alert">
      <ShieldAlert size={22} />
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      <button className="btn secondary" type="button" onClick={onRetry}>
        <RefreshCw size={16} /> {retryLabel}
      </button>
    </div>
  );
}
export function InlineError({
  message,
  detail,
  onRetry,
  retryLabel = "Yeniden dene",
}: {
  message: string;
  detail?: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="inline-resource-error" role="alert">
      <span>
        {message} {detail && <span>{detail}</span>}
      </span>
      <button className="link-btn" type="button" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}
export function SuccessNotice({
  children,
  appearance = "panel",
}: {
  children: ReactNode;
  appearance?: "panel" | "inline";
}) {
  return appearance === "inline" ? (
    <span className="success-inline" role="status">
      <Check size={14} /> {children}
    </span>
  ) : (
    <div className="success-strip" role="status">
      <Check size={17} /> {children}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
  closeDisabled = false,
  bare = false,
  className = "",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
  /** Visually hidden title and no close button; Escape and the backdrop close it. */
  bare?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const titleId = useId();
  const subtitleId = useId();
  close.current = () => {
    if (!closeDisabled) onClose();
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const backdrop = ref.current?.parentElement;
    const unregister = backdrop ? registerModal(backdrop) : () => {};
    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button, a[href], input, select, textarea, summary, [tabindex]",
        ) || [],
      ).filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(":disabled") &&
          !element.closest('[inert], [aria-hidden="true"]') &&
          element.getClientRects().length > 0 &&
          window.getComputedStyle(element).visibility === "visible",
      );
    const initialTargets = focusables();
    const firstField = initialTargets.find((element) =>
      element.matches("input, textarea, select"),
    );
    const preferred = initialTargets.find((element) => element.hasAttribute("data-initial-focus"));
    (preferred || firstField || initialTargets[0] || ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll<HTMLElement>(
        ".modal-backdrop .modal",
      );
      if (dialogs.item(dialogs.length - 1) !== ref.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const list = focusables();
        const first = list[0];
        const last = list.at(-1);
        if (!first || !last) {
          e.preventDefault();
          ref.current?.focus();
        } else if (
          !ref.current?.contains(document.activeElement) ||
          !list.includes(document.activeElement as HTMLElement)
        ) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      unregister();
      // The parent removes its inert state in the same commit as this dialog.
      // Restore focus after that commit so the trigger can receive it.
      window.requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.closest("[inert]")) previous.focus();
      });
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        ref={ref}
      >
        {bare ? (
          <h2 id={titleId} className="sr-only">{title}</h2>
        ) : (
          <header className="modal-head">
            <div>
              <h2 id={titleId}>{title}</h2>
              {subtitle && <p id={subtitleId}>{subtitle}</p>}
            </div>
            <button
              className="icon-btn"
              type="button"
              aria-label="Pencereyi kapat"
              disabled={closeDisabled}
              onClick={() => close.current()}
            >
              <X size={20} />
            </button>
          </header>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="link-btn" onClick={onClick}>
      {children}
      <ArrowRight size={15} />
    </button>
  );
}
export function dateLabel(value: string, long = false) {
  return formatDateUTC(value, long);
}
