import { useEffect, useRef, useState } from "react";
import { Bot, LoaderCircle, RotateCcw, Send, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageHeader from "../components/PageHeader";
import { getAgentHealth, streamChat } from "../api/agent";
import { useToast } from "../toast/ToastContext";

type ToolCall = { name: string; input: Record<string, unknown> };
type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; tools: ToolCall[] };

/** what each tool read, in the user's terms — the chip under a reply */
const TOOL_LABELS: Record<string, string> = {
  list_runs: "listed the runs",
  get_run: "read a run's P&L",
  get_run_metrics: "read metrics",
  get_run_floor: "looked at the floor",
  get_capital_log: "read the capital log",
  list_work_orders: "read the work orders",
  list_sales_orders: "read the order book",
  get_factory_settings: "read factory settings",
};

function toolLabel(call: ToolCall): string {
  const base = TOOL_LABELS[call.name] ?? call.name;
  const runId = call.input["run_id"];
  return runId === undefined ? base : `${base} · run #${String(runId)}`;
}

const SUGGESTIONS = [
  "Which run made the most money, and where is its constraint?",
  "How is the current run doing on on-time delivery?",
  "What's still unreleased in the order book?",
];

/**
 * The Track 8 chat window — phase 1, a read-only analyst. The page talks to
 * the agent service on :8000 directly; the agent talks to the backend. It
 * can read everything and change nothing, so ask freely.
 */
export default function AgentPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentHealth()
      .then((health) => {
        if (cancelled) return;
        setWarning(
          health.backendReachable
            ? null
            : "The agent is up but can't reach the sim backend on :3000 — start it with npm run dev.",
        );
      })
      .catch(() => {
        if (!cancelled) {
          setWarning(
            "The agent service isn't running — start it with: cd agent && uv run uvicorn factory_agent.main:app --port 8000",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const region = scrollRef.current;
    if (region) region.scrollTop = region.scrollHeight;
  }, [items]);

  const patchLastAssistant = (
    patch: (item: Extract<ChatItem, { kind: "assistant" }>) => ChatItem,
  ) =>
    setItems((previous) => {
      const next = [...previous];
      const last = next[next.length - 1];
      if (last && last.kind === "assistant") next[next.length - 1] = patch(last);
      return next;
    });

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    setItems((previous) => [
      ...previous,
      { kind: "user", text: message },
      { kind: "assistant", text: "", tools: [] },
    ]);
    try {
      await streamChat(message, threadId, (event) => {
        if (event.type === "token") {
          patchLastAssistant((last) => ({ ...last, text: last.text + event.text }));
        } else if (event.type === "tool") {
          patchLastAssistant((last) => ({
            ...last,
            tools: [...last.tools, { name: event.name, input: event.input }],
          }));
        } else if (event.type === "done") {
          setThreadId(event.threadId);
        } else if (event.type === "error") {
          showToast(event.message, "error");
        }
      });
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "The agent request failed",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setItems([]);
    setThreadId(null);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Agent"
        description="A read-only analyst over the sim — it can read every run, metric and order, and change nothing."
      >
        <Button variant="outline" onClick={reset} disabled={busy || items.length === 0}>
          <RotateCcw className="size-4" /> New conversation
        </Button>
      </PageHeader>

      {warning && (
        <p className="mb-3 shrink-0 rounded-md border border-starved/40 bg-starved/10 px-3 py-2 text-sm text-starved">
          {warning}
        </p>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card p-4"
      >
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Bot className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Ask about your runs, the constraint, the P&L, or the order book.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((item, index) =>
              item.kind === "user" ? (
                <div key={index} className="self-end">
                  <p className="max-w-xl rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {item.text}
                  </p>
                </div>
              ) : (
                <div key={index} className="flex max-w-3xl flex-col gap-1.5 self-start">
                  {item.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.tools.map((call, toolIndex) => (
                        <span
                          key={toolIndex}
                          className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          <Wrench className="size-3" /> {toolLabel(call)}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.text === "" && busy && index === items.length - 1 ? (
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {item.text}
                    </p>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <form
        className="mt-3 flex shrink-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask the analyst…"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || draft.trim() === ""}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send
        </Button>
      </form>
    </div>
  );
}
