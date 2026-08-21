import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { CameraIcon, CheckIcon, CloseIcon, ImageIcon, UploadIcon } from "./Icons";
import { ACCEPTED_IMAGE_TYPES, formatFileSize } from "./image-selection";
import type { Locale, Messages } from "./i18n";

interface Props {
  file?: File;
  previewUrl?: string;
  maxUploadBytes: number;
  locale: Locale;
  messages: Messages;
  disabled?: boolean;
  onSelect: (file?: File) => void;
}

export function ImagePicker({
  file,
  previewUrl,
  maxUploadBytes,
  locale,
  messages,
  disabled = false,
  onSelect,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const accept = ACCEPTED_IMAGE_TYPES.join(",");

  function selectFromInput(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0];
    if (next) onSelect(next);
    event.currentTarget.value = "";
  }

  function isFileDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function dragEnter(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (disabled || !isFileDrag(event)) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function dragLeave(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (disabled) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    const next = event.dataTransfer.files[0];
    if (next) onSelect(next);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  return (
    <div className="image-picker">
      <input ref={fileInputRef} hidden type="file" accept={accept} onChange={selectFromInput} />
      <input
        ref={cameraInputRef}
        hidden
        type="file"
        accept={accept}
        capture="environment"
        onChange={selectFromInput}
      />

      <button
        type="button"
        className={`drop-surface${dragging ? " is-dragging" : ""}${
          previewUrl ? " has-preview" : ""
        }`}
        disabled={disabled}
        onClick={openFilePicker}
        onDragEnter={dragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={dragLeave}
        onDrop={drop}
      >
        {previewUrl ? (
          <>
            <img src={previewUrl} alt={messages.image.selectedAlt} />
            <span className="preview-status">
              <CheckIcon />
              {messages.image.selected}
            </span>
          </>
        ) : (
          <span className="drop-prompt">
            <span className="drop-icon">{dragging ? <UploadIcon /> : <ImageIcon />}</span>
            <strong>{dragging ? messages.image.dropActive : messages.image.dropTitle}</strong>
            <span>{messages.image.dropDescription}</span>
          </span>
        )}
      </button>

      {file && (
        <div className="selected-file">
          <div>
            <strong>{file.name}</strong>
            <span>
              {file.type.replace("image/", "").toUpperCase()} ·{" "}
              {formatFileSize(file.size, locale === "ja" ? "ja-JP" : "en-US")}
            </span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => onSelect(undefined)}
            disabled={disabled}
            aria-label={messages.image.remove}
            title={messages.image.remove}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <div className="picker-actions">
        <button
          type="button"
          className="control-button secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          <ImageIcon />
          {messages.image.choose}
        </button>
        <button
          type="button"
          className="control-button secondary"
          onClick={() => cameraInputRef.current?.click()}
          disabled={disabled}
        >
          <CameraIcon />
          {messages.image.camera}
        </button>
      </div>
      <p className="picker-note">
        <span>
          {messages.image.supportedTypes} {formatFileSize(maxUploadBytes, locale)}
        </span>
        <span>{messages.image.cameraHint}</span>
      </p>
    </div>
  );
}
