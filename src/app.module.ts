import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AnalysisModule } from './analysis/analysis.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './common/config/env.validation';
import { GenerationModule } from './generation/generation.module';
import { GithubModule } from './github/github.module';
import { KbModule } from './knowledge-base/kb.module';
import { SlackModule } from './slack/slack.module';
import { VoiceModule } from './voice/voice.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    EventEmitterModule.forRoot(),
    SlackModule,
    GithubModule,
    VoiceModule,
    AnalysisModule,
    GenerationModule,
    KbModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
