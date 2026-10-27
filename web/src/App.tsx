// The first page: paste a procedure, compile it, review its steps, objects and rules, approve it,
// then start a live session that streams the camera and lists every server message.
import type { Procedure } from "@attest/shared";
import { useEffect, useRef, useState } from "react";
import { approveProcedure, compileProcedure, createSession } from "./api";
import { h264Supported, openCamera, SegmentRecorder } from "./capture";
import { LiveSession, type LiveStatus, type LogEntry } from "./live";

// Streaming stops on its own after this long; this first page is for short tests.
const STREAM_LIMIT_MS = 60_000;
// After the last upload, how long the socket stays open for the server's answers; the server
// takes longer per segment than a segment lasts, so a minute of capture leaves a backlog.
const DRAIN_MS = 120_000;

type Screen = { name: "paste" } | { name: "review"; procedure: Procedure } | { name: "live"; procedure: Procedure };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "paste" });
  if (screen.name === "paste") {
    return (
      <PasteScreen
        onCompiled={(procedure) => {
          setScreen({ name: "review", procedure });
        }}
      />
    );
  }
  if (screen.name === "review") {
    return (
      <ReviewScreen
        procedure={screen.procedure}
        onApproved={(procedure) => {
          setScreen({ name: "review", procedure });
        }}
        onStart={() => {
          setScreen({ name: "live", procedure: screen.procedure });
        }}
      />
    );
  }
  return <LiveScreen procedure={screen.procedure} />;
}

function PasteScreen({ onCompiled }: { onCompiled: (procedure: Procedure) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compile = async () => {
    setBusy(true);
    setError(null);
    try {
      onCompiled(await compileProcedure(text));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main>
      <h1>Attest</h1>
      <p>Paste a written procedure. Attest reads it into steps, the objects the camera tracks and the safety rules.</p>
      <textarea
        rows={24}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <p>
        <button disabled={busy || text.trim() === ""} onClick={() => void compile()}>
          {busy ? "Reading the procedure (about a minute)…" : "Compile"}
        </button>
      </p>
      {error !== null && <p className="error">{error}</p>}
    </main>
  );
}

function ReviewScreen({ procedure, onApproved, onStart }: { procedure: Procedure; onApproved: (procedure: Procedure) => void; onStart: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [h264, setH264] = useState<boolean | null>(null);
  useEffect(() => {
    void h264Supported().then(setH264, () => {
      setH264(false);
    });
  }, []);
  const ordinalOf = new Map(procedure.steps.map((step) => [step.id, step.ordinal]));
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      onApproved(await approveProcedure(procedure.id));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  const approved = procedure.approved_at !== null;
  return (
    <main>
      <h1>{procedure.title}</h1>
      <p>
        {approved ? `Approved ${new Date(procedure.approved_at ?? 0).toLocaleString()}.` : "Not approved yet. Check the steps, objects and rules, then approve."}
      </p>
      <h2>Steps</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Instruction</th>
            <th>Done when</th>
            <th>Cue</th>
            <th>Objects</th>
            <th>Needs</th>
          </tr>
        </thead>
        <tbody>
          {procedure.steps.map((step) => (
            <tr key={step.id}>
              <td>{step.ordinal}</td>
              <td>{step.instruction}</td>
              <td>{step.completion_cue}</td>
              <td>{step.cue_kind}</td>
              <td>{step.expected_objects.join(", ")}</td>
              <td>{step.depends_on.map((id) => ordinalOf.get(id)).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Objects</h2>
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Name</th>
            <th>Camera prompt</th>
            <th>Color</th>
          </tr>
        </thead>
        <tbody>
          {procedure.objects.map((object) => (
            <tr key={object.id}>
              <td>{object.label}</td>
              <td>{object.display_name}</td>
              <td>{object.prompt}</td>
              <td style={{ background: object.color }}>{object.color}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Safety rules</h2>
      <table>
        <thead>
          <tr>
            <th>Before step</th>
            <th>Severity</th>
            <th>Condition</th>
            <th>Object</th>
            <th>Says</th>
          </tr>
        </thead>
        <tbody>
          {procedure.hazard_rules.map((rule) => (
            <tr key={rule.id}>
              <td>{ordinalOf.get(rule.before_step)}</td>
              <td>{rule.severity}</td>
              <td>
                {rule.condition} ({rule.condition_kind})
              </td>
              <td>{rule.object_label}</td>
              <td>{rule.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!approved && (
        <button disabled={busy} onClick={() => void approve()}>
          Approve
        </button>
      )}
      {approved && (
        <section>
          <h2>Start</h2>
          <p>
            <strong>Recording notice:</strong> while the session runs, the camera records the work area. The video is stored by Attest and sent to Meta's models
            to check each step.
          </p>
          <p>H.264 encoding in this browser: {h264 === null ? "checking…" : h264 ? "supported" : "not supported"}</p>
          <button disabled={h264 !== true} onClick={onStart}>
            Start the camera and the session
          </button>
        </section>
      )}
      {error !== null && <p className="error">{error}</p>}
    </main>
  );
}

interface Run {
  cancelled: boolean;
  stopping: boolean;
  stream: MediaStream | null;
  recorder: SegmentRecorder | null;
  live: LiveSession | null;
  timer: number | undefined;
}

// The session starts only from the Start click, never on mount, so a remount (such as a dev
// reload) cannot open the camera or create a session by itself; unmounting stops a running one.
function LiveScreen({ procedure }: { procedure: Procedure }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [phase, setPhase] = useState<"ready" | "starting" | "streaming" | "stopped">("ready");
  const [elapsed, setElapsed] = useState(0);
  const runRef = useRef<Run | null>(null);

  const note = (entry: LogEntry) => {
    setLog((previous) => [...previous, entry]);
  };

  const stop = async (run: Run) => {
    if (run.stopping) return;
    run.stopping = true;
    if (run.timer !== undefined) clearInterval(run.timer);
    setPhase("stopped");
    await run.recorder?.stop();
    run.recorder = null;
    for (const track of run.stream?.getTracks() ?? []) track.stop();
    await run.live?.close(DRAIN_MS);
  };

  useEffect(
    () => () => {
      const run = runRef.current;
      if (run === null) return;
      run.cancelled = true;
      void stop(run);
    },
    [],
  );

  const start = async () => {
    const run: Run = { cancelled: false, stopping: false, stream: null, recorder: null, live: null, timer: undefined };
    // A function, so the checks after each await read the current value.
    const cancelled = () => run.cancelled;
    runRef.current = run;
    setPhase("starting");
    try {
      const stream = await openCamera();
      run.stream = stream;
      if (cancelled()) {
        await stop(run);
        return;
      }
      if (videoRef.current !== null) videoRef.current.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      if (track === undefined) throw new Error("the camera has no video track");
      const settings = track.getSettings();
      note({ at: Date.now(), kind: "socket", type: "camera", text: `${track.label}: ${String(settings.width)}x${String(settings.height)} at ${String(settings.frameRate)} fps`, raw: null });
      const created = await createSession(procedure.id);
      if (cancelled()) {
        await stop(run);
        return;
      }
      note({ at: Date.now(), kind: "socket", type: "session", text: `session ${created.session.id} created`, raw: created.session });
      const session = new LiveSession(created.session.id, created.token, note, setStatus);
      run.live = session;
      run.recorder = new SegmentRecorder(
        track,
        (segment) => {
          session.upload(segment);
        },
        (error) => {
          note({ at: Date.now(), kind: "error", type: "capture", text: errorText(error), raw: null });
          void stop(run);
        },
      );
      setPhase("streaming");
      const startedAt = Date.now();
      run.timer = window.setInterval(() => {
        const ms = Date.now() - startedAt;
        setElapsed(ms);
        if (ms >= STREAM_LIMIT_MS) void stop(run);
      }, 250);
    } catch (error) {
      note({ at: Date.now(), kind: "error", type: "start", text: errorText(error), raw: null });
      await stop(run);
    }
  };

  const save = () => {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `attest-messages-${new Date().toISOString().replaceAll(":", "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main>
      <h1>{procedure.title}</h1>
      <video ref={videoRef} autoPlay muted playsInline />
      <p>
        {phase === "streaming" ? `Streaming ${String(Math.floor(elapsed / 1000))} s of ${String(STREAM_LIMIT_MS / 1000)} s` : `Not streaming (${phase})`} · socket{" "}
        {status?.socket ?? "not open"} · segments sent {status?.segments_sent ?? 0}
        {status !== null && status.segments_failed > 0 ? `, failed ${String(status.segments_failed)}` : ""} · session cost{" "}
        {status?.session_micro_usd == null ? "–" : `$${(status.session_micro_usd / 1e6).toFixed(4)}`}
      </p>
      <p>
        <button disabled={phase !== "ready"} onClick={() => void start()}>
          Start streaming (stops after {STREAM_LIMIT_MS / 1000} s)
        </button>
        <button
          disabled={phase !== "streaming"}
          onClick={() => {
            if (runRef.current !== null) void stop(runRef.current);
          }}
        >
          Stop
        </button>
        <button onClick={save}>Save messages</button>
      </p>
      <h2>Messages</h2>
      <ol className="messages">
        {log.map((entry, index) => (
          <li key={index} className={entry.kind === "error" ? "error" : undefined}>
            {new Date(entry.at).toLocaleTimeString()} {entry.kind === "server" ? "" : `[${entry.kind}] `}
            <strong>{entry.type}</strong> {entry.text}
          </li>
        ))}
      </ol>
    </main>
  );
}
