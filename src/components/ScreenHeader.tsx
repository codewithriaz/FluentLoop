import type { ReactNode } from "react";
import { ShellMenuButton, useShell } from "./Shell";
import { cx } from "./ui";

/**
 * Page header: title, optional subtitle, actions on the right, optional filter row (children) and
 * tabs along the bottom edge. Doubles as the window drag region (overlay title bar).
 */
export function ScreenHeader({
  title,
  subtitle,
  actions,
  children,
  tabs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  tabs?: ReactNode;
}) {
  const { mobile } = useShell();
  return (
    <header data-tauri-drag-region className={cx("shrink-0 border-b border-line bg-bg px-5 pt-5 md:px-8", !tabs && "pb-4", mobile && "pt-9")}>
      <div data-tauri-drag-region className="flex min-h-9 flex-wrap items-start gap-x-4 gap-y-3">
        <ShellMenuButton />
        <div data-tauri-drag-region className="min-w-0 flex-1 basis-[200px]">
          <h1 data-tauri-drag-region className="truncate text-[24px] font-semibold leading-tight tracking-tight">
            {title}
          </h1>
          {subtitle && <div className="mt-0.5 truncate text-[13.5px] text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-4">{tabs}</div>}
      {children && <div className={cx(tabs ? "-mx-5 border-t border-line px-5 py-3 md:-mx-8 md:px-8" : "mt-4")}>{children}</div>}
    </header>
  );
}
