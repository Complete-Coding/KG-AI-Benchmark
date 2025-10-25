import { questionTopology } from '@/data/topology';
import type { QuestionTopologySubject, QuestionTopologyTopic, QuestionTopologySubtopic } from '@/types/benchmark';

/**
 * Find a subject by its ID
 */
export const findSubjectById = (id?: string | null): QuestionTopologySubject | null => {
  if (!id) return null;
  return questionTopology.find(s => s.id === id) ?? null;
};

/**
 * Find a topic by its ID within a specific subject
 */
export const findTopicById = (subjectId?: string | null, topicId?: string | null): QuestionTopologyTopic | null => {
  const subject = findSubjectById(subjectId);
  if (!subject || !topicId) return null;
  return subject.topics.find(t => t.id === topicId) ?? null;
};

/**
 * Find a subtopic by its ID within a specific topic
 */
export const findSubtopicById = (
  subjectId?: string | null,
  topicId?: string | null,
  subtopicId?: string | null
): QuestionTopologySubtopic | null => {
  const topic = findTopicById(subjectId, topicId);
  if (!topic || !subtopicId) return null;
  return topic.subtopics.find(st => st.id === subtopicId) ?? null;
};

/**
 * Format topology IDs as display string with names
 * Example: "Theory of Computation › Context Free Grammar › Basics"
 */
export const formatTopologyIds = (topology: {
  subjectId?: string | null;
  topicId?: string | null;
  subtopicId?: string | null;
}): string => {
  const subject = findSubjectById(topology.subjectId);
  const topic = findTopicById(topology.subjectId, topology.topicId);
  const subtopic = findSubtopicById(topology.subjectId, topology.topicId, topology.subtopicId);

  const parts = [
    subject?.name ?? '—',
    topic?.name ?? '—',
    subtopic?.name ?? '—'
  ];

  return parts.join(' › ');
};

/**
 * Get topology names from IDs for display
 */
export const getTopologyNames = (topology: {
  subjectId?: string | null;
  topicId?: string | null;
  subtopicId?: string | null;
}) => {
  const subject = findSubjectById(topology.subjectId);
  const topic = findTopicById(topology.subjectId, topology.topicId);
  const subtopic = findSubtopicById(topology.subjectId, topology.topicId, topology.subtopicId);

  return {
    subject: subject?.name ?? null,
    topic: topic?.name ?? null,
    subtopic: subtopic?.name ?? null,
  };
};
