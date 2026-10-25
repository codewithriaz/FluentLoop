import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertTriangle, CheckCircle2, FolderOpen, HardDrive, KeyRound, RefreshCw, Shield, XCircle } from "lucide-react";
import { useApp } from "../AppContext";
import { useFeedback } from "../components/feedback";
import { ScreenHeader } from "../components/ScreenHeader";
import { Button, Checkbox, ErrorBox, Modal, Segmented, Select, Spinner, TextInput } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatBytes } from "../lib/format";
import type { AiConfig, StorageInfo } from "../lib/types";

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Shield; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold">
        {Icon && <Icon size={15} className="text-muted" />}
        {title}
      </div>
      <div className="flex flex-col gap-3 px-4 py-3 text-[13px]">{children}</div>
    </section>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-40 shrink-0 pt-1.5 text-muted">{label}</div>
      <div className="min-w-0 flex-1">
        {children}
        {hint && <div className="mt-1 text-[11.5px] text-faint">{hint}</div>}
      </div>
    </div>
  );
}

function ToolLine({ name, path, purpose }: { name: string; path: string | null; purpose: string }) {
  return (
    <div className="flex items-start gap-2">
      {path ? <CheckCircle2 size={15} className="mt-0.5 text-success" /> : <XCircle size={15} className="mt-0.5 text-warn" />}
      <div className="min-w-0">
        <div className="font-medium">
          {name} <span className="font-normal text-muted">— {purpose}</span>
        </div>
        <div className="selectable truncate font-mono text-[11.5px] text-faint">{path ?? "Not found (install it to ~/.local/bin or /opt/homebrew/bin)"}</div>
      </div>
    </div>
  );
}

function AiSettings() {
  const { toast, confirm } = useFeedback();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAiConfig().then(setCfg).catch((e) => toast(errorMessage(e), "error"));
  }, [toast]);

  if (!cfg) return <Spinner />;

  const saveConfig = async (next: AiConfig) => {
    setCfg(next);
    try {
      await api.setAiConfig(next.provider, next.endpoint, next.model);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <>
      <div className="rounded-md bg-sunken px-3 py-2 text-[12px] text-muted">
        AI is optional. When configured, only the text you explicitly send from an AI dialog is transmitted to the provider below. The API key is stored in
        the macOS Keychain, never in the library database or backups.
      </div>
      <Row label="Provider">
        <Select
          value={cfg.provider}
          onChange={(e) => {
            const provider = e.target.value as AiConfig["provider"];
            void saveConfig({
              ...cfg,
              provider,
              endpoint: provider === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1",
              model: provider === "anthropic" ? "claude-opus-5-5" : "",
            });
          }}
        >
          <option value="openai">OpenAI-compatible (OpenAI, OpenRouter, local Ollama…)</option>
          <option value="anthropic">Anthropic (Claude)</option>
        </Select>
      </Row>
      <Row label="Endpoint" hint={cfg.provider === "openai" ? "Base URL; /chat/completions is appended." : "Base URL; /messages is appended."}>
        <TextInput value={cfg.endpoint} onChange={(e) => setCfg({ ...cfg, endpoint: e.target.value })} onBlur={() => void saveConfig(cfg)} />
      </Row>
      <Row label="Model">
        <TextInput
          value={cfg.model}
          placeholder={cfg.provider === "anthropic" ? "claude-opus-5-5" : "e.g. gpt-4o-mini"}
          onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
          onBlur={() => void saveConfig(cfg)}
        />
      </Row>
      <Row label="API key" hint={cfg.hasKey ? "A key is saved in your Keychain." : "No key saved."}>
        <div className="flex gap-2">
          <TextInput type="password" value={key} placeholder={cfg.hasKey ? "••••••••  (enter a new key to replace)" : "Paste your API key"} onChange={(e) => setKey(e.target.value)} />
          <Button
            variant="primary"
            icon={KeyRound}
            disabled={!key.trim()}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.setAiKey(key);
                setKey("");
                setCfg({ ...cfg, hasKey: true });
                toast("API key saved to Keychain");
              } catch (e) {
                toast(errorMessage(e), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save key
          </Button>
          {cfg.hasKey && (
            <Button
              variant="ghost"
              onClick={async () => {
                if (!(await confirm({ title: "Remove API key?", message: "AI features will stop working until you add a key again.", confirmLabel: "Remove", danger: true }))) return;
                await api.clearAiKey().catch((e) => toast(errorMessage(e), "error"));
                setCfg({ ...cfg, hasKey: false });
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </Row>
    </>
  );
}

export function SettingsScreen() {
  const { info, refreshInfo, settings, updateSetting, bump } = useApp();
  const { toast, confirm } = useFeedback();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  const loadStorage = useCallback(() => {
    if (!info?.path) return;
    api
      .storageInfo()
      .then((s) => {
        setStorage(s);
        setStorageError(null);
      })
      .catch((e) => setStorageError(errorMessage(e)));
  }, [info?.path]);

  useEffect(loadStorage, [loadStorage]);

  const backup = async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const path = await save({ defaultPath: `FluentLoop-backup-${stamp}.zip`, filters: [{ name: "Zip archive", extensions: ["zip"] }] });
    if (!path) return;
    setBusy("backup");
    try {
      const bytes = await api.createBackup(path, includeMedia);
      toast(`Backup saved (${formatBytes(bytes)})`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    const path = await open({ multiple: false, filters: [{ name: "FluentLoop backup", extensions: ["zip"] }] });
    if (typeof path !== "string") return;
    const ok = await confirm({
      title: "Restore from backup?",
      message:
        "Your current library database will be replaced by the backup. A safety copy of the current database is saved first in the library’s backups folder. Media and recordings in the backup are added; existing files are not deleted.",
      confirmLabel: "Restore",
      danger: true,
    });
    if (!ok) return;
    setBusy("restore");
    try {
      const r = await api.restoreBackup(path);
      await refreshInfo();
      bump();
      loadStorage();
      toast(`Library restored. Safety copy: ${r.safetyCopy}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const chooseLocation = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Choose a folder for your FluentLoop library" });
    if (typeof dir === "string") setMoveTarget(dir);
  };

  const applyLocation = async (copy: boolean) => {
    if (!moveTarget) return;
    setBusy("location");
    try {
      await api.changeLibrary(moveTarget, copy);
      setMoveTarget(null);
      await refreshInfo();
      bump();
      loadStorage();
      toast(copy ? "Library copied and opened from the new location" : "Library opened");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const exportVault = async (format: "csv" | "txt") => {
    const path = await save({ defaultPath: `saved-sentences.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (!path) return;
    try {
      toast(`Exported ${await api.exportSaved(path, format, null)} sentences`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const exportNotes = async () => {
    const path = await save({ defaultPath: "fluentloop-notes.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!path) return;
    try {
      await api.exportNotes(path);
      toast("Notes exported");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const total = storage ? storage.databaseBytes + storage.mediaBytes + storage.recordingsBytes + storage.backupsBytes : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-5">
          <Section title="Appearance">
            <Row label="Theme">
              <Segmented
                value={settings.theme ?? "light"}
                onChange={(v) => updateSetting("theme", v)}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
              />
            </Row>
            <Row label="Text size">
              <Segmented
                value={settings.fontScale ?? "1"}
                onChange={(v) => updateSetting("fontScale", v)}
                options={[
                  { value: "0.93", label: "A−" },
                  { value: "1", label: "A" },
                  { value: "1.1", label: "A+" },
                  { value: "1.2", label: "A++" },
                ]}
              />
            </Row>
          </Section>

          <Section title="Library & storage" icon={HardDrive}>
            <Row label="Location">
              <div className="flex items-center gap-2">
                <div className="selectable min-w-0 flex-1 truncate rounded-md bg-sunken px-2.5 py-1.5 font-mono text-[11.5px]">{info?.path ?? "Not open"}</div>
                {info?.path && <Button size="sm" icon={FolderOpen} onClick={() => void revealItemInDir(`${info.path}/fluentloop.db`)}>Show in Finder</Button>}
                <Button size="sm" onClick={() => void chooseLocation()}>
                  Change…
                </Button>
              </div>
            </Row>
            {info?.openError && <ErrorBox>{info.openError}</ErrorBox>}
            {storageError && <ErrorBox>{storageError}</ErrorBox>}
            {storage ? (
              <>
                <Row label="Storage used">
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    <span>Total {formatBytes(total)}</span>
                    <span className="text-muted">Database {formatBytes(storage.databaseBytes)}</span>
                    <span className="text-muted">Media {formatBytes(storage.mediaBytes)}</span>
                    <span className="text-muted">Recordings {formatBytes(storage.recordingsBytes)}</span>
                    <span className="text-muted">Safety copies {formatBytes(storage.backupsBytes)}</span>
                  </div>
                </Row>
                <Row label="Contents">
                  <span className="text-muted">
                    {storage.videoCount} videos · {storage.sentenceCount} sentences · {storage.savedCount} saved · {storage.noteCount} notes
                  </span>
                </Row>
                <Row label="Missing files">
                  <div className="flex items-start gap-2">
                    {storage.missing.length === 0 ? (
                      <span className="flex items-center gap-1 text-success">
                        <CheckCircle2 size={14} /> All media and recording files are present
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {storage.missing.map((m) => (
                          <li key={m.kind + m.id} className="flex items-center gap-1.5 text-warn">
                            <AlertTriangle size={13} /> {m.kind === "media" ? `Video: ${m.label}` : "A recording"} — <span className="selectable truncate font-mono text-[11px]">{m.path}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex-1" />
                    <Button size="sm" variant="ghost" icon={RefreshCw} onClick={loadStorage}>
                      Recheck
                    </Button>
                  </div>
                </Row>
              </>
            ) : (
              info?.path && !storageError && <Spinner />
            )}
          </Section>

          <Section title="Backup & restore" icon={Shield}>
            <Row label="Backup" hint="Creates a .zip with your database (videos, transcripts, notes, vault, history, templates) and recordings.">
              <div className="flex items-center gap-3">
                <Button variant="primary" onClick={() => void backup()} loading={busy === "backup"}>
                  Create backup…
                </Button>
                <Checkbox checked={includeMedia} onChange={setIncludeMedia} label={`Include video/audio files${storage ? ` (${formatBytes(storage.mediaBytes)})` : ""}`} />
              </div>
            </Row>
            <Row label="Restore" hint="Replaces the current database after saving a safety copy. Requires confirmation.">
              <Button onClick={() => void restore()} loading={busy === "restore"}>
                Restore from backup…
              </Button>
            </Row>
            <Row label="Export">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void exportVault("csv")}>
                  Saved sentences (CSV)
                </Button>
                <Button size="sm" onClick={() => void exportVault("txt")}>
                  Saved sentences (TXT)
                </Button>
                <Button size="sm" onClick={() => void exportNotes()}>
                  All notes (Markdown)
                </Button>
              </div>
              <div className="mt-1 text-[11.5px] text-faint">Transcripts are exported from the workspace (⋯ menu → Export).</div>
            </Row>
          </Section>

          <Section title="Media tools">
            <ToolLine name="yt-dlp" path={info?.tools.ytDlp ?? null} purpose="video details, public downloads, captions" />
            <ToolLine name="ffmpeg" path={info?.tools.ffmpeg ?? null} purpose="merging downloaded audio + video" />
            <ToolLine name="ffprobe" path={info?.tools.ffprobe ?? null} purpose="duration and integrity checks" />
            <ToolLine name="whisper-cli" path={info?.tools.whisper ?? null} purpose="offline speech-to-text (video audio and your recordings)" />
            <ToolLine name="Whisper model" path={info?.tools.whisperModel ?? null} purpose="e.g. ggml-small.en.bin in ~/.local/share/whisper" />
            <div className="text-[11.5px] text-faint">
              Downloads never use your browser cookies or accounts: only public videos can be downloaded. Private, login-only and DRM-protected media are not supported.
            </div>
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void refreshInfo()} className="self-start">
              Check again
            </Button>
          </Section>

          <Section title="AI assistant (optional)" icon={KeyRound}>
            <AiSettings />
          </Section>

          <Section title="Privacy" icon={Shield}>
            <div className="text-muted">
              FluentLoop is local-first. Your library, notes, transcripts and recordings stay on this Mac. There is no account, no cloud sync and no analytics or
              telemetry. The internet is used only for online playback, fetching video details/captions/downloads you request, and AI requests you send.
            </div>
          </Section>
        </div>
      </div>

      {moveTarget && (
        <Modal title="Change library location" onClose={() => setMoveTarget(null)} width={500}>
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="selectable rounded-md bg-sunken px-2.5 py-1.5 font-mono text-[11.5px]">{moveTarget}</div>
            <div>
              <b>Copy my library here</b> — copies the database, media and recordings into this folder (must not already contain a library) and uses it from now on.
              The old folder is left untouched.
            </div>
            <div>
              <b>Open the library in this folder</b> — switches to the library already in this folder, or starts a new empty one. Nothing is copied or overwritten.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setMoveTarget(null)}>Cancel</Button>
              <Button onClick={() => void applyLocation(false)} loading={busy === "location"}>
                Open library here
              </Button>
              <Button variant="primary" onClick={() => void applyLocation(true)} loading={busy === "location"}>
                Copy my library here
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
