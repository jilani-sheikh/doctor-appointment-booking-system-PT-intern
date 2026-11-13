"use client";

import {
  parseFormattedAssistantBlocks,
  type FormattedSpan,
} from "@/lib/ai/format-text";

function renderInlineSpans(spans: FormattedSpan[], isError?: boolean) {
  return spans.map((span, idx) =>
    span.bold ? (
      <strong
        key={idx}
        className={`font-semibold ${isError ? "text-destructive" : "text-foreground"}`}
      >
        {span.text}
      </strong>
    ) : (
      <span key={idx}>{span.text}</span>
    )
  );
}

export function FormattedAssistantText({
  content,
  isError = false,
}: {
  content: string;
  isError?: boolean;
}) {
  const blocks = parseFormattedAssistantBlocks(content);
  if (blocks.length === 0) {
    return (
      <span className="whitespace-pre-wrap">{content.replaceAll("*", "")}</span>
    );
  }

  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <p
              key={index}
              className={`font-semibold pt-1 first:pt-0 tracking-[-0.01em] ${
                isError ? "text-destructive" : "text-foreground"
              }`}
            >
              {renderInlineSpans(block.spans, isError)}
            </p>
          );
        }
        if (block.kind === "bullet") {
          return (
            <div key={index} className="flex items-start gap-2 pl-0.5">
              <span
                aria-hidden="true"
                className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                  isError ? "bg-destructive/75" : "bg-primary/75"
                }`}
              />
              <span className="min-w-0 flex-1">
                {renderInlineSpans(block.spans, isError)}
              </span>
            </div>
          );
        }
        if (block.kind === "numbered") {
          return (
            <div key={index} className="flex items-start gap-2 pl-0.5">
              <span
                className={`shrink-0 font-semibold ${
                  isError ? "text-destructive" : "text-primary"
                }`}
              >
                {block.numberLabel}
              </span>
              <span className="min-w-0 flex-1">
                {renderInlineSpans(block.spans, isError)}
              </span>
            </div>
          );
        }
        return (
          <p key={index} className="break-words">
            {renderInlineSpans(block.spans, isError)}
          </p>
        );
      })}
    </div>
  );
}

