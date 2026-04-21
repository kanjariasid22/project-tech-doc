import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ElevenLabsClient } from 'elevenlabs';
import { AnalysisResult } from '../common/interfaces/analysis-result.interface';
import { PRContext } from '../common/interfaces/pr-context.interface';
import { PrAnalyzedEvent } from '../events/pr-analyzed.event';
import { PrFailedEvent } from '../events/pr-failed.event';
import { VoiceCompletedEvent } from '../events/voice-completed.event';
import { SlackService } from '../slack/slack.service';

const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 10 * 60 * 1_000;

const BASE_SYSTEM_PROMPT = [
  'You are a documentation assistant. Your job is to have a short',
  'conversation with a developer to confirm your understanding of a PR',
  'they just shipped and ask a few clarifying questions. Be concise and',
  'professional. Once you have confirmation and answers to all questions,',
  'say "Thank you, I have everything I need. Goodbye." and end the session.',
].join(' ');

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly client: ElevenLabsClient;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly slack: SlackService,
  ) {
    this.client = new ElevenLabsClient({
      apiKey: this.config.getOrThrow<string>('ELEVENLABS_API_KEY'),
    });
  }

  @OnEvent('pr.analyzed')
  async handlePrAnalyzed(payload: PrAnalyzedEvent): Promise<void> {
    const { prContext, analysis } = payload;
    const { prNumber, channelId, triggeredBy } = prContext;

    try {
      const agent = await this.client.conversationalAi.createAgent({
        name: `pr-${prNumber}-${Date.now()}`,
        conversation_config: {
          agent: {
            prompt: {
              prompt: this.buildSystemPrompt(prContext, analysis),
            },
            first_message: [
              `Hi! I've analyzed PR #${prNumber}`,
              `— "${prContext.title}".`,
              'I have a few questions to confirm my understanding.',
              'Is now a good time?',
            ].join(' '),
          },
          tts: {
            voice_id: 'ePn9OncKq8KyJvrTRqTi',
          },
        },
      });

      const agentId = agent.agent_id;
      const shareUrl = `https://elevenlabs.io/app/talk-to?agent_id=${agentId}`;
      const startedAt = Date.now();

      await this.slack.postMessage(
        channelId,
        [
          `Hey <@${triggeredBy}>! I've analyzed PR #${prNumber}.`,
          `Join this quick voice chat so I can confirm my understanding:`,
          shareUrl,
          `It'll take less than 2 minutes.`,
        ].join('\n'),
      );

      const transcript = await this.pollForTranscript(agentId, startedAt);

      if (transcript === null) {
        throw new Error('Voice conversation timed out after 10 minutes');
      }

      const event = Object.assign(new VoiceCompletedEvent(), {
        prContext,
        analysis,
        transcript,
      });

      this.events.emit('voice.completed', event);
      this.logger.log(`Voice session complete for PR #${prNumber}`);
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : 'Unknown voice error';

      this.logger.error(`Voice session failed for PR #${prNumber}: ${reason}`);

      const failed = Object.assign(new PrFailedEvent(), {
        prNumber,
        channelId,
        reason,
      });

      this.events.emit('pr.failed', failed);
    }
  }

  private async pollForTranscript(
    agentId: string,
    startedAt: number,
  ): Promise<string | null> {
    const deadline = startedAt + TIMEOUT_MS;

    while (Date.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);

      const page = await this.client.conversationalAi.getConversations({
        agent_id: agentId,
      });

      const completed = page.conversations.find(
        (c) =>
          c.status === 'done' && c.start_time_unix_secs * 1000 >= startedAt,
      );

      if (completed) {
        const full = await this.client.conversationalAi.getConversation(
          completed.conversation_id,
        );

        return full.transcript
          .map((t) => `${t.role}: ${t.message ?? ''}`)
          .join('\n');
      }
    }

    return null;
  }

  private buildSystemPrompt(ctx: PRContext, analysis: AnalysisResult): string {
    const questions = analysis.questions
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n');

    return [
      BASE_SYSTEM_PROMPT,
      '',
      '## PR Summary',
      analysis.summary,
      '',
      '## Why This Change Was Made',
      analysis.why,
      '',
      '## Questions to Ask',
      questions,
    ].join('\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
