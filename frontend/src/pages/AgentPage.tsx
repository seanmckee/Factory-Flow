import { Fragment, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  GitBranch,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageHeader from "../components/PageHeader";
import {
  getAgentHealth,
  resumeChat,
  revokePlan,
  stopChat,
  streamChat,
} from "../api/agent";
import type { AgentEvent, AgentPlan, ApprovalRequest } from "../agent/sse";
import { isSpent, planBounds, spentFraction } from "../agent/planDisplay";
import { parseComparison, type RunComparison } from "../agent/verdict";
import { formatTickTime } from "../simulation/simTime";
import VerdictCard from "../components/VerdictCard";
import { useToast } from "../toast/ToastContext";

type ToolCall = { name: string; input: Record<string, unknown> };
/** a chunked advance mid-flight: where it started, where it is, where it ends */
type AdvanceProgress = {
  runId: number | null;
  tickNum: number;
  fromTick: number;
  toTick: number;
  dayTicks: number | null;
};
type Decision = "pending" | "approved" | "declined";
type ChatItem =
  | { kind: "user"; text: string }
  /** `verdicts` are computed answers a tool returned, shown as themselves
   * rather than left to the reply to paraphrase */
  | { kind: "assistant"; text: string; tools: ToolCall[]; verdicts: RunComparison[] }
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
  compare_runs: "compared two runs",
  advance_to_tick: "advanced a run",
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
  /**
   * The newest progress payload from a long-running tool, or null when
   * nothing long is running. Held outside the transcript because it is a
   * *replacing* readout rather than a message — an advance emits one per
   * committed request, and appending them would bury the conversation.
   */
  const [progress, setProgress] = useState<AdvanceProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  /**
   * The experiment this conversation has authorised, if any. Kept on screen
   * for as long as it stands: it outlives the turn that granted it, and a
   * standing authority nobody can see is not one anybody should have given.
   */
  const [plan, setPlan] = useState<AgentPlan | null>(null);
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
    } else if (event.type === "result") {
      // A payload we cannot narrow is dropped, not half-drawn: the model's
      // own reply still stands, which is a worse answer than the table but
      // never a wrong one.
      const verdict = parseComparison(event.data);
      if (verdict)
        patchLastAssistant((last) => ({
          ...last,
          verdicts: [...last.verdicts, verdict],
        }));
    } else if (event.type === "plan") {
      setPlan(event.plan);
    } else if (event.type === "progress") {
      if (event.tickNum !== undefined && event.toTick !== undefined) {
        setProgress({
          runId: event.runId ?? null,
          tickNum: event.tickNum,
          fromTick: event.fromTick ?? event.tickNum,
          toTick: event.toTick,
          dayTicks: event.dayTicks ?? null,
        });
      }
    } else if (event.type === "approval") {
      const request: ApprovalRequest = {
        tool: event.tool,
        args: event.args,
        run: event.run,
        summary: event.summary,
        ...(event.spendCents === undefined
          ? {}
          : { spendCents: event.spendCents }),
        ...(event.outsidePlan === undefined
          ? {}
          : { outsidePlan: event.outsidePlan }),
        ...(event.runs === undefined ? {} : { runs: event.runs }),
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
    // The thread id is the client's from the first turn, not the server's.
    // It used to arrive on `done`, which is too late to stop anything: a
    // chunked advance runs for minutes inside the very turn that would have
    // told us where to send the stop.
    const id = threadId ?? crypto.randomUUID();
    setThreadId(id);
    setDraft("");
    setBusy(true);
    setItems((previous) => [
      ...previous,
      { kind: "user", text: message },
      { kind: "assistant", text: "", tools: [], verdicts: [] },
    ]);
    try {
      await streamChat(message, id, handleEvent);
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
      setProgress(null);
      setStopping(false);
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
      { kind: "assistant" as const, text: "", tools: [], verdicts: [] },
    ]);
    try {
      await resumeChat(threadId, approved, handleEvent);
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
      setProgress(null);
      setStopping(false);
    }
  };

  /**
   * Stops a long tool at its next committed boundary. Deliberately not a
   * cancel of the request: the backend commits each advance it accepted, so
   * aborting here would only leave this page claiming a tick the run has
   * already passed. The tool answers on the stream that is still open.
   */
  const stop = async () => {
    if (threadId === null || stopping) return;
    setStopping(true);
    try {
      await stopChat(threadId);
    } catch (error) {
      failed(error);
      setStopping(false);
    }
  };

  const reset = () => {
    setItems([]);
    setThreadId(null);
    setProgress(null);
    // A new conversation is a new thread, which has no state and therefore no
    // authority — the server agrees by construction, and this keeps the page
    // from showing a grant that no longer applies to anything.
    setPlan(null);
  };

  /** Takes the grant back, so every change pauses again. */
  const revoke = async () => {
    if (threadId === null) return;
    try {
      await revokePlan(threadId);
      setPlan(null);
      showToast("Plan revoked — changes will ask again");
    } catch (error) {
      failed(error);
    }
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
                  {item.verdicts.map((verdict, verdictIndex) => (
                    <VerdictCard key={verdictIndex} verdict={verdict} />
                  ))}
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

      {plan && <PlanBanner plan={plan} busy={busy} onRevoke={revoke} />}

      {progress && (
        <AdvanceReadout progress={progress} stopping={stopping} onStop={stop} />
      )}

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


/**
 * A plan's bounds, laid out rather than said in a sentence.
 *
 * Four separate limits, each of which pauses on its own, so they are read as
 * four rows: a sentence hides that structure, and the sentence is what
 * someone skims when they are about to grant standing authority. The runs
 * carry the names the SIM confirmed, which is the whole reason a plan is
 * built server-side — the model can describe its plan however it likes.
 */
function PlanBounds({ request }: { request: ApprovalRequest }) {
  const plan = request.plan;
  if (!plan) return null;
  const dayTicks = request.runs?.find((run) => run.dayTicks)?.dayTicks;
  return (
    <div className="flex flex-col gap-2">
      {plan.purpose && <p className="text-sm leading-relaxed">{plan.purpose}</p>}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {planBounds(plan, dayTicks ?? undefined).map((bound) => (
          <Fragment key={bound.label}>
            <dt className="text-muted-foreground">{bound.label}</dt>
            <dd className="tabular-nums">{bound.value}</dd>
          </Fragment>
        ))}
      </dl>

      {request.runs && request.runs.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {request.runs.map((run) => (
            <li key={run.id} className="flex items-center gap-1.5 tabular-nums">
              {run.isFork && <GitBranch className="size-3 shrink-0" />}#{run.id}{" "}
              {run.name} · {formatTickTime(run.tickNum, run.dayTicks ?? undefined)}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Anything outside these bounds still asks you first, and you can revoke
        this at any time.
      </p>
    </div>
  );
}

/**
 * The standing grant, on screen for as long as it stands.
 *
 * This is the half of "approve the experiment once" that makes it defensible.
 * A grant is kept with the conversation and outlives the turn that asked for
 * it, so it has to be visible — with what is left of its ceiling — and it has
 * to be cancellable here rather than by abandoning the conversation.
 */
function PlanBanner({
  plan,
  busy,
  onRevoke,
}: {
  plan: AgentPlan;
  busy: boolean;
  onRevoke: () => void;
}) {
  const spent = spentFraction(plan);
  return (
    <div className="mt-4 flex shrink-0 flex-col gap-2 rounded-lg border border-running/40 bg-running/5 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <ShieldCheck className="size-4 shrink-0 text-running" />
        <span className="font-medium">Experiment approved</span>
        {plan.purpose && (
          <span className="truncate text-muted-foreground">{plan.purpose}</span>
        )}
        <Button
          className="ml-auto shrink-0"
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onRevoke}
        >
          Revoke
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {planBounds(plan).map((bound) => (
          <span key={bound.label} className="tabular-nums">
            {bound.label}: <span className="text-foreground">{bound.value}</span>
          </span>
        ))}
      </div>

      {plan.maxSpendCents > 0 && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${isSpent(plan) ? "bg-saturated" : "bg-chart-2"}`}
            style={{ width: `${spent * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A chunked advance mid-flight, with Stop beside it — the simulator page's
 * own convention for a fast-forward: progress inline, never a modal, and Stop
 * lands on a committed boundary rather than aborting in flight.
 *
 * It replaces itself rather than accumulating. An advance emits one of these
 * per committed request, and a day is 22 of them; appended, they would bury
 * the conversation they are supposed to be part of.
 */
function AdvanceReadout({
  progress,
  stopping,
  onStop,
}: {
  progress: AdvanceProgress;
  stopping: boolean;
  onStop: () => void;
}) {
  const span = progress.toTick - progress.fromTick;
  const done = span > 0 ? (progress.tickNum - progress.fromTick) / span : 1;
  const dayTicks = progress.dayTicks ?? undefined;
  return (
    <div className="mt-4 flex shrink-0 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-xs">
      <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
      <span className="tabular-nums">
        {progress.runId === null ? "Advancing" : `Advancing #${progress.runId}`} ·{" "}
        {formatTickTime(progress.tickNum, dayTicks)} →{" "}
        {formatTickTime(progress.toTick, dayTicks)}
      </span>
      <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-chart-2"
          style={{ width: `${Math.min(100, Math.max(0, done * 100))}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {Math.round(done * 100)}%
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onStop}
        disabled={stopping}
      >
        <Square className="size-3" />
        {stopping ? "Stopping…" : "Stop"}
      </Button>
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
          {request.runs && request.runs.length > 1
            ? request.runs.map((one) => `#${one.id}`).join(" · ")
            : `run #${run.id} · ${run.name}`}
        </span>
      </div>

      {request.plan ? (
        <PlanBounds request={request} />
      ) : (
        <p className="text-sm leading-relaxed">{request.summary}</p>
      )}

      {/* Why you are being asked again, when a plan you already approved was
          supposed to cover this. Without it the pause reads as the gate
          having forgotten. */}
      {request.outsidePlan && (
        <p className="text-xs leading-relaxed text-starved">
          Outside the approved plan: {request.outsidePlan}.
        </p>
      )}

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
