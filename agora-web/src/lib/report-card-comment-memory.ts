"use client";

import {
  resolveReportCardCommentFamily,
  type ReportCardCommentCategory,
  type ReportCardCommentFamily,
} from "@/lib/report-card-comment-presets";

const STORAGE_KEY = "agora.reportCardCommentMemory.v1";
const MAX_STORED_COMMENTS = 80;

export interface ReportCardCommentMemoryEntry {
  key: string;
  comment_family: ReportCardCommentFamily;
  comment_category: ReportCardCommentCategory;
  subject_name: string;
  comment_text: string;
  favorite: boolean;
  last_used_at: string | null;
  use_count: number;
}

interface ReportCardCommentMemoryInput {
  subjectName: string;
  category: ReportCardCommentCategory;
  comment: string;
}

function normalizeComment(comment: string) {
  return comment.trim().replace(/\s+/g, " ");
}

function buildKey(
  family: ReportCardCommentFamily,
  category: ReportCardCommentCategory,
  comment: string
) {
  return `${family}::${category}::${normalizeComment(comment).toLowerCase()}`;
}

function sortMemory(entries: ReportCardCommentMemoryEntry[]) {
  return [...entries].sort((left, right) => {
    if (Number(right.favorite) !== Number(left.favorite)) {
      return Number(right.favorite) - Number(left.favorite);
    }
    const leftLastUsed = left.last_used_at ? new Date(left.last_used_at).getTime() : 0;
    const rightLastUsed = right.last_used_at ? new Date(right.last_used_at).getTime() : 0;
    if (rightLastUsed !== leftLastUsed) {
      return rightLastUsed - leftLastUsed;
    }
    if (right.use_count !== left.use_count) {
      return right.use_count - left.use_count;
    }
    return left.comment_text.localeCompare(right.comment_text);
  });
}

function trimMemory(entries: ReportCardCommentMemoryEntry[]) {
  const sorted = sortMemory(entries);
  const favorites = sorted.filter((entry) => entry.favorite);
  const nonFavorites = sorted.filter((entry) => !entry.favorite);
  return [...favorites, ...nonFavorites.slice(0, Math.max(0, MAX_STORED_COMMENTS - favorites.length))];
}

function getStorage(storage?: Storage | null) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function loadReportCardCommentMemory(storage?: Storage | null) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return [] as ReportCardCommentMemoryEntry[];

  try {
    const raw = targetStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ReportCardCommentMemoryEntry =>
        typeof entry?.key === "string" &&
        typeof entry?.comment_family === "string" &&
        typeof entry?.comment_category === "string" &&
        typeof entry?.comment_text === "string"
    );
  } catch (_error) {
    return [];
  }
}

function saveReportCardCommentMemory(
  entries: ReportCardCommentMemoryEntry[],
  storage?: Storage | null
) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return;
  targetStorage.setItem(STORAGE_KEY, JSON.stringify(trimMemory(entries)));
}

function upsertEntry(
  entries: ReportCardCommentMemoryEntry[],
  input: ReportCardCommentMemoryInput,
  updater: (
    current: ReportCardCommentMemoryEntry | undefined,
    meta: { family: ReportCardCommentFamily; normalizedComment: string; key: string }
  ) => ReportCardCommentMemoryEntry | null
) {
  const normalizedComment = normalizeComment(input.comment);
  if (!normalizedComment) return entries;

  const family = resolveReportCardCommentFamily(input.subjectName);
  const key = buildKey(family, input.category, normalizedComment);
  const current = entries.find((entry) => entry.key === key);
  const next = updater(current, { family, normalizedComment, key });

  if (!next) {
    return entries.filter((entry) => entry.key !== key);
  }

  return trimMemory([
    ...entries.filter((entry) => entry.key !== key),
    next,
  ]);
}

export function recordReportCardCommentUse(
  input: ReportCardCommentMemoryInput,
  storage?: Storage | null
) {
  const currentEntries = loadReportCardCommentMemory(storage);
  const nextEntries = upsertEntry(currentEntries, input, (current, meta) => ({
    key: meta.key,
    comment_family: meta.family,
    comment_category: input.category,
    subject_name: input.subjectName,
    comment_text: meta.normalizedComment,
    favorite: current?.favorite ?? false,
    last_used_at: new Date().toISOString(),
    use_count: (current?.use_count ?? 0) + 1,
  }));
  saveReportCardCommentMemory(nextEntries, storage);
  return nextEntries;
}

export function toggleFavoriteReportCardComment(
  input: ReportCardCommentMemoryInput,
  storage?: Storage | null
) {
  const currentEntries = loadReportCardCommentMemory(storage);
  const nextEntries = upsertEntry(currentEntries, input, (current, meta) => {
    const favorite = !(current?.favorite ?? false);
    if (!favorite && !(current?.last_used_at || current?.use_count)) {
      return null;
    }
    return {
      key: meta.key,
      comment_family: meta.family,
      comment_category: input.category,
      subject_name: input.subjectName,
      comment_text: meta.normalizedComment,
      favorite,
      last_used_at: current?.last_used_at ?? null,
      use_count: current?.use_count ?? 0,
    };
  });
  saveReportCardCommentMemory(nextEntries, storage);
  return nextEntries;
}

interface SelectCommentMemoryOptions {
  subjectName: string;
  category: ReportCardCommentCategory;
  limit?: number;
}

export function getFavoriteReportCardComments(
  entries: ReportCardCommentMemoryEntry[],
  options: SelectCommentMemoryOptions
) {
  const family = resolveReportCardCommentFamily(options.subjectName);
  return sortMemory(entries)
    .filter(
      (entry) =>
        entry.favorite &&
        entry.comment_family === family &&
        entry.comment_category === options.category
    )
    .slice(0, options.limit ?? 4);
}

export function getRecentReportCardComments(
  entries: ReportCardCommentMemoryEntry[],
  options: SelectCommentMemoryOptions
) {
  const family = resolveReportCardCommentFamily(options.subjectName);
  return sortMemory(entries)
    .filter(
      (entry) =>
        !!entry.last_used_at &&
        entry.comment_family === family &&
        entry.comment_category === options.category
    )
    .slice(0, options.limit ?? 4);
}

export function isFavoriteReportCardComment(
  entries: ReportCardCommentMemoryEntry[],
  input: ReportCardCommentMemoryInput
) {
  const normalizedComment = normalizeComment(input.comment);
  if (!normalizedComment) return false;
  const family = resolveReportCardCommentFamily(input.subjectName);
  const key = buildKey(family, input.category, normalizedComment);
  return entries.some((entry) => entry.key === key && entry.favorite);
}
