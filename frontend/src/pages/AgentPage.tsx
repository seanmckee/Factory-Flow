import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  GitBranch,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageHeader from "../components/PageHeader";
import { getAgentHealth, resumeChat, streamChat } from "../api/agent";
import type { AgentEvent, ApprovalRequest } from "../agent/sse";
import { useToast } from "../toast/ToastContext";

type ToolCall = { name: string; input: Record<string, unknown> };
type Decision = "pending" | "approved" | "declined";
type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; tools: ToolCall[] }
  | { kind: "approval"; request: ApprovalRequest; decision: Decision };

/** what each tool did, in the user's terms — the chip under a reply */
const TOOL_LABELS: Record<string, string> = {
  list_runs: "listed the runs",
  get_run: "read a run's P&L",
  get_run_metrics: "read metrics",
  get_run_floor: "looked at the floor",
  get_capital_log: "read the capital log",
  list_work_orders: "read the work orders",
  list_sales_orders: "read the order book",
  get_factory_settings: "read factory settings",
  fork_run: "forked a run",
  advance_run: "advanced a run",
  capital_action: "changed the machines",
  set_release_policy: "changed the release policy",
  release_work_order: "released a work order",
};

function toolLabel(call: ToolCall): string {
  const base = TOOL_LABELS[call.name] ?? call.name;
  const runId = call.input["run_id"];
  return runId === undefined ? base : `${base} · run #${String(runId)}`;
}

const SUGGESTIONS = [
  "Which run made the most money, and where is its constraint?",
  "Fork the best run and buy a machine at its constraint — is it worth it?",
  "How is the current run doing on on-time delivery?",
];

const CHIP =
  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground";

/**
 * The Track 8 chat window. The agent reads the sim freely and can also change
 * it — every write pauses in the graph and surfaces here as an approval card,
 * showing the run's real name and the run's own frozen price. Nothing is
 * written until it is approved from this page.
 */
export default function AgentPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const awaiting = items.some(
    (item) => item.kind === "approval" && item.decision === "pending",
  );

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

  /** shared by a turn and by the continuation after a decision */
  const handleEvent = (event: AgentEvent) => {
    if (event.type === "token") {
      patchLastAssistant((last) => ({ ...last, text: last.text + event.text }));
    } else if (event.type === "tool") {
      patchLastAssistant((last) => ({
        ...last,
        tools: [...last.tools, { name: event.name, input: event.input }],
      }));
    } else if (event.type === "approval") {
      const request: ApprovalRequest = {
        tool: event.tool,
        args: event.args,
        run: event.run,
        summary: event.summary,
      };
      setItems((previous) => [
        ...previous,
        { kind: "approval", request, decision: "pending" },
      ]);
    } else if (event.type === "done") {
      setThreadId(event.threadId);
    } else if (event.type === "error") {
      showToast(event.message, "error");
    }
  };

  const failed = (error: unknown) =>
    showToast(
      error instanceof Error ? error.message : "The agent request failed",
      "error",
    );

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || awaiting) return;
    setDraft("");
    setBusy(true);
    setItems((previous) => [
      ...previous,
      { kind: "user", text: message },
      { kind: "assistant", text: "", tools: [] },
    ]);
    try {
      await streamChat(message, threadId, handleEvent);
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approved: boolean) => {
    if (threadId === null || busy) return;
    setBusy(true);
    setItems((previous) => [
      ...previous.map((item) =>
        item.kind === "approval" && item.decision === "pending"
          ? { ...item, decision: approved ? ("approved" as const) : ("declined" as const) }
          : item,
      ),
      // a fresh target for the continuation's tokens
      { kind: "assistant" as const, text: "", tools: [] },
    ]);
    try {
      await resumeChat(threadId, approved, handleEvent);
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setItems([]);
    setThreadId(null);
  };

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="Agent"
        description="An analyst over the sim that can also act — every change waits for your approval."
      >
        <Button
          variant="outline"
          onClick={reset}
          disabled={busy || items.length === 0}
        >
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
        className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card p-5"
      >
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Bot className="size-8 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              Ask about your runs, the constraint, the P&amp;L or the order book — or
              ask it to test a decision by forking a run.
            </p>
            <div className="flex flex-col items-stretch gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-md border px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {items.map((item, index) => {
              if (item.kind === "user") {
                return (
                  <p
                    key={index}
                    className="max-w-xl self-end rounded-lg bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                  >
                    {item.text}
                  </p>
                );
              }
              if (item.kind === "approval") {
                return (
                  <ApprovalCard
                    key={index}
                    request={item.request}
                    decision={item.decision}
                    busy={busy}
                    onDecide={decide}
                  />
                );
              }
              return (
                <div key={index} className="flex max-w-3xl flex-col gap-2 self-start">
                  {item.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.tools.map((call, toolIndex) => (
                        <span key={toolIndex} className={CHIP}>
                          <Wrench className="size-3" /> {toolLabel(call)}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.text === "" && busy && index === items.length - 1 ? (
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    item.text !== "" && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {item.text}
                      </p>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <form
        className="mt-4 flex shrink-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={awaiting ? "Answer the approval above to continue…" : "Ask the analyst…"}
          disabled={busy || awaiting}
        />
        <Button type="submit" disabled={busy || awaiting || draft.trim() === ""}>
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Send
        </Button>
      </form>
    </div>
  );
}

const DECIDED: Record<
  Exclude<Decision, "pending">,
  { label: string; className: string }
> = {
  approved: { label: "Approved — the agent carried it out", className: "text-running" },
  declined: { label: "Declined — nothing was changed", className: "text-muted-foreground" },
};

/**
 * One paused write. Everything shown here came from the sim at approval time,
 * not from the model: the run's name and tick off its summary, the price off
 * the run's own frozen config. Approving is the only thing that lets the write
 * run at all — the graph is stopped until this is answered.
 */
function ApprovalCard({
  request,
  decision,
  busy,
  onDecide,
}: {
  request: ApprovalRequest;
  decision: Decision;
  busy: boolean;
  onDecide: (approved: boolean) => void;
}) {
  const { run } = request;
  const pending = decision === "pending";
  return (
    <div
      className={`flex max-w-3xl flex-col gap-3 self-start rounded-lg border p-4 ${
        pending ? "border-starved/50 bg-starved/5" : "bg-background"
      }`}
    >
      <div className="flex items-center gap-2">
        <ShieldAlert
          className={`size-4 ${pending ? "text-starved" : "text-muted-foreground"}`}
        />
        <span className="text-sm font-medium">
          {pending ? "Approval needed" : "Approval"}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {run.isFork && <GitBranch className="size-3" />}
          run #{run.id} · {run.name}
        </span>
      </div>

      <p className="text-sm leading-relaxed">{request.summary}</p>

      {pending ? (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => onDecide(true)}>
            <Check className="size-4" /> Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide(false)}
          >
            <X className="size-4" /> Decline
          </Button>
        </div>
      ) : (
        <p className={`text-xs ${DECIDED[decision].className}`}>
          {DECIDED[decision].label}
        </p>
      )}
    </div>
  );
}
