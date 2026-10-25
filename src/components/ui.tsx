import { forwardRef, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Loader2, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-text hover:bg-primary-hover border border-transparent",
  secondary: "bg-panel text-ink border border-line hover:bg-hover",
  ghost: "text-ink hover:bg-hover border border-transparent",
  danger: "bg-danger text-white hover:opacity-90 border border-transparent",
  soft: "bg-accent-soft text-accent-text hover:brightness-95 border border-transparent",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition-colors disabled:opacity-45 disabled:pointer-events-none",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={size === "sm" ? 13 : 15} strokeWidth={2} /> : null}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  size?: number;
  tone?: "default" | "danger" | "success" | "warn" | "accent";
}

const tones = {
  default: "text-ink",
  danger: "text-danger",
  success: "text-success",
  warn: "text-warn",
  accent: "text-accent",
};

export function IconButton({ icon: Icon, label, active, size = 15, tone = "default", className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control transition-colors disabled:opacity-35 disabled:pointer-events-none",
        active ? "bg-accent-soft text-accent-text" : cx("hover:bg-hover", tones[tone]),
        className,
      )}
      {...rest}
    >
      <Icon size={size} strokeWidth={2} />
    </button>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        "h-9 w-full rounded-control border border-line bg-panel px-3 text-[13px] text-ink placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...rest}
    />
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(
        "w-full rounded-control border border-line bg-panel px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y",
        className,
      )}
      {...rest}
    />
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx("h-9 rounded-control border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20", className)}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("flex items-center gap-2 text-[13px]", disabled && "opacity-50")}>
      <input type="checkbox" className="accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx("animate-spin text-muted", className)} />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-[5px] font-medium transition-colors",
            size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-7 px-2.5 text-[12.5px]",
            value === o.value ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-sunken text-muted">
        <Icon size={20} />
      </div>
      <div className="text-[14px] font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-sm text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] text-danger whitespace-pre-wrap selectable">{children}</div>;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "success" | "warn" | "danger" | "a" | "b"; className?: string }) {
  const t = {
    neutral: "bg-sunken text-muted",
    accent: "bg-accent-soft text-accent-text",
    success: "bg-success-soft text-success",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    a: "bg-pa-soft text-pa",
    b: "bg-pb-soft text-pb",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium whitespace-nowrap", t, className)}>{children}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="flex max-h-[85vh] w-[calc(100vw-32px)] flex-col rounded-card border border-line bg-panel shadow-pop"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="text-[14px] font-semibold">{title}</div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

/** Small dropdown menu anchored to a trigger button. */
/** Dropdown menu: Esc closes, ↑/↓/Home/End move focus, focus returns to the trigger on close. */
export function Menu({ trigger, items, align = "right" }: { trigger: (open: () => void) => ReactNode; items: (MenuItem | "divider")[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const keys = (e: KeyboardEvent) => {
      const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        returnFocus.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        buttons[e.key === "Home" ? 0 : buttons.length - 1]?.focus();
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", keys, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", keys, true);
    };
  }, [open]);
  return (
    <div className="relative inline-flex" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div
          ref={listRef}
          role="menu"
          className={cx("absolute top-full z-40 mt-1 min-w-[200px] rounded-card border border-line bg-panel p-1 shadow-pop", align === "right" ? "right-0" : "left-0")}
        >
          {items.map((it, i) =>
            it === "divider" ? (
              <div key={i} className="my-1 border-t border-line" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className={cx(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none hover:bg-hover focus-visible:bg-hover disabled:opacity-40",
                  it.danger ? "text-danger" : "text-ink",
                )}
              >
                {it.icon && <it.icon size={14} className="shrink-0 opacity-80" />}
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[11px] text-faint">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</div>
      {right}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-sunken px-1 font-mono text-[10.5px] text-muted">{children}</kbd>;
}

/** Search input with an icon and an optional ⌘K / Ctrl+K shortcut that focuses it. */
export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  shortcut = false,
  className,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  shortcut?: boolean;
  className?: string;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);
  return (
    <div className={cx("relative", className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
          onKeyDown?.(e);
        }}
        className={cx(
          "h-9 w-full rounded-control border border-line bg-panel pl-9 text-[13px] text-ink placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 [&::-webkit-search-cancel-button]:hidden",
          shortcut ? "pr-14" : "pr-3",
        )}
      />
      {shortcut && !value && (
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-sunken px-1.5 font-sans text-[11px] text-muted">⌘K</kbd>
      )}
    </div>
  );
}

/** Underlined tabs under a page header (keyboard: ←/→ between tabs). */
export function PageTabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t, i) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          tabIndex={value === t.value ? 0 : -1}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
            onChange(next.value);
            requestAnimationFrame(() => (e.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLElement | undefined)?.focus());
          }}
          className={cx(
            "shrink-0 border-b-2 px-3 pb-2.5 text-[13.5px] font-medium outline-none transition-colors focus-visible:text-ink",
            value === t.value ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Scrollable page body with consistent padding and an optional max width. */
export function Page({ children, width = "max-w-5xl", className }: { children: ReactNode; width?: string; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cx("w-full px-5 py-6 md:px-8", width, className)}>{children}</div>
    </div>
  );
}
