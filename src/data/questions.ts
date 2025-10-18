import rawDataset from '../../pyq-gate-sample.json';
import {
  BenchmarkQuestion,
  BenchmarkQuestionAnswer,
  BenchmarkQuestionOption,
  QuestionDatasetSummary,
  QuestionType,
} from '@/types/benchmark';
import { richTextToPlain } from '@/utils/richText';

interface RawNode {
  type: string;
  text?: string;
  content?: RawNode[];
}

interface RawOption {
  id: number;
  order: number;
  text: RawNode;
  feedback?: RawNode;
}

interface RawAnswer {
  correctOption?: number | null;
  correctOptions?: number[];
  acceptedAnswers?: string[];
  range?: {
    min?: number;
    max?: number;
    precision?: number;
  };
  caseSensitive?: boolean;
  correct?: boolean;
}

interface RawQuestion {
  id: string;
  questionId: number;
  displayId: string | null;
  type: QuestionType;
  difficulty: string;
  topology?: {
    subject?: {
      name?: string | null;
      canonicalName?: string | null;
    };
    topic?: {
      name?: string | null;
      canonicalName?: string | null;
    };
    subtopic?: {
      name?: string | null;
      canonicalName?: string | null;
    };
  };
  pyq?: {
    type?: string | null;
    year?: number | null;
    exam?: {
      name?: string | null;
      canonicalName?: string | null;
    };
    branch?: {
      name?: string | null;
      canonicalName?: string | null;
    };
    paper?: {
      name?: string | null;
      canonicalName?: string | null;
    };
  };
  content: {
    questionText: RawNode;
    instructions?: RawNode;
    options?: RawOption[];
  };
  answer: RawAnswer;
  solution?: RawNode;
  metadata: {
    status: string;
    hasImages: boolean;
    createdAt: string;
    updatedAt: string;
    tags: string[];
  };
}

interface RawDataset {
  generatedAt: string;
  total: number;
  requested: number;
  filters: {
    questionTypes?: QuestionType[];
    excludeImages?: boolean;
    status?: string[];
  };
  stats: {
    poolSize: number;
    poolWithoutImages: number;
    countsByType: Record<string, number>;
  };
  questions: RawQuestion[];
}

const dataset = rawDataset as RawDataset;

const buildOptions = (question: RawQuestion): BenchmarkQuestionOption[] => {
  if (question.type === 'TRUE_FALSE') {
    return [
      { id: 0, order: 0, text: 'True' },
      { id: 1, order: 1, text: 'False' },
    ];
  }

  if (!Array.isArray(question.content?.options)) {
    return [];
  }

  return question.content.options.map<BenchmarkQuestionOption>((option) => ({
    id: option.id,
    order: option.order,
    text: richTextToPlain(option.text),
  }));
};

const mapAnswer = (question: RawQuestion): BenchmarkQuestionAnswer => {
  const { answer } = question;

  if (question.type === 'MCQ') {
    return {
      kind: 'single',
      correctOption: answer.correctOption ?? 0,
    };
  }

  if (question.type === 'MSQ') {
    return {
      kind: 'multiple',
      correctOptions: answer.correctOptions ?? [],
    };
  }

  if (question.type === 'NAT') {
    return {
      kind: 'numeric',
      range: answer.range ?? {},
      acceptedAnswers: answer.acceptedAnswers ?? [],
      caseSensitive: Boolean(answer.caseSensitive),
    };
  }

  if (question.type === 'TRUE_FALSE') {
    return {
      kind: 'boolean',
      value: Boolean(answer.correct),
    };
  }

  return {
    kind: 'descriptive',
    acceptedAnswers: answer.acceptedAnswers ?? [],
    caseSensitive: Boolean(answer.caseSensitive),
  };
};

const mapQuestion = (question: RawQuestion): BenchmarkQuestion => {
  const prompt = richTextToPlain(question.content?.questionText);
  const instructions = richTextToPlain(question.content?.instructions);
  const solution = richTextToPlain(question.solution);

  return {
    id: question.id,
    questionId: question.questionId,
    displayId: question.displayId,
    type: question.type,
    difficulty: question.difficulty ?? 'UNKNOWN',
    prompt,
    instructions: instructions || undefined,
    options: buildOptions(question),
    answer: mapAnswer(question),
    solution: solution || undefined,
    metadata: {
      status: question.metadata.status,
      hasImages: question.metadata.hasImages,
      createdAt: question.metadata.createdAt,
      updatedAt: question.metadata.updatedAt,
      tags: question.metadata.tags ?? [],
      topology: {
        subject:
          question.topology?.subject?.name ??
          question.topology?.subject?.canonicalName ??
          null,
        topic:
          question.topology?.topic?.name ??
          question.topology?.topic?.canonicalName ??
          null,
        subtopic:
          question.topology?.subtopic?.name ??
          question.topology?.subtopic?.canonicalName ??
          null,
      },
      pyq: {
        type: question.pyq?.type ?? null,
        year: question.pyq?.year ?? null,
        exam: question.pyq?.exam?.name ?? question.pyq?.exam?.canonicalName ?? null,
        branch:
          question.pyq?.branch?.name ?? question.pyq?.branch?.canonicalName ?? null,
        paper:
          question.pyq?.paper?.name ?? question.pyq?.paper?.canonicalName ?? null,
      },
    },
  };
};

const describeFilters = (filters: RawDataset['filters']): string[] => {
  const summary: string[] = [];

  if (filters.questionTypes?.length) {
    summary.push(`Types: ${filters.questionTypes.join(', ')}`);
  }

  if (filters.status?.length) {
    summary.push(`Statuses: ${filters.status.join(', ')}`);
  }

  if (filters.excludeImages) {
    summary.push('Images excluded');
  }

  return summary;
};

export const questionDataset: BenchmarkQuestion[] = dataset.questions.map(mapQuestion);

export const questionDatasetSummary: QuestionDatasetSummary = {
  label: 'GATE PYQ Sample',
  generatedAt: dataset.generatedAt,
  total: dataset.total,
  filters: describeFilters(dataset.filters),
  stats: {
    poolSize: dataset.stats.poolSize,
    poolWithoutImages: dataset.stats.poolWithoutImages,
    countsByType: dataset.stats.countsByType,
  },
};

export const questionLookup = new Map(questionDataset.map((item) => [item.id, item]));
