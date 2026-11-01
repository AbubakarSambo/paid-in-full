import { Module } from '@nestjs/common';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';

/** Import SheetsModule and inject SheetsService to call syncBatch()/syncInvoice() (they never throw). */
@Module({
  controllers: [SheetsController],
  providers: [SheetsService],
  exports: [SheetsService],
})
export class SheetsModule {}
