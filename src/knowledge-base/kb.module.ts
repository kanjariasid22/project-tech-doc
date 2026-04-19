import { Module } from '@nestjs/common';
import { KbService } from './kb.service';

@Module({
  providers: [KbService],
  exports: [KbService],
})
export class KbModule {}
