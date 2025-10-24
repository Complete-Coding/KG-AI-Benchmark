import rawTopology from './benchmark-topology.json';
import { QuestionTopology, QuestionTopologySubject } from '@/types/benchmark';

const topologyDataset = (rawTopology as QuestionTopology) ?? { subjects: [] };

const subjects: QuestionTopologySubject[] = Array.isArray(topologyDataset.subjects)
  ? topologyDataset.subjects
  : [];

export const questionTopologyGeneratedAt = topologyDataset.generatedAt;
export const questionTopology: QuestionTopologySubject[] = subjects;
