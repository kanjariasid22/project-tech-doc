import { AnalysisResult } from '../common/interfaces/analysis-result.interface';
import { PRContext } from '../common/interfaces/pr-context.interface';

export class VoiceCompletedEvent {
  prContext: PRContext;
  analysis: AnalysisResult;
  transcript: string;
}
