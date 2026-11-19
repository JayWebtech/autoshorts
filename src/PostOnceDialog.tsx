import { useEffect, useState } from "react";
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
  onSaveKey,
  onClose,
  onPosted,
  placement,
}: {
  clips: PostableClip[];
  /** Where the dialog was opened from, for the sign-up link. */
  placement?: "sidebar";
  apiKey: string;
  hasEnvKey: boolean;
  onSaveKey: (key: string) => void;
  onClose: () => void;
  onPosted: (candidateId: string, label: string) => void;
}) {
  const [draftKey, setDraftKey] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
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
  const connected = Boolean(apiKey) || hasEnvKey;

  useEffect(() => {
    if (!connected) return;
    setAccounts(null);
    setError(null);
    invoke<Account[]>("postonce_list_accounts", { apiKey })
      .then((list) => {
        setAccounts(list);
        setSelected(new Set(list.map((account) => account.id)));
      })
      .catch((err) => {
        setAccounts([]);
        setError(errorText(err));
      });
  }, [apiKey, connected]);

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
            <button type="button" className="icon-button" onClick={() => void invoke("open_postonce_signup", { placement }).catch((err) => setError(errorText(err)))}>
              <ExternalLink size={14} /> Get a free PostOnce API key
            </button>
            <label>
              <span>PostOnce API key</span>
              <input
                value={draftKey}
                onChange={(event) => setDraftKey(event.target.value)}
                placeholder="po_live_…"
                type="password"
                autoFocus
              />
            </label>
            <small>Sign up, connect your social accounts, then copy your API key here.</small>
          </div>
        ) : done ? (
          <div className="postonce-done">
            <Check size={18} /> {done}
          </div>
        ) : accounts === null ? (
          <div className="postonce-loading">
            <Loader2 className="spin" size={16} /> Loading your accounts…
          </div>
        ) : accounts.length === 0 && error ? null : (
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
              </div>
            ) : (
              <small>No accounts yet. Connect TikTok, YouTube or Instagram in PostOnce first.</small>
            )}

            {noClips ? (
              <small>PostOnce is connected. Cut a clip, then click Post on it.</small>
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

        {error && <div className="error-banner">{error}</div>}

        <div className="style-modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>
            {done || (connected && noClips) ? "Close" : "Cancel"}
          </button>
          {!connected ? (
            <button type="button" className="btn-confirm" disabled={!draftKey.trim()} onClick={() => onSaveKey(draftKey.trim())}>
              Continue
            </button>
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
