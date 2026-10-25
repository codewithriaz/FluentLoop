import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle, Download, ExternalLink, FileUp, Film, FolderInput, FolderPlus, Music, MoreHorizontal, Paperclip, Pencil, Plus, Search, StickyNote, Trash2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useApp } from "../AppContext";
import { useFeedback } from "../components/feedback";
import { NoteEditor } from "../components/NoteEditor";
import { ScreenHeader } from "../components/ScreenHeader";
import { SectionTabs } from "../components/SectionTabs";
import { Badge, Button, EmptyState, IconButton, Menu, Modal, SearchField, Select, Spinner, TextInput } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatTime, platformLabel, relativeDate } from "../lib/format";
import type { Folder, Video } from "../lib/types";
import { AddVideoDialog } from "./AddVideoDialog";

export const MEDIA_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "aiff", "aif"];

function Thumb({ video }: { video: Video }) {
  const [broken, setBroken] = useState(false);
  if (video.thumbnailUrl && !broken) {
    return <img src={video.thumbnailUrl} alt="" onError={() => setBroken(true)} className="h-[40px] w-[71px] shrink-0 rounded object-cover bg-sunken" />;
  }
  const Icon = video.mediaKind === "audio" || video.platform === "local_audio" ? Music : Film;
  return (
    <div className="flex h-[40px] w-[71px] shrink-0 items-center justify-center rounded bg-sunken text-faint">
      <Icon size={16} />
    </div>
  );
}

function MediaStatus({ video, percent }: { video: Video; percent?: number | null }) {
  if (video.mediaStatus === "downloading" || percent !== undefined) {
    return (
      <Badge tone="accent">
        <Spinner size={10} className="text-accent-text" /> {percent != null ? `${Math.round(percent)}%` : "Downloading"}
      </Badge>
    );
  }
  if (video.mediaMissing) return <Badge tone="danger">File missing</Badge>;
  if (video.mediaStatus === "failed") return <Badge tone="warn">Download failed</Badge>;
  if (video.mediaStatus === "ready") return <Badge tone="success">Offline</Badge>;
  if (video.sourceUrl) return <Badge>Link only</Badge>;
  return null;
}

export function LibraryScreen({ folderId, recent }: { folderId: string | null; recent: boolean }) {
  const { dataVersion, bump, openVideo, navigate, downloads, startDownload, info } = useApp();
  const { toast, confirm } = useFeedback();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [moving, setMoving] = useState<Video | null>(null);
  const [renaming, setRenaming] = useState<{ kind: "video" | "folder"; id: string; name: string } | null>(null);
  const [showFolderNote, setShowFolderNote] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const folder = useMemo(() => folders.find((f) => f.id === folderId) ?? null, [folders, folderId]);

  const load = useCallback(async () => {
    try {
      const [v, f] = await Promise.all([api.listVideos({ folderId, search, recentOnly: recent }), api.listFolders()]);
      setVideos(v);
      setFolders(f);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setVideos([]);
    }
  }, [folderId, search, recent]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, dataVersion, search]);

  const importFiles = async () => {
    const picked = await open({ multiple: true, filters: [{ name: "Video or audio", extensions: MEDIA_EXTENSIONS }] });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (!paths.length) return;
    setImporting(true);
    let ok = 0;
    for (const p of paths) {
      try {
        await api.importMediaFile(p, folderId);
        ok++;
      } catch (e) {
        toast(`${p.split("/").pop()}: ${errorMessage(e)}`, "error");
      }
    }
    setImporting(false);
    if (ok) toast(`Imported ${ok} file${ok > 1 ? "s" : ""}`);
    bump();
  };

  const attachFile = async (v: Video) => {
    const picked = await open({ multiple: false, filters: [{ name: "Video or audio", extensions: MEDIA_EXTENSIONS }] });
    if (typeof picked !== "string") return;
    try {
      await api.attachMediaFile(v.id, picked);
      toast("File attached");
      bump();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const deleteVideo = async (v: Video) => {
    const ok = await confirm({
      title: "Delete video?",
      message: (
        <>
          “{v.title}” will be removed with its transcript, sentence notes, recordings and any downloaded media. Saved sentences stay in the
          vault. This cannot be undone.
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteVideo(v.id);
      toast("Video deleted");
      bump();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const deleteFolder = async () => {
    if (!folder) return;
    const ok = await confirm({
      title: "Delete folder?",
      message: `“${folder.name}” will be deleted. Its ${folder.videoCount} video(s) are kept and moved to “No folder”.`,
      confirmLabel: "Delete folder",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteFolder(folder.id);
      bump();
      navigate({ screen: "library", folderId: null });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const submitRename = async () => {
    if (!renaming) return;
    try {
      if (renaming.kind === "folder") await api.renameFolder(renaming.id, renaming.name);
      else await api.updateVideo(renaming.id, { title: renaming.name });
      bump();
      setRenaming(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const scope = recent ? "Recently practiced" : (folder?.name ?? "All videos");

  const createFolder = async () => {
    const name = newFolder?.trim();
    if (!name) return;
    try {
      const id = await api.createFolder(name);
      setNewFolder(null);
      bump();
      navigate({ screen: "library", folderId: id });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title="Video Studio"
        subtitle={videos ? `${scope} · ${videos.length} item${videos.length === 1 ? "" : "s"}` : scope}
        actions={
          <>
            <Button icon={FileUp} onClick={() => void importFiles()} loading={importing}>
              Import File
            </Button>
            <Button icon={Plus} variant="primary" onClick={() => setAdding(true)}>
              Add Video
            </Button>
          </>
        }
        tabs={<SectionTabs section="studio" />}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={search} onChange={setSearch} placeholder="Search titles, channels, links" shortcut className="w-full max-w-sm" />
          {!recent && (
            <>
              <Select
                aria-label="Folder"
                value={folderId ?? ""}
                onChange={(e) => navigate({ screen: "library", folderId: e.target.value || null })}
                className="max-w-[220px]"
              >
                <option value="">All folders</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.videoCount})
                  </option>
                ))}
              </Select>
              <Button icon={FolderPlus} variant="ghost" onClick={() => setNewFolder("")}>
                New folder
              </Button>
            </>
          )}
          {folder && (
            <>
              <Button icon={StickyNote} variant={showFolderNote ? "soft" : "ghost"} onClick={() => setShowFolderNote((s) => !s)}>
                Folder note
              </Button>
              <Menu
                trigger={(toggle) => <IconButton icon={MoreHorizontal} label="Folder actions" onClick={toggle} className="h-9 w-9" />}
                items={[
                  { label: "Rename folder", icon: Pencil, onClick: () => setRenaming({ kind: "folder", id: folder.id, name: folder.name }) },
                  { label: "Delete folder", icon: Trash2, danger: true, onClick: () => void deleteFolder() },
                ]}
              />
            </>
          )}
        </div>
      </ScreenHeader>

      {folder && showFolderNote && (
        <div className="border-b border-line bg-panel px-5 py-3 md:px-8">
          <NoteEditor entityType="folder" entityId={folder.id} placeholder="Notes for this folder…" rows={3} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <div className="p-4 text-danger">{error}</div>}
        {videos === null ? (
          <div className="flex justify-center p-10">
            <Spinner />
          </div>
        ) : videos.length === 0 ? (
          search ? (
            <EmptyState icon={Search} title="No matches">
              Nothing matches “{search}”.
            </EmptyState>
          ) : recent ? (
            <EmptyState icon={Film} title="Nothing practiced yet">
              Videos you practice will appear here.
            </EmptyState>
          ) : (
            <EmptyState
              icon={Film}
              title="Your library is empty"
              action={
                <div className="flex gap-2">
                  <Button icon={FileUp} onClick={() => void importFiles()}>
                    Import File
                  </Button>
                  <Button icon={Plus} variant="primary" onClick={() => setAdding(true)}>
                    Add Video
                  </Button>
                </div>
              }
            >
              Paste a YouTube or Facebook link, or import a video/audio file from your Mac.
            </EmptyState>
          )
        ) : (
          <ul className="divide-y divide-line">
            {videos.map((v) => {
              const dl = downloads[v.id];
              const canDownload = !!v.sourceUrl && !!info?.tools.ytDlp && (v.mediaStatus !== "ready" || v.mediaMissing) && !dl;
              return (
                <li
                  key={v.id}
                  className="group flex cursor-default items-center gap-3 px-5 py-2.5 hover:bg-hover/60 md:px-8"
                  onDoubleClick={() => openVideo(v.id)}
                >
                  <button type="button" onClick={() => openVideo(v.id)} className="shrink-0">
                    <Thumb video={v} />
                  </button>
                  <button type="button" onClick={() => openVideo(v.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[13.5px] font-medium">{v.title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-muted">
                      <span>{platformLabel(v.platform)}</span>
                      {v.channel && <span className="truncate">· {v.channel}</span>}
                      {v.durationSec != null && <span>· {formatTime(v.durationSec)}</span>}
                      {v.sentenceCount > 0 && (
                        <span>
                          · {v.practicedCount}/{v.sentenceCount} practiced
                        </span>
                      )}
                    </div>
                    {v.mediaStatus === "failed" && v.mediaError && !dl && (
                      <div className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-warn" title={v.mediaError}>
                        <AlertTriangle size={11} /> {v.mediaError.split("\n")[0]}
                      </div>
                    )}
                  </button>
                  <MediaStatus video={v} percent={dl ? dl.percent : undefined} />
                  <div className="w-[88px] shrink-0 text-right text-[11.5px] text-faint" title="Last practiced">
                    {relativeDate(v.lastPracticedAt)}
                  </div>
                  <Menu
                    trigger={(toggle) => <IconButton icon={MoreHorizontal} label="Video actions" onClick={toggle} className="opacity-60 group-hover:opacity-100" />}
                    items={[
                      { label: "Open", icon: Film, onClick: () => openVideo(v.id) },
                      { label: "Rename", icon: Pencil, onClick: () => setRenaming({ kind: "video", id: v.id, name: v.title }) },
                      { label: "Move to folder", icon: FolderInput, onClick: () => setMoving(v) },
                      "divider",
                      { label: v.mediaStatus === "failed" ? "Retry download" : "Download for offline", icon: Download, disabled: !canDownload, onClick: () => void startDownload(v.id) },
                      { label: "Attach my own file", icon: Paperclip, onClick: () => void attachFile(v) },
                      { label: "Open link in browser", icon: ExternalLink, disabled: !v.sourceUrl, onClick: () => v.sourceUrl && void openUrl(v.sourceUrl) },
                      "divider",
                      { label: "Delete", icon: Trash2, danger: true, onClick: () => void deleteVideo(v) },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {adding && <AddVideoDialog folders={folders} defaultFolderId={folderId} onClose={() => setAdding(false)} />}

      {moving && (
        <Modal title="Move to folder" onClose={() => setMoving(null)} width={380}>
          <Select
            className="w-full"
            defaultValue={moving.folderId ?? ""}
            onChange={async (e) => {
              try {
                await api.updateVideo(moving.id, { folderId: e.target.value });
                bump();
                setMoving(null);
                toast("Moved");
              } catch (err) {
                toast(errorMessage(err), "error");
              }
            }}
          >
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Modal>
      )}

      {newFolder !== null && (
        <Modal
          title="New folder"
          onClose={() => setNewFolder(null)}
          width={400}
          footer={
            <>
              <Button onClick={() => setNewFolder(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void createFolder()} disabled={!newFolder.trim()}>
                Create
              </Button>
            </>
          }
        >
          <TextInput
            autoFocus
            placeholder="Folder name"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createFolder()}
          />
        </Modal>
      )}

      {renaming && (
        <Modal
          title={renaming.kind === "folder" ? "Rename folder" : "Rename video"}
          onClose={() => setRenaming(null)}
          width={420}
          footer={
            <>
              <Button onClick={() => setRenaming(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void submitRename()} disabled={!renaming.name.trim()}>
                Save
              </Button>
            </>
          }
        >
          <TextInput
            autoFocus
            value={renaming.name}
            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && void submitRename()}
          />
        </Modal>
      )}
    </div>
  );
}
