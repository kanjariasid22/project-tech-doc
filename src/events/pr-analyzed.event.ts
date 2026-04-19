import { AnalysisResult } from '../common/interfaces/analysis-result.interface';
import { PRContext } from '../common/interfaces/pr-context.interface';

export class PrAnalyzedEvent {
  prContext: PRContext;
  analysis: AnalysisResult;
}
