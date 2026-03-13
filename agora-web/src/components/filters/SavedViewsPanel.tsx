"use client";

import type { SavedFilterView } from "@/lib/saved-views";

interface SavedViewsPanelProps {
  title: string;
  views: SavedFilterView[];
  onSaveCurrent: () => void;
  onCopyCurrent: () => void;
  onApply: (view: SavedFilterView) => void;
  onCopy: (view: SavedFilterView) => void;
  onDelete: (viewId: string) => void;
  emptyText?: string;
}

export default function SavedViewsPanel({
  title,
  views,
  onSaveCurrent,
  onCopyCurrent,
  onApply,
  onCopy,
  onDelete,
  emptyText = "No saved views yet.",
}: SavedViewsPanelProps) {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-800">{title}</h4>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={onSaveCurrent} type="button">
            Save this view
          </button>
          <button className="btn-secondary" onClick={onCopyCurrent} type="button">
            Copy current link
          </button>
        </div>
      </div>
      {views.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{emptyText}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {views.map((view) => (
            <div
              key={view.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{view.name}</p>
                <p className="text-xs text-gray-500">{new Date(view.created_at).toLocaleString()}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => onApply(view)} type="button">
                  Apply
                </button>
                <button className="btn-secondary" onClick={() => onCopy(view)} type="button">
                  Copy link
                </button>
                <button
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                  onClick={() => onDelete(view.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
