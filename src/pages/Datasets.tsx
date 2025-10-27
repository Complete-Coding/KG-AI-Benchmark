import { useState, useMemo } from 'react';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import Modal from '@/components/Modal';
import QuestionSelector, { QuestionFilters } from '@/components/QuestionSelector';
import { BenchmarkDataset } from '@/types/benchmark';

const formatDateTime = (iso?: string) => {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

interface DatasetFormData {
  id?: string;
  name: string;
  description: string;
  selectedQuestionIds: Set<string>;
  filters: QuestionFilters;
}

const Datasets = () => {
  const { datasets, questions, runs, upsertDataset, deleteDataset } = useBenchmarkContext();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingDataset, setEditingDataset] = useState<BenchmarkDataset | null>(null);
  const [deletingDataset, setDeletingDataset] = useState<BenchmarkDataset | null>(null);

  const [formData, setFormData] = useState<DatasetFormData>({
    name: '',
    description: '',
    selectedQuestionIds: new Set(),
    filters: {
      types: new Set(),
      difficulty: new Set(),
      pyq: new Set(),
      search: '',
    },
  });

  // Count how many runs use each dataset
  const datasetUsageCount = useMemo(() => {
    const counts = new Map<string, number>();
    runs.forEach((run) => {
      if (run.datasetId) {
        counts.set(run.datasetId, (counts.get(run.datasetId) || 0) + 1);
      }
    });
    return counts;
  }, [runs]);

  const handleOpenCreate = () => {
    setFormData({
      name: '',
      description: '',
      selectedQuestionIds: new Set(questions.map((q) => q.id)),
      filters: {
        types: new Set(),
        difficulty: new Set(),
        pyq: new Set(),
        search: '',
      },
    });
    setEditingDataset(null);
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (dataset: BenchmarkDataset) => {
    setFormData({
      id: dataset.id,
      name: dataset.name,
      description: dataset.description || '',
      selectedQuestionIds: new Set(dataset.questionIds),
      filters: {
        types: new Set(dataset.filters.types),
        difficulty: new Set(dataset.filters.difficulty),
        pyq: new Set(dataset.filters.pyqYears),
        search: dataset.filters.search || '',
      },
    });
    setEditingDataset(dataset);
    setIsCreateModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsCreateModalOpen(false);
    setEditingDataset(null);
  };

  const handleSave = () => {
    if (!formData.name.trim() || formData.selectedQuestionIds.size === 0) {
      alert('Please provide a dataset name and select at least one question.');
      return;
    }

    // Calculate metadata
    const selectedQuestions = questions.filter((q) =>
      formData.selectedQuestionIds.has(q.id)
    );

    const questionTypeBreakdown: Record<string, number> = {};
    let hasImages = false;

    selectedQuestions.forEach((q) => {
      questionTypeBreakdown[q.type] = (questionTypeBreakdown[q.type] || 0) + 1;
      if (q.metadata.hasImages) {
        hasImages = true;
      }
    });

    const datasetData: Partial<BenchmarkDataset> = {
      id: formData.id,
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      questionIds: Array.from(formData.selectedQuestionIds),
      filters: {
        types: Array.from(formData.filters.types),
        difficulty: Array.from(formData.filters.difficulty),
        pyqYears: Array.from(formData.filters.pyq),
        search: formData.filters.search || undefined,
      },
      metadata: {
        totalQuestions: formData.selectedQuestionIds.size,
        hasImages,
        questionTypeBreakdown,
      },
    };

    upsertDataset(datasetData);
    handleCloseModal();
  };

  const handleDelete = (dataset: BenchmarkDataset) => {
    setDeletingDataset(dataset);
  };

  const confirmDelete = () => {
    if (deletingDataset) {
      deleteDataset(deletingDataset.id);
      setDeletingDataset(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Datasets
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem] mt-2">
            Create and manage reusable question datasets for benchmarking.
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="px-4 py-2 bg-accent-600 hover:bg-accent-700 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
        >
          <span>+ New Dataset</span>
        </button>
      </header>

      {/* Empty State */}
      {datasets.length === 0 && (
        <section className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm p-8 flex flex-col items-center gap-4">
          <div className="text-slate-400 dark:text-slate-500 text-6xl">📊</div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            No datasets yet
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-center max-w-md">
            Create your first dataset to organize questions and use them across benchmark runs.
          </p>
          <button
            onClick={handleOpenCreate}
            className="mt-4 px-6 py-3 bg-accent-600 hover:bg-accent-700 text-white font-semibold rounded-lg transition-colors"
          >
            Create Dataset
          </button>
        </section>
      )}

      {/* Dataset Grid */}
      {datasets.length > 0 && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {datasets.map((dataset) => {
            const usageCount = datasetUsageCount.get(dataset.id) || 0;
            const typeEntries = Object.entries(dataset.metadata.questionTypeBreakdown);

            return (
              <article
                key={dataset.id}
                className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-5 border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col gap-4"
              >
                {/* Dataset Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 truncate">
                      {dataset.name}
                    </h3>
                    {dataset.description && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                        {dataset.description}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleOpenEdit(dataset)}
                      className="px-3 py-1.5 text-sm font-medium text-accent-700 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-accent-900/20 rounded-lg transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(dataset)}
                      className="px-3 py-1.5 text-sm font-medium text-danger-700 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20 rounded-lg transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Dataset Stats */}
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                    {dataset.metadata.totalQuestions} question
                    {dataset.metadata.totalQuestions === 1 ? '' : 's'}
                  </span>
                  {dataset.metadata.hasImages && (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                      Has images
                    </span>
                  )}
                </div>

                {/* Question Type Breakdown */}
                {typeEntries.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                      Question Types
                    </span>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {typeEntries.map(([type, count]) => (
                        <span
                          key={type}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-accent-50 text-accent-700 dark:bg-accent-900/20 dark:text-accent-400"
                        >
                          <span>{type}</span>
                          <span className="font-semibold">({count})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Applied Filters */}
                {(dataset.filters.types.length > 0 ||
                  dataset.filters.difficulty.length > 0 ||
                  dataset.filters.pyqYears.length > 0 ||
                  dataset.filters.search) && (
                  <div>
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                      Filters Applied
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {dataset.filters.types.length > 0 && (
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          Types: {dataset.filters.types.join(', ')}
                        </span>
                      )}
                      {dataset.filters.difficulty.length > 0 && (
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          • Difficulty: {dataset.filters.difficulty.join(', ')}
                        </span>
                      )}
                      {dataset.filters.pyqYears.length > 0 && (
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          • PYQ: {dataset.filters.pyqYears.join(', ')}
                        </span>
                      )}
                      {dataset.filters.search && (
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          • Search: "{dataset.filters.search}"
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Created: {formatDateTime(dataset.createdAt)}</span>
                  {usageCount > 0 && (
                    <span className="font-medium">
                      Used in {usageCount} run{usageCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* Create/Edit Dataset Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={handleCloseModal}
        title={editingDataset ? 'Edit Dataset' : 'Create Dataset'}
        size="xl"
      >
        <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto px-1">
          {/* Name Input */}
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Name <span className="text-danger-600">*</span>
            </span>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Full MCQ Set, Hard Questions Only"
              className="px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
            />
          </label>

          {/* Description Input */}
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Description <span className="text-slate-500">(optional)</span>
            </span>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe this dataset..."
              rows={2}
              className="px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 resize-none"
            />
          </label>

          {/* Question Selector */}
          <QuestionSelector
            questions={questions}
            selectedQuestionIds={formData.selectedQuestionIds}
            onSelectionChange={(ids) =>
              setFormData({ ...formData, selectedQuestionIds: ids })
            }
            filters={formData.filters}
            onFiltersChange={(filters) => setFormData({ ...formData, filters })}
            showStats
          />

          {/* Summary */}
          <div className="bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 dark:text-slate-50 mb-2">Summary</h4>
            <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
              <li>• {formData.selectedQuestionIds.size} questions selected</li>
              {formData.selectedQuestionIds.size > 0 && (
                <>
                  <li>
                    • Types:{' '}
                    {Array.from(
                      new Set(
                        questions
                          .filter((q) => formData.selectedQuestionIds.has(q.id))
                          .map((q) => q.type)
                      )
                    ).join(', ')}
                  </li>
                  <li>
                    •{' '}
                    {questions.filter(
                      (q) =>
                        formData.selectedQuestionIds.has(q.id) && q.metadata.hasImages
                    ).length > 0
                      ? 'Includes image-based questions'
                      : 'No image-based questions'}
                  </li>
                </>
              )}
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={handleCloseModal}
              className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!formData.name.trim() || formData.selectedQuestionIds.size === 0}
              className="px-4 py-2 bg-accent-600 hover:bg-accent-700 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            >
              {editingDataset ? 'Save Changes' : 'Create Dataset'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deletingDataset}
        onClose={() => setDeletingDataset(null)}
        title="Delete Dataset"
      >
        <div className="flex flex-col gap-4">
          <p className="text-slate-700 dark:text-slate-300">
            Are you sure you want to delete <strong>{deletingDataset?.name}</strong>?
          </p>
          {deletingDataset && datasetUsageCount.get(deletingDataset.id)! > 0 && (
            <div className="bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-lg p-3">
              <p className="text-sm text-warning-800 dark:text-warning-300">
                This dataset is used by {datasetUsageCount.get(deletingDataset.id)} run(s).
                Deleting will not affect existing runs.
              </p>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setDeletingDataset(null)}
              className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              className="px-4 py-2 bg-danger-600 hover:bg-danger-700 text-white font-semibold rounded-lg transition-colors"
            >
              Delete Dataset
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Datasets;
