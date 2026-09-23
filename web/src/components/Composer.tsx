import { useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type {
  AdapterCapabilities,
  MessageAttachment,
  ModelCatalogItem,
  ModelParam,
  PromptTemplate,
  QueueItem,
  RedactedConfig,
} from "@glassys/protocol";
import { useT } from "../i18n";
import { isImageMime, slashQuery } from "../format";
import { shouldSubmitOnEnter } from "../operatorError";
import { CommandPalette, templatePaletteItems } from "./CommandPalette";
import { ModelMenu } from "./ModelMenu";
import { PermissionChip } from "./PermissionChip";
import { Kbd } from "./Primitives";
import {
  IconAlert,
  IconArrowUp,
  IconAttach,
  IconClose,
  IconStop,
  IconZap,
} from "./Icon";

export type ComposerProps = {
  config: RedactedConfig;
  onConfig: (c: RedactedConfig) => void;
  caps?: AdapterCapabilities;
  adapterName: string;
  models: ModelCatalogItem[];
  modelId: string;
  modelParams: ModelParam[];
  onModel: (id: string, params: ModelParam[]) => void;
  fallbackCatalog: boolean;
  catalogError: string;
  text: string;
  onText: (next: string) => void;
  drafts: MessageAttachment[];
  onRemoveDraft: (id: string) => void;
  onAttach: (files: FileList | File[] | null) => void;
  fileRef: RefObject<HTMLInputElement | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: (e: FormEvent) => void;
  onResize: (el: HTMLTextAreaElement) => void;
  canSend: boolean;
  busy: boolean;
  waiting: boolean;
  onCancel: () => void;
  queue: QueueItem[];
  onQueueCancel: (id: string) => void;
  templates: PromptTemplate[];
  onTemplate: (text: string) => void;
  slashOpen: boolean;
  setSlashOpen: (open: boolean) => void;
  paletteOpen: boolean;
  onPalette: () => void;
  status: ReactNode;
};

function attachableFile(file: File): boolean {
  if (isImageMime(file.type)) return true;
  if (
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    file.type === "text/x-log" ||
    file.type === "application/json" ||
    file.type === "application/x-ndjson"
  ) {
    return true;
  }
  return /\.(log|txt|md|json|jsonl|service|conf|journal)$/i.test(file.name);
}

/**
 * One card: the message on top, everything that describes how it will run in a
 * bar inside its bottom edge. The controls used to sit in a separate row above
 * the box, led by a floating "Model" label, with the hint line below — three
 * bands of chrome around a single-line input.
 */
export function Composer(props: ComposerProps) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const {
    config,
    onConfig,
    caps,
    adapterName,
    models,
    modelId,
    modelParams,
    onModel,
    fallbackCatalog,
    catalogError,
    text,
    onText,
    drafts,
    onRemoveDraft,
    onAttach,
    fileRef,
    composerRef,
    onSubmit,
    onResize,
    canSend,
    busy,
    waiting,
    onCancel,
    queue,
    onQueueCancel,
    templates,
    onTemplate,
    slashOpen,
    setSlashOpen,
    onPalette,
    status,
  } = props;

  return (
    <form
      className={`composer${dragging ? " dragging" : ""}`}
      onSubmit={onSubmit}
      onPaste={(e) => {
        const files = [...(e.clipboardData?.files ?? [])];
        const fromFiles = files.filter((f) => attachableFile(f));
        if (fromFiles.length) {
          e.preventDefault();
          onAttach(fromFiles);
          return;
        }
        const pasted = e.clipboardData?.getData("text/plain") || "";
        if (pasted.length > 2048) {
          e.preventDefault();
          onAttach([new File([pasted], "paste.txt", { type: "text/plain" })]);
        }
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        const files = [...e.dataTransfer.files].filter((f) => attachableFile(f));
        if (!files.length) return;
        e.preventDefault();
        onAttach(files);
      }}
    >
      <div className="composer-inner">
        {queue.length > 0 && (
          <div className="queue-band">
            <p className="eyebrow">
              {t("chat.queueList")} · <span className="nums">{queue.length}</span>
            </p>
            <ul className="queue-list" aria-label={t("chat.queueList")}>
              {queue.map((item) => (
                <li key={item.id}>
                  <span className="truncate">
                    {item.source === "schedule" ? `${t("chat.queueSchedule")}: ` : ""}
                    {item.text || (item.hasAttachments ? t("chat.pendingAttach") : t("chat.pending"))}
                  </span>
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={t("chat.queueRemove")}
                    title={t("chat.queueRemove")}
                    onClick={() => onQueueCancel(item.id)}
                  >
                    <IconClose />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* The run's own strip, tucked into the top edge of the card. */}
        {status}

        {drafts.length > 0 && (
          <div className="thumbs draft-thumbs">
            {drafts.map((a) => (
              <button
                key={a.id}
                type="button"
                className="thumb-remove"
                aria-label={`${t("chat.removeAttach")} ${a.name}`}
                title={`${t("chat.removeAttach")} ${a.name}`}
                onClick={() => onRemoveDraft(a.id)}
              >
                {isImageMime(a.mime) ? (
                  <img src={`/api/uploads/${encodeURIComponent(a.id)}`} alt={a.name} />
                ) : (
                  <span className="file-chip">{a.name}</span>
                )}
                {/* Without this badge nothing said the thumbnail was removable. */}
                <span className="thumb-badge" aria-hidden="true">
                  <IconClose />
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="composer-box">
          <textarea
            ref={composerRef}
            rows={1}
            value={text}
            placeholder={t("chat.placeholder")}
            aria-label={t("chat.placeholder")}
            enterKeyHint="send"
            onChange={(e) => {
              const next = e.target.value;
              onText(next);
              const q = slashQuery(next);
              setSlashOpen(q !== null);
              onResize(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (slashOpen || props.paletteOpen) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault();
                }
                return;
              }
              if (shouldSubmitOnEnter(e)) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
          />
          {slashOpen && (
            <CommandPalette
              open
              inline
              hideSearch
              query={slashQuery(text) ?? ""}
              items={templatePaletteItems(templates, t, onTemplate)}
              onClose={() => setSlashOpen(false)}
            />
          )}

          {/* The toolbar lives inside the card's bottom edge. */}
          <div className="composer-meta">
            <button
              type="button"
              className="icon-btn sm composer-attach"
              aria-label={t("chat.attach")}
              title={t("chat.attach")}
              onClick={() => fileRef.current?.click()}
            >
              <IconAttach />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.log,.txt,.md,.json,.jsonl,.service,.conf,.journal,text/plain"
              multiple
              hidden
              onChange={(e) => onAttach(e.target.files)}
            />
            <button
              type="button"
              className="icon-btn sm"
              aria-label={t("palette.title")}
              title={t("palette.title")}
              onClick={onPalette}
            >
              <IconZap />
            </button>
            {caps?.models !== false && (
              <ModelMenu
                models={models}
                modelId={modelId}
                params={modelParams}
                preferred={caps?.defaultModel}
                adapterName={adapterName}
                onChange={onModel}
              />
            )}
            {fallbackCatalog && caps?.liveCatalog !== false && caps && (
              <p className="warn composer-warn" title={catalogError || t("wizard.model.fallbackShort")}>
                <IconAlert />
                <span className="truncate">{t("wizard.model.fallbackShort")}</span>
              </p>
            )}
            <PermissionChip config={config} caps={caps} onConfig={onConfig} />
            {caps?.attachments === false && (
              <p className="muted composer-hint" title={t("chat.attachPathOnly")}>
                {t("chat.attachPathOnly")}
              </p>
            )}
            {waiting && <p className="muted composer-hint">{t("chat.queuedHint")}</p>}

            <span className="composer-spacer" />

            {busy && caps?.cancel !== false ? (
              <button
                type="button"
                className="composer-send stop"
                aria-label={t("chat.cancel")}
                title={t("chat.cancel")}
                onClick={onCancel}
              >
                <IconStop fill="currentColor" />
              </button>
            ) : (
              <button className="composer-send" type="submit" disabled={!canSend} aria-label={t("chat.send")}>
                <IconArrowUp />
              </button>
            )}
          </div>
        </div>
        <p className="muted composer-hint composer-shortcut">
          <Kbd>⏎</Kbd> {t("chat.hintSend")} · <Kbd>⇧⏎</Kbd> {t("chat.hintNewline")} · <Kbd>/</Kbd>{" "}
          {t("chat.hintSlash")}
        </p>
      </div>
    </form>
  );
}
