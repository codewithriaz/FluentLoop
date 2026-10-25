import { useState } from "react";
import { Download, Link2, Search, Subtitles } from "lucide-react";
import { useApp } from "../AppContext";
import { useFeedback } from "../components/feedback";
import { Badge, Button, Checkbox, ErrorBox, Modal, Segmented, Select, Spinner, TextInput } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatTime, platformLabel } from "../lib/format";
import type { Folder, UrlMetadata } from "../lib/types";

type Tab = "link" | "transcript";

/** Paste a YouTube/Facebook link (or create a transcript-only item) and save it to a folder. */
export function AddVideoDialog({ folders, defaultFolderId, onClose }: { folders: Folder[]; defaultFolderId: string | null; onClose: () => void }) {
  const { bump, startDownload, openVideo, info } = useApp();
  const { toast } = useFeedback();
  const [tab, setTab] = useState<Tab>("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState(defaultFolderId ?? "");
  const [meta, setMeta] = useState<UrlMetadata | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState(true);
  const [captions, setCaptions] = useState(true);
  const hasYtDlp = !!info?.tools.ytDlp;

  const check = async () => {
    setError(null);
    setChecking(true);
    setMeta(null);
    try {
      const m = await api.fetchUrlMetadata(url);
      setMeta(m);
      setTitle(m.title ?? "");
      setCaptions(m.hasEnglishCaptions);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (tab === "transcript") {
        const v = await api.createVideo({ title: title || "Untitled transcript", folderId: folderId || null });
        bump();
        onClose();
        openVideo(v.id);
        return;
      }
      const v = await api.createVideo({
        title: title || meta?.title || url,
        sourceUrl: url.trim(),
        channel: meta?.channel,
        thumbnailUrl: meta?.thumbnailUrl,
        durationSec: meta?.durationSec,
        folderId: folderId || null,
      });
      bump();
      onClose();
      toast(`Saved “${v.title}”`);
      if (captions && meta?.hasEnglishCaptions) {
        api
          .fetchCaptions(v.id)
          .then((c) => api.importTranscript(v.id, c.content, "vtt", `captions:${c.language}`, true))
          .then((d) => {
            toast(`Imported ${d.sentences.length} caption lines`);
            bump();
          })
          .catch((e) => toast(`Captions could not be imported: ${errorMessage(e)}`, "error"));
      }
      if (download && hasYtDlp) void startDownload(v.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const canSave = tab === "transcript" ? true : url.trim().startsWith("http");

  return (
    <Modal
      title="Add video"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!canSave}>
            {tab === "transcript" ? "Create" : "Save to library"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "link", label: "YouTube / Facebook link" },
            { value: "transcript", label: "Transcript only" },
          ]}
        />
        {tab === "link" ? (
          <>
            <div className="flex gap-2">
              <TextInput
                autoFocus
                placeholder="https://www.youtube.com/watch?v=…  or  https://www.facebook.com/…"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setMeta(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && url && void check()}
              />
              <Button icon={Search} onClick={() => void check()} loading={checking} disabled={!url.trim()}>
                Fetch details
              </Button>
            </div>
            {checking && (
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <Spinner size={14} /> Reading public video details…
              </div>
            )}
            {meta && (
              <div className="flex gap-3 rounded-lg border border-line bg-sunken p-2.5">
                {meta.thumbnailUrl ? (
                  <img src={meta.thumbnailUrl} alt="" className="h-[68px] w-[120px] shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-[68px] w-[120px] shrink-0 items-center justify-center rounded bg-hover text-muted">
                    <Link2 size={18} />
                  </div>
                )}
                <div className="min-w-0 flex-1 text-[12.5px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="accent">{platformLabel(meta.platform)}</Badge>
                    {meta.durationSec != null && <Badge>{formatTime(meta.durationSec)}</Badge>}
                    {meta.hasEnglishCaptions && (
                      <Badge tone="success">
                        <Subtitles size={11} /> English captions
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 truncate font-medium">{meta.title ?? "Title not available"}</div>
                  {meta.channel && <div className="truncate text-muted">{meta.channel}</div>}
                  {meta.error && <div className="mt-1 text-warn whitespace-pre-wrap">{meta.error}</div>}
                </div>
              </div>
            )}
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Title
              <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Uses the video title when empty" />
            </label>
            <div className="flex flex-col gap-1.5 rounded-lg border border-line p-2.5">
              <Checkbox
                checked={download && hasYtDlp}
                disabled={!hasYtDlp}
                onChange={setDownload}
                label={
                  <span className="flex items-center gap-1.5">
                    <Download size={13} /> Download for offline practice (public videos only, no login used)
                  </span>
                }
              />
              <Checkbox
                checked={captions && !!meta?.hasEnglishCaptions}
                disabled={!meta?.hasEnglishCaptions}
                onChange={setCaptions}
                label={
                  <span className="flex items-center gap-1.5">
                    <Subtitles size={13} /> Import English captions as transcript
                    {!meta && <span className="text-faint">(fetch details first)</span>}
                  </span>
                }
              />
              {!hasYtDlp && <div className="text-[11.5px] text-warn">yt-dlp was not found, so downloads are unavailable. The link will be saved.</div>}
              <div className="text-[11.5px] text-faint">
                Private, login-only or DRM-protected videos cannot be downloaded. The link is always kept so you can attach your own file later.
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="text-[12.5px] text-muted">Create an item for a transcript you will paste or import (no video needed).</div>
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Title
              <TextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Client call role-play" />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Folder
          <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </label>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}
