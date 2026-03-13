"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import {
  bulkGenerateReportCards,
  bulkPublishReportCards,
  downloadReportCardPdf,
  getClassTeacherMyClassroom,
  getReportCard,
  getReportCardHistory,
  publishReportCard,
  unpublishReportCard,
  updateReportCardSubjectComments,
  type ClassTeacherExamTerm,
  type ClassTeacherReportCardDetail,
  type ClassTeacherReportCardHistoryItem,
} from "@/lib/api";
import {
  getCommentCategoryLabel,
  getCommentPresetsForSubject,
  getDefaultCommentCategory,
  resolveReportCardCommentFamily,
  REPORT_CARD_COMMENT_CATEGORY_OPTIONS,
  type ReportCardCommentCategory,
} from "@/lib/report-card-comment-presets";
import {
  getFavoriteReportCardComments,
  getRecentReportCardComments,
  isFavoriteReportCardComment,
  loadReportCardCommentMemory,
  recordReportCardCommentUse,
  toggleFavoriteReportCardComment,
} from "@/lib/report-card-comment-memory";

interface ReportCardHistoryKpis {
  total_cards: number;
  published_cards: number;
  draft_cards: number;
  average_percentage: number;
  average_attendance_rate: number;
  grade_distribution: Array<{
    grade: string;
    count: number;
    percentage: number;
  }>;
}

const DEFAULT_KPIS: ReportCardHistoryKpis = {
  total_cards: 0,
  published_cards: 0,
  draft_cards: 0,
  average_percentage: 0,
  average_attendance_rate: 0,
  grade_distribution: [],
};

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function CommentMemoryStrip({
  title,
  items,
  onUse,
}: {
  title: string;
  items: Array<{ key: string; comment_text: string }>;
  onUse: (comment: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className="max-w-full rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-left text-xs text-gray-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            onClick={() => onUse(item.comment_text)}
          >
            <span className="line-clamp-2">{item.comment_text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ClassTeacherReportCardsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [classSubjects, setClassSubjects] = useState<Array<{ subject_id: string; subject_name: string }>>([]);
  const [terms, setTerms] = useState<ClassTeacherExamTerm[]>([]);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all");
  const [commentStatusFilter, setCommentStatusFilter] = useState<"all" | "missing" | "completed">("all");
  const [remarks, setRemarks] = useState("");
  const [cards, setCards] = useState<ClassTeacherReportCardHistoryItem[]>([]);
  const [historyKpis, setHistoryKpis] = useState<ReportCardHistoryKpis>(DEFAULT_KPIS);
  const [historyMeta, setHistoryMeta] = useState({
    page: 1,
    page_size: 25,
    total_items: 0,
    total_pages: 1,
  });
  const [selectedCard, setSelectedCard] = useState<ClassTeacherReportCardDetail | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [commentMemory, setCommentMemory] = useState(() => loadReportCardCommentMemory());
  const [subjectCommentDrafts, setSubjectCommentDrafts] = useState<
    Record<
      string,
      {
        comment_category: ReportCardCommentCategory;
        teacher_comment: string;
      }
    >
  >({});
  const [bulkCommentConfig, setBulkCommentConfig] = useState<{
    subject_id: string;
    subject_name: string;
    comment_category: ReportCardCommentCategory;
    teacher_comment: string;
  }>({
    subject_id: "",
    subject_name: "",
    comment_category: "good_better",
    teacher_comment: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const classroomData = await getClassTeacherMyClassroom();
        if (cancelled) return;
        const resolvedClassroomId = classroomData.classroom?.id || "";
        setClassroomId(resolvedClassroomId);
        setClassSubjects(
          (classroomData.subjects || []).map((subject) => ({
            subject_id: subject.subject_id,
            subject_name: subject.subject_name,
          }))
        );
        const termRows = classroomData.exam_terms || [];
        setTerms(termRows);
        const requestedTermId = searchParams.get("exam_term_id");
        const resolvedTermId =
          requestedTermId && termRows.some((term) => term.id === requestedTermId)
            ? requestedTermId
            : termRows[0]?.id || "";
        setSelectedTermId(resolvedTermId);
        const firstSubject = classroomData.subjects?.[0];
        const requestedSubjectId = searchParams.get("subject_id");
        const resolvedSubjectId =
          requestedSubjectId &&
          classroomData.subjects?.some((subject) => subject.subject_id === requestedSubjectId)
            ? requestedSubjectId
            : "";
        setSelectedSubjectId(resolvedSubjectId);
        const requestedCommentStatus = searchParams.get("comment_status");
        setCommentStatusFilter(
          requestedCommentStatus === "missing" || requestedCommentStatus === "completed"
            ? requestedCommentStatus
            : "all"
        );
        if (firstSubject) {
          const selectedSubject =
            classroomData.subjects?.find((subject) => subject.subject_id === resolvedSubjectId) || firstSubject;
          const defaultCategory: ReportCardCommentCategory = "good_better";
          const presets = getCommentPresetsForSubject(selectedSubject.subject_name, defaultCategory);
          setBulkCommentConfig({
            subject_id: selectedSubject.subject_id,
            subject_name: selectedSubject.subject_name,
            comment_category: defaultCategory,
            teacher_comment: presets[0] || "",
          });
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load classroom/terms");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const fetchHistory = useCallback(
    async (page = 1) => {
      if (!classroomId || !selectedTermId) {
        setCards([]);
        setHistoryKpis(DEFAULT_KPIS);
        setHistoryMeta({
          page: 1,
          page_size: 25,
          total_items: 0,
          total_pages: 1,
        });
        return;
      }
      setHistoryLoading(true);
      setError("");
      try {
        const response = await getReportCardHistory({
          classroom_id: classroomId,
          exam_term_id: selectedTermId,
          subject_id: selectedSubjectId || undefined,
          status: statusFilter === "all" ? undefined : statusFilter,
          comment_status: commentStatusFilter === "all" ? undefined : commentStatusFilter,
          page,
          page_size: 25,
        });
        const nextCards = response.data.items || [];
        setCards(nextCards);
        setSelectedCardIds((current) =>
          current.filter((id) => nextCards.some((card) => card.id === id))
        );
        setHistoryKpis(response.data.kpis || DEFAULT_KPIS);
        setHistoryMeta({
          page: response.pagination.page,
          page_size: response.pagination.page_size,
          total_items: response.pagination.total_items,
          total_pages: response.pagination.total_pages,
        });
      } catch (err: unknown) {
        setCards([]);
        setHistoryKpis(DEFAULT_KPIS);
        setError(err instanceof Error ? err.message : "Failed to load report card history");
      } finally {
        setHistoryLoading(false);
      }
    },
    [classroomId, selectedSubjectId, selectedTermId, statusFilter, commentStatusFilter]
  );

  useEffect(() => {
    fetchHistory(1);
  }, [fetchHistory]);

  const selectedTerm = useMemo(() => terms.find((term) => term.id === selectedTermId) || null, [selectedTermId, terms]);
  const selectedSubject = useMemo(
    () => classSubjects.find((subject) => subject.subject_id === selectedSubjectId) || null,
    [classSubjects, selectedSubjectId]
  );
  const publishProgress = useMemo(() => {
    if (!historyKpis.total_cards) return 0;
    return Math.round((historyKpis.published_cards / historyKpis.total_cards) * 100);
  }, [historyKpis.published_cards, historyKpis.total_cards]);
  const maxGradeCount = useMemo(
    () =>
      historyKpis.grade_distribution.length > 0
        ? Math.max(...historyKpis.grade_distribution.map((row) => Number(row.count || 0)))
        : 1,
    [historyKpis.grade_distribution]
  );
  const allCardsSelected = cards.length > 0 && selectedCardIds.length === cards.length;
  const bulkPresets = useMemo(() => {
    if (!bulkCommentConfig.subject_name) return [];
    return getCommentPresetsForSubject(
      bulkCommentConfig.subject_name,
      bulkCommentConfig.comment_category
    );
  }, [bulkCommentConfig.comment_category, bulkCommentConfig.subject_name]);
  const bulkFavoriteComments = useMemo(
    () =>
      bulkCommentConfig.subject_name
        ? getFavoriteReportCardComments(commentMemory, {
            subjectName: bulkCommentConfig.subject_name,
            category: bulkCommentConfig.comment_category,
          })
        : [],
    [bulkCommentConfig.comment_category, bulkCommentConfig.subject_name, commentMemory]
  );
  const bulkRecentComments = useMemo(() => {
    if (!bulkCommentConfig.subject_name) return [];
    const favoriteKeys = new Set(bulkFavoriteComments.map((item) => item.key));
    return getRecentReportCardComments(commentMemory, {
      subjectName: bulkCommentConfig.subject_name,
      category: bulkCommentConfig.comment_category,
    }).filter((item) => !favoriteKeys.has(item.key));
  }, [
    bulkCommentConfig.comment_category,
    bulkCommentConfig.subject_name,
    bulkFavoriteComments,
    commentMemory,
  ]);
  const filteredPreviewSubjects = useMemo(() => {
    if (!selectedCard) return [];
    if (!selectedSubjectId) return selectedCard.subjects;
    return selectedCard.subjects.filter(
      (subject) =>
        subject.subject_id === selectedSubjectId ||
        subject.subject_name === selectedSubject?.subject_name
    );
  }, [selectedCard, selectedSubject?.subject_name, selectedSubjectId]);

  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(searchParams.toString());
    if (selectedTermId) {
      params.set("exam_term_id", selectedTermId);
    } else {
      params.delete("exam_term_id");
    }
    if (selectedSubjectId) {
      params.set("subject_id", selectedSubjectId);
    } else {
      params.delete("subject_id");
    }
    if (commentStatusFilter === "all") {
      params.delete("comment_status");
    } else {
      params.set("comment_status", commentStatusFilter);
    }
    const nextQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery === currentQuery) return;
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [commentStatusFilter, loading, pathname, router, searchParams, selectedSubjectId, selectedTermId]);

  async function regenerateCards() {
    if (!classroomId || !selectedTermId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await bulkGenerateReportCards({
        classroom_id: classroomId,
        exam_term_id: selectedTermId,
        remarks: remarks || undefined,
      });
      setSelectedCard(null);
      setNotice(`Generated ${response.generated_count} report cards.`);
      await fetchHistory(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate report cards");
    } finally {
      setSaving(false);
    }
  }

  async function publishAllCards() {
    if (!classroomId || !selectedTermId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await bulkPublishReportCards({
        classroom_id: classroomId,
        exam_term_id: selectedTermId,
      });
      setNotice(`Published ${response.updated_count} report cards.`);
      await fetchHistory(historyMeta.page);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to bulk publish report cards");
    } finally {
      setSaving(false);
    }
  }

  async function previewCard(reportCardId: string) {
    setSaving(true);
    setError("");
    try {
      const detail = await getReportCard(reportCardId);
      setSelectedCard(detail);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load report card detail");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!selectedCard) {
      setSubjectCommentDrafts({});
      return;
    }
    setSubjectCommentDrafts(
      Object.fromEntries(
        selectedCard.subjects.map((subject) => [
          subject.id,
          {
            comment_category: (
              subject.comment_category || getDefaultCommentCategory(subject.percentage)
            ) as ReportCardCommentCategory,
            teacher_comment: subject.teacher_comment || "",
          },
        ])
      ) as Record<string, { comment_category: ReportCardCommentCategory; teacher_comment: string }>
    );
  }, [selectedCard]);

  async function toggleStatus(reportCardId: string, status: "published" | "draft") {
    setSaving(true);
    setError("");
    try {
      if (status === "published") {
        await publishReportCard(reportCardId);
      } else {
        await unpublishReportCard(reportCardId);
      }
      await fetchHistory(historyMeta.page);
      if (selectedCard?.id === reportCardId) {
        const detail = await getReportCard(reportCardId);
        setSelectedCard(detail);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update report card status");
    } finally {
      setSaving(false);
    }
  }

  async function downloadCard(reportCardId: string) {
    setSaving(true);
    setError("");
    try {
      const blob = await downloadReportCardPdf(reportCardId);
      const fallback = `report-card-${reportCardId}.pdf`;
      const studentCode = selectedCard?.id === reportCardId ? selectedCard.student.student_code : "student";
      downloadBlob(blob, `report-card-${studentCode}.pdf` || fallback);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to download report card PDF");
    } finally {
      setSaving(false);
    }
  }

  function updateSubjectDraft(
    subjectId: string,
    updates: Partial<{
      comment_category: ReportCardCommentCategory;
      teacher_comment: string;
    }>
  ) {
    setSubjectCommentDrafts((current) => ({
      ...current,
      [subjectId]: {
        ...current[subjectId],
        ...updates,
      },
    }));
  }

  function refreshCommentMemory() {
    setCommentMemory(loadReportCardCommentMemory());
  }

  function rememberComment(subjectName: string, category: ReportCardCommentCategory, comment: string) {
    if (!comment.trim()) return;
    recordReportCardCommentUse({
      subjectName,
      category,
      comment,
    });
    refreshCommentMemory();
  }

  function toggleFavoriteComment(
    subjectName: string,
    category: ReportCardCommentCategory,
    comment: string
  ) {
    if (!comment.trim()) return;
    toggleFavoriteReportCardComment({
      subjectName,
      category,
      comment,
    });
    refreshCommentMemory();
  }

  function useSavedBulkComment(comment: string) {
    setBulkCommentConfig((current) => ({
      ...current,
      teacher_comment: comment,
    }));
  }

  function handleCommentCategoryChange(
    subjectId: string,
    subjectName: string,
    category: ReportCardCommentCategory
  ) {
    const presets = getCommentPresetsForSubject(subjectName, category);
    updateSubjectDraft(subjectId, {
      comment_category: category,
      teacher_comment: presets[0] || "",
    });
  }

  function toggleCardSelection(reportCardId: string) {
    setSelectedCardIds((current) =>
      current.includes(reportCardId)
        ? current.filter((id) => id !== reportCardId)
        : [...current, reportCardId]
    );
  }

  function toggleSelectAllCards() {
    setSelectedCardIds((current) => (current.length === cards.length ? [] : cards.map((card) => card.id)));
  }

  function handleBulkSubjectChange(subjectId: string) {
    const nextSubject = classSubjects.find((subject) => subject.subject_id === subjectId);
    if (!nextSubject) return;
    const presets = getCommentPresetsForSubject(nextSubject.subject_name, bulkCommentConfig.comment_category);
    setBulkCommentConfig((current) => ({
      ...current,
      subject_id: nextSubject.subject_id,
      subject_name: nextSubject.subject_name,
      teacher_comment: presets[0] || current.teacher_comment,
    }));
  }

  async function applyBulkSubjectComment() {
    if (!bulkCommentConfig.subject_name || selectedCardIds.length === 0) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const details = await Promise.all(selectedCardIds.map((reportCardId) => getReportCard(reportCardId)));
      let updatedCount = 0;

      for (const detail of details) {
        const matchingSubject = detail.subjects.find(
          (subject) =>
            subject.subject_id === bulkCommentConfig.subject_id ||
            subject.subject_name === bulkCommentConfig.subject_name
        );
        if (!matchingSubject) continue;

        await updateReportCardSubjectComments(detail.id, {
          comments: [
            {
              report_card_subject_id: matchingSubject.id,
              comment_category: bulkCommentConfig.comment_category,
              teacher_comment: bulkCommentConfig.teacher_comment.trim() || null,
            },
          ],
        });
        updatedCount += 1;
      }

      if (selectedCard && selectedCardIds.includes(selectedCard.id)) {
        const refreshed = await getReportCard(selectedCard.id);
        setSelectedCard(refreshed);
      }

      rememberComment(
        bulkCommentConfig.subject_name,
        bulkCommentConfig.comment_category,
        bulkCommentConfig.teacher_comment
      );

      setNotice(`Applied ${bulkCommentConfig.subject_name} comment to ${updatedCount} selected report card(s).`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to apply bulk subject comments");
    } finally {
      setSaving(false);
    }
  }

  async function saveSubjectComments() {
    if (!selectedCard) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const comments = selectedCard.subjects.map((subject) => {
        const draft =
          subjectCommentDrafts[subject.id] || {
            comment_category: getDefaultCommentCategory(subject.percentage),
            teacher_comment: subject.teacher_comment || "",
          };
        return {
          report_card_subject_id: subject.id,
          comment_category: draft.comment_category,
          teacher_comment: draft.teacher_comment.trim() || null,
        };
      });
      await updateReportCardSubjectComments(selectedCard.id, { comments });
      let storedComments = false;
      selectedCard.subjects.forEach((subject) => {
        const draft =
          subjectCommentDrafts[subject.id] || {
            comment_category: getDefaultCommentCategory(subject.percentage),
            teacher_comment: subject.teacher_comment || "",
          };
        if (!draft.teacher_comment?.trim()) return;
        recordReportCardCommentUse({
          subjectName: subject.subject_name,
          category: draft.comment_category,
          comment: draft.teacher_comment,
        });
        storedComments = true;
      });
      if (storedComments) refreshCommentMemory();
      const detail = await getReportCard(selectedCard.id);
      setSelectedCard(detail);
      setNotice("Subject comments saved. Families will now see these recommendations on the report card.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save subject comments");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Header title="Report Cards" />
      <div className="space-y-6 p-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
        )}

        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-700 via-purple-600 to-fuchsia-600 p-6 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.25em] text-indigo-100">Report Cards</p>
          <h2 className="mt-3 text-2xl font-bold">Generate + Publish Term Reports</h2>
          <p className="mt-2 text-sm text-indigo-100">
            Generate report cards from consolidated subject marks, publish to families, and export signed PDFs.
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
            <div>
              <label className="label-text">Term</label>
              <select
                className="input-field"
                value={selectedTermId}
                onChange={(event) => setSelectedTermId(event.target.value)}
                disabled={loading}
              >
                {terms.length === 0 ? <option value="">No exam terms</option> : null}
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name} ({term.term_type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">Focus Subject</label>
              <select
                aria-label="Focus Subject"
                className="input-field"
                value={selectedSubjectId}
                onChange={(event) => {
                  const nextSubjectId = event.target.value;
                  setSelectedSubjectId(nextSubjectId);
                  if (nextSubjectId) {
                    handleBulkSubjectChange(nextSubjectId);
                  }
                }}
                disabled={loading}
              >
                <option value="">All Subjects</option>
                {classSubjects.map((subject) => (
                  <option key={`focus-${subject.subject_id}`} value={subject.subject_id}>
                    {subject.subject_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">Comment Status</label>
              <select
                aria-label="Comment Status"
                className="input-field"
                value={commentStatusFilter}
                onChange={(event) =>
                  setCommentStatusFilter(event.target.value as "all" | "missing" | "completed")
                }
                disabled={loading || historyLoading}
              >
                <option value="all">All Comments</option>
                <option value="missing">Missing Comments</option>
                <option value="completed">Completed Comments</option>
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="label-text">Remarks (optional)</label>
              <input
                className="input-field"
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Term remarks to print on report cards"
              />
            </div>
            <div>
              <label className="label-text">Status Filter</label>
              <select
                className="input-field"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | "draft" | "published")}
                disabled={loading || historyLoading}
              >
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={regenerateCards}
                disabled={saving || !classroomId || !selectedTermId}
              >
                {saving ? "Working..." : "Generate All"}
              </button>
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={publishAllCards}
                disabled={saving || cards.length === 0}
              >
                Bulk Publish
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Selected Term: {selectedTerm ? `${selectedTerm.name} (${selectedTerm.term_type})` : "None"}
          </p>
          {selectedSubject ? (
            <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              Focused subject: {selectedSubject.subject_name}
              {commentStatusFilter !== "all" ? `• ${commentStatusFilter === "missing" ? "Missing comments" : "Completed comments"}` : null}
              <button
                type="button"
                className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                onClick={() => {
                  setSelectedSubjectId("");
                  setCommentStatusFilter("all");
                }}
              >
                Clear
              </button>
            </div>
          ) : null}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <article className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <p className="text-xs uppercase tracking-wide text-indigo-600">Cards</p>
            <p className="mt-1 text-2xl font-bold text-indigo-900">{historyKpis.total_cards}</p>
          </article>
          <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs uppercase tracking-wide text-emerald-600">Published</p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{historyKpis.published_cards}</p>
          </article>
          <article className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs uppercase tracking-wide text-amber-600">Draft</p>
            <p className="mt-1 text-2xl font-bold text-amber-900">{historyKpis.draft_cards}</p>
          </article>
          <article className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs uppercase tracking-wide text-blue-600">Avg Percentage</p>
            <p className="mt-1 text-2xl font-bold text-blue-900">{historyKpis.average_percentage.toFixed(1)}%</p>
          </article>
          <article className="rounded-xl border border-purple-200 bg-purple-50 p-4">
            <p className="text-xs uppercase tracking-wide text-purple-600">Avg Attendance</p>
            <p className="mt-1 text-2xl font-bold text-purple-900">{historyKpis.average_attendance_rate.toFixed(1)}%</p>
          </article>
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Publish Readiness</h3>
            <p className="mt-1 text-sm text-gray-600">
              {historyKpis.published_cards}/{historyKpis.total_cards} cards published ({publishProgress}%)
            </p>
            <div className="mt-3 h-3 w-full rounded-full bg-gray-100">
              <div
                className="h-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all"
                style={{ width: `${publishProgress}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                Published: {historyKpis.published_cards}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                Draft Pending: {historyKpis.draft_cards}
              </div>
            </div>
          </article>

          <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Grade Distribution</h3>
            {historyKpis.grade_distribution.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No grades available for this term yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {historyKpis.grade_distribution.map((row) => {
                  const count = Number(row.count || 0);
                  const barWidth = maxGradeCount > 0 ? Math.max(8, Math.round((count / maxGradeCount) * 100)) : 0;
                  return (
                    <div key={row.grade}>
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                        <span className="font-semibold text-gray-800">{row.grade}</span>
                        <span>
                          {count} ({Number(row.percentage || 0).toFixed(1)}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </section>

        <section className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/70 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-700">
                Bulk Subject Comment Apply
              </p>
              <h3 className="mt-2 text-lg font-semibold text-gray-900">
                Copy one preset comment to selected students
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                Select students from the table below, choose a subject and category, then apply the same recommendation in one step.
              </p>
            </div>
            <div className="rounded-lg border border-fuchsia-200 bg-white px-3 py-2 text-sm text-fuchsia-900">
              Selected report cards: <span className="font-semibold">{selectedCardIds.length}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div>
              <label className="label-text">Subject</label>
              <select
                className="input-field"
                value={bulkCommentConfig.subject_id}
                onChange={(event) => handleBulkSubjectChange(event.target.value)}
                disabled={saving}
              >
                {classSubjects.length === 0 ? <option value="">No subjects available</option> : null}
                {classSubjects.map((subject) => (
                  <option key={subject.subject_id} value={subject.subject_id}>
                    {subject.subject_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">Category</label>
              <select
                className="input-field"
                value={bulkCommentConfig.comment_category}
                onChange={(event) => {
                  const nextCategory = event.target.value as ReportCardCommentCategory;
                  const presets = getCommentPresetsForSubject(
                    bulkCommentConfig.subject_name,
                    nextCategory
                  );
                  setBulkCommentConfig((current) => ({
                    ...current,
                    comment_category: nextCategory,
                    teacher_comment: presets[0] || current.teacher_comment,
                  }));
                }}
                disabled={saving}
              >
                {REPORT_CARD_COMMENT_CATEGORY_OPTIONS.map((option) => (
                  <option key={`bulk-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="label-text">Preset Comment</label>
              <select
                className="input-field"
                value={
                  (() => {
                    const matchedIndex = bulkPresets.findIndex(
                      (preset) => preset === bulkCommentConfig.teacher_comment
                    );
                    return matchedIndex >= 0 ? String(matchedIndex) : "custom";
                  })()
                }
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === "custom") return;
                  const preset = bulkPresets[Number(nextValue)];
                  setBulkCommentConfig((current) => ({
                    ...current,
                    teacher_comment: preset || current.teacher_comment,
                  }));
                }}
                disabled={saving}
              >
                {bulkPresets.map((preset, index) => (
                  <option key={`bulk-preset-${index}`} value={String(index)}>
                    {index + 1}. {preset}
                  </option>
                ))}
                <option value="custom">Custom comment</option>
              </select>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CommentMemoryStrip
              title="Favorites"
              items={bulkFavoriteComments}
              onUse={useSavedBulkComment}
            />
            <CommentMemoryStrip
              title="Recently Used"
              items={bulkRecentComments}
              onUse={useSavedBulkComment}
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="label-text mb-0">Final Comment</label>
                <button
                  type="button"
                  className="rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  onClick={() =>
                    toggleFavoriteComment(
                      bulkCommentConfig.subject_name,
                      bulkCommentConfig.comment_category,
                      bulkCommentConfig.teacher_comment
                    )
                  }
                  disabled={saving || !bulkCommentConfig.teacher_comment.trim()}
                >
                  {isFavoriteReportCardComment(commentMemory, {
                    subjectName: bulkCommentConfig.subject_name,
                    category: bulkCommentConfig.comment_category,
                    comment: bulkCommentConfig.teacher_comment,
                  })
                    ? "Remove Favorite"
                    : "Save Favorite"}
                </button>
              </div>
              <textarea
                className="input-field min-h-[88px]"
                value={bulkCommentConfig.teacher_comment}
                onChange={(event) =>
                  setBulkCommentConfig((current) => ({
                    ...current,
                    teacher_comment: event.target.value,
                  }))
                }
                placeholder="Choose a preset comment or write your own"
                disabled={saving}
              />
            </div>
            <button
              type="button"
              className="btn-primary h-fit self-end"
              onClick={applyBulkSubjectComment}
              disabled={saving || selectedCardIds.length === 0 || !bulkCommentConfig.subject_name}
            >
              {saving ? "Applying..." : "Apply to Selected"}
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <article className="rounded-xl border border-gray-200 bg-white shadow-sm xl:col-span-2">
            <div className="border-b border-gray-200 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-gray-900">Term Report Card History</h3>
                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  onClick={() => fetchHistory(historyMeta.page)}
                  disabled={historyLoading || saving || !classroomId || !selectedTermId}
                >
                  Refresh
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all report cards"
                        checked={allCardsSelected}
                        onChange={toggleSelectAllCards}
                        disabled={historyLoading || cards.length === 0}
                      />
                    </th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Percentage</th>
                    <th className="px-4 py-3">Grade</th>
                    <th className="px-4 py-3">Attendance</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                        Loading report card history...
                      </td>
                    </tr>
                  ) : null}
                  {!historyLoading && cards.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                        {selectedSubject && commentStatusFilter === "missing"
                          ? `No students are currently missing ${selectedSubject.subject_name} comments for this term.`
                          : "No cards found for this term and filter. Click Generate All to build report cards."}
                      </td>
                    </tr>
                  ) : (
                    cards.map((card) => (
                      <tr key={card.id} className="border-b border-gray-100">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${card.student_name}`}
                            checked={selectedCardIds.includes(card.id)}
                            onChange={() => toggleCardSelection(card.id)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{card.student_name}</p>
                          <p className="text-xs text-gray-500">
                            {card.student_code}
                            {card.roll_no ? ` • Roll ${card.roll_no}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-3">{card.percentage !== null && card.percentage !== undefined ? `${card.percentage}%` : "-"}</td>
                        <td className="px-4 py-3">{card.grade || "-"}</td>
                        <td className="px-4 py-3">{card.attendance_rate !== null && card.attendance_rate !== undefined ? `${card.attendance_rate}%` : "-"}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                              card.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {card.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                              onClick={() => previewCard(card.id)}
                              disabled={saving}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                              onClick={() => downloadCard(card.id)}
                              disabled={saving}
                            >
                              PDF
                            </button>
                            {card.status === "published" ? (
                              <button
                                type="button"
                                className="rounded-md border border-amber-200 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                                onClick={() => toggleStatus(card.id, "draft")}
                                disabled={saving}
                              >
                                Unpublish
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="rounded-md border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                                onClick={() => toggleStatus(card.id, "published")}
                                disabled={saving}
                              >
                                Publish
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
              <p>
                Page {historyMeta.page} of {historyMeta.total_pages} • {historyMeta.total_items} records
              </p>
              <div className="inline-flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-1 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  onClick={() => fetchHistory(Math.max(1, historyMeta.page - 1))}
                  disabled={historyMeta.page <= 1 || historyLoading || saving}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-1 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  onClick={() => fetchHistory(Math.min(historyMeta.total_pages, historyMeta.page + 1))}
                  disabled={historyMeta.page >= historyMeta.total_pages || historyLoading || saving}
                >
                  Next
                </button>
              </div>
            </div>
          </article>

          <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Report Card Preview</h3>
            {!selectedCard ? (
              <p className="mt-3 text-sm text-gray-500">Select a generated card to preview details and subject-wise marks.</p>
            ) : (
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Student</p>
                  <p className="font-semibold text-gray-900">{selectedCard.student.full_name}</p>
                  <p className="text-xs text-gray-500">{selectedCard.student.student_code}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-xs text-gray-500">Percentage</p>
                    <p className="font-semibold text-gray-900">{selectedCard.summary.percentage ?? "-"}%</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-xs text-gray-500">Grade</p>
                    <p className="font-semibold text-gray-900">{selectedCard.summary.grade || "-"}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200">
                  <div className="border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Subject Breakdown
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {filteredPreviewSubjects.map((subject) => (
                      <div key={subject.id} className="flex items-center justify-between border-b border-gray-100 px-3 py-2 last:border-b-0">
                        <div>
                          <p className="font-medium text-gray-900">{subject.subject_name}</p>
                          <p className="text-xs text-gray-500">{subject.grade || "-"}</p>
                        </div>
                        <p className="font-semibold text-gray-800">
                          {subject.marks_obtained}/{subject.max_marks}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
                        Subject Teacher Comments
                      </p>
                      <p className="mt-1 text-xs text-indigo-900/80">
                        Pick a category, choose a preset comment, and save. These recommendations appear on family report cards and PDFs.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-indigo-300 bg-white px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                      onClick={saveSubjectComments}
                      disabled={saving}
                    >
                      {saving ? "Saving..." : "Save Comments"}
                    </button>
                  </div>
                  <div className="mt-4 space-y-4">
                    {filteredPreviewSubjects.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-indigo-200 bg-white px-4 py-6 text-sm text-gray-500">
                        No subjects match the current subject focus for this report card.
                      </div>
                    ) : (
                    filteredPreviewSubjects.map((subject) => {
                      const draft =
                        subjectCommentDrafts[subject.id] || {
                          comment_category: getDefaultCommentCategory(subject.percentage),
                          teacher_comment: subject.teacher_comment || "",
                        };
                      const presets = getCommentPresetsForSubject(subject.subject_name, draft.comment_category);
                      const presetValue = (() => {
                        const matchedIndex = presets.findIndex((entry) => entry === draft.teacher_comment);
                        return matchedIndex >= 0 ? String(matchedIndex) : "custom";
                      })();
                      const family = resolveReportCardCommentFamily(subject.subject_name);
                      const favoriteComments = getFavoriteReportCardComments(commentMemory, {
                        subjectName: subject.subject_name,
                        category: draft.comment_category,
                      });
                      const recentComments = getRecentReportCardComments(commentMemory, {
                        subjectName: subject.subject_name,
                        category: draft.comment_category,
                      }).filter(
                        (entry) => !favoriteComments.some((favorite) => favorite.key === entry.key)
                      );
                      const isFavorite = isFavoriteReportCardComment(commentMemory, {
                        subjectName: subject.subject_name,
                        category: draft.comment_category,
                        comment: draft.teacher_comment,
                      });

                      return (
                        <div key={`${subject.id}-comment`} className="rounded-xl border border-white/70 bg-white p-4 shadow-sm">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold text-gray-900">{subject.subject_name}</p>
                              <p className="text-xs text-gray-500">
                                Suggested band: {getCommentCategoryLabel(getDefaultCommentCategory(subject.percentage))}
                              </p>
                            </div>
                            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600">
                              {family}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            <div>
                              <label className="label-text">Comment Category</label>
                              <select
                                className="input-field"
                                value={draft.comment_category}
                                onChange={(event) =>
                                  handleCommentCategoryChange(
                                    subject.id,
                                    subject.subject_name,
                                    event.target.value as ReportCardCommentCategory
                                  )
                                }
                                disabled={saving}
                              >
                                {REPORT_CARD_COMMENT_CATEGORY_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="label-text">Preset Comment</label>
                              <select
                                className="input-field"
                                value={presetValue}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  if (nextValue === "custom") return;
                                  const preset = presets[Number(nextValue)];
                                  updateSubjectDraft(subject.id, {
                                    teacher_comment: preset || draft.teacher_comment,
                                  });
                                }}
                                disabled={saving}
                              >
                                {presets.map((preset, index) => (
                                  <option key={`${subject.id}-${draft.comment_category}-${index}`} value={String(index)}>
                                    {index + 1}. {preset}
                                  </option>
                                ))}
                                <option value="custom">Custom comment</option>
                              </select>
                            </div>
                            <CommentMemoryStrip
                              title="Favorites"
                              items={favoriteComments}
                              onUse={(comment) =>
                                updateSubjectDraft(subject.id, {
                                  teacher_comment: comment,
                                })
                              }
                            />
                            <CommentMemoryStrip
                              title="Recently Used"
                              items={recentComments}
                              onUse={(comment) =>
                                updateSubjectDraft(subject.id, {
                                  teacher_comment: comment,
                                })
                              }
                            />
                            <div>
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <label className="label-text mb-0">Final Comment</label>
                                <button
                                  type="button"
                                  className="rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                  onClick={() =>
                                    toggleFavoriteComment(
                                      subject.subject_name,
                                      draft.comment_category,
                                      draft.teacher_comment
                                    )
                                  }
                                  disabled={saving || !draft.teacher_comment.trim()}
                                >
                                  {isFavorite ? "Remove Favorite" : "Save Favorite"}
                                </button>
                              </div>
                              <textarea
                                className="input-field min-h-[96px]"
                                value={draft.teacher_comment}
                                onChange={(event) =>
                                  updateSubjectDraft(subject.id, {
                                    teacher_comment: event.target.value,
                                  })
                                }
                                placeholder="Select a preset or edit the recommendation here"
                                disabled={saving}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    }))}
                  </div>
                </div>
              </div>
            )}
          </article>
        </section>
      </div>
    </>
  );
}
