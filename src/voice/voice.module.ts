import { Module } from '@nestjs/common';
import { SlackModule } from '../slack/slack.module';
import { VoiceService } from './voice.service';

@Module({
  imports: [SlackModule],
  providers: [VoiceService],
  exports: [VoiceService],
})
export class VoiceModule {}
