import { useMemo, useState } from 'react';
import { BenchmarkQuestion } from '@/types/benchmark';

export interface QuestionFilters {
  types: Set<string>;
  difficulty: Set<string>;
  pyq: Set<string>;
  search: string;
}

export interface QuestionSelectorProps {
  questions: BenchmarkQuestion[];
  selectedQuestionIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  filters: QuestionFilters;
  onFiltersChange: (filters: QuestionFilters) => void;
  showStats?: boolean;
}

const filterQuestions = (questions: BenchmarkQuestion[], filters: QuestionFilters) => {
  const searchTerm = filters.search.trim().toLowerCase();

  return questions.filter((question) => {
    if (filters.types.size > 0 && !filters.types.has(question.type)) {
      return false;
    }

    if (filters.difficulty.size > 0 && !filters.difficulty.has(question.difficulty)) {
      return false;
    }

    if (filters.pyq.size > 0) {
      const year = question.metadata.pyq?.year ? String(question.metadata.pyq.year) : undefined;
      if (!year || !filters.pyq.has(year)) {
        return false;
      }
    }

    if (!searchTerm) {
      return true;
    }

    const haystack = `${question.prompt} ${question.instructions ?? ''}`.toLowerCase();
    return haystack.includes(searchTerm);
  });
};

const QuestionSelector = ({
  questions,
  selectedQuestionIds,
  onSelectionChange,
  filters,
  onFiltersChange,
  showStats = true,
}: QuestionSelectorProps) => {
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const filteredQuestions = useMemo(
    () => filterQuestions(questions, filters),
    [questions, filters]
  );

  const selectionHasImages = useMemo(() => {
    if (selectedQuestionIds.size === 0) {
      return false;
    }
    for (const id of selectedQuestionIds) {
      const question = questions.find((q) => q.id === id);
      if (question?.metadata.hasImages) {
        return true;
      }
    }
    return false;
  }, [selectedQuestionIds, questions]);

  const filteredHasImages = useMemo(
    () => filteredQuestions.some((question) => question.metadata.hasImages),
    [filteredQuestions]
  );

  const uniqueTypes = useMemo(() => {
    const types = new Set<string>();
    questions.forEach((question) => {
      types.add(question.type);
    });
    return Array.from(types).sort();
  }, [questions]);

  const uniqueDifficulty = useMemo(() => {
    const difficulties = new Set<string>();
    questions.forEach((question) => {
      difficulties.add(question.difficulty);
    });
    return Array.from(difficulties).sort();
  }, [questions]);

  const uniqueYears = useMemo(() => {
    const years = new Set<string>();
    questions.forEach((question) => {
      const year = question.metadata.pyq?.year;
      if (year) {
        years.add(String(year));
      }
    });
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [questions]);

  const handleFilterToggle = (filterType: 'types' | 'difficulty' | 'pyq', value: string) => () => {
    onFiltersChange({
      ...filters,
      [filterType]: (() => {
        const next = new Set(filters[filterType]);
        if (next.has(value)) {
          next.delete(value);
        } else {
          next.add(value);
        }
        return next;
      })(),
    });
  };

  const handleToggleQuestion = (questionId: string) => () => {
    const next = new Set(selectedQuestionIds);
    if (next.has(questionId)) {
      next.delete(questionId);
    } else {
      next.add(questionId);
    }
    onSelectionChange(next);
  };

  const handleSelectAll = () => {
    onSelectionChange(new Set(filteredQuestions.map((question) => question.id)));
  };

  const handleClearSelection = () => {
    onSelectionChange(new Set());
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Filters Section */}
      <div className="flex flex-col gap-4 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
        <button
          type="button"
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          className="flex items-center justify-between w-full px-4 py-3 font-semibold text-slate-900 dark:text-slate-50 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 rounded-xl transition-colors text-left"
        >
          <span>Filters</span>
          <svg
            className={`w-5 h-5 text-slate-500 dark:text-slate-400 transition-transform ${filtersExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {filtersExpanded && (
          <div className="flex flex-col gap-4 px-4 pb-4">
            {/* Type Filter */}
            <div>
              <strong className="text-sm font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                Type
              </strong>
              <div className="flex flex-wrap gap-2">
                {uniqueTypes.map((type) => (
                  <label
                    key={type}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 cursor-pointer hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.types.has(type)}
                      onChange={handleFilterToggle('types', type)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Difficulty Filter */}
            <div>
              <strong className="text-sm font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                Difficulty
              </strong>
              <div className="flex flex-wrap gap-2">
                {uniqueDifficulty.map((difficulty) => (
                  <label
                    key={difficulty}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 cursor-pointer hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.difficulty.has(difficulty)}
                      onChange={handleFilterToggle('difficulty', difficulty)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{difficulty}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* PYQ Year Filter */}
            <div>
              <strong className="text-sm font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                PYQ year
              </strong>
              <div className="flex flex-wrap gap-2">
                {uniqueYears.map((year) => (
                  <label
                    key={year}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 cursor-pointer hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.pyq.has(year)}
                      onChange={handleFilterToggle('pyq', year)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{year}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Search
              </span>
              <input
                type="search"
                value={filters.search}
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    search: event.target.value,
                  })
                }
                placeholder="Search question text"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
          </div>
        )}
      </div>

      {/* Question List Section */}
      <div className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">
            Select questions
          </h3>
          <div className="flex gap-2">
            <button
              type="button"
              className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
              onClick={handleSelectAll}
            >
              Select all
            </button>
            <button
              type="button"
              className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
              onClick={handleClearSelection}
            >
              Clear
            </button>
          </div>
        </header>

        {showStats && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Showing {filteredQuestions.length} questions. Selected {selectedQuestionIds.size}.
            {selectionHasImages ? (
              <span className="ml-1 text-warning-700 dark:text-warning-400 font-semibold">
                Includes image-based questions.
              </span>
            ) : filteredHasImages ? (
              <span className="ml-1 text-slate-500 dark:text-slate-400">
                (Images available in this filtered set.)
              </span>
            ) : null}
          </p>
        )}

        <ul className="max-h-96 overflow-y-auto flex flex-col gap-2 border border-slate-300 dark:border-slate-600 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-900/30">
          {filteredQuestions.map((question) => {
            const isSelected = selectedQuestionIds.has(question.id);
            return (
              <li
                key={question.id}
                className={`border rounded-lg p-3 transition-all ${
                  isSelected
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                    : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-accent-300 dark:hover:border-accent-700'
                }`}
              >
                <label className="flex gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={handleToggleQuestion(question.id)}
                    className="w-4 h-4 mt-1 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 dark:text-slate-50">
                        {question.questionId || question.id}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                        {question.type}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                        {question.difficulty}
                      </span>
                      {question.metadata.hasImages && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                          Has images
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                      {question.prompt}
                    </p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default QuestionSelector;
