import { ModelProfile } from '@/types/benchmark';
import { fetchModels, sendChatCompletion } from '@/services/lmStudioClient';
import { parseModelResponse, parseTopologyPrediction } from '@/services/evaluation';
import createId from '@/utils/createId';

export interface CompatibilityCheckLog {
  id: string;
  timestamp: string;
  message: string;
  severity: 'info' | 'warn' | 'error';
}

export interface CompatibilityCheckStep {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'pending';
  logs: CompatibilityCheckLog[];
  error?: string;
}

export interface CompatibilityCheckResult {
  compatible: boolean;
  summary: string;
  jsonFormat?: 'json_object' | 'json_schema' | 'none';
  steps: CompatibilityCheckStep[];
  startedAt: string;
  completedAt: string;
  metadata: Record<string, unknown>;
}

const createLog = (message: string, severity: 'info' | 'warn' | 'error' = 'info'): CompatibilityCheckLog => ({
  id: createId(),
  timestamp: new Date().toISOString(),
  message,
  severity,
});

// Simple test question for protocol compliance
const TEST_QUESTION = {
  id: 'compat-test',
  type: 'MCQ',
  prompt: 'What is 2 + 2?',
  options: [
    { id: 0, order: 0, text: '3' },
    { id: 1, order: 1, text: '4' },
    { id: 2, order: 2, text: '5' },
    { id: 3, order: 3, text: '6' },
  ],
};

/**
 * Run unified compatibility check on a profile.
 * This replaces separate L1/L2 diagnostics with a single comprehensive check.
 *
 * Checks performed (fail-fast):
 * 1. Connectivity - Can we reach the server?
 * 2. JSON Mode - Does the server support JSON formatting? (json_object or json_schema)
 * 3. Protocol - Can the model return properly formatted responses?
 */
export const runCompatibilityCheck = async (
  profile: ModelProfile
): Promise<CompatibilityCheckResult> => {
  const startedAt = new Date().toISOString();
  const steps: CompatibilityCheckStep[] = [
    { id: 'connectivity', name: 'Server Connectivity', status: 'pending', logs: [] },
    { id: 'json_mode', name: 'JSON Mode Support', status: 'pending', logs: [] },
    { id: 'protocol', name: 'Protocol Compliance', status: 'pending', logs: [] },
  ];

  let compatible = false;
  let summary = '';
  let jsonFormat: 'json_object' | 'json_schema' | 'none' = 'none';

  // STEP 1: CONNECTIVITY CHECK
  const connectivityStep = steps[0];
  connectivityStep.status = 'pending';
  connectivityStep.logs.push(createLog('Testing server connectivity...'));

  try {
    const models = await fetchModels(profile);
    const modelIds = models.map((m) => m.id).join(', ') || 'no models reported';

    connectivityStep.logs.push(createLog(`✓ Server responded successfully`));
    connectivityStep.logs.push(createLog(`Available models: ${modelIds}`));
    connectivityStep.status = 'pass';
  } catch (error) {
    const errorMsg = (error as Error).message || 'unknown error';
    connectivityStep.logs.push(createLog(`❌ Connection failed: ${errorMsg}`, 'error'));
    connectivityStep.status = 'fail';
    connectivityStep.error = errorMsg;

    summary = `Server not reachable at ${profile.baseUrl}`;
    const completedAt = new Date().toISOString();

    return {
      compatible: false,
      summary,
      jsonFormat: 'none',
      steps,
      startedAt,
      completedAt,
      metadata: { error: errorMsg },
    };
  }

  // STEP 2: JSON MODE CHECK
  const jsonStep = steps[1];
  jsonStep.status = 'pending';
  jsonStep.logs.push(createLog('Testing JSON mode support...'));

  try {
    const testCompletion = await sendChatCompletion({
      profile,
      messages: [
        {
          role: 'system',
          content: 'You are a test assistant. Return only the requested JSON, no additional text.',
        },
        {
          role: 'user',
          content: 'Return the JSON object {"answer": "4"} with no additional text.',
        },
      ],
      temperature: 0,
      preferJson: true,
      schemaType: 'answer',
    });

    if (testCompletion.supportsJsonMode && testCompletion.jsonFormat) {
      jsonFormat = testCompletion.jsonFormat;
      jsonStep.logs.push(createLog(`✓ JSON mode supported: ${jsonFormat}`));
      jsonStep.status = 'pass';
    } else {
      jsonStep.logs.push(createLog('❌ JSON mode not supported', 'error'));
      jsonStep.status = 'fail';
      jsonStep.error = 'JSON mode required but not available';

      summary = 'Model does not support JSON mode (required for benchmarking)';
      const completedAt = new Date().toISOString();

      return {
        compatible: false,
        summary,
        jsonFormat: 'none',
        steps,
        startedAt,
        completedAt,
        metadata: { supportsJsonMode: false },
      };
    }
  } catch (error) {
    const errorMsg = (error as Error).message || 'unknown error';
    jsonStep.logs.push(createLog(`❌ JSON mode test failed: ${errorMsg}`, 'error'));
    jsonStep.status = 'fail';
    jsonStep.error = errorMsg;

    summary = 'JSON mode test failed';
    const completedAt = new Date().toISOString();

    return {
      compatible: false,
      summary,
      jsonFormat: 'none',
      steps,
      startedAt,
      completedAt,
      metadata: { error: errorMsg },
    };
  }

  // STEP 3: PROTOCOL COMPLIANCE CHECK
  const protocolStep = steps[2];
  protocolStep.status = 'pending';
  protocolStep.logs.push(createLog('Testing protocol compliance with topology and answer steps...'));

  try {
    // Test topology classification
    const topologyPrompt = `Question (${TEST_QUESTION.type}): ${TEST_QUESTION.prompt}\n\nOptions:\n${TEST_QUESTION.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join('\n')}\n\nClassify the question before answering. Return JSON with keys \`subject\`, \`topic\`, \`subtopic\`, and optionally \`confidence\` (0-1).`;

    const topologyCompletion = await sendChatCompletion({
      profile,
      messages: [
        { role: 'system', content: profile.defaultSystemPrompt },
        { role: 'user', content: topologyPrompt },
      ],
      temperature: profile.temperature,
      maxTokens: profile.maxOutputTokens,
      preferJson: true,
      schemaType: 'topology',
    });

    protocolStep.logs.push(createLog(`Topology response received (${topologyCompletion.text.length} chars)`));

    let topologyParsed;
    try {
      topologyParsed = parseTopologyPrediction(topologyCompletion.text);
      protocolStep.logs.push(createLog(`✓ Topology parsed: ${topologyParsed.subjectId || 'none'}, ${topologyParsed.topicId || 'none'}, ${topologyParsed.subtopicId || 'none'}`));
    } catch (parseError) {
      throw new Error(`Topology parsing failed: ${(parseError as Error).message}`);
    }

    // Test answer with topology context
    const answerPrompt = `Question (${TEST_QUESTION.type}): ${TEST_QUESTION.prompt}\n\nOptions:\n${TEST_QUESTION.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join('\n')}\n\nReturn a JSON object with keys \`answer\`, \`explanation\`, and \`confidence\` (0-1). For multiple answers, join values using commas (e.g., "A,C").\n\nTopology classification: ${JSON.stringify({ subjectId: topologyParsed.subjectId, topicId: topologyParsed.topicId, subtopicId: topologyParsed.subtopicId })}`;

    const answerCompletion = await sendChatCompletion({
      profile,
      messages: [
        { role: 'system', content: profile.defaultSystemPrompt },
        { role: 'user', content: answerPrompt },
      ],
      temperature: profile.temperature,
      maxTokens: profile.maxOutputTokens,
      preferJson: true,
      schemaType: 'answer',
    });

    protocolStep.logs.push(createLog(`Answer response received (${answerCompletion.text.length} chars)`));

    let answerParsed;
    try {
      answerParsed = parseModelResponse(answerCompletion.text);
      protocolStep.logs.push(createLog(`✓ Answer parsed: "${answerParsed.answer}"`));
      if (answerParsed.explanation) {
        protocolStep.logs.push(createLog(`✓ Explanation included`));
      }
      if (answerParsed.confidence !== undefined) {
        protocolStep.logs.push(createLog(`✓ Confidence score: ${answerParsed.confidence}`));
      }
    } catch (parseError) {
      throw new Error(`Answer parsing failed: ${(parseError as Error).message}`);
    }

    protocolStep.status = 'pass';
    protocolStep.logs.push(createLog('✓ Protocol compliance verified'));

    // All checks passed!
    compatible = true;
    summary = `Compatible - Supports ${jsonFormat} format`;

  } catch (error) {
    const errorMsg = (error as Error).message || 'unknown error';
    protocolStep.logs.push(createLog(`❌ Protocol test failed: ${errorMsg}`, 'error'));
    protocolStep.status = 'fail';
    protocolStep.error = errorMsg;

    summary = 'Model does not follow required response format';
  }

  const completedAt = new Date().toISOString();

  return {
    compatible,
    summary,
    jsonFormat,
    steps,
    startedAt,
    completedAt,
    metadata: {
      profileId: profile.id,
      profileName: profile.name,
      modelId: profile.modelId,
      supportsJsonMode: jsonFormat === 'json_object' || jsonFormat === 'json_schema',
    },
  };
};
