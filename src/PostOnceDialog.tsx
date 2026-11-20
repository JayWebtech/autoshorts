import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CalendarClock, Check, ExternalLink, Loader2, Send } from "lucide-react";

export type PostableClip = { candidateId: string; hook: string };

type Account = { id: string; platform: string; username: string };
type PostResult = { postId: string; status: string };

const PLATFORM_NAMES: Record<string, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X",
  linkedin: "LinkedIn",
  threads: "Threads",
  pinterest: "Pinterest",
  bluesky: "Bluesky",
  snapchat: "Snapchat",
};

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Connected PostOnce accounts. Reloads when the window gets focus again, so an
 * account connected in the browser shows up as soon as the user comes back.
 */
export function usePostOnceAccounts(apiKey: string, connected: boolean) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const load = useCallback(
    (quiet: boolean) => {
      if (!connected) return;
      if (!quiet) {
        loaded.current = false;
        setAccounts(null);
        setError(null);
      }
      invoke<Account[]>("postonce_list_accounts", { apiKey })
        .then((list) => {
          loaded.current = true;
          setAccounts(list);
          setError(null);
        })
        .catch((err) => {
          // A failed background refresh keeps the last list instead of flashing an error.
          if (quiet && loaded.current) return;
          setAccounts((current) => current ?? []);
          setError(errorText(err));
        });
    },
    [apiKey, connected],
  );
  useEffect(() => {
    if (!connected) {
      setAccounts(null);
      return;
    }
    load(false);
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [connected, load]);
  const reload = useCallback(() => load(false), [load]);
  return { accounts, error, reload };
}

/** Opens the browser to sign in or sign up, then waits for the user to approve AutoShorts. */
export function PostOnceSignInButton({
  onSignedIn,
  onError,
  className = "postonce-platform",
  label = "Sign in with PostOnce",
}: {
  onSignedIn: () => void;
  onError: (message: string) => void;
  className?: string;
  label?: string;
}) {
  const [waiting, setWaiting] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={waiting}
      onClick={() => {
        setWaiting(true);
        invoke("postonce_sign_in")
          .then(onSignedIn)
          .catch((err) => onError(errorText(err)))
          .finally(() => setWaiting(false));
      }}
    >
      {waiting ? <Loader2 className="spin" size={14} /> : null}
      {waiting ? "Finish in your browser…" : label}
    </button>
  );
}

/** One button: opens the PostOnce page where the user picks platforms to connect. */
export function PostOnceConnectButton({
  apiKey,
  onError,
  className = "postonce-platform",
  label = "Connect accounts",
}: {
  apiKey: string;
  onError: (message: string) => void;
  className?: string;
  label?: string;
}) {
  const [opening, setOpening] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={opening}
      onClick={() => {
        setOpening(true);
        invoke("postonce_connect_accounts", { apiKey })
          .catch((err) => onError(errorText(err)))
          .finally(() => setOpening(false));
      }}
    >
      {opening ? <Loader2 className="spin" size={14} /> : <ExternalLink size={14} />}
      {label}
    </button>
  );
}

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input, one hour from now. */
function defaultScheduleValue() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PostOnceDialog({
  clips,
  apiKey,
  hasEnvKey,
  signedIn,
  onSignedIn,
  onSaveKey,
  onClose,
  onPosted,
}: {
  clips: PostableClip[];
  apiKey: string;
  hasEnvKey: boolean;
  signedIn: boolean;
  onSignedIn: () => void;
  onSaveKey: (key: string) => void;
  onClose: () => void;
  onPosted: (candidateId: string, label: string) => void;
}) {
  const [draftKey, setDraftKey] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState(clips[0]?.hook ?? "");
  const [schedule, setSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleValue);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const single = clips.length === 1;
  // Opened from the sidebar before any clip is cut: connect only, nothing to post yet.
  const noClips = clips.length === 0;
  const connected = Boolean(apiKey) || hasEnvKey || signedIn;

  const { accounts, error: accountsError } = usePostOnceAccounts(apiKey, connected);
  const shownError = error ?? accountsError;
  const [selectedFor, setSelectedFor] = useState<Account[] | null>(null);
  // Tick every account the first time a list arrives, and newly connected ones after that.
  useEffect(() => {
    if (!accounts || accounts === selectedFor) return;
    const known = new Set((selectedFor ?? []).map((account) => account.id));
    setSelected((current) => {
      const next = new Set(current);
      for (const account of accounts) if (!known.has(account.id)) next.add(account.id);
      return next;
    });
    setSelectedFor(accounts);
  }, [accounts, selectedFor]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function post() {
    setError(null);
    const accountIds = [...selected];
    const start = schedule ? new Date(scheduleAt) : null;
    if (start && (Number.isNaN(start.getTime()) || start.getTime() <= Date.now())) {
      setError("Pick a time in the future.");
      return;
    }
    let posted = 0;
    for (const [index, clip] of clips.entries()) {
      setProgress(single ? "Uploading clip…" : `Posting clip ${index + 1} of ${clips.length}…`);
      // With several clips, a schedule sends one clip per day from the chosen time.
      const publishAt = start
        ? new Date(start.getTime() + index * 24 * 60 * 60 * 1000).toISOString()
        : null;
      try {
        const result = await invoke<PostResult>("post_clip_to_postonce", {
          candidateId: clip.candidateId,
          apiKey,
          caption: single ? caption : clip.hook,
          accountIds,
          publishAt,
        });
        posted += 1;
        onPosted(
          clip.candidateId,
          result.status === "already_sent"
            ? "Already sent to PostOnce"
            : publishAt
              ? `Scheduled ${new Date(publishAt).toLocaleString()}`
              : "Sent to PostOnce",
        );
      } catch (err) {
        setError(errorText(err));
        break;
      }
    }
    setProgress(null);
    if (posted === clips.length) {
      setDone(
        schedule
          ? `${posted === 1 ? "Clip" : `${posted} clips`} scheduled.`
          : `${posted === 1 ? "Clip" : `${posted} clips`} sent. PostOnce is publishing now.`,
      );
    }
  }

  const busy = progress !== null;

  return (
    <div className="style-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="style-modal postonce-modal" onClick={(event) => event.stopPropagation()}>
        <div className="style-modal-header">
          <h3>{noClips ? "Connect PostOnce" : single ? "Post this clip" : `Post ${clips.length} clips`}</h3>
          <p>Publish to TikTok, YouTube Shorts, Instagram Reels and more with PostOnce.</p>
        </div>

        {!connected ? (
          <div className="postonce-connect">
            <PostOnceSignInButton onSignedIn={onSignedIn} onError={setError} />
            <small>Free to start. Approve AutoShorts, then pick where to post.</small>
            <details className="postonce-key-option">
              <summary>Use an API key instead</summary>
              <label>
                <span>PostOnce API key</span>
                <input
                  value={draftKey}
                  onChange={(event) => setDraftKey(event.target.value)}
                  placeholder="po_live_…"
                  type="password"
                />
              </label>
            </details>
          </div>
        ) : done ? (
          <div className="postonce-done">
            <Check size={18} /> {done}
          </div>
        ) : accounts === null ? (
          <div className="postonce-loading">
            <Loader2 className="spin" size={16} /> Loading your accounts…
          </div>
        ) : accounts.length === 0 && shownError ? null : (
          <>
            {accounts.length > 0 ? (
              <div className="postonce-accounts">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    className={`postonce-account ${selected.has(account.id) ? "selected" : ""}`}
                    onClick={() => toggle(account.id)}
                    disabled={busy}
                  >
                    {selected.has(account.id) && <Check size={12} />}
                    {PLATFORM_NAMES[account.platform] ?? account.platform}
                    <span>@{account.username}</span>
                  </button>
                ))}
                {!busy && (
                  <PostOnceConnectButton
                    apiKey={apiKey}
                    onError={setError}
                    className="postonce-account postonce-add"
                    label="Add"
                  />
                )}
              </div>
            ) : (
              <div className="postonce-connect">
                <small>No accounts yet. Pick where to post, then come back here.</small>
                <PostOnceConnectButton apiKey={apiKey} onError={setError} />
              </div>
            )}

            {noClips ? (
              accounts.length > 0 && <small>PostOnce is connected. Cut a clip, then click Post on it.</small>
            ) : single ? (
              <label className="postonce-field">
                <span>Caption</span>
                <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={3} disabled={busy} />
              </label>
            ) : (
              <small>Each clip uses its hook as the caption.</small>
            )}

            {!noClips && <div className="postonce-when">
              <label>
                <input type="checkbox" checked={schedule} onChange={(event) => setSchedule(event.target.checked)} disabled={busy} />
                <CalendarClock size={14} /> Schedule
              </label>
              {schedule && (
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(event) => setScheduleAt(event.target.value)}
                  readOnly={busy}
                />
              )}
              {schedule && !single && <small>One clip per day from this time.</small>}
            </div>}
          </>
        )}

        {shownError && <div className="error-banner">{shownError}</div>}

        <div className="style-modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>
            {done || (connected && noClips) ? "Close" : "Cancel"}
          </button>
          {!connected ? (
            draftKey.trim() && (
              <button type="button" className="btn-confirm" onClick={() => onSaveKey(draftKey.trim())}>
                Continue
              </button>
            )
          ) : (
            !done && !noClips && (
              <button
                type="button"
                className="btn-confirm"
                disabled={busy || !accounts?.length || selected.size === 0}
                onClick={() => void post()}
              >
                {busy ? <Loader2 className="spin" size={14} /> : <Send size={14} />}
                {busy ? progress : schedule ? "Schedule" : "Post now"}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
