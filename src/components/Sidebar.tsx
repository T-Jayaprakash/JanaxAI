"use client";

import { Check, FolderOpen, MessageSquarePlus, PanelLeftClose, Pencil, Trash2, UserRound, X } from "lucide-react";
import { useState } from "react";
import type { ConversationSummary } from "@/lib/client/api";
import { Wordmark } from "./Logo";

export function Sidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onClose,
  onOpenProjects,
  onOpenAccount,
}: {
  conversations: ConversationSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onOpenProjects: () => void;
  onOpenAccount: () => void;
}) {
  return (
    <nav aria-label="Conversations" className="flex h-full w-[272px] flex-col border-r border-line bg-bg-2">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <Wordmark />
        <button onClick={onClose} aria-label="Close sidebar" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink">
          <PanelLeftClose size={17} />
        </button>
      </div>
      <div className="px-3">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-xl border border-line bg-card px-3 py-2.5 text-sm hover:border-accent/40"
        >
          <MessageSquarePlus size={16} className="text-accent" /> New video
        </button>
      </div>
      <p className="px-5 pb-1 pt-5 text-[11px] font-medium uppercase tracking-wider text-faint">Recent</p>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 && <li className="px-3 py-2 text-xs text-faint">No conversations yet.</li>}
        {conversations.map((c) => (
          <ConversationRow
            key={c.id}
            c={c}
            active={c.id === currentId}
            onSelect={() => onSelect(c.id)}
            onRename={(t) => onRename(c.id, t)}
            onDelete={() => onDelete(c.id)}
          />
        ))}
      </ul>
      <div className="space-y-0.5 border-t border-line p-2">
        <button onClick={onOpenProjects} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted hover:bg-card hover:text-ink">
          <FolderOpen size={16} /> Projects
        </button>
        <button onClick={onOpenAccount} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted hover:bg-card hover:text-ink">
          <UserRound size={16} /> Account & usage
        </button>
      </div>
    </nav>
  );
}

function ConversationRow({
  c,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  c: ConversationSummary;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"view" | "rename" | "confirm">("view");
  const [draft, setDraft] = useState(c.title);

  if (mode === "rename") {
    return (
      <li>
        <form
          className="flex items-center gap-1 rounded-lg bg-card px-2 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) onRename(draft.trim());
            setMode("view");
          }}
        >
          <input
            autoFocus
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setMode("view")}
            aria-label="Conversation title"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm focus:outline-none"
          />
          <button type="submit" aria-label="Save title" className="p-1 text-accent">
            <Check size={14} />
          </button>
          <button type="button" aria-label="Cancel rename" onClick={() => setMode("view")} className="p-1 text-muted">
            <X size={14} />
          </button>
        </form>
      </li>
    );
  }

  if (mode === "confirm") {
    return (
      <li className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs">
        <p className="mb-1.5 text-ink">Delete “{c.title}” and its videos?</p>
        <div className="flex gap-2">
          <button onClick={onDelete} className="rounded-md bg-danger px-2.5 py-1 font-medium text-bg">
            Delete
          </button>
          <button onClick={() => setMode("view")} className="rounded-md px-2.5 py-1 text-muted hover:text-ink">
            Keep
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`group flex items-center rounded-lg ${active ? "bg-card" : "hover:bg-card/60"}`}>
      <button onClick={onSelect} aria-current={active ? "page" : undefined} className="min-w-0 flex-1 px-3 py-2 text-left">
        <span className={`block truncate text-sm ${active ? "text-ink" : "text-muted group-hover:text-ink"}`}>{c.title}</span>
        {c.versionCount > 0 && <span className="text-[11px] text-faint">{c.versionCount} version{c.versionCount > 1 ? "s" : ""}</span>}
      </button>
      <div className="flex pr-1 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <button
          onClick={() => {
            setDraft(c.title);
            setMode("rename");
          }}
          aria-label={`Rename ${c.title}`}
          className="grid h-7 w-7 place-items-center rounded-md text-faint hover:text-ink"
        >
          <Pencil size={13} />
        </button>
        <button onClick={() => setMode("confirm")} aria-label={`Delete ${c.title}`} className="grid h-7 w-7 place-items-center rounded-md text-faint hover:text-danger">
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}
