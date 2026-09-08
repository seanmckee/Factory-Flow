import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The agent's replies, rendered.
 *
 * The transcript used to draw them with `whitespace-pre-wrap`, so every
 * `**bold**`, heading and bullet arrived as literal asterisks and hyphens —
 * and the model leans on all three, because a P&L answer *is* a list of
 * labelled figures. It read as broken sitting beside the verdict card, which
 * is exactly the comparison a reader makes.
 *
 * **Why a dependency rather than a small parser of our own.** The alternative
 * is a parser, not a formatter: bold, lists, headings, inline code and tables
 * interact (an asterisk inside a code span is not emphasis), and a subset
 * renderer is wrong at exactly the edges a model wanders into. This is also
 * the safe direction — `react-markdown` produces React elements rather than
 * an HTML string, so there is no `dangerouslySetInnerHTML` anywhere in the
 * path, and **raw HTML in the source is escaped rather than rendered**
 * because `rehype-raw` is deliberately absent. Model output is untrusted text
 * as far as this component is concerned; don't add a raw-HTML plugin.
 *
 * `remark-gfm` is here for **tables**: asked for a P&L comparison the model
 * reaches for one, and a GFM table without the plugin renders as pipes.
 *
 * Styling is a component map rather than a typography plugin, so every colour
 * and spacing value stays a semantic token — the project's one styling rule.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => (
            <strong className="font-medium text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          // One heading style for every level. The model's h2 and h4 are not a
          // document outline, they are emphasis — rendering six sizes inside a
          // chat bubble would imply a structure the reply does not have.
          h1: Heading,
          h2: Heading,
          h3: Heading,
          h4: Heading,
          h5: Heading,
          h6: Heading,
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border" />,
          // Wide content scrolls inside its own container rather than
          // stretching the transcript, the same rule the app's tables follow.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b px-2 py-1 text-left font-normal text-muted-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b px-2 py-1 tabular-nums">{children}</td>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              // A link in model output is a link in untrusted text: open it
              // away from the app, and tell the browser not to hand over the
              // opener.
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-4"
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function Heading({ children }: { children?: React.ReactNode }) {
  return <p className="font-medium text-foreground">{children}</p>;
}
