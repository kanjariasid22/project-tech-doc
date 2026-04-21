import { AnalysisResult } from '../common/interfaces/analysis-result.interface';
import { PRContext } from '../common/interfaces/pr-context.interface';

export class DocsGeneratedEvent {
  prContext: PRContext;
  analysis: AnalysisResult;
  technicalDoc: string;
  userGuide: string;
  techPath: string;
  guidePath: string;
}
