import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCopy } from "../../useCopy";
import type { DirListing, FileEntry, FilePreview } from "@glassys/protocol";
import { useT } from "../../i18n";
import { formatBytes, formatRelativeShort } from "../../format";
import { Callout, ListRow, Skeleton } from "../../components/Primitives";
import {
  IconArrowUp,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconFile,
  IconFileCode,
  IconFolder,
  IconMention,
  IconZap,
} from "../../components/Icon";
import { HostHead, fill, useLoad, type Draft, type HostSource } from "./shared";

/** Files: a read-only browser and preview; changes are asked of the agent. */

function fileGlyph(e: FileEntry): ReactNode {
  if (e.type === "dir") return <IconFolder />;
  if (/\.(conf|ya?ml|json|toml|ini|service|timer|sh|py|js|ts|rb|go|rs)$/i.test(e.name)) return <IconFileCode />;
  return <IconFile />;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function Crumbs({ path, onOpen }: { path: string; onOpen: (p: string) => void }) {
  const parts = path.split("/").filter(Boolean);
  /* A deep path keeps its end in view: the folder you are in matters more
     than the root, and clipping the tail hid exactly that folder. */
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    el.classList.toggle("clipped", el.scrollWidth > el.clientWidth);
  }, [path]);
  return (
    <nav className="crumbs mono" aria-label={path} ref={nav}>
      <button type="button" onClick={() => onOpen("/")}>
        /
      </button>
      {parts.map((part, i) => {
        const to = `/${parts.slice(0, i + 1).join("/")}`;
        return (
          <span key={to} className="crumb">
            {/* A chevron between segments: a slash beside the root's own slash
                read as one path with spaces in it. */}
            <span className="crumb-sep" aria-hidden="true">
              <IconChevronRight />
            </span>
            <button type="button" onClick={() => onOpen(to)} aria-current={i === parts.length - 1 ? "page" : undefined}>
              {part}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

export function FilesView({
  source,
  start,
  locale,
  onDraft,
  onMention,
  narrow,
}: {
  source: HostSource;
  start: string;
  locale: string;
  onDraft: Draft;
  onMention: (text: string) => void;
  narrow: boolean;
}) {
  const t = useT();
  const [dir, setDir] = useState(start || "/");
  const [file, setFile] = useState<string | null>(null);
  const { state: copyState, copy: copyPath } = useCopy();
  const copied = copyState === "copied";
  const listing = useLoad<DirListing>(() => source.hostFiles(dir), [source, dir]);
  const preview = useLoad<FilePreview | null>(
    () => (file ? source.hostFile(file) : Promise.resolve(null)),
    [source, file],
  );
  const lines = useMemo(() => (preview.data?.text ?? "").replace(/\n$/, "").split("\n"), [preview.data?.text]);
  const lineNumbers = useMemo(() => lines.map((_, i) => i + 1).join("\n"), [lines]);

  function open(path: string) {
    setDir(path);
    setFile(null);
  }

  const list = (
    <div className="files-pane">
      <div className="files-pane-head">
        <button
          type="button"
          className="icon-btn sm"
          disabled={!listing.data?.parent}
          onClick={() => listing.data?.parent && open(listing.data.parent)}
          aria-label={t("files.up")}
          title={t("files.up")}
        >
          <IconArrowUp />
        </button>
        <Crumbs path={listing.data?.path ?? dir} onOpen={open} />
      </div>
      <div className="files-scroll">
        {listing.error ? <Callout tone="danger">{listing.error}</Callout> : null}
        {!listing.data && listing.loading ? <Skeleton rows={8} label={t("host.loading")} /> : null}
        {listing.data && listing.data.entries.length === 0 ? <p className="muted host-empty">{t("files.empty")}</p> : null}
        {listing.data?.entries.map((e) => {
          const path = joinPath(listing.data!.path, e.name);
          return (
            <ListRow
              key={e.name}
              glyph={fileGlyph(e)}
              current={file === path}
              onClick={() => (e.type === "dir" ? open(path) : setFile(path))}
              title={path}
              tail={
                <>
                  <span className="files-size">{e.type !== "dir" ? formatBytes(e.size, locale) : ""}</span>
                  <span className="files-mtime">{e.mtime ? formatRelativeShort(new Date(e.mtime).toISOString(), Date.now(), locale) : ""}</span>
                </>
              }
            >
              {e.name}
              {e.type === "link" ? <span className="muted"> →</span> : null}
            </ListRow>
          );
        })}
        {listing.data?.truncated ? <p className="muted host-empty">{t("files.truncatedDir")}</p> : null}
      </div>
    </div>
  );

  const view = (
    <div className="files-pane preview-pane">
      {file ? (
        <>
          <div className="files-pane-head">
            {narrow ? (
              <button type="button" className="icon-btn sm" onClick={() => setFile(null)} aria-label={t("files.back")} title={t("files.back")}>
                <IconChevronLeft />
              </button>
            ) : null}
            <span className="mono truncate preview-path" title={file}>
              {file}
            </span>
            <button
              type="button"
              className="icon-btn sm"
              aria-label={t("files.copyPath")}
              title={copied ? t("chat.copied") : t("files.copyPath")}
              onClick={() => void copyPath(file)}
            >
              {copied ? <IconCheck /> : <IconCopy />}
            </button>
            <button type="button" className="ghost tiny" title={t("files.mention")} onClick={() => onMention(`\`${file}\``)}>
              <IconMention />
              <span className="btn-label">{t("files.mention")}</span>
            </button>
            <button
              type="button"
              className="ghost tiny"
              title={t("files.askChange")}
              onClick={() => onDraft(fill(t("prompt.draft.fileChange"), { path: file }))}
            >
              <IconZap />
              <span className="btn-label">{t("files.askChange")}</span>
            </button>
          </div>
          <div className="files-scroll">
            {preview.error ? <Callout tone="danger">{preview.error}</Callout> : null}
            {preview.loading && !preview.data ? <Skeleton rows={8} label={t("host.loading")} /> : null}
            {preview.data?.binary ? <Callout>{t("files.binary")}</Callout> : null}
            {preview.data?.text !== undefined ? (
              <pre className="file-preview">
                <span className="file-no" aria-hidden="true">
                  {lineNumbers}
                </span>
                <code>{lines.join("\n")}</code>
              </pre>
            ) : null}
            {preview.data?.truncated ? <p className="muted host-empty">{t("files.truncated")}</p> : null}
          </div>
        </>
      ) : (
        <div className="preview-empty muted">
          <IconFile />
          <p>{t("files.pick")}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="host-page host-page-fill files-page">
      <HostHead title={t("nav.files")} sub={t("files.readOnly")} />
      <div className={`files-split${narrow ? " narrow" : ""}`}>
        {narrow ? (file ? view : list) : (
          <>
            {list}
            {view}
          </>
        )}
      </div>
    </div>
  );
}
