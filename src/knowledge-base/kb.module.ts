import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { SlackModule } from '../slack/slack.module';
import { KbService } from './kb.service';

@Module({
  imports: [GithubModule, SlackModule],
  providers: [KbService],
  exports: [KbService],
})
export class KbModule {}
