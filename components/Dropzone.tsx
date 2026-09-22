"use client";

import { useCallback, useRef, useState } from "react";

export default function Dropzone({
  onFile,
  fileName,
}: {
  onFile: (file: File) => void;
  fileName: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (f && f.type.startsWith("image/")) onFile(f);
    },
    [onFile]
  );

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
        dragOver
          ? "border-emerald-400 bg-emerald-400/10"
          : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <svg
        className="mb-3 h-8 w-8 text-zinc-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
        />
      </svg>
      {fileName ? (
        <>
          <span className="max-w-full truncate text-sm font-medium text-zinc-200">
            {fileName}
          </span>
          <span className="mt-1 text-xs text-zinc-500">
            Click or drop another image to replace it
          </span>
        </>
      ) : (
        <>
          <span className="text-sm font-medium text-zinc-200">
            Drop an image here, or click to browse
          </span>
          <span className="mt-1 text-xs text-zinc-500">
            PNG · JPG · WebP — transparent areas become empty space
          </span>
        </>
      )}
    </button>
  );
}
