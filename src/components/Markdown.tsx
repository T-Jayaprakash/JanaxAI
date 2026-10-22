"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders assistant replies (plans, captions, tables) safely: no raw HTML. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="janux-md text-[15px] leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
