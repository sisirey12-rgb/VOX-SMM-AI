import { useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";

export function Status({ children }: { children: string }) {
  const tone = /fail|error|cancel|void|revoked/i.test(children)
    ? "danger"
    : /uncertain|reconcil|pending|review|paused|partial/i.test(children)
      ? "warning"
      : /active|completed|closed|captured|accepted|submitted/i.test(children)
        ? "success"
        : "neutral";
  return <span className="glass-status" data-tone={tone}>{children}</span>;
}

export function Loading({ label }: { label: string }) {
  return <span className="glass-loading" role="status"><span aria-hidden="true" />{label}</span>;
}

export function GlassDialog({
  trigger,
  triggerLabel,
  onOpen,
  title,
  children,
}: {
  trigger: ReactNode;
  triggerLabel?: string;
  onOpen?: () => void;
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  return (
    <>
      <button type="button" className="glass-action" aria-label={triggerLabel} onClick={() => { dialog.current?.showModal(); onOpen?.(); }}>{trigger}</button>
      <dialog className="glass-dialog" aria-label={title} ref={dialog}>
        <div className="glass-dialog-header">
          <h2>{title}</h2>
          <button type="button" className="glass-action" onClick={close} aria-label="Close dialog"><X size={18} /></button>
        </div>
        {children(close)}
      </dialog>
    </>
  );
}

export function PageSearch({ pages, navigate }: {
  pages: readonly string[];
  navigate: (page: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = pages.filter((page) => page.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <GlassDialog title="Find a workspace page" triggerLabel="Search pages" trigger={<><Search size={17} aria-hidden="true" /><span>Search pages</span></>}>
      {(close) => (
        <div className="glass-search">
          <label>
            Search pages
            <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {matches.length ? (
            <ul>{matches.map((page) => (
              <li key={page}>
                <button type="button" onClick={() => { close(); setQuery(""); navigate(page); }}>
                  {page}<ArrowUpRight size={15} aria-hidden="true" />
                </button>
              </li>
            ))}</ul>
          ) : <p>No matching pages.</p>}
        </div>
      )}
    </GlassDialog>
  );
}
